// The project strip, level 1. Pure, so it is asserted here rather than through a socket — and
// unlike `app.js`, this module IS loaded by a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectTabsOf, modelOf } from '../lib/monitor/projects.mjs';

const node = (key, status, pending = []) => ({ key, id: key, status, pending });
const model = (id, name, nodes, mode = 'offline') => ({ project: { id, name, mode }, nodes });

test('one tab per project, sorted by name, never by activity', () => {
  const tabs = projectTabsOf([
    model('bbbbbb', 'zulu', [node('z/1', 'claimed')]),
    model('aaaaaa', 'alpha', [node('a/1', 'todo')]),
  ]);
  assert.deepEqual(tabs.map((t) => t.name), ['alpha', 'zulu']);
  assert.deepEqual(tabs.map((t) => t.id), ['aaaaaa', 'bbbbbb']);
  assert.deepEqual(tabs.map((t) => t.mode), ['offline', 'offline']);
});

test('two projects with the same name still get two tabs, ordered by id', () => {
  const tabs = projectTabsOf([
    model('ffffff', 'app', [node('f/1', 'todo')]),
    model('111111', 'app', [node('o/1', 'todo')]),
  ]);
  assert.deepEqual(tabs.map((t) => t.id), ['111111', 'ffffff']);
});

test('counts cover the whole project, not one developer view', () => {
  const [tab] = projectTabsOf([model('aaaaaa', 'alpha', [
    node('a/1', 'landed'), node('a/2', 'claimed'), node('a/3', 'todo'),
  ])]);
  assert.equal(tab.counts.total, 3);
});

test('waiting counts the questions with no answer', () => {
  const [tab] = projectTabsOf([model('aaaaaa', 'alpha', [
    node('a/1', 'claimed', [{ id: 'q1', answer: null }, { id: 'q2', answer: 'yes' }]),
    node('a/2', 'claimed', [{ id: 'q3', answer: null }]),
  ])]);
  assert.equal(tab.waiting, 2);
});

test('a slot this tab already answered stops counting as waiting', () => {
  const models = [model('aaaaaa', 'alpha', [node('a/1', 'claimed', [{ id: 'q1', answer: null }])])];
  assert.equal(projectTabsOf(models, new Set(['a/1:q1']))[0].waiting, 0);
});

test('no projects at all is an empty strip, not a throw', () => {
  assert.deepEqual(projectTabsOf([]), []);
  assert.deepEqual(projectTabsOf(undefined), []);
});

test('modelOf finds a project by id, and answers null for one that left', () => {
  const models = [model('aaaaaa', 'alpha', []), model('bbbbbb', 'zulu', [])];
  assert.equal(modelOf(models, 'bbbbbb').project.name, 'zulu');
  assert.equal(modelOf(models, 'nope'), null);
  assert.equal(modelOf(undefined, 'aaaaaa'), null);
});
