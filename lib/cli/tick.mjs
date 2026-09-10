// The launch plan, and the one place the machine-wide budget narrows it.
import { statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { orchestraDir } from '../paths.mjs';
import { readState, writeState, statePath } from '../register/state.mjs';
import { append as journal } from '../register/journal.mjs';
import { reconcileTasks, computeReadySet, planLaunches, launchHold, pendingWaiting, gatherGit }
  from '../register/ready.mjs';
import { obligations } from '../register/drive.mjs';
import { fleetCost, retireLine } from '../register/cost.mjs';
import { TERMINAL } from '../register/archive.mjs';
import { oneLine } from '../register/inbox.mjs';
import { gatherLiveness } from '../register/liveness.mjs';
import { lastWords } from './drive.mjs';
import { maxWorkers, otherWorkers, recordInstance } from '../machine.mjs';
import { conductorState } from '../register/beat.mjs';
import { gateLine, tickOutcome, tickWake } from '../register/tick.mjs';
import { stalledLandings } from '../gate/run.mjs';
import { yieldVerdict, FOUND_EXIT } from '../register/wake.mjs';

const out = (s) => process.stdout.write(`${s}\n`);

// One `IDLE:` line: who stopped, since when the record knows, and the last thing it said — enough to
// tell a worker that reported "done" (land it) from one that was cut mid-turn (drive it) without
// opening the log.
function idleLine(e) {
  const who = e.sessionName ?? String(e.session).slice(0, 8);
  const since = e.turn
    ? (e.turn.verdict === 'vanished' ? 'its last turn vanished without an exit' : `stopped ${e.turn.endedAt}${e.turn.refused ? ` — REFUSED (${e.turn.refused})` : ''}`)
    : e.registered ? 'background session idle' : 'stopped';
  const said = e.turn ? lastWords(e.turn.log) : '';
  return `IDLE: ${e.id} [${e.status}] — ${who} ${since}${said ? ` — last words: ${said}` : ''}`;
}

export function readyCommand({ cfg, args }) {
  const state = readState(cfg.root);
  if (!state) { out('no register — publish a roadmap first, then `orchestra roadmap enrol`'); return; }
  const arg = (n, d) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : d; };
  const widthArg = arg('--width', '8');
  const width = Number(widthArg);
  // A NaN width (a missing value, or a typo'd one) would silently zero every launch below AND
  // suppress the two lines that explain why — `effective < width` reads false, and so does
  // `effective <= inFlight` — so this is refused loudly instead, naming what was passed.
  if (!Number.isInteger(width) || width <= 0)
    throw new Error(`orchestra ready: --width must be a positive integer, got ${JSON.stringify(widthArg)}`);

  const git = gatherGit(cfg.root, { mainBranch: cfg.mainBranch });
  const { tasks, corrections } = reconcileTasks(state.tasks ?? [], git);
  const { ready, blocked } = computeReadySet(tasks, git);
  const inFlight = tasks.filter((t) => t.status === 'claimed' || t.status === 'review').length;

  // This project's live worker count, published for every other conductor on this machine to budget
  // against — and the same call reaps whatever died since the last tick. `ready` is this project's
  // one writer of the WORKER side of the registry entry. It is not the file's only writer:
  // `lib/monitor/discover.mjs`'s `discoverProjects` writes `{id, name, root, mode}` onto that same
  // entry, the first time it finds the current directory's project unregistered —
  // `recordInstance` MERGES the two field sets (`lib/machine.mjs`) rather than one replacing the
  // other, so the two writers never clobber each other's half. The monitor process itself writes
  // neither: `port` and `monitorPid` left this registry entirely, for `~/.orchestra/monitor.json`.
  //
  // `beatAt` records the conductor's own watch-loop beat (spec §8.2) and is legitimately null
  // whenever no `watch-answers` loop is armed — the ordinary case for a `ready` typed by hand, or a
  // tick before the loop starts. An entry's PRESENCE in the registry deliberately does NOT depend
  // on it for that reason: `isLive` reads `updatedAt`, which `recordInstance` stamps from its own
  // clock on every write, so an entry never reads dead the instant it is written just because
  // nobody happens to be watching for answers. Its WORKER COUNT, though, reads its OWN stamp,
  // `workersAt` — stamped only when the incoming entry carries `workers`, falling back to
  // `updatedAt` for an entry written before this change — because `discoverProjects`'s own
  // registration write moves `updatedAt` with no fresh worker count behind it, and coupling the
  // count to that stamp would let that one write alone revive a `-9`-killed conductor's stale
  // count. An undercounted project would make every OTHER project launch MORE, which is the wrong
  // direction for an advisory cap — this file's header calls it "too few launches, never too many".
  // `beatAt` and `conductorSession` are the content spec §8.2 declares for the registry's entry,
  // filled here and printed by `orchestra instances` (`lib/cli/monitor.mjs`) — a truncated session
  // id and a relative beat age beside the worker count they explain.
  const beat = conductorState(cfg.root);
  recordInstance({
    id: cfg.id, name: cfg.name, root: cfg.root, mode: cfg.mode, workers: inFlight,
    conductorSession: beat?.session ?? null, conductorPid: beat?.pid ?? null, beatAt: beat?.ts ?? null,
  });

  // §8.6: this tick may plan at most `maxWorkers` minus what the OTHER live projects hold. It budgets
  // SESSIONS, not CPU: four projects each running one full test suite is within budget and can still
  // saturate the machine. A project that needs that ordering configures `queue`.
  const cap = maxWorkers();
  const others = otherWorkers(cfg.id);
  const effective = Math.min(width, Math.max(0, cap - others));

  const planned = planLaunches(ready, inFlight, effective, { roadmapRuntimes: cfg.roadmapRuntimes, conductorRuntime: state.conductor?.runtime ?? 'claude' });
  const liveness = gatherLiveness(cfg.root, tasks);
  const { idle, undelivered, driving, relaunch, refresh = [] } = obligations(tasks, liveness);
  const waiting = pendingWaiting(tasks);
  // The merge queue's own debt. A `queued` or `landing` entry with no live process behind it is a
  // landing that died, and nothing outside `orchestra queue-list` ever named one: LP6 sat exactly
  // there for two hours on 2026-09-08 in duckJam after the gate merged LP2 and its process died
  // before releasing. This is the tick's copy of a line that already existed and that nobody read.
  const stalled = stalledLandings(cfg);
  // A warm session before a cold one — ./ready.mjs's `launchHold` holds the evidence. `launches` is
  // empty while a turn is owed, deliberately and visibly: a caller reading the JSON gets no plan to
  // follow, and `held` says whose turn to pay first.
  const held = launchHold(planned, { idle: [...idle, ...refresh], undelivered });
  const launches = held ? [] : planned;
  // What the live fleet costs, and which of it has grown past the point where carrying its prefix
  // is dearer than starting over on the same worktree (`lib/register/cost.mjs` holds the rule and
  // the simulation that chose its threshold). Measured off each session's own transcript, so this
  // is a fact about the session rather than an estimate from its turn count. `driving` is passed
  // because a session mid-turn cannot be stopped and is measured at a prefix already out of date.
  const fleet = fleetCost(tasks, {
    retireAt: cfg.retireAt, terminal: TERMINAL,
    driving: new Set(driving.map((d) => d.id)),
  });
  const retire = fleet.filter((r) => r.verdict.ok);

  if (args.includes('--json')) {
    out(JSON.stringify({ corrections, tasks, blocked, ready, launches, launchHeld: held,
      undelivered, idle, driving, relaunch, refresh, waiting, stalled, retire, fleet,
      liveness: { errors: liveness.errors },
      budget: { width, maxWorkers: cap, others, effective, inFlight } }, null, 2));
    return;
  }
  for (const c of corrections) out(`fix: ${c}`);
  for (const e of liveness.errors) out(`liveness: ${e}`);
  // First, above everything else: UNDELIVERED and IDLE are obligations for this tick, not status. A
  // tick may not end with either outstanding, and `orchestra drive` resolves both.
  for (const u of undelivered)
    out(`UNDELIVERED: ${u.id} [${u.status}] — relay written ${u.writtenAt ?? 'at an unreadable time'}${u.ageMin === null ? '' : `, ${u.ageMin} min ago`}${u.session ? '' : ' — no session on the row: put it in the relaunch brief'}`);
  for (const e of idle) out(idleLine(e));
  for (const e of refresh) out(`REFRESH: ${e.id} — ${e.why}`);
  for (const s of stalled)
    out(`STALLED: ${s.branch} has been ${s.state} in the merge queue for ${s.age} with no live process`
      + `${s.note ? ` — ${s.note}` : ''} — run \`orchestra land ${s.branch}\` again`);
  // A live row with no worker. It reads as an obligation because it is one — the branch is there,
  // the work is half done, and nothing is moving it. `orchestra retire` leaves exactly this state
  // on purpose, so the hand-over finishes through the launch path that is already guarded.
  for (const r of relaunch)
    out(`RELAUNCH: ${r.id} [${r.status}] — the branch is there and no session is`
      + `${r.retiredAt ? `; retired at ${r.retiredAt}` : ''}`
      + `${r.note ? ` — its note: ${oneLine(r.note, 100)}` : ' — no note on the row'}`
      + ` — relaunch on the same worktree with \`orchestra brief ${r.id}`
      + `${r.retiredAt ? ` --handover ${r.turns ?? '<turns>'}` : ' --relaunch'}\``);
  for (const r of retire) out(retireLine(r));
  for (const d of driving) out(`driving: ${d.id} [${d.status}] — ${d.why}${d.relayInFlight ? ', relay in flight' : ''}`);
  if (undelivered.length || idle.length) out(`owed: ${undelivered.length + idle.length} worker turn(s) — orchestra drive`);
  if (relaunch.length) out(`relaunch: ${relaunch.length} live row(s) with no session — ${relaunch.map((r) => r.id).join(', ')}`);
  if (held)
    out(`LAUNCHES HELD: ${held.deferred.length} ready task(s) wait on ${held.owed.length} owed worker turn(s)`
      + ` (${held.owed.join(', ')}) — a warm session pays no brief and a new one pays all of it.`
      + ' Run `orchestra drive`, then `orchestra ready` again.');
  if (waiting.length) {
    const oldest = waiting[0];
    out(`WAITING: ${waiting.length} item(s), oldest ${oldest.id} (${oldest.ageMin === null ? 'age unknown' : `${oldest.ageMin} min`}) — ${oldest.ask.slice(0, 80)}`);
  }
  out(`in flight: ${inFlight}/${effective}${effective < width
    ? ` (width ${width}, held down to ${effective}: ${others} of ${cap} worker(s) belong to other project(s) on this machine)` : ''}`);
  // A conductor held to zero says so rather than launching anyway.
  if (!launches.length && ready.length && effective <= inFlight)
    out(`HELD: ${ready.length} task(s) are ready and this machine has no slot for them — ${others} of ${cap} are held elsewhere`);
  for (const t of launches) out(`launch: ${t.id} — ${t.title} [${t.runtime}; ${t.model ?? 'native default model'}] on ${t.branch}`);
  for (const b of blocked) out(`blocked: ${b.id} — ${b.reasons.join('; ')}`);
}

// Exit code is deliberately NOT the channel here: a gate that cannot answer must not be able to stop
// the heartbeat, and `set -e` in some future caller would turn a non-zero exit into exactly that. The
// shell reads the first word of the line and nothing else.
export const tickGateCommand = ({ cfg }) => process.stdout.write(`${gateLine(cfg.root)}\n`);

// Run FIRST by both tick entry points, before either arms a watch or records itself as conductor —
// the two writes a session about to hand back must not make. Exit 10 means hand back; the journal
// line is already written, so the caller only has to stop.
export function yieldCheckCommand({ cfg }) {
  const v = yieldVerdict({ root: cfg.root });
  process.stdout.write(`${v.why}\n`);
  if (v.yield) process.exitCode = FOUND_EXIT;
}

// `orchestra tick-outcome --from <transcript> --since <iso>` — read back what the slot bought.
//
// Run by `templates/tick.sh` after the `claude -p` it fired returns, still holding `tick.lock`, so
// the register has exactly one writer at that moment exactly as it does during the tick itself. The
// decision is `tickOutcome`'s (lib/register/tick.mjs), where it is tested; this gathers the two facts
// it needs and performs the three writes it earns — the journal line the monitoring page reads, the
// `budgetResetAt` the NEXT slot's gate reads, and one line into `tick.log` so a slot lost to the
// ceiling is not the same shape as a slot that found nothing to do.
//
// Silence is the ordinary answer: a tick that conducted writes nothing here.
export function tickOutcomeCommand({ cfg, args }) {
  const arg = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
  const from = arg('--from');
  if (!from) throw new Error('orchestra tick-outcome: --from <file> is required');
  const since = Date.parse(arg('--since') ?? '');
  if (!Number.isFinite(since)) throw new Error('orchestra tick-outcome: --since <iso 8601 stamp> is required');

  let output = '';
  try { output = readFileSync(from, 'utf8'); } catch { /* no transcript is nothing to read back */ }
  // The register's mtime is the same witness `conductorState` uses (lib/register/beat.mjs) and for
  // the same reason: `writeState` is this plugin's only writer of that file, and step 8 of every tick
  // calls it unconditionally. A register that has not moved since this tick started is a tick that
  // conducted nothing. A project with no register at all cannot be judged this way, and is not: there
  // the transcript is the only witness, which is what `tickOutcome` already requires of it.
  let conducted = false;
  try { conducted = statSync(statePath(cfg.root)).mtimeMs > since; } catch { /* no register */ }

  const outcome = tickOutcome({ output, conducted });
  if (!outcome) return;
  process.stdout.write(`${outcome.text}\n`);
  journal(cfg.root, { kind: 'tick', task: null, text: outcome.text });
  if (!outcome.resetAt) return;
  const state = readState(cfg.root);
  // Best effort, and it must be: the journal line above is the part that must survive, and a
  // register this cannot read is a problem for the next tick to name, not a reason to lose the line.
  if (state) writeState(cfg.root, { ...state, budgetResetAt: outcome.resetAt });
}

// `.orchestra/tick.wake` — the instant a wake is already armed for, and nothing else. One line, so a
// torn read is an unarmed wake rather than a wrong one, and the worst an unarmed wake costs is the
// hourly grid, which is what ran before this existed.
const wakePath = (root) => join(orchestraDir(root), 'tick.wake');

// `orchestra tick-wake --gate "<the gate's line>"` — prints the seconds to sleep before re-running
// the tick, or nothing at all. `templates/tick.sh` reads stdout and arms a detached sleep off it.
//
// The decision is `tickWake`'s (lib/register/tick.mjs), where it is tested and where the argument
// for it lives. This holds the one piece of state it needs: what a wake is already armed for, so an
// afternoon of slots refused on the same reset arms one sleep rather than five.
export function tickWakeCommand({ cfg, args }) {
  const i = args.indexOf('--gate');
  const gate = i > -1 ? args[i + 1] ?? '' : '';
  let armedFor = null;
  try { armedFor = readFileSync(wakePath(cfg.root), 'utf8').trim() || null; } catch { /* none armed */ }
  const wake = tickWake({ gate, armedFor });
  if (!wake) return;
  writeFileSync(wakePath(cfg.root), `${wake.at}\n`);
  process.stdout.write(`${wake.seconds}\n`);
}
