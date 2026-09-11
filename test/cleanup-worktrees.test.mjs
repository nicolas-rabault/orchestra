import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers/fixture.mjs';
import { cleanupWorktrees } from '../lib/register/cleanupWorktrees.mjs';
import { emptyState, readState, writeState } from '../lib/register/state.mjs';

const bin = fileURLToPath(new URL('../bin/orchestra', import.meta.url));
function setup(t, overrides = {}) {
  const r = makeRepo();
  t.after(() => r.cleanup());
  const path = join(r.root, 'worker tree');
  r.git('worktree', 'add', '-q', '-b', 'demo/task', path);
  writeFileSync(join(path, 'task.txt'), 'completed task\n');
  r.git('-C', path, 'add', 'task.txt');
  r.git('-C', path, 'commit', '-qm', 'complete task');
  r.git('merge', '--ff-only', 'demo/task');
  const row = { id: 'demo/T1', branch: 'demo/task', status: 'landed', subjects: [], deps: [], ...overrides };
  const save = (tasks = [row]) => writeState(r.root, { ...emptyState(r.root), tasks });
  save();
  const ready = (cwd = r.root) => JSON.parse(execFileSync(process.execPath, [bin, 'ready', '--compact'], {
    cwd, encoding: 'utf8', env: { ...process.env, HOME: join(r.root, 'home') },
  }));
  return { ...r, path, row, save, ready };
}

test('ready removes a merged terminal worktree and is idempotent', t => {
  const r = setup(t);
  const result = r.ready();
  assert.equal(existsSync(r.path), false);
  assert.equal(result.cleanup.removed[0].id, 'demo/T1');
  assert.deepEqual(r.ready().cleanup.removed, []);
});

test('ready retries a locked worktree even after its row is archived', t => {
  const r = setup(t);
  r.git('worktree', 'lock', r.path);
  assert.equal(r.ready().cleanup.kept.length, 1);
  assert.equal(existsSync(r.path), true);
  appendFileSync(join(r.root, '.orchestra/archive.jsonl'), JSON.stringify({ kind: 'task', ...r.row }) + '\n');
  r.save([]);
  r.git('worktree', 'unlock', r.path);
  assert.equal(r.ready().cleanup.removed.length, 1);
  assert.equal(existsSync(r.path), false);
});

for (const file of ['notes.txt', 'ignored.txt', 'README.md']) {
  test(`ready preserves local ${file} and retries after it is cleared`, t => {
    const r = setup(t);
    if (file === 'ignored.txt') appendFileSync(join(r.root, '.git/info/exclude'), '\nignored.txt\n');
    writeFileSync(join(r.path, file), 'local work\n');
    assert.equal(r.ready().cleanup.kept.length, 1);
    assert.equal(existsSync(join(r.path, file)), true);
    if (file === 'README.md') r.git('-C', r.path, 'restore', file);
    else rmSync(join(r.path, file));
    assert.equal(r.ready().cleanup.removed.length, 1);
  });
}

test('terminal status alone cannot delete unmerged commits', t => {
  const r = setup(t, { status: 'dropped' });
  writeFileSync(join(r.path, 'new.txt'), 'unmerged\n');
  r.git('-C', r.path, 'add', 'new.txt');
  r.git('-C', r.path, 'commit', '-qm', 'unmerged');
  assert.equal(r.ready().cleanup.kept.length, 1);
  assert.equal(existsSync(r.path), true);
});

test('a live row sharing an archived branch protects its worktree', t => {
  const r = setup(t, { status: 'review' });
  appendFileSync(join(r.root, '.orchestra/archive.jsonl'), JSON.stringify({ kind: 'task', ...r.row, id: 'demo/OLD', status: 'landed' }) + '\n');
  r.ready();
  assert.equal(existsSync(r.path), true);
});

test('ready never removes the checkout it runs inside', t => {
  const r = setup(t);
  r.ready(r.path);
  assert.equal(existsSync(r.path), true);
});

for (const status of ['running', 'unknown', 'completed']) {
  test(`Codex ${status} observation ${status === 'completed' ? 'allows' : 'holds'} cleanup`, t => {
    const r = setup(t, { runtime: 'codex', session: 'native-task', hostId: 'local',
      observation: { threadId: 'native-task', hostId: 'local', status, observedAt: new Date().toISOString() } });
    r.ready();
    assert.equal(existsSync(r.path), status !== 'completed');
  });
}


test('stale native completion is not permission to delete a worktree', t => {
  const r = setup(t, { runtime: 'codex', session: 'native-task', hostId: 'local',
    observation: { threadId: 'native-task', hostId: 'local', status: 'completed', observedAt: '2020-01-01T00:00:00.000Z' } });
  assert.equal(r.ready().cleanup.kept.length, 1);
  assert.equal(existsSync(r.path), true);
});

for (const reason of ['busy', 'resume', 'turn', 'unavailable']) {
  test(`Claude ${reason} liveness holds cleanup until the worker is stopped`, t => {
    const r = setup(t, { session: 'claude-session' });
    const live = { registered: new Map(), resuming: new Set(), turns: new Map(), alive: () => true, errors: [] };
    if (reason === 'busy') live.registered.set(r.row.session, { status: 'busy' });
    if (reason === 'resume') live.resuming.add(r.row.session);
    if (reason === 'turn') live.turns.set(r.row.id, { session: r.row.session, pid: 123 });
    if (reason === 'unavailable') live.errors.push('cannot read agent list');
    const cfg = { root: r.root, mainBranch: 'main' };
    assert.equal(cleanupWorktrees(cfg, [r.row], { liveness: () => live }).kept.length, 1);
    assert.equal(existsSync(r.path), true);
    live.registered.clear(); live.resuming.clear(); live.turns.clear(); live.errors = [];
    assert.equal(cleanupWorktrees(cfg, [r.row], { liveness: () => live }).removed.length, 1);
  });
}

test('an archived Codex worker can receive a fresh observation and retry cleanup', t => {
  const r = setup(t, { runtime: 'codex', session: 'native-task', hostId: 'local',
    observation: { threadId: 'native-task', hostId: 'local', status: 'completed', observedAt: '2020-01-01T00:00:00.000Z' } });
  appendFileSync(join(r.root, '.orchestra/archive.jsonl'), JSON.stringify({ kind: 'task', ...r.row }) + '\n');
  r.save([]);
  assert.equal(r.ready().cleanup.kept.length, 1);
  const snapshot = join(r.root, 'snapshot.json');
  writeFileSync(snapshot, JSON.stringify({ threadId: 'native-task', hostId: 'local', status: 'completed', observedAt: new Date().toISOString() }));
  execFileSync(process.execPath, [bin, 'codex', 'observe', r.row.id, snapshot], { cwd: r.root });
  assert.deepEqual(readState(r.root).tasks, []);
  assert.equal(r.ready().cleanup.removed.length, 1);
});
