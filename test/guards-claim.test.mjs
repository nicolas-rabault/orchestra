// `claimedBranches` is `guard-claim`'s pure decision: every branch name a `git worktree add -b`
// starts in this command — the gesture that starts a task, per the design `guard-claim`'s own
// header explains. `startVerdict` (lib/roadmap/policy.mjs) judges each one; this file only tests
// the extraction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimedBranches } from '../lib/guards/claim.mjs';

test('a plain worktree add names its branch', () => {
  assert.deepEqual(claimedBranches('git worktree add ../wt -b my-branch main'), ['my-branch']);
});

test('a quoted branch name has its quotes stripped', () => {
  assert.deepEqual(claimedBranches('git worktree add ../wt -b "my-branch"'), ['my-branch']);
});

test('no worktree add at all: no branches, and no other git command is mistaken for one', () => {
  assert.deepEqual(claimedBranches('git status'), []);
  assert.deepEqual(claimedBranches('git checkout -b my-branch'), []);
});

test('every -b across a chained command is collected, not just the first', () => {
  assert.deepEqual(
    claimedBranches('git worktree remove old && git worktree add new -b shared-branch main'),
    ['shared-branch'],
  );
});

test('two worktree add segments both contribute their branch', () => {
  assert.deepEqual(
    claimedBranches('git worktree add wt1 -b br1 main && git worktree add wt2 -b br2 main'),
    ['br1', 'br2'],
  );
});

test('a worktree add with no -b names nothing', () => {
  assert.deepEqual(claimedBranches('git worktree add ../wt existing-branch'), []);
});

test('an empty or falsy command yields no branches', () => {
  assert.deepEqual(claimedBranches(''), []);
});
