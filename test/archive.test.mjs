import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo } from './helpers/fixture.mjs';
import { writeState, readState, emptyState } from '../lib/register/state.mjs';
import { partition, archive, loadArchive, isStripped, archivePath, PROSE_FIELDS } from '../lib/register/archive.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

const row = (id, over = {}) => ({ id, status: 'landed', deps: [], note: 'a long post-mortem',
  subjects: ['feat: x'], touches: ['a.js'], decisions: ['chose b'], pending: [], ...over });

test('a finished row nothing depends on leaves the register entirely', () => {
  const { next, archived } = partition({ tasks: [row('demo/D1')] }, { at: 'T' });
  assert.deepEqual(next.tasks, []);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].kind, 'task');
  assert.equal(archived[0].note, 'a long post-mortem');
});

test('a finished row a LIVE row still depends on stays, stripped of its prose only', () => {
  const { next } = partition({ tasks: [row('demo/D1'), row('demo/D2', { status: 'todo', deps: ['demo/D1'] })] }, { at: 'T' });
  assert.deepEqual(next.tasks.map((t) => t.id), ['demo/D1', 'demo/D2']);
  const kept = next.tasks[0];
  for (const f of PROSE_FIELDS) assert.equal(kept[f], undefined);
  // Every field a reader touches is still there.
  assert.equal(kept.status, 'landed');
  assert.deepEqual(kept.deps, []);
  assert.ok(isStripped(kept));
});

test('a second pass does not archive a stripped row again', () => {
  const first = partition({ tasks: [row('demo/D1'), row('demo/D2', { status: 'todo', deps: ['demo/D1'] })] }, { at: 'T' });
  const second = partition(first.next, { at: 'T' });
  assert.deepEqual(second.archived, []);
  assert.equal(second.next, first.next);
});

test('pending is never prose: a question already put survives archiving', () => {
  const { next } = partition({ tasks: [row('demo/D1', { pending: [{ ask: 'A or B?' }] }),
                                       row('demo/D2', { status: 'todo', deps: ['demo/D1'] })] }, { at: 'T' });
  assert.deepEqual(next.tasks[0].pending, [{ ask: 'A or B?' }]);
});

test('nothing finished means nothing moves, INCLUDING the conductor prose', () => {
  const state = { tasks: [row('demo/D1', { status: 'claimed' })], lesson: 'never do that again' };
  const { next, archived } = partition(state, { at: 'T' });
  assert.equal(next, state);
  assert.deepEqual(archived, []);
});

test('structural keys stay and everything else at the top is archived as lessons', () => {
  const root = '/tmp/x';
  const state = { ...emptyState(root), tasks: [row('demo/D1')], lesson: 'never do that again' };
  const { next, archived } = partition(state, { at: 'T' });
  assert.equal(next.root, root);
  assert.equal(next.version, 1);
  assert.equal(next.budgetResetAt, null);
  assert.equal(next.lesson, undefined);
  const lessons = archived.find((a) => a.kind === 'lessons');
  assert.deepEqual(lessons.keys, ['lesson']);
});

test('archive writes the line before it rewrites the register, and round-trips', () => {
  const r = repo();
  writeState(r.root, { ...emptyState(r.root), tasks: [row('demo/D1')] });
  const res = archive(r.root, { at: 'T' });
  assert.equal(res.archived, 1);
  assert.ok(res.after < res.before);
  assert.deepEqual(readState(r.root).tasks, []);
  assert.equal(readState(r.root).root, r.root);       // the wrong-project guard survives the pass
  assert.equal(loadArchive(r.root)[0].note, 'a long post-mortem');
});

test('a torn tail line in the archive is skipped, not fatal', () => {
  const r = repo();
  writeState(r.root, { ...emptyState(r.root), tasks: [row('demo/D1')] });
  archive(r.root, { at: 'T' });
  appendFileSync(archivePath(r.root), '{"kind":"tas');
  assert.equal(loadArchive(r.root).length, 1);
});
