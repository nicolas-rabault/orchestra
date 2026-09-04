// The other shared decision (task 3's brief): is `dir` inside a GIVEN project's main checkout,
// and if so what branch is HEAD on. Two separate questions on purpose — "am I in this project's
// main checkout" and "is HEAD the main branch" have different inputs (a directory vs. a branch
// name) and different failure modes, and folding them into one boolean would lose which of the
// two said no, which is exactly what a refusal message needs to say. Each caller compares the
// returned `branch` against its own `cfg.mainBranch`.
//
// Three git questions, not one:
//   - a linked worktree's --git-dir sits under the main checkout's .git/worktrees/<name>, while
//     its --git-common-dir is the shared .git; the two are equal only in the main checkout
//     itself.
//   - --path-format=absolute (git >= 2.31) on EVERY call below is mandatory: without it, git
//     returns a relative form from a subdirectory, and a main-checkout subdirectory would be
//     misreported as a worktree.
//   - "git-dir equals git-common-dir" alone cannot tell THIS project's main checkout from any
//     other repository's — a user works across several in one session — so `dir` is scoped
//     against `root`'s own --git-common-dir, never against a hardcoded path.
//
// A directory that is not a repository at all, that belongs to a different repository, or that is
// a linked worktree, is none of a caller's business here and gets `null` — only the main checkout
// itself gets an answer.
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { gitEnv } from '../paths.mjs';

const git = (dir, args) => {
  try {
    return execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: gitEnv(),
    }).trim();
  } catch { return null; }
};

export function isMainCheckout(dir, { root }) {
  const gitDir = git(dir, ['rev-parse', '--path-format=absolute', '--git-dir']);
  const commonDir = git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (gitDir === null || commonDir === null) return null; // not a repository at all

  const ourCommonDir = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (ourCommonDir === null || commonDir !== ourCommonDir) return null; // a different repository

  if (gitDir !== commonDir) return null; // a linked worktree, not the main checkout

  return { root: dirname(commonDir), branch: git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']) };
}
