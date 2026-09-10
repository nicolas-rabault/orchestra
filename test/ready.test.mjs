import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { makeRepo } from './helpers/fixture.mjs';
import { reconcileTasks, computeReadySet, planLaunches, launchHold, pendingWaiting, gatherGit }
  from '../lib/register/ready.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

// `id.split('/')[1]` assumes a qualified id, which the "unqualified id" test below deliberately
// violates (`row('D1')`) to reach computeReadySet's own check — so the branch name falls back to
// the whole id rather than crashing before that check ever runs. Every other call site here passes
// a qualified id, where this is identical to the unguarded form.
const row = (id, over = {}) => ({ id, order: 1, title: id,
  branch: `b/${(id.includes('/') ? id.split('/')[1] : id).toLowerCase()}`,
  deps: [], lane: null, subjects: [], status: 'todo', design: false, mine: true, pending: [], ...over });

test('an existing ref claims a todo row, and a vanished ref returns a claimed one', () => {
  const git = { branches: ['b/d1'], mainSubjects: [] };
  const { tasks, corrections } = reconcileTasks([row('demo/D1'), row('demo/D2', { status: 'claimed' })], git);
  assert.equal(tasks[0].status, 'claimed');
  assert.equal(tasks[1].status, 'todo');
  assert.equal(tasks[1].note, 'ref gone; check worktree before relaunch');
  assert.equal(corrections.length, 2);
});

test('a subject on main lands a row whatever its ref says', () => {
  const git = { branches: [], mainSubjects: ['feat: the thing'] };
  const { tasks } = reconcileTasks([row('demo/D1', { subjects: ['feat: the thing'] })], git);
  assert.equal(tasks[0].status, 'landed');
});

test('an unqualified id or dep is an error, not a task to schedule cautiously', () => {
  const git = { branches: [], mainSubjects: [] };
  assert.throws(() => computeReadySet([row('D1')], git), /unqualified id/);
  assert.throws(() => computeReadySet([row('demo/D1', { deps: ['D0'] })], git), /unqualified dep/);
});

test('a dep that has not landed and a busy lane each block, and nothing else does', () => {
  const git = { branches: [], mainSubjects: [] };
  const tasks = [
    row('demo/D1', { status: 'landed' }),
    row('demo/D2', { deps: ['demo/D1'] }),
    row('demo/D3', { deps: ['demo/D9'] }),
    row('demo/D4', { lane: 'ui' }),
    row('demo/D5', { lane: 'ui', status: 'claimed' }),
  ];
  const { ready, blocked } = computeReadySet(tasks, git);
  assert.deepEqual(ready.map((t) => t.id), ['demo/D2']);
  assert.deepEqual(blocked.map((b) => b.id), ['demo/D3', 'demo/D4']);
});

test('mine goes first; a stranger fills a spare slot and never displaces me', () => {
  const ready = [row('x/A', { order: 1, mine: false }), row('x/B', { order: 2 })];
  assert.deepEqual(planLaunches(ready, 0, 1).map((t) => t.id), ['x/B']);
  assert.deepEqual(planLaunches(ready, 0, 2).map((t) => t.id), ['x/B', 'x/A']);
});

test('a row with no mine field at all is not demoted behind a stranger', () => {
  const ready = [{ ...row('x/A'), mine: undefined }, row('x/B', { mine: false })];
  assert.deepEqual(planLaunches(ready, 0, 1).map((t) => t.id), ['x/A']);
});

test('a design task is planned on the design model', () => {
  assert.equal(planLaunches([row('x/A', { design: true })], 0, 1)[0].model, 'opus');
  assert.equal(planLaunches([row('x/A')], 0, 1)[0].model, 'sonnet');
});

test('a question older than the floor is reported, oldest first, unknown age last', () => {
  const now = Date.parse('2026-09-03T12:00:00.000Z');
  const tasks = [
    row('demo/D1', { pending: [{ kind: 'question', ask: 'old', askedAt: '2026-09-03T09:00:00.000Z' }] }),
    row('demo/D2', { pending: [{ kind: 'question', ask: 'fresh', askedAt: '2026-09-03T11:59:00.000Z' }] }),
    row('demo/D3', { pending: [{ kind: 'question', ask: 'undated' }] }),
    row('demo/D4', { pending: [{ kind: 'question', ask: 'answered', askedAt: '2026-09-03T09:00:00.000Z', answer: 'yes' }] }),
  ];
  assert.deepEqual(pendingWaiting(tasks, { now }).map((p) => p.ask), ['old', 'undated']);
});

test('gatherGit answers about THIS checkout and excludes main', () => {
  const r = repo();
  r.git('branch', 'demo/d1');
  const git = gatherGit(r.root);
  assert.deepEqual(git.branches, ['demo/d1']);
  assert.ok(git.mainSubjects.includes('initial'));
});

test('gatherGit reconciles against the configured main branch, not the literal main', () => {
  const r = repo();
  r.git('branch', '-m', 'main', 'master');
  r.git('worktree', 'add', '-q', '-b', 'feat/x', join(r.root, 'wt'), 'master');
  const git = gatherGit(r.root, { mainBranch: 'master' });
  // The main branch is not one of the branches to reconcile against itself...
  assert.deepEqual(git.branches, ['feat/x']);
  // ...and its subjects are the landing oracle.
  assert.ok(git.mainSubjects.includes('initial'));
});

test('an unborn main branch is a project with no landed history, not a crash', () => {
  const r = repo();
  const git = gatherGit(r.root, { mainBranch: 'trunk' });
  assert.deepEqual(git.mainSubjects, []);
});

// 2026-09-08 in duckJam: six lines launched at 06:45 were every one refused after reading their
// brief, while one already-warm session committed nine times in the same window. The conductor made
// it a ruling by hand that morning; this is the same rule, in the tool.
test('a launch plan stands down while a worker turn is owed, and names who is holding it', () => {
  const launches = [{ id: 'r/A1' }, { id: 'r/A2' }];
  const held = launchHold(launches, { idle: [{ id: 'r/W1' }], undelivered: [{ id: 'r/W2' }] });
  assert.deepEqual(held.owed, ['r/W2', 'r/W1']);
  assert.deepEqual(held.deferred, ['r/A1', 'r/A2']);
});

test('nothing owed, or nothing to launch, holds nothing', () => {
  assert.equal(launchHold([{ id: 'r/A1' }], { idle: [], undelivered: [] }), null);
  assert.equal(launchHold([], { idle: [{ id: 'r/W1' }] }), null);
  assert.equal(launchHold([{ id: 'r/A1' }]), null);
});
