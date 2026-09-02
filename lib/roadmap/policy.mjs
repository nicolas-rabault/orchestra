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
// pure and here rather than inside `.claude/hooks/guard-roadmap-claim.mjs`, because a hook reads
// stdin and spawns a child process at import: nothing can unit-test it, and its three refusals were
// exercised by nothing. It is roadmap policy, not hook plumbing. The hook owns the wording.
//
// Order matters, and each place in it is a decision:
//   landed   — finished work is nobody's business here. FIRST, because a closed issue reads as
//              landed whoever it is assigned to, so a landed row can never satisfy the claimed-by-me
//              test and the branch NAME would otherwise be blocked forever.
//   foreign  — before `stale`, because no amount of waiting for the network makes someone else's
//              nominative roadmap mine, and "claim it first" is a loop with no exit.
//   stale    — a cached board cannot say who took what since. Applies to my own tasks too.
export function startVerdict(row, { stale = null } = {}) {
  if (row.status === 'landed') return { ok: true };
  if (!mayTake(row)) return { ok: false, reason: 'foreign' };
  if (stale) return { ok: false, reason: 'stale' };
  if (row.status === 'claimed' && row.claimedByMe) return { ok: true };
  return { ok: false, reason: 'unclaimed' };
}
