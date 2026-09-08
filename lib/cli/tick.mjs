// The launch plan, and the one place the machine-wide budget narrows it.
import { readState } from '../register/state.mjs';
import { reconcileTasks, computeReadySet, planLaunches, pendingWaiting, gatherGit }
  from '../register/ready.mjs';
import { obligations } from '../register/drive.mjs';
import { gatherLiveness } from '../register/liveness.mjs';
import { lastWords } from './drive.mjs';
import { maxWorkers, otherWorkers, recordInstance } from '../machine.mjs';
import { conductorState } from '../register/beat.mjs';
import { gateLine } from '../register/tick.mjs';
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

  const launches = planLaunches(ready, inFlight, effective);
  const liveness = gatherLiveness(cfg.root, tasks);
  const { idle, undelivered, driving } = obligations(tasks, liveness);
  const waiting = pendingWaiting(tasks);

  if (args.includes('--json')) {
    out(JSON.stringify({ corrections, tasks, blocked, ready, launches, undelivered, idle, driving, waiting,
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
  for (const d of driving) out(`driving: ${d.id} [${d.status}] — ${d.why}${d.relayInFlight ? ', relay in flight' : ''}`);
  if (undelivered.length || idle.length) out(`owed: ${undelivered.length + idle.length} worker turn(s) — orchestra drive`);
  if (waiting.length) {
    const oldest = waiting[0];
    out(`WAITING: ${waiting.length} item(s), oldest ${oldest.id} (${oldest.ageMin === null ? 'age unknown' : `${oldest.ageMin} min`}) — ${oldest.ask.slice(0, 80)}`);
  }
  out(`in flight: ${inFlight}/${effective}${effective < width
    ? ` (width ${width}, held down to ${effective}: ${others} of ${cap} worker(s) belong to other project(s) on this machine)` : ''}`);
  // A conductor held to zero says so rather than launching anyway.
  if (!launches.length && ready.length && effective <= inFlight)
    out(`HELD: ${ready.length} task(s) are ready and this machine has no slot for them — ${others} of ${cap} are held elsewhere`);
  for (const t of launches) out(`launch: ${t.id} — ${t.title} [${t.model}] on ${t.branch}`);
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
