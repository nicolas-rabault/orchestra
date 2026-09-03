// The launch plan, and the one place the machine-wide budget narrows it.
import { readState } from '../register/state.mjs';
import { reconcileTasks, computeReadySet, planLaunches, undeliveredRelays, pendingWaiting, gatherGit }
  from '../register/ready.mjs';
import { maxWorkers, otherWorkers, recordInstance } from '../machine.mjs';
import { conductorState } from '../register/beat.mjs';
import { gateLine } from '../register/tick.mjs';
import { yieldVerdict, FOUND_EXIT } from '../register/wake.mjs';

const out = (s) => process.stdout.write(`${s}\n`);

export function readyCommand({ cfg, args }) {
  const state = readState(cfg.root);
  if (!state) { out('no register — publish a roadmap first, then `orchestra roadmap enrol`'); return; }
  const arg = (n, d) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : d; };
  const width = Number(arg('--width', '8'));

  const git = gatherGit(cfg.root);
  const { tasks, corrections } = reconcileTasks(state.tasks ?? [], git);
  const { ready, blocked } = computeReadySet(tasks, git);
  const inFlight = tasks.filter((t) => t.status === 'claimed' || t.status === 'review').length;

  // This project's live worker count, published for every other conductor on this machine to budget
  // against — and the same call reaps whatever died since the last tick. `ready` is the ONE command
  // that writes the registry, so the machine file has exactly one writer per project, the way the
  // register does.
  //
  // `beatAt` is stamped from THIS call, not from the conductor's own watch-loop beat: machine.mjs's
  // own comment says this file is "written once per tick rather than every two seconds", precisely
  // so a project ticking hourly with nobody watching for answers still counts as alive. Forwarding
  // `conductorState()`'s `ts` here would leave `beatAt` null whenever no watch-answers loop happens
  // to be running — the ordinary case for a `ready` typed by hand, or a tick before the loop is
  // armed — and an entry with neither a live pid nor a beat reads as dead to every OTHER project's
  // budget the instant it is written, which is the wrong direction for an advisory cap: this file's
  // own header says "too few launches, never too many".
  const beat = conductorState(cfg.root);
  recordInstance({
    id: cfg.id, name: cfg.name, root: cfg.root, mode: cfg.mode, workers: inFlight,
    conductorSession: beat?.session ?? null, conductorPid: beat?.pid ?? null,
    beatAt: new Date().toISOString(),
  });

  // §8.6: this tick may plan at most `maxWorkers` minus what the OTHER live projects hold. It budgets
  // SESSIONS, not CPU: four projects each running one full test suite is within budget and can still
  // saturate the machine. A project that needs that ordering configures `queue`.
  const cap = maxWorkers();
  const others = otherWorkers(cfg.id);
  const effective = Math.min(width, Math.max(0, cap - others));

  const launches = planLaunches(ready, inFlight, effective);
  const undelivered = undeliveredRelays(tasks);
  const waiting = pendingWaiting(tasks);

  if (args.includes('--json')) {
    out(JSON.stringify({ corrections, tasks, blocked, ready, launches, undelivered, waiting,
      budget: { width, maxWorkers: cap, others, effective, inFlight } }, null, 2));
    return;
  }
  for (const c of corrections) out(`fix: ${c}`);
  // First, above everything else: an UNDELIVERED line is an obligation for this tick, not a status.
  for (const u of undelivered)
    out(`UNDELIVERED: ${u.id} [${u.status}] — relay written ${u.writtenAt ?? 'at an unreadable time'}${u.ageMin === null ? '' : `, ${u.ageMin} min ago`}`);
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
