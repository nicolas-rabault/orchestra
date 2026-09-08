// The wake-up for the failure `drive.mjs`'s header measures: a conductor that is alive, holds the
// baton, and is sitting between two turns with its whole fleet stopped. Nothing else reaches that
// session — `tick-gate` stands the heartbeat down for it, correctly, and the user is the only other
// thing that starts its turn. This loop is the conductor's own, armed as a persistent Monitor beside
// the answer watch, and every line it prints reaches THAT session as an event: the fix goes through
// the live conductor, never beside it.
//
// It is a SECOND loop on purpose, not a third job for `watch.mjs`. That loop is a two-second file
// read whose liveness IS the conductor's liveness; a `claude agents --json` that hangs inside it
// would freeze the beat and make a live conductor read dead, which is the one thing the beat exists
// to prevent. This one may hang, and the cost is a late wake, not a false death. Every minute, not
// every two seconds, because its one witness costs two seconds.
import { readState } from './state.mjs';
import { reconcileTasks, gatherGit } from './ready.mjs';
import { obligations } from './drive.mjs';
import { gatherLiveness } from './liveness.mjs';

export const PERIOD_MS = 60_000;

// A turn that ended moments ago is one the conductor is most likely reading — a foreground `drive`
// prints it as it returns — so a stop younger than this is not yet a debt. Three minutes clears a
// tick's ordinary path from `ready` to `drive`.
export const GRACE_MS = 3 * 60_000;

// The same set, still owed, is said again after this long. Transitions alone would reproduce the
// measured failure exactly: the eleven turn-ends of 2026-09-08 arrived while the conductor was
// mid-turn, were absorbed there as noise, and nothing said them a second time once the turn had ended.
export const REMIND_MS = 10 * 60_000;

const short = (id) => (id.includes('/') ? id.split('/').pop() : id);

const names = (entries, cap = 4) => {
  const ids = entries.map((e) => short(e.id));
  return ids.length > cap ? `${ids.slice(0, cap).join(', ')} +${ids.length - cap}` : ids.join(', ');
};

const ages = (entries) => entries.slice(0, 3).map((e) => `${short(e.id)}${e.ageMin === null ? '' : ` ${e.ageMin} min`}`).join(', ');

// `memory` is the loop's own: `{ key, at, idleSince }`. Returns the line to emit, or null.
export function announcement(obl, memory, now = Date.now()) {
  const due = [];
  for (const e of obl.idle) {
    const ended = Date.parse(e.turn?.endedAt ?? '');
    let since = Number.isFinite(ended) ? ended : memory.idleSince.get(e.session);
    if (since === undefined) { since = now; memory.idleSince.set(e.session, now); }
    if (now - since >= GRACE_MS) due.push(e);
  }
  for (const s of [...memory.idleSince.keys()]) if (!obl.idle.some((e) => e.session === s)) memory.idleSince.delete(s);

  const key = [...due.map((e) => `i:${e.id}`), ...obl.undelivered.map((e) => `u:${e.id}`)].sort().join(' ');
  if (!key) { memory.key = null; return null; }
  if (key === memory.key && now - memory.at < REMIND_MS) return null;
  memory.key = key;
  memory.at = now;
  const parts = [];
  if (due.length) parts.push(`${due.length} stopped worker(s) on live rows (${names(due)})`);
  if (obl.undelivered.length) parts.push(`${obl.undelivered.length} undelivered relay(s) (${ages(obl.undelivered)})`);
  return `OWED: ${parts.join(' · ')} — run \`orchestra drive\``;
}

// A round that cannot read the register or git says nothing and forgets nothing, for `watch.mjs`'s
// reason: silence costs one period, a wrong announcement costs the conductor a turn.
export function round(root, cfg, memory, { now = Date.now(), liveness = null, emit = console.log } = {}) {
  let tasks;
  try {
    const state = readState(root);
    if (!state) return 0;
    tasks = reconcileTasks(state.tasks ?? [], gatherGit(root, { mainBranch: cfg.mainBranch })).tasks;
  } catch { return 0; }
  const line = announcement(obligations(tasks, liveness ?? gatherLiveness(root, tasks), { now }), memory, now);
  if (!line) return 0;
  emit(line);
  return 1;
}

// The first round announces nothing: the tick that arms this loop runs `orchestra ready` itself and
// sees the same lines there. It only remembers, so the loop's first word is a change or a reminder.
export function watchWorkers(root, cfg, { emit = console.log } = {}) {
  const memory = { key: null, at: 0, idleSince: new Map() };
  round(root, cfg, memory, { emit: () => {} });
  setInterval(() => { try { round(root, cfg, memory, { emit }); } catch { /* one missed period, never a dead watch */ } }, PERIOD_MS);
}
