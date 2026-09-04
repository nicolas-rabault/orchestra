// A landing outlives the session that asked for it, and this is the whole mechanism.
//
// THE SHAPE, AND WHY IT IS NOT AN ACCOMMODATION. A landing is one process from the lock to the
// fast-forward, and the gates inside it are minutes — against a 600-second ceiling on an agent's
// Bash call. A foreground landing therefore loses that race whenever the machine is busy. But
// backgrounding the call is WORSE than the problem it solves: a subagent has no tool with which to
// wait on a background job, so its only move is to end its turn, and a subagent that ends its turn
// is over. The landing then outlives the only process that knew its exit code, and the outcome is
// lost in a way no amount of care by the agent can recover.
//
// So: `--detach` forks the real work into its own session, writes its outcome to a durable run
// record, and returns at once. `await` blocks in bounded chunks that fit under the ceiling, and can
// be re-run any number of times, by any number of sessions, including ones that started after the
// original died. Nothing needs a notification, so nothing can miss one.
import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { gitEnv } from '../paths.mjs';
import { BIN, gatePaths, gitOk, precheck } from './land.mjs';
import * as S from './state.mjs';

const err = (s) => process.stderr.write(`orchestra gate: ${s}\n`);
const readFile = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleepMs = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const nowSec = () => Math.floor(Date.now() / 1000);
const age = (s) => (s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`);

// The parent half. It writes the run record BEFORE the fork so that an `await` racing it by a
// millisecond still finds one, then hands the child its own session and returns.
export function detach(cfg, branch, waitSeconds) {
  const p = gatePaths(cfg.root);
  // Run BEFORE anything is recorded, so a typo is refused by the command the agent actually
  // watched rather than surfacing one poll later, out of a log.
  const pre = precheck(cfg, branch);
  if (pre.exit !== undefined) return pre.exit;

  const runFile = p.runFor(branch);
  const logFile = p.logFor(branch);

  // A landing already running is not something to start twice: the second would only register as a
  // waiter and block behind the first, while overwriting the record that names the first.
  const existing = S.parseRun(readFile(runFile));
  const verdict = S.runVerdict({
    run: existing, alive: existing ? alive(existing.pid) : false, nowSec: nowSec(),
  });
  if (verdict.state === 'running') {
    err(`'${branch}' is already landing — pid ${existing.pid}, ${age(verdict.elapsed)} in`);
    err(`run \`orchestra await ${branch}\``);
    return S.EXIT.started;
  }

  writeFileSync(runFile, S.formatRun({
    branch, pid: null, startedAt: nowSec(), log: logFile, exit: null, endedAt: null,
  }));
  // Truncated, not appended: the log belongs to THIS attempt, and an agent reading a conflict out
  // of the previous one would resolve a conflict that is no longer there.
  const fd = openSync(logFile, 'w');
  try {
    const child = spawn(process.execPath, [BIN, 'land', branch, `--wait=${waitSeconds}`], {
      cwd: cfg.root,
      // Its own session, so the child does not take the SIGHUP that ends the agent's shell — which
      // is the entire point: this process is meant to outlive its caller.
      detached: true,
      stdio: ['ignore', fd, fd],
      env: { ...gitEnv(), ORCHESTRA_GATE_RUN_FILE: runFile },
    });
    child.unref();
    // Read-modify-write, not a second blind write: a child that failed a precondition in the
    // milliseconds since the spawn has already recorded its exit, and stamping the pid over it
    // would erase the only answer anybody wanted.
    const seeded = S.parseRun(readFile(runFile));
    writeFileSync(runFile, S.formatRun({ ...seeded, pid: child.pid }));
    err(`landing '${branch}' detached — pid ${child.pid}, log ${logFile}`);
    err(`poll it with \`orchestra await ${branch}\` — never re-run land`);
  } finally {
    closeSync(fd);
  }
  return S.EXIT.started;
}

// The child half. Whatever happens to it — a throw, a signal — the code it exits with is the one
// thing the caller cannot reconstruct later.
//
// It CLAIMS the record by pid first, and refuses one already claimed by someone else. That is not
// defensive dressing: `ORCHESTRA_GATE_RUN_FILE` travels in the environment, and an environment is
// inherited by every descendant — including a gate that itself runs this plugin. Such a nested run
// would stamp its own exit code onto the live landing's record, so `await` would read a finished
// landing while the real one was still rebasing. A pid cannot be inherited, so it is what tells the
// landing apart from its own descendants.
function ownsRun(run) {
  // pid null is the sliver between the parent's first write and its second, when only the real
  // child can be running at all.
  return !!run && (run.pid === null || run.pid === process.pid);
}

export function recordOutcome(runFile) {
  const claimed = S.parseRun(readFile(runFile));
  if (!ownsRun(claimed)) return;
  try {
    writeFileSync(runFile, S.formatRun({ ...claimed, pid: process.pid }));
  } catch { /* the parent's own write is the authority; ours is only the race-closer */ }
  process.on('exit', (code) => {
    try {
      const run = S.parseRun(readFile(runFile));
      // Re-checked at exit, not trusted from the claim: a later `land --detach` on the same branch
      // legitimately takes the record over, and a landing that has been superseded must not
      // overwrite its successor's outcome on its way out.
      if (!ownsRun(run)) return;
      writeFileSync(runFile, S.formatRun({ ...run, exit: code, endedAt: nowSec() }));
    } catch { /* the landing's own exit code matters more than our bookkeeping */ }
  });
}

// The tail is the report. An agent that polls a landing has no scrollback for it — the output went
// to a file in another session — so a verdict without the last lines of the log would name exit 10
// or 11 and leave the agent to go and find out which files.
const tailOfLog = (logFile, lines) => {
  const text = readFile(logFile).trimEnd();
  return text ? text.split('\n').slice(-lines).join('\n') : '';
};

// The refusing gate's name, from the durable record rather than from the log's last lines, which a
// verbose gate can push out of a 40-line tail. This is the third of the three places the name
// travels, and the only one an agent is guaranteed to read.
const noteFor = (p, branch) => S.findEntry(S.parseState(readFile(p.state)), branch)?.note ?? '';

// Blocks in one bounded chunk and reports; it never waits past the caller's ceiling, and running it
// again is always correct. That is what makes a lost turn survivable: the state lives on disk, so
// the session that reads the outcome need not be the session that started the landing.
export function awaitRun(cfg, branch, forSeconds) {
  const p = gatePaths(cfg.root);
  const runFile = p.runFor(branch);
  const deadline = Date.now() + forSeconds * 1000;
  for (;;) {
    const run = S.parseRun(readFile(runFile));
    const v = S.runVerdict({ run, alive: run ? alive(run.pid) : false, nowSec: nowSec() });
    if (v.state === 'unknown') {
      err(`no detached landing on record for '${branch}'`);
      err(`start one with \`orchestra land ${branch} --detach\``);
      return S.EXIT.usage;
    }
    if (v.state === 'finished') {
      const note = noteFor(p, branch);
      err(`'${branch}' finished with exit ${v.exit} after ${age(v.elapsed)}`
        + `${note ? ` — ${note}` : ''} — full log: ${run.log}`);
      const report = tailOfLog(run.log, 40);
      if (report) process.stderr.write(`${report}\n`);
      return v.exit;
    }
    if (v.state === 'vanished') {
      // Distinguished from `busy` on purpose: the caller must NOT keep waiting, and must not assume
      // nothing happened either — the fast-forward may already have run.
      err(`the landing of '${branch}' (pid ${run.pid}) is gone and recorded no exit after`
        + ` ${age(v.elapsed)} — it was killed, not finished`);
      err(`check \`git -C ${cfg.root} log --oneline -3\` and the log at ${run.log} before starting over`);
      const report = tailOfLog(run.log, 20);
      if (report) process.stderr.write(`${report}\n`);
      return v.exit;
    }
    if (Date.now() >= deadline) {
      err(`'${branch}' is still landing — pid ${run.pid}, ${age(v.elapsed)} in.`
        + ' Run await again; do not run land again.');
      return S.EXIT.busy;
    }
    sleepMs(2000);
  }
}

// What is in the queue, and — the one line worth acting on — whether any live process is moving it.
//
// It also REAPS, which is what replaces the source's `drop` verb: an entry whose branch ref is gone
// landed, or was deleted, and either way nothing will ever move it again. An entry whose branch
// still exists is never touched — remembering a branch blocked by a conflict is the record's job.
export function queueList(cfg) {
  const p = gatePaths(cfg.root);
  const refExists = (b) => gitOk(cfg.root, ['rev-parse', '--verify', `refs/heads/${b}`]);
  const state = S.dropVanished(S.parseState(readFile(p.state)), refExists);
  writeFileSync(p.state, S.formatState(state));

  const holder = S.reapHolder(S.parseHolder(readFile(p.holder)), alive);
  const waiters = S.reapWaiters(S.parseWaiters(readFile(p.waiters)), alive);
  if (!state.entries.length) { process.stdout.write('merge queue: empty\n'); return S.EXIT.ok; }
  const now = nowSec();
  for (const e of state.entries) {
    const waiting = waiters.find((x) => x.branch === e.branch);
    // "no live process" is the one line worth acting on: the entry outlived its agent, and nothing
    // will move it until somebody runs `land` again.
    const who = holder?.branch === e.branch ? `pid ${holder.pid} holds the lock`
      : waiting ? `pid ${waiting.pid} waiting`
        : 'no live process';
    process.stdout.write(`${e.state.padEnd(8)} ${age(now - e.enqueuedAt).padStart(5)}`
      + `  ${e.branch}  (${who})${e.note ? ` — ${e.note}` : ''}\n`);
  }
  return S.EXIT.ok;
}
