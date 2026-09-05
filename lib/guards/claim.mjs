// Every branch a command's `git worktree add -b <branch>` starts.
//
// "Taken instantly, and everyone notified" cannot rest on an agent's discipline — it has to be that
// THE GESTURE WHICH STARTS THE WORK IS THE GESTURE WHICH POSTS THE CLAIM. `git worktree add` is
// that gesture, and it is the only one, because every change in a project running this plugin goes
// through a worktree (spec §3). `guard-claim.mjs` asks `startVerdict` (lib/roadmap/policy.mjs) —
// already unit-tested — whether each branch this finds may be started; this module only extracts
// them.
//
// Every `-b` in the command, not the first: a chained `git worktree remove old && git worktree add
// new -b <shared-branch>` still starts a task through its SECOND segment, so this walks every
// segment rather than matching once against the whole string.
import { segments, stripEnv, stripQuotes } from './segments.mjs';

export function claimedBranches(command) {
  const branches = [];
  for (const segment of segments(command)) {
    const stripped = stripEnv(segment);
    if (!/git\b.*worktree\s+add/.test(stripped)) continue;
    const m = /(?:^|\s)-b\s+(\S+)/.exec(stripped);
    if (m) branches.push(stripQuotes(m[1]));
  }
  return branches;
}
