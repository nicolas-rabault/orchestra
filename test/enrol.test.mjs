import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoadmap } from '../lib/roadmap/parse.mjs';
import { enrol } from '../lib/roadmap/enrol.mjs';
import { FOREIGN } from '../lib/register/state.mjs';
import { ROADMAP } from './helpers/fixture.mjs';

const tasks = parseRoadmap(ROADMAP).tasks;
const at = '2026-09-02T10:00:00Z';
const host = 'testbox';

test('a fresh task becomes a todo row carrying its slug and its qualified deps', () => {
  const { state, added } = enrol({ tasks: [] }, tasks, { at, host });
  assert.deepEqual(added, ['demo/D1']);
  assert.equal(state.tasks[0].id, 'demo/D1');
  assert.equal(state.tasks[0].roadmap, 'demo');
  assert.equal(state.tasks[0].status, 'todo');
  assert.match(state.tasks[0].note, /ENROLLED 2026-09-02T10:00:00Z testbox/);
});

test('an existing row is returned by IDENTITY — a note can never be overwritten', () => {
  const existing = { id: 'demo/D1', note: 'a conductor wrote this', status: 'claimed' };
  const { state, added } = enrol({ tasks: [existing] }, tasks, { at, host });
  assert.deepEqual(added, []);
  assert.equal(state.tasks[0], existing);
});

test('a task this machine may not take is enroled terminal, so nothing schedules it', () => {
  const { state } = enrol({ tasks: [] }, tasks, { at, host, foreign: () => true });
  assert.equal(state.tasks[0].status, FOREIGN);
  assert.match(state.tasks[0].note, /dropped here on purpose/);
});

test('a task with no key is skipped rather than written as a null identity', () => {
  const broken = [{ ...tasks[0], key: null }];
  const { state, added } = enrol({ tasks: [] }, broken, { at, host });
  assert.deepEqual(added, []);
  assert.deepEqual(state.tasks, []);
});

test('enrolling twice adds nothing the second time', () => {
  const first = enrol({ tasks: [] }, tasks, { at, host });
  const second = enrol(first.state, tasks, { at, host });
  assert.deepEqual(second.added, []);
  assert.equal(second.state.tasks.length, 1);
});
