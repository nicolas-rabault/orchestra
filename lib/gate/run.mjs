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
import { closeSync, openSync, readFileSync } from 'node:fs';
import { gitEnv } from '../paths.mjs';
import { readJsonl } from '../jsonl.mjs';
import { BIN, gateFiles, gatePaths, gitOk, precheck, withMutex, writeAtomic } from './land.mjs';
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
    // `existing.pid` is null for the sliver between the seed write and the pid stamp (see the
    // comment on `runVerdict` in ./state.mjs) — never printed as the literal word "null".
    err(`'${branch}' is already landing — pid ${existing.pid ?? 'starting'}, ${age(verdict.elapsed)} in`);
    err(`run \`orchestra await ${branch}\``);
    return S.EXIT.started;
  }

  writeAtomic(runFile, S.formatRun({
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
    writeAtomic(runFile, S.formatRun({ ...seeded, pid: child.pid }));
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
// It CLAIMS the record by pid first, and refuses one already claimed by someone else (`S.ownsRun`,
// in ./state.mjs, where the decision is tested). That is not defensive dressing:
// `ORCHESTRA_GATE_RUN_FILE` travels in the environment, and an environment is inherited by every
// descendant — including a gate that itself runs this plugin. Such a nested run would stamp its own
// exit code onto the live landing's record, so `await` would read a finished landing while the real
// one was still rebasing. A pid cannot be inherited, so it is what tells the landing apart from its
// own descendants.
export function recordOutcome(runFile) {
  const claimed = S.parseRun(readFile(runFile));
  if (!S.ownsRun(claimed, process.pid)) return;
  try {
    writeAtomic(runFile, S.formatRun({ ...claimed, pid: process.pid }));
  } catch { /* the parent's own write is the authority; ours is only the race-closer */ }
  process.on('exit', (code) => {
    try {
      const run = S.parseRun(readFile(runFile));
      // Re-checked at exit, not trusted from the claim: a later `land --detach` on the same branch
      // legitimately takes the record over, and a landing that has been superseded must not
      // overwrite its successor's outcome on its way out.
      if (!S.ownsRun(run, process.pid)) return;
      writeAtomic(runFile, S.formatRun({ ...run, exit: code, endedAt: nowSec() }));
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

// What every earlier passage on this branch came to. Printed rather than left to be grepped, because
// it is what makes exit 17's instruction — "land again once" — a rule an agent can actually follow:
// without it, "again" has no meaning and a machine refusal becomes a retry loop.
const historyFor = (p, branch) =>
  S.attemptHistoryLine(S.attemptSummary(readJsonl(p.attempts).entries, branch));

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
      const history = historyFor(p, branch);
      if (history) err(history);
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
      // `run.pid` can still be null here if `forSeconds` expired inside the same sliver — never
      // printed as the literal word "null".
      err(`'${branch}' is still landing — pid ${run.pid ?? 'starting'}, ${age(v.elapsed)} in.`
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
  // The read and the reap-write are ONE critical section, under the same mutex `land.mjs`'s `mark`
  // takes — not just an atomic write of our own. `queue.json` has always had two writers (`mark` and
  // this reap); making only THIS write atomic protected other readers from us, which is the direction
  // that does not lose data. It left us unprotected from `mark`: a read landing mid-`mark` sees a
  // state `mark` has already truncated — `parseState` (correctly) maps that to `{...EMPTY}` — and
  // `dropVanished` on an empty state drops nothing, so the empty state would be written straight
  // back, wiping every entry's state and note, including the note `noteFor` above is the only place
  // an agent is guaranteed to read one. The mutex closes the same window `writeAtomic` closes for the
  // run record, just against the OTHER writer.
  //
  // `holder` and `waiters` are read in the SAME critical section, for the identical reason: `mark`,
  // `acquire` and `release` all write those two files with a plain `writeFileSync` (truncate then
  // write), not `writeAtomic`, so a read outside the mutex can land mid-write and see a torn or
  // empty file — the one line this command exists to get right ("no live process" for a branch that
  // in fact has one) read off exactly that torn read. There is no reason the second writer should be
  // the unguarded one, and that reasoning does not stop at `queue.json`'s door.
  //
  // The write itself only happens when reaping actually changed something: the common call is
  // read-only, and skipping the write is what keeps an ordinary `queue-list` from being a second
  // writer at all in the case that matters — nothing to land on mid-write when there is no write.
  const { state, holder, waiters } = withMutex(p, () => {
    const before = S.parseState(readFile(p.state));
    const reaped = S.dropVanished(before, refExists);
    if (reaped.entries.length !== before.entries.length) writeAtomic(p.state, S.formatState(reaped));
    return {
      state: reaped,
      holder: S.reapHolder(S.parseHolder(readFile(p.holder)), alive),
      waiters: S.reapWaiters(S.parseWaiters(readFile(p.waiters)), alive),
    };
  });

  if (!state.entries.length) { process.stdout.write('merge queue: empty\n'); return S.EXIT.ok; }
  const now = nowSec();
  // Read once for the whole listing, outside the mutex: the attempt ledger is append-only, so a
  // concurrent write can only add a line this listing has not counted — never tear one it has.
  const attempts = readJsonl(p.attempts).entries;
  const stalled = new Set(S.stalledEntries({ entries: state.entries, holder, waiters }).map((e) => e.branch));
  for (const e of state.entries) {
    const waiting = waiters.find((x) => x.branch === e.branch);
    // "no live process" is the one line worth acting on: the entry outlived its agent, and nothing
    // will move it until somebody runs `land` again. On a `queued` or `landing` entry that is a
    // stall, and `orchestra ready` names it too — nobody ran this command for the two hours LP6 spent
    // in exactly that state on 2026-09-08.
    const who = holder?.branch === e.branch ? `pid ${holder.pid} holds the lock`
      : waiting ? `pid ${waiting.pid} waiting`
        : `no live process${stalled.has(e.branch) ? ' — STALLED, run land again' : ''}`;
    const history = S.attemptHistoryLine(S.attemptSummary(attempts, e.branch));
    process.stdout.write(`${e.state.padEnd(8)} ${age(now - e.enqueuedAt).padStart(5)}`
      + `  ${e.branch}  (${who})${e.note ? ` — ${e.note}` : ''}${history ? `\n         ${history}` : ''}\n`);
  }
  return S.EXIT.ok;
}

// What the merge queue owes the conductor, for `orchestra ready` to print beside the turns it owes
// its workers. Read-only and lock-free, which is the whole reason it is separate from `queueList`:
// that command reaps, and reaping needs the mutex and a `git rev-parse` per entry. This is three
// file reads on a tick that runs every hour, and a torn read of `holder` or `waiters` costs at worst
// one spurious line rather than a wrong decision — nothing acts on it, a person does.
//
// Returns [] on any project that has never landed anything, which is most of them.
export function stalledLandings(cfg) {
  const p = gateFiles(cfg.root);
  const entries = S.parseState(readFile(p.state)).entries;
  if (!entries.length) return [];
  const holder = S.reapHolder(S.parseHolder(readFile(p.holder)), alive);
  const waiters = S.reapWaiters(S.parseWaiters(readFile(p.waiters)), alive);
  const now = nowSec();
  return S.stalledEntries({ entries, holder, waiters })
    .map((e) => ({ branch: e.branch, state: e.state, note: e.note ?? '', age: age(now - e.enqueuedAt) }));
}
