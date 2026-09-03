import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo } from './helpers/fixture.mjs';
import { reconcileTasks, computeReadySet, planLaunches, undeliveredRelays, pendingWaiting, gatherGit }
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
  assert.equal(planLaunches([row('x/A', { design: true })], 0, 1)[0].model, 'fable');
  assert.equal(planLaunches([row('x/A')], 0, 1)[0].model, 'opus');
});

test('an undelivered relay is reported whatever the row status, and never for a terminal row', () => {
  const now = Date.parse('2026-09-03T12:00:00.000Z');
  const tasks = [
    row('demo/D1', { status: 'review', relay: { text: 'blocking defect', writtenAt: '2026-09-03T10:00:00.000Z' } }),
    row('demo/D2', { status: 'landed', relay: { text: 'old news', writtenAt: '2026-09-01T10:00:00.000Z' } }),
    row('demo/D3', { status: 'claimed', relay: { text: 'done', writtenAt: '2026-09-03T10:00:00.000Z', deliveredAt: '2026-09-03T10:01:00.000Z' } }),
  ];
  const out = undeliveredRelays(tasks, { now });
  assert.deepEqual(out.map((u) => u.id), ['demo/D1']);
  assert.equal(out[0].ageMin, 120);
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
