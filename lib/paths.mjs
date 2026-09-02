// Where a project's files are, and which project this is.
//
// Runtime state always belongs to the MAIN checkout, never to the worktree the caller happens to
// be standing in: `git worktree add` copies no untracked file, so a worker's tree has no register,
// no journal and no drafts, and resolving them relative to cwd would silently create a second,
// empty set beside the real one.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

export function mainCheckout(cwd = process.cwd()) {
  // --path-format=absolute (git 2.31) removes the only ambiguity here: --git-common-dir answers
  // relatively from the main checkout and absolutely from a linked worktree, and a caller that
  // resolved the relative form against its own cwd would be right by accident.
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!/[/\\]\.git$/.test(common))
    throw new Error(`orchestra: ${cwd} is not a working tree with a .git directory (git-common-dir = ${common})`);
  return dirname(common);
}

// Six hex of sha256 over the ABSOLUTE path, never over the name: two checkouts of one repository,
// and two unrelated projects that happen to share a directory name, must not collide. Derived on
// demand and never stored in the config, which would carry a wrong id to another machine.
export const projectId = (root) => createHash('sha256').update(resolve(root)).digest('hex').slice(0, 6);

export const orchestraDir = (root) => join(root, '.orchestra');

// `cd` persists between an agent's shell calls, and a conductor that has just launched a worker is
// one relative path away from writing another project's state. A mismatch is an error naming both
// paths — never a warning, and never a silent write.
export function assertRoot(recorded, actual) {
  if (!recorded) return;
  if (resolve(recorded) !== resolve(actual))
    throw new Error(
      `orchestra: this state belongs to ${resolve(recorded)}, but the working tree resolved to ${resolve(actual)} — refusing to write across projects`,
    );
}
