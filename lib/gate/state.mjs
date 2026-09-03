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

// Which of the main checkout's dirty tracked files the gate owns and commits itself, before it asks
// what would clash. `ledgers` is the project's own list from `.orchestra/config.json`.
//
// An ALLOWLIST of exact paths, never a pattern: the exemption exists because these are bookkeeping
// files the gate itself may commit, and "any .jsonl" or "anything under reports/" would quietly
// extend that claim to a data file a branch is genuinely authoring. Sorted, so the line a person
// reads is the same between two runs.
export const ledgerPathsToCommit = (dirty, ledgers) =>
  dirty.filter((p) => ledgers.includes(p)).sort();

// Which uncommitted files a landing could actually harm, in the main checkout.
//
// The only thing a landing does to the main working tree is `git merge --ff-only`, and a
// fast-forward writes exactly the paths the branch changed. So a dirty tracked file OUTSIDE that set
// cannot be touched, and one INSIDE it is refused by git itself, loudly, naming the file.
//
// Refusing on ANY dirty tracked file is not merely over-cautious, it is unworkable: a checkout that
// keeps a settings file or a ledger permanently modified would have EVERY landing refused, and the
// way past that is to mask them with `skip-worktree` and hope nothing kills the process between
// setting the flag and clearing it. A forgotten skip-worktree makes git ignore every later change to
// those files, in silence.
//
// Paths, not a count: "commit or stash them" sends a reader to files they are keeping dirty on
// purpose, while the names say which two actually collide.
export const clashingPaths = (dirty, changed) => {
  const set = new Set(changed);
  return dirty.filter((p) => set.has(p)).sort();
};

// One glob into one RegExp, segment by segment. `**`, `*` and literals — spec §5's whole grammar,
// implemented here because the plugin takes no dependency.
//
// Scanned rather than chained `String.replace`: a replacement's own output contains `*` and `/`, so
// a second pass would rewrite what the first pass just produced. That is the classic silent bug in a
// hand-written glob, and it produces a matcher that is wrong only on the patterns people write.
export function globToRegExp(glob) {
  const parts = String(glob).split('/');
  let out = '';
  parts.forEach((seg, i) => {
    if (seg === '**') {
      // `**` as a whole segment matches zero or more segments, so `docs/**` matches `docs/a.md` and
      // `**/*.md` matches `a.md` at the root. Consuming the separator HERE is what makes "zero"
      // possible: a `/` written between two segments could never be optional.
      out += i === parts.length - 1 ? '(?:.*)?' : '(?:[^/]*/)*';
      return;
    }
    out += seg.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '*' ? '[^/]*' : `\\${c}`));
    if (i < parts.length - 1) out += '/';
  });
  return new RegExp(`^${out}$`);
}

// The portable form of a project instrument's "could this branch have moved a pixel". A gate is
// skipped ONLY when every changed path matches one of its globs.
//
// DELIBERATELY WRONG IN ONE DIRECTION. An unreadable diff, an empty diff, or a path shape nobody has
// thought about runs the gate. A needless run costs minutes; a missed run lets through the defect
// the gate exists to catch — in the project this was extracted from, that stage is what found a
// scene photographing an entirely black frame, which every unit test had passed over for six days.
export function gateSkipped(gate, changed) {
  const globs = gate?.skipWhenAllPathsMatch;
  if (!Array.isArray(globs) || globs.length === 0) return false;
  if (!changed || changed.length === 0) return false;
  const res = globs.map(globToRegExp);
  return changed.every((p) => res.some((re) => re.test(p)));
}

// The last thing a landing does. The worktree and the branch are two INDEPENDENT cleanups and are
// asked as two: they used to be a single if/else-if chain, so any failure on the worktree side meant
// `branch -d` was never ATTEMPTED at all and the merged branch survived as a dead ref — observed
// twice in a row on 2026-08-19 in planetCraft, both deleted by hand afterwards. What gates deleting
// anything is the ancestry check the caller runs before this; the state of a directory is not. Every
// git call is injected for the same reason `reapWaiters` takes `isAlive`: the decision is WHICH
// CALLS HAPPEN, not just what gets printed.
//
// THE WORKTREE: TRACKED-DIRTY IS THE ONLY STATE THIS PRE-EMPTS, AND THE REMOVAL IS NEVER FORCED.
// What a landing can silently destroy is an uncommitted change to a file the main branch already
// has. Anything else git decides, and it decides loudly. Measured on git 2.52.0, 2026-08-31, in
// scratch repositories: an ignored directory does NOT make `git worktree remove` fail, and an
// untracked non-ignored file DOES — exit 128, with NOTHING removed, so there is no half-state left
// to repair either. The only thing forcing would destroy is a file that is untracked, not ignored,
// and by construction not on the main branch: far likelier to be work its author never committed
// than a stray artefact. The worktree is kept and the note NAMES the files.
//
// THE BRANCH: A PINNED UPSTREAM IS PROVEN PAST, NEVER FORCED PAST. When a branch was pushed,
// `branch.<name>.merge` is set and `git branch -d` tests "fully merged into its UPSTREAM", not into
// HEAD. The gate rebases, which re-hashes every commit, so git refuses a branch that IS the main
// branch. The answer is NOT -D: `provenMerged` is the caller's evidence that the branch tip is
// byte-identical to the main branch's AND an ancestor of it, and only then is the upstream unpinned
// and the SAME lowercase -d asked again. There is no force-delete in this function's interface at
// all, so it cannot escalate even by mistake.
export function cleanupAfterLanding({
  branch, worktree, hasUncommittedTracked, untrackedFiles,
  removeWorktree, deleteBranch, provenMerged, unsetUpstream,
}) {
  const notes = [];
  const kept = hasUncommittedTracked() ? 'it holds uncommitted changes to tracked files'
    : removeWorktree() ? null
      : `git will not delete its untracked files (${untrackedFiles().join(', ') || 'none reported'})`;
  if (kept) notes.push(`worktree ${worktree} kept — ${kept}, remove it by hand`);

  // A branch still checked out in a surviving worktree is refused for that reason and no other, so
  // name it instead of sending a reader to investigate what the line above just explained.
  if (deleteBranch()) return notes;
  if (kept) { notes.push(`branch '${branch}' kept — still checked out in ${worktree}`); return notes; }
  // A failing --unset-upstream here means there was none to unset: the branch exists (we just asked
  // git to delete it) and it is the main branch's tip, so no upstream is the only way left for -d to
  // have refused — and that is a genuine thing to look into.
  const why = !provenMerged() ? "and it is not the main branch's tip"
    : !unsetUpstream() ? 'and it has no upstream to unpin'
      : deleteBranch() ? null
        : 'even with its upstream unpinned';
  if (why) notes.push(`git refused 'branch -d ${branch}' ${why} — kept, investigate`);
  return notes;
}

// The record of ONE detached landing: written by the parent before it forks, completed by the
// child's exit handler. It exists because a landing outlives the agent that asked for it — a gate
// that runs a whole test suite is minutes, against the 600-second ceiling of an agent's Bash call —
// so the honest shape is a process the caller can leave and come back to. Anything unparseable reads
// as "no record", for `parseState`'s reason.
export function parseRun(text) {
  try {
    const run = JSON.parse(text);
    if (!run || typeof run.branch !== 'string') return null;
    return run;
  } catch {
    return null;
  }
}

export const formatRun = (run) => `${JSON.stringify(run, null, 2)}\n`;

// What `await` concludes, from the run record and one pid liveness check. The two can disagree, and
// each disagreement is a different instruction to the caller — which is the whole point of separating
// them: an agent that reads "still running" waits, one that reads "vanished" starts over, and before
// this existed both looked identical (a Bash call that returned nothing).
export function runVerdict({ run, alive, nowSec }) {
  if (!run) return { state: 'unknown', exit: EXIT.usage };
  // The recorded exit wins over liveness in BOTH directions: a finished run whose pid has been
  // recycled onto another process must not read as alive, and one that recorded its code
  // microseconds before dying must not read as vanished.
  if (typeof run.exit === 'number') {
    return { state: 'finished', exit: run.exit, elapsed: (run.endedAt ?? nowSec) - run.startedAt };
  }
  if (!alive) return { state: 'vanished', exit: EXIT.vanished, elapsed: nowSec - run.startedAt };
  return { state: 'running', exit: EXIT.busy, elapsed: nowSec - run.startedAt };
}

// Branches carry '/' and their records land in a flat directory. Not a hash: the whole value of these
// files is that a human debugging a stuck landing can `ls` them and recognise the branch.
export const runSlug = (branch) => branch.replace(/[^A-Za-z0-9._-]+/g, '_');

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
