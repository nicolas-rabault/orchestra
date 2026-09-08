import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, existsSync } from 'node:fs';
import { makeRepo } from './helpers/fixture.mjs';
import {
  statePath, emptyState, readState, writeState, registerRow, qualifyDep, FOREIGN, STRUCTURAL,
  recordLanding,
} from '../lib/register/state.mjs';

const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

test('readState is null before anything is written', () => {
  assert.equal(readState(repo().root), null);
});

test('writeState then readState round-trips and stamps the root', () => {
  const r = repo();
  writeState(r.root, emptyState(r.root));
  const s = readState(r.root);
  assert.equal(s.root, r.root);
  assert.equal(s.adopted, false);
  assert.deepEqual(s.tasks, []);
  assert.ok(existsSync(statePath(r.root)));
});

test('writeState REFUSES a state recorded for another project, naming both paths', () => {
  const a = repo();
  const b = repo();
  const foreign = emptyState(b.root);
  assert.throws(
    () => writeState(a.root, foreign),
    (e) => e.message.includes(a.root) && e.message.includes(b.root),
  );
});

test('an unparseable register is an error, not an empty one', () => {
  const r = repo();
  writeFileSync(statePath(r.root), '{ broken');
  assert.throws(() => readState(r.root), /state\.json/);
});

test('qualifyDep is idempotent on an already-qualified dep', () => {
  assert.equal(qualifyDep('demo', 'D2'), 'demo/D2');
  assert.equal(qualifyDep('demo', 'other/D2'), 'other/D2');
});

test('registerRow carries the SLUG, qualified deps, and every runtime field as null or empty', () => {
  const task = {
    key: 'demo/D1', id: 'D1', title: 'First thing', order: 1, roadmap: 'demo',
    deps: ['D0', 'other/X1'], touches: ['README.md'], lane: null,
    branch: 'demo/d1-first-thing', design: false,
  };
  const row = registerRow(task, { roadmapSlug: 'demo', note: 'hello' });
  assert.equal(row.id, 'demo/D1');
  assert.equal(row.roadmap, 'demo');
  assert.deepEqual(row.deps, ['demo/D0', 'other/X1']);
  assert.equal(row.status, 'todo');
  assert.deepEqual(row.subjects, []);
  assert.deepEqual(row.pending, []);
  assert.equal(row.session, null);
  assert.equal(row.port, null);
  // What the card's "what to open" buttons are built from beside the port: a port is one localhost
  // server, `links` is everywhere else the row can be opened — its pull request, a staging deploy,
  // a CI run. Empty on a fresh row, because nothing has been built for anyone to look at yet.
  assert.deepEqual(row.links, []);
  assert.equal(row.note, 'hello');
});

test('registerRow qualifies deps against roadmapSlug, not task.roadmap', () => {
  const task = {
    key: 'demo/D1', id: 'D1', title: 'First thing', order: 1, roadmap: 'demo',
    deps: ['D0'], touches: ['README.md'], lane: null,
    branch: 'demo/d1-first-thing', design: false,
  };
  const row = registerRow(task, { roadmapSlug: 'other', note: '' });
  assert.equal(row.roadmap, 'other');
  assert.deepEqual(row.deps, ['other/D0']);
});

test('writeState stamps root when the state object has no root field', () => {
  const r = repo();
  const stateWithoutRoot = {
    version: 1,
    adopted: false,
    conductor: { session: null, language: null, inboxSeen: null },
    tasks: [],
  };
  writeState(r.root, stateWithoutRoot);
  const s = readState(r.root);
  assert.equal(s.root, r.root);
});

test('FOREIGN is terminal so nothing schedules another developer\'s task here', () => {
  assert.equal(FOREIGN, 'dropped');
});

test('every key of an empty state is structural, so the archive can never file one as prose', () => {
  for (const k of Object.keys(emptyState('/tmp/x'))) assert.ok(STRUCTURAL.has(k), `${k} is not structural`);
});

test('recordLanding unions subjects onto the matching row and never duplicates them', () => {
  // A row that lands in two goes — a follow-up after a held branch — keeps the subjects of both, and
  // re-running `land` on the same branch cannot duplicate them.
  const state = { tasks: [{ id: 'demo/D1', branch: 'demo/d1', subjects: ['feat: one'], status: 'review' }] };
  const once = recordLanding(state, 'demo/d1', ['feat: one', 'fix: two']);
  assert.equal(once.matched, 'demo/D1');
  assert.deepEqual(once.state.tasks[0].subjects, ['feat: one', 'fix: two']);
  assert.equal(once.state.tasks[0].status, 'landed');
  // A branch with no row is the ordinary case (a fix, a study) and says nothing.
  assert.equal(recordLanding(state, 'nobody/knows', ['x']).matched, null);
  assert.equal(recordLanding({}, 'demo/d1', ['x']).matched, null);
});
