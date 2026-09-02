import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoadmap } from '../lib/roadmap/parse.mjs';
import { reconcile, UNVERIFIED, isLanded } from '../lib/roadmap/board.mjs';
import { ROADMAP } from './helpers/fixture.mjs';

const tasks = parseRoadmap(ROADMAP).tasks;
const noGit = { refs: new Set(), mainSubjects: new Set() };
const row = (over = {}) => ({
  id: 'demo/D1', status: 'todo', subjects: [], deps: [], branch: 'demo/d1-first-thing', ...over,
});

test('with no overlay and no branch, a task is todo and schedulable', () => {
  const b = reconcile({ tasks, git: noGit, register: [], overlay: new Map() });
  assert.equal(b.rows[0].status, 'todo');
  assert.equal(b.rows[0].mine, true);
  assert.equal(b.rows[0].schedulable, true);
  assert.deepEqual(b.corrections, []);
});

test('an existing branch ref makes it claimed', () => {
  const git = { refs: new Set(['demo/d1-first-thing']), mainSubjects: new Set() };
  assert.equal(reconcile({ tasks, git, register: [], overlay: new Map() }).rows[0].status, 'claimed');
});

test('a recorded subject on main makes it landed', () => {
  const git = { refs: new Set(), mainSubjects: new Set(['feat: the first thing']) };
  const register = [row({ status: 'landed', subjects: ['feat: the first thing'] })];
  assert.equal(reconcile({ tasks, git, register, overlay: new Map() }).rows[0].status, 'landed');
});

test('landed with NO recorded subject is "landed?", listed separately, never todo', () => {
  const register = [row({ status: 'landed', subjects: [] })];
  const b = reconcile({ tasks, git: noGit, register, overlay: new Map() });
  assert.equal(b.rows[0].status, UNVERIFIED);
  assert.equal(b.unverified.length, 1);
  assert.deepEqual(b.corrections, []);
  assert.equal(isLanded(UNVERIFIED), true);
});

test('a real disagreement between register and derivation is a correction', () => {
  const register = [row({ status: 'claimed', subjects: [] })];
  const b = reconcile({ tasks, git: noGit, register, overlay: new Map() });
  assert.equal(b.corrections.length, 1);
  assert.match(b.corrections[0], /register says claimed, derived todo/);
});

test('an overlay entry that is not mine derives from the overlay, not from git', () => {
  const overlay = new Map([['demo/D1', {
    status: 'claimed', ref: 5, owner: 'someone', open: false, mine: false,
    programme: 1, programmeState: 'open',
  }]]);
  const b = reconcile({ tasks, git: noGit, register: [], overlay });
  assert.equal(b.rows[0].status, 'claimed');
  assert.equal(b.rows[0].mine, false);
  assert.equal(b.rows[0].schedulable, false);
  assert.equal(b.rows[0].issue, 5);
});

test('a roadmap someone opened is schedulable although it is not mine', () => {
  const overlay = new Map([['demo/D1', { status: 'todo', ref: 5, owner: 'someone', open: true, mine: false }]]);
  assert.equal(reconcile({ tasks, git: noGit, register: [], overlay }).rows[0].schedulable, true);
});

test('a shared task the register dropped is "not ours", never a correction', () => {
  const overlay = new Map([['demo/D1', { status: 'claimed', ref: 5, owner: 'someone', open: false, mine: false }]]);
  const register = [row({ status: 'dropped' })];
  const b = reconcile({ tasks, git: noGit, register, overlay });
  assert.equal(b.notMine.length, 1);
  assert.deepEqual(b.corrections, []);
});

test('offline can never produce a "not ours" line, because the overlay is empty', () => {
  const register = [row({ status: 'dropped' })];
  const b = reconcile({ tasks, git: noGit, register, overlay: new Map() });
  assert.deepEqual(b.notMine, []);
});

test('deps are OVERWRITTEN with the qualified form and drive depsMet', () => {
  const two = parseRoadmap(ROADMAP.replace('- **Deps** —', '- **Deps** D0')).tasks;
  const b = reconcile({ tasks: two, git: noGit, register: [], overlay: new Map() });
  assert.deepEqual(b.rows[0].deps, ['demo/D0']);
  assert.equal(b.rows[0].depsMet, false);
  assert.deepEqual(b.rows[0].blockedBy, ['demo/D0']);
});

test('orphans are reported in both directions', () => {
  const register = [row({ id: 'demo/ZZ', status: 'todo' })];
  const b = reconcile({ tasks, git: noGit, register, overlay: new Map() });
  assert.deepEqual(b.orphans.inRegisterOnly, ['demo/ZZ']);
  assert.deepEqual(b.orphans.inRoadmapOnly, ['demo/D1']);
});
