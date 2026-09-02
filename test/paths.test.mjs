import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo } from './helpers/fixture.mjs';
import { mainCheckout, projectId, orchestraDir, assertRoot } from '../lib/paths.mjs';

const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

test('mainCheckout returns the root from the root', () => {
  const r = repo();
  assert.equal(mainCheckout(r.root), r.root);
});

test('mainCheckout returns the MAIN checkout from inside a linked worktree', () => {
  const r = repo();
  const wt = join(r.root, 'wt');
  r.git('worktree', 'add', '-q', wt, '-b', 'side');
  assert.equal(mainCheckout(wt), r.root);
});

test('mainCheckout refuses a directory that is not a working tree', () => {
  assert.throws(() => mainCheckout('/'), /not a working tree|fatal/i);
});

test('projectId is stable, 6 hex, and keyed on the PATH not the name', () => {
  const a = repo({ name: 'same' });
  const b = repo({ name: 'same' });
  assert.match(projectId(a.root), /^[0-9a-f]{6}$/);
  assert.equal(projectId(a.root), projectId(a.root));
  assert.notEqual(projectId(a.root), projectId(b.root));
});

test('orchestraDir hangs off the root', () => {
  const r = repo();
  assert.equal(orchestraDir(r.root), join(r.root, '.orchestra'));
});

test('assertRoot is silent when it matches or has nothing recorded', () => {
  assertRoot(null, '/a');
  assertRoot('/a', '/a');
  assertRoot('/a/', '/a');
});

test('assertRoot throws naming BOTH paths when they differ', () => {
  assert.throws(
    () => assertRoot('/projects/alpha', '/projects/beta'),
    (e) => e.message.includes('/projects/alpha') && e.message.includes('/projects/beta'),
  );
});
