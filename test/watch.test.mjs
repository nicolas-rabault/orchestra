import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { makeRepo } from './helpers/fixture.mjs';
import { writeState, emptyState, statePath } from '../lib/register/state.mjs';
import { inboxPath } from '../lib/register/inbox.mjs';
import { round, seed, MAX_PER_ROUND } from '../lib/register/watch.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

const answer = (r, i) => appendFileSync(inboxPath(r.root),
  `${JSON.stringify({ ts: `2026-09-03T10:${String(i).padStart(2, '0')}:00.000Z`, task: 'demo/D1', answer: `a${i}` })}\n`);

test('the first round announces nothing and remembers what is already there', () => {
  const r = repo();
  writeState(r.root, emptyState(r.root));
  answer(r, 0);
  const announced = new Set();
  const said = [];
  seed(r.root, announced);
  assert.equal(round(r.root, announced, { emit: (s) => said.push(s) }), 0);
  assert.deepEqual(said, []);
});

test('a new answer is announced once and only once', () => {
  const r = repo();
  writeState(r.root, emptyState(r.root));
  const announced = new Set();
  const said = [];
  seed(r.root, announced);
  answer(r, 1);
  assert.equal(round(r.root, announced, { emit: (s) => said.push(s) }), 1);
  assert.equal(round(r.root, announced, { emit: (s) => said.push(s) }), 0);
  assert.equal(said.length, 1);
  assert.match(said[0], /^ANSWER demo\/D1 · a free remark · 2026-09-03T10:01:00\.000Z — "a1"$/);
});

test('a round that cannot read the register announces NOTHING and forgets nothing', () => {
  const r = repo();
  writeFileSync(statePath(r.root), '{"tasks":');   // caught mid-write
  for (let i = 0; i < 5; i += 1) answer(r, i);
  const announced = new Set();
  const said = [];
  assert.equal(round(r.root, announced, { emit: (s) => said.push(s) }), 0);
  assert.deepEqual(said, []);
  assert.equal(announced.size, 0);
});

test('the overflow past the cap is remembered without being announced', () => {
  const r = repo();
  writeState(r.root, emptyState(r.root));
  const announced = new Set();
  const said = [];
  seed(r.root, announced);
  for (let i = 1; i <= MAX_PER_ROUND + 3; i += 1) answer(r, i);
  assert.equal(round(r.root, announced, { emit: (s) => said.push(s) }), MAX_PER_ROUND);
  assert.equal(round(r.root, announced, { emit: (s) => said.push(s) }), 0);
  assert.equal(said.length, MAX_PER_ROUND);
});
