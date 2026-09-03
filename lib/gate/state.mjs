// The gate's decisions, with no filesystem, no git and no clock. `lib/gate/land.mjs` gathers the
// facts and this decides — the same split `lib/register/ready.mjs` keeps from `lib/cli/tick.mjs`,
// and for the same reason: a decision that needs a repository to be tested is a decision nobody
// tests.
//
// Ported from planetCraft's `tools/merge-queue-state.mjs` at 86bf8412. What was deliberately left
// behind, and the argument for each, is in `docs/plans/2026-09-03-p3-merge-gate.md`.

// The durable record. It remembers the one thing no process can: a branch left `blocked` by a
// conflict is waiting for its agent to come back, and that outlives every pid involved.
export const EMPTY = { version: 1, entries: [] };

// `landing` is what HOLDING the lock looks like; `queued` is asking for it. `blocked` and `held`
// are the two ways a landing stops without the main branch moving.
export const STATES = ['queued', 'landing', 'blocked', 'held'];

// Unreadable means "no record", never a crash. A truncated or hand-edited file must not wedge every
// landing on this machine — the record is a convenience, the lock is what protects the main branch.
export function parseState(text) {
  try {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.entries)) return { ...EMPTY };
    return { version: 1, entries: data.entries.filter((e) => e && typeof e.branch === 'string') };
  } catch {
    return { ...EMPTY };
  }
}

export const formatState = (state) => `${JSON.stringify(state, null, 2)}\n`;

export const findEntry = (state, branch) => state.entries.find((e) => e.branch === branch) ?? null;

// An upsert, not an append: `land` runs more than once for one branch by design — exit 10 sends the
// agent away to resolve a conflict and it comes back. `enqueuedAt` survives that round trip, which
// is what makes `queue-list` show how long a branch has really been trying to land.
export function upsertEntry(state, { branch, worktree, at }) {
  const existing = findEntry(state, branch);
  const entry = existing
    ? { ...existing, worktree, state: 'queued', note: '' }
    : { branch, worktree, enqueuedAt: at, state: 'queued', note: '' };
  return {
    state: {
      ...state,
      entries: existing
        ? state.entries.map((e) => (e.branch === branch ? entry : e))
        : [...state.entries, entry],
    },
    entry,
  };
}

export function setEntryState(state, branch, next, note = '') {
  // Throw rather than write a state no reader handles: the record is read back by `queue-list` and
  // by the next `land`, so an unknown value would surface far from here.
  if (!STATES.includes(next)) throw new Error(`orchestra gate: unknown entry state '${next}'`);
  return {
    ...state,
    entries: state.entries.map((e) => (e.branch === branch ? { ...e, state: next, note } : e)),
  };
}

export const dropEntry = (state, branch) => ({
  ...state,
  entries: state.entries.filter((e) => e.branch !== branch),
});

// An entry whose branch ref is gone is finished with, whatever it says: it landed, or somebody
// deleted the branch. This is what replaces the source's `drop` verb — spec §2's subcommand list has
// no fourth verb, and the same liveness argument the pid-held lock already makes answers it without
// one. An entry whose branch still EXISTS is never reaped: remembering a branch blocked by a
// conflict, across every process involved, is the durable record's whole job.
export const dropVanished = (state, refExists) => ({
  ...state,
  entries: state.entries.filter((e) => refExists(e.branch)),
});

// `pid|branch|epoch` per line. A pid on this host is a liveness answer that needs no timeout, and a
// lease's expiry would have to be longer than a project's slowest gate to be safe, which is far too
// long to unwedge a crashed landing.
export function parseWaiters(text) {
  return String(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid, branch, epoch] = line.split('|');
      return { pid: Number(pid), branch, epoch: Number(epoch) };
    })
    // pid 0 is why this filter is not cosmetic: `process.kill(0, 0)` targets the process GROUP and
    // always succeeds, so a malformed line read as pid 0 would be alive for ever and hold the queue
    // shut.
    .filter((x) => Number.isInteger(x.pid) && x.pid > 0 && x.branch && Number.isFinite(x.epoch));
}

export const formatWaiters = (list) =>
  list.map((x) => `${x.pid}|${x.branch}|${x.epoch}`).join('\n') + (list.length ? '\n' : '');

export const parseHolder = (text) => parseWaiters(text)[0] ?? null;
export const formatHolder = (holder) => (holder ? formatWaiters([holder]) : '');

// Liveness is INJECTED, which is what keeps this decidable in a test: a process can be killed on
// paper. The caller passes a predicate built on `process.kill(pid, 0)`.
export const reapWaiters = (list, isAlive) => list.filter((x) => isAlive(x.pid));
export const reapHolder = (holder, isAlive) => (holder && isAlive(holder.pid) ? holder : null);

// The turn is decided among LIVE waiters, never by the durable record's order. If the record gated
// it, an entry whose agent session died would sit at the head for ever and block every other branch
// — exactly the staleness a process-held lock exists to avoid.
//
// Both inputs must already be reaped; this function has no opinion about liveness.
export function mayTake({ holder, waiters, pid }) {
  if (holder) return { ok: false, reason: `landing ${holder.branch}`, ahead: 1 };
  // A total order, not just a sort by time: epochs are seconds, so two `land` calls in the same
  // second is ordinary. Without the pid tiebreak both read themselves as the head and two landings
  // run at once, which is the entire bug this queue exists to prevent.
  const queue = [...waiters].sort((a, b) => a.epoch - b.epoch || a.pid - b.pid);
  const at = queue.findIndex((x) => x.pid === pid);
  if (at === -1) return { ok: false, reason: 'not registered as a waiter', ahead: queue.length };
  if (at > 0) return { ok: false, reason: `${at} ahead`, ahead: at };
  return { ok: true, ahead: 0 };
}

// The gate's whole interface with `merge_agent`: a number, because the agent has to branch on it.
// Each one names an actor — 10 is the only outcome that needs a judgement a script cannot make,
// which is why it is the only one that hands control back.
//
// THERE IS NO 14, AND THE HOLE IS DELIBERATE. The project this was extracted from distinguishes
// "dead code" (14) from "a test failed" (11); spec §5 folds them, because `merge_agent`'s action is
// identical in both cases — stop and report — and the REFUSING GATE'S NAME now travels in the
// outcome, which is strictly more information than a second number was. The number is left unused
// rather than recycled: a reader holding the source's brief must not meet 14 here meaning something
// else.
export const EXIT = {
  ok: 0,
  usage: 1,
  conflict: 10,
  refused: 11,
  busy: 12,
  precondition: 13,
  // A detached landing was started and is now running without us — the caller's next move is
  // `await`, not a second `land`.
  started: 15,
  // The detached process is gone and recorded no outcome. Not the same as `busy` (still going) and
  // not the same as an exit code (it finished): nobody knows how far it got.
  vanished: 16,
};
