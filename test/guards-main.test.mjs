// `isMainCheckout` is three git questions, not one (task 3's brief): a linked worktree's
// --git-dir sits under the main checkout's .git/worktrees/<name>, its --git-common-dir is the
// shared .git, and the two are equal only in the main checkout itself — scoped to ONE project by
// comparing against that project's own --git-common-dir, since a user works across several
// repositories in one session.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo } from './helpers/fixture.mjs';
import { isMainCheckout } from '../lib/guards/mainCheckout.mjs';

const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

test('the main checkout itself: recognised, on branch main', () => {
  const r = repo();
  assert.deepEqual(isMainCheckout(r.root, { root: r.root }), { root: r.root, branch: 'main' });
});

test('a subdirectory of the main checkout: recognised the same way', () => {
  const r = repo();
  const sub = join(r.root, 'src');
  mkdirSync(sub);
  assert.deepEqual(isMainCheckout(sub, { root: r.root }), { root: r.root, branch: 'main' });
});

test('the branch reported is whatever HEAD is actually on', () => {
  const r = repo();
  r.git('checkout', '-q', '-b', 'feature');
  assert.deepEqual(isMainCheckout(r.root, { root: r.root }), { root: r.root, branch: 'feature' });
});

test('a linked worktree: null — it is not the main checkout', () => {
  const r = repo();
  const wt = join(r.root, 'wt');
  r.git('worktree', 'add', '-q', wt, '-b', 'side');
  assert.equal(isMainCheckout(wt, { root: r.root }), null);
});

test('a subdirectory of a linked worktree: also null', () => {
  const r = repo();
  const wt = join(r.root, 'wt');
  r.git('worktree', 'add', '-q', wt, '-b', 'side');
  const sub = join(wt, 'src');
  mkdirSync(sub);
  assert.equal(isMainCheckout(sub, { root: r.root }), null);
});

test('a second, unrelated repository: null — scoped OUT, not merely "a" main checkout', () => {
  const a = repo();
  const b = repo();
  assert.equal(isMainCheckout(b.root, { root: a.root }), null);
});

test('a directory that is not a repository at all: null, not a throw', () => {
  const r = repo();
  const bare = realpathSync(mkdtempSync(join(tmpdir(), 'orchestra-notrepo-')));
  assert.equal(isMainCheckout(bare, { root: r.root }), null);
  rmSync(bare, { recursive: true, force: true });
});
