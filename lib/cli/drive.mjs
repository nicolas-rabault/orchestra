// `orchestra drive [<id>…] [--for=<seconds>]` — the resume cycle as one command, and the only writer
// of a relay's receipt.
//
// What it replaces was three lines a conductor typed per worker (`claude stop`, `cd`, `claude -p
// --resume … "<nudge>"`), which is what the protocol still calls the ONLY thing that moves a worker.
// Typed by hand, the cycle was skipped for a whole fleet on 2026-09-08 in duckJam, and when it was
// typed, the nudge was generic while the relay sat on the row — see lib/register/drive.mjs. Here the
// nudge is built from the row and nowhere else, the turn is run in the worktree, and the receipt is
// stamped by the process that watched the turn return.
//
// THE TURN IS DETACHED, for the reason `orchestra land --detach` is (lib/gate/run.mjs): a worker's
// turn is minutes against the 600-second ceiling on the caller's Bash call, and a headless tick ends
// with the session that ran it. The parent waits up to `--for` and prints each report as it lands;
// exit 12 says some are still running and this same command, run again, picks them up — the
// outcome is on disk, so the session that reads it need not be the one that started it.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { readState, writeState } from '../register/state.mjs';
import { reconcileTasks, gatherGit } from '../register/ready.mjs';
import { obligations, nudgeFor, driveSlug, relayOwed, turnVerdict, turnRefusal } from '../register/drive.mjs';
import { gatherLiveness, turnPaths, readTurn, writeTurn } from '../register/liveness.mjs';
import { pidAlive } from '../register/beat.mjs';
import { oneLine } from '../register/inbox.mjs';
import { TERMINAL } from '../register/archive.mjs';
import { worktreePaths } from '../monitor/sources.mjs';
import { ORCHESTRA_BIN } from '../guards/orchestraBin.mjs';

// The same number `orchestra await` answers with: "still going — run this again".
export const STILL_RUNNING_EXIT = 12;

const out = (s) => process.stdout.write(`${s}\n`);
const sleepMs = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const age = (fromIso, toMs = Date.now()) => {
  const s = Math.round((toMs - Date.parse(fromIso ?? '')) / 1000);
  if (!Number.isFinite(s)) return '?';
  return s < 90 ? `${Math.max(0, s)}s` : `${Math.round(s / 60)}m`;
};
const tailOf = (path, lines) => {
  let text;
  try { text = readFileSync(path, 'utf8').trimEnd(); } catch { return ''; }
  return text ? text.split('\n').slice(-lines).join('\n') : '';
};

// The last thing a worker said, for the lines `ready` prints: one line, capped, off the turn's log.
export const lastWords = (log) => oneLine(tailOf(log, 3), 120);

// What one returned turn says, for the conductor reading a `drive` — the same shape whether the turn
// returned while this command waited or before it was run.
function report(turn, verdict) {
  const elapsed = age(turn.startedAt, Date.parse(turn.endedAt ?? '') || Date.now());
  if (verdict === 'vanished') {
    out(`--- ${turn.id}: the turn (pid ${turn.pid ?? 'starting'}) is gone and recorded no exit after ${elapsed} — killed, not finished; log ${turn.log} ---`);
  } else {
    const relay = !turn.relay ? ''
      : turn.delivered ? ' — relay delivered, receipt on the row'
        : ' — relay NOT delivered, still owed';
    const refused = turn.refused ? ` — REFUSED (${turn.refused}); this turn executed nothing` : '';
    out(`--- ${turn.id}: turn returned exit ${turn.exit} after ${elapsed}${refused}${relay} ---`);
  }
  const text = tailOf(turn.log, 40);
  if (text) out(text);
}

function flag(args, name) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

export function driveCommand({ cfg, args }) {
  if (args[0] === '--turn') { runTurn(cfg, args[1]); return; }
  const forSeconds = Number(flag(args, 'for') ?? 540);
  if (!Number.isInteger(forSeconds) || forSeconds < 0)
    throw new Error(`orchestra drive: --for must be a whole number of seconds, got ${JSON.stringify(flag(args, 'for'))}`);
  const ids = args.filter((a) => !a.startsWith('--'));

  const state = readState(cfg.root);
  if (!state) { out('no register — publish a roadmap first, then `orchestra roadmap enrol`'); return; }
  const { tasks } = reconcileTasks(state.tasks ?? [], gatherGit(cfg.root, { mainBranch: cfg.mainBranch }));
  const liveness = gatherLiveness(cfg.root, tasks);
  for (const e of liveness.errors) out(`liveness: ${e}`);
  const obl = obligations(tasks, liveness);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  // Named rows are driven whatever they are waiting on — the conductor asked — but never on top of
  // a running turn, and never without a session to resume.
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length) throw new Error(`orchestra drive: no such row(s) — ${unknown.join(', ')}`);
  const wanted = ids.length ? ids.map((id) => byId.get(id)) : [...obl.undelivered, ...obl.idle].map((e) => byId.get(e.id));
  const targets = [];
  for (const row of wanted) {
    const busy = obl.driving.find((e) => e.id === row.id);
    if (busy) { out(`skip: ${row.id} — a turn is already running (${busy.why})`); continue; }
    if (TERMINAL.has(row.status)) { out(`skip: ${row.id} — ${row.status}`); continue; }
    if (!row.session) { out(`skip: ${row.id} — no session on the row; launch it (step 8)${relayOwed(row) ? ', with the relay in its brief' : ''}`); continue; }
    targets.push(row);
  }

  const worktrees = worktreePaths(cfg.root);
  const started = [];
  for (const row of targets) {
    const slug = driveSlug(row.id);
    const cwd = worktrees.get(row.branch) ?? join(cfg.root, cfg.worktrees, slug);
    if (!existsSync(cwd)) { out(`skip: ${row.id} — no worktree at ${cwd}; relaunch it (step 8)`); continue; }
    // A registered background session refuses `--resume` until it is stopped. Its conversation is
    // kept; stopping it is the first half of the cycle the protocol always ran.
    const registered = liveness.registered.get(row.session);
    if (registered?.id) {
      const stop = spawnSync('claude', ['stop', registered.id], { encoding: 'utf8', timeout: 15_000 });
      out(stop.status === 0 ? `stopped background session ${registered.id} (${row.id})`
        : `could not stop background session ${registered.id} (${row.id}): ${oneLine(`${stop.stderr ?? ''}${stop.stdout ?? ''}${stop.error?.message ?? ''}`, 160)}`);
    }
    const p = turnPaths(cfg.root, slug);
    const owed = relayOwed(row);
    // Written BEFORE the fork, pid null, so a `ready` racing it still sees a starting turn; the exact
    // prompt is on the record, which is what makes "the relay was in the message" a fact on disk.
    writeTurn(p.record, {
      id: row.id, session: row.session, cwd, pid: null, startedAt: new Date().toISOString(),
      endedAt: null, exit: null, refused: null, delivered: null,
      relay: owed ? { writtenAt: row.relay.writtenAt ?? null, text: row.relay.text } : null,
      prompt: nudgeFor(row), log: p.log,
    });
    // Truncated, not appended: the log belongs to THIS turn, and `ready`'s "last words" must never
    // quote a turn before it.
    const fd = openSync(p.log, 'w');
    try {
      const child = spawn(process.execPath, [ORCHESTRA_BIN, 'drive', '--turn', p.record],
        { cwd: cfg.root, detached: true, stdio: ['ignore', fd, fd], env: process.env });
      child.unref();
      writeTurn(p.record, { ...readTurn(p.record), pid: child.pid });
    } finally { closeSync(fd); }
    out(`driving: ${row.id} [${row.status}] — ${owed ? `relay inlined (${row.relay.text.length} chars)` : 'continue nudge'} — log ${p.log}`);
    started.push(p.record);
  }
  if (!started.length) {
    out(obl.driving.length ? `nothing to drive — ${obl.driving.length} turn(s) already running` : 'nothing to drive');
    return;
  }

  const deadline = Date.now() + forSeconds * 1000;
  const done = new Set();
  for (;;) {
    for (const record of started) {
      if (done.has(record)) continue;
      const turn = readTurn(record);
      const verdict = turnVerdict(turn, { alive: pidAlive });
      if (verdict === 'running') continue;
      done.add(record);
      report(turn, verdict);
    }
    if (done.size === started.length) return;
    if (Date.now() >= deadline) {
      const still = started.filter((r) => !done.has(r)).map((r) => readTurn(r));
      out(`still running: ${still.map((t) => `${t.id} (pid ${t.pid ?? 'starting'}, ${age(t.startedAt)} in)`).join(', ')} — run \`orchestra drive\` again; the turns go on without you`);
      process.exitCode = STILL_RUNNING_EXIT;
      return;
    }
    sleepMs(2000);
  }
}

// The child half: one worker's turn, watched to its end. Its stdout IS the turn's log (the parent
// pointed it there), so output is written through as it arrives and only the tail is kept, for the
// refusal check.
const TAIL_BYTES = 4096;

function runTurn(cfg, recordFile) {
  const turn = readTurn(recordFile);
  if (!turn) throw new Error(`orchestra drive --turn: no turn record at ${recordFile}`);
  // Claimed by pid, refused when another pid already holds it — a record is one turn's, and the
  // environment this runs under is inherited by everything the worker itself spawns.
  if (!(turn.pid === null || turn.pid === process.pid)) return;
  writeTurn(recordFile, { ...turn, pid: process.pid });

  const env = { ...process.env };
  // A `claude` started from inside a Claude Code session inherits this and dies on a false
  // authentication error (templates/tick.sh measures it); a worker's turn is exactly that case.
  delete env.CLAUDE_CODE_CHILD_SESSION;
  let tail = '';
  const take = (chunk) => {
    try { writeSync(1, chunk); } catch { /* a log nobody can write is still a turn */ }
    tail = `${tail}${chunk}`.slice(-TAIL_BYTES);
  };
  let finished = false;
  const finish = (code) => {
    if (finished) return;
    finished = true;
    const refused = turnRefusal(tail);
    const endedAt = new Date().toISOString();
    // The receipt, and the ONLY place one is written: the turn returned, cleanly, and did not print
    // one of the three refusals — so the text on the record reached the worker.
    const delivered = turn.relay && code === 0 && !refused && stampReceipt(cfg.root, turn, endedAt) ? endedAt : null;
    writeTurn(recordFile, { ...readTurn(recordFile), pid: process.pid, exit: code, endedAt, refused, delivered });
    process.exit(code);
  };
  const child = spawn('claude', ['-p', '--resume', turn.session, '--dangerously-skip-permissions', turn.prompt],
    { cwd: turn.cwd, stdio: ['ignore', 'pipe', 'pipe'], env });
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  child.on('error', (e) => { take(`${e.message}\n`); finish(127); });
  child.on('close', (code) => finish(code ?? 1));
}

// Stamped onto the row only if the relay there is still the one this turn carried: a conductor that
// rewrote the text while the turn ran wrote a relay nobody has delivered yet.
function stampReceipt(root, turn, at) {
  const state = readState(root);
  const i = (state?.tasks ?? []).findIndex((t) => t.id === turn.id);
  const row = state?.tasks?.[i];
  if (!row?.relay || row.relay.text !== turn.relay.text) return false;
  const tasks = state.tasks.slice();
  tasks[i] = { ...row, relay: { ...row.relay, deliveredAt: at, receipt: { turnAt: turn.startedAt, session: turn.session, pid: process.pid } } };
  writeState(root, { ...state, tasks });
  return true;
}
