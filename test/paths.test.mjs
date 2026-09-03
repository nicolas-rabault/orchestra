import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo } from './helpers/fixture.mjs';
import { mainCheckout, projectId, orchestraDir, assertRoot, gitEnv } from '../lib/paths.mjs';

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

test('mainCheckout refuses a bare repository — the guard, not git, catches it', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'orchestra-bare-')));
  execFileSync('git', ['init', '-q', '--bare', 'project.git'], { cwd: dir });
  const bare = join(dir, 'project.git');
  assert.throws(() => mainCheckout(bare), (e) =>
    e.message.includes('is not a working tree') && e.message.includes(bare));
  rmSync(dir, { recursive: true, force: true });
});

test('assertRoot accepts a root reached through a symlink', () => {
  const r = repo();
  const link = join(realpathSync(mkdtempSync(join(tmpdir(), 'orchestra-link-'))), 'via');
  symlinkSync(r.root, link);
  // Same tree, two spellings. Refusing this is the wrong-project guard firing on the right project.
  assert.doesNotThrow(() => assertRoot(r.root, link));
  assert.doesNotThrow(() => assertRoot(link, r.root));
});

test('assertRoot still refuses two genuinely different trees, naming both', () => {
  const a = repo();
  const b = repo();
  assert.throws(() => assertRoot(a.root, b.root), (e) =>
    e.message.includes(a.root) && e.message.includes(b.root));
});

test('assertRoot compares a path that does not exist without throwing on the stat', () => {
  // A register recorded for a checkout since deleted must still be REFUSED, not crash the caller
  // with ENOENT — the guard's job is to name the mismatch.
  const r = repo();
  assert.throws(() => assertRoot(join(r.root, 'gone-since'), r.root), /refusing to write across projects/);
});

test('gitEnv strips every GIT_ variable', () => {
  const env = gitEnv({ PATH: '/bin', GIT_DIR: '/elsewhere/.git', GIT_WORK_TREE: '/elsewhere', GIT_INDEX_FILE: '/x' });
  assert.equal(env.PATH, '/bin');
  assert.deepEqual(Object.keys(env).filter((k) => k.startsWith('GIT_')), []);
});
