// May this machine take this task, and may work start on it here and now?
//
// In OFFLINE mode there is exactly one owner, so nothing ever populates an ownership record and
// `mayTake` is reached with nothing to weigh — which is why `mine !== false` is the permissive
// default rather than an oversight: it is the correct answer there.

// May this machine take this task at all — schedule it, claim it, start a worktree for it? Mine, or
// someone else's that they opened to everyone.
//
// ONE predicate with three readers — `reconcile`'s `schedulable`, `startVerdict`'s foreign branch,
// and `claim` — so the hook, the ready set and the CLI cannot each grow their own slightly
// different version of the same permission. It reads an ownership record or a board row alike:
// both carry `mine` and `open`, and `mine !== false` means a caller that knows no ownership (an
// offline board, code written before ownership existed) gets the answer it got before.
export const mayTake = (x) => !x || x.mine !== false || x.open === true;

// May work start on this row's branch here and now? The decision the worktree guard enforces, kept
// pure and here rather than inside `hooks/guard-claim.mjs` (spec §10, which is what calls this),
// because a hook reads stdin and spawns a child process at import: nothing can unit-test it
// directly, and in the project this comes from its three refusals were exercised by nothing. It is
// roadmap policy, not hook plumbing. The hook owns the wording.
//
// Order matters, and each place in it is a decision:
//   landed   — finished work is nobody's business here. FIRST, because a closed issue reads as
//              landed whoever it is assigned to, so a landed row can never satisfy the claimed-by-me
//              test and the branch NAME would otherwise be blocked forever.
//   foreign  — before `stale`, because no amount of waiting for the network makes someone else's
//              nominative roadmap mine, and "claim it first" is a loop with no exit.
//   stale    — a cached board cannot say who took what since. Applies to my own tasks too.
//   unrecordable — LAST, and deliberately after `stale`: a row no shared channel carries has no
//              claim to show, so refusing it demands evidence its own store cannot produce.
//              Offline, and for a `destination: local` roadmap in ANY mode, `claim` returns
//              `{ ok: true }` having written nothing (lib/store/files.mjs) — there is nobody to
//              tell — so such a row reads `todo` until its BRANCH exists, which is the very thing
//              the refused `git worktree add -b` was about to create. On 2026-09-07 that refused
//              `pr/PR91` one second after `orchestra roadmap claim pr/PR91` reported success, and
//              the wording sent the conductor back to re-run the command it had just run. This is
//              the same situation as the unreachable channel the guard already fails open on: the
//              guard is the backstop, not the mechanism, and what actually stops a second start
//              there is git refusing a branch name it already has. After `stale`, because a cached
//              board's overlay is as out of date as the rest of it.
//
// `row.shared === false`, never `!row.shared`: this is the one branch that turns a refusal into a
// permission, so a row that does not carry the field at all — an older board's JSON, a caller
// written before it existed — must keep the stricter answer rather than quietly disarm the guard.
// That is the deliberate mirror of `mayTake`'s permissive `mine !== false` above.
export function startVerdict(row, { stale = null } = {}) {
  if (row.status === 'landed') return { ok: true };
  if (!mayTake(row)) return { ok: false, reason: 'foreign' };
  if (stale) return { ok: false, reason: 'stale' };
  if (row.status === 'claimed' && row.claimedByMe) return { ok: true };
  if (row.shared === false) return { ok: true, reason: 'unrecordable' };
  return { ok: false, reason: 'unclaimed' };
}
