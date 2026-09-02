import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoadmap, EMPTY, FIELD_NAMES } from '../lib/roadmap/parse.mjs';
import { ROADMAP } from './helpers/fixture.mjs';

test('a well-formed roadmap parses into one qualified task', () => {
  const { roadmap, tasks, errors } = parseRoadmap(ROADMAP, { source: 'demo.md' });
  assert.deepEqual(errors, []);
  assert.equal(roadmap, 'demo');
  assert.equal(tasks.length, 1);
  const t = tasks[0];
  assert.equal(t.id, 'D1');
  assert.equal(t.key, 'demo/D1');
  assert.equal(t.title, 'First thing');
  assert.equal(t.order, 1);
  assert.deepEqual(t.deps, []);
  assert.deepEqual(t.touches, ['README.md']);
  assert.equal(t.branch, 'demo/d1-first-thing');
  assert.equal(t.design, false);
  assert.equal(t.lane, null);
  assert.match(t.why, /^The player sees/);
  assert.match(t.acceptance, /^A test asserts/);
});

test('the em dash is the only way to say "none"', () => {
  const { tasks } = parseRoadmap(ROADMAP.replace('- **Deps** —', '- **Deps** D0, demo/D9'));
  assert.deepEqual(tasks[0].deps, ['D0', 'demo/D9']);
  assert.equal(EMPTY, '—');
});

test('an unknown field is a shape error carrying the field and the task', () => {
  const { errors } = parseRoadmap(ROADMAP.replace('- **Lane** —', '- **Status** landed'));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, 'Status');
  assert.equal(errors[0].task, 'D1');
});

test('a field written twice is an error', () => {
  const { errors } = parseRoadmap(ROADMAP.replace('- **Lane** —', '- **Order** 2'));
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /appears twice/);
});

test('unclosed frontmatter is reported', () => {
  const { errors } = parseRoadmap('---\nroadmap: demo\n\n### A1 — x\n');
  assert.match(errors[0].message, /never closed/);
});

test('FIELD_NAMES is the whole grammar and holds no status field', () => {
  assert.deepEqual(FIELD_NAMES, ['Roadmap', 'Order', 'Deps', 'Touches', 'Branch', 'Design', 'Lane']);
});
