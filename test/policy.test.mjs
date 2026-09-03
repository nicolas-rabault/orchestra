import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mayTake, startVerdict } from '../lib/roadmap/policy.mjs';
import { reconcile } from '../lib/roadmap/board.mjs';
import { parseRoadmap } from '../lib/roadmap/parse.mjs';
import { ROADMAP } from './helpers/fixture.mjs';

test('an unknown ownership reads as mine — the offline board gets the answer it always got', () => {
  assert.equal(mayTake(null), true);
  assert.equal(mayTake(undefined), true);
  assert.equal(mayTake({}), true);
});

test('someone else\'s roadmap is refused unless they opened it', () => {
  assert.equal(mayTake({ mine: false, open: false }), false);
  assert.equal(mayTake({ mine: false, open: true }), true);
});

test('landed is checked first, so a finished row never blocks its own branch name', () => {
  assert.deepEqual(startVerdict({ status: 'landed', mine: false, open: false }), { ok: true });
});

test('foreign beats stale — waiting for the network never makes a nominative roadmap mine', () => {
  assert.deepEqual(
    startVerdict({ status: 'todo', mine: false, open: false }, { stale: 'cached' }),
    { ok: false, reason: 'foreign' },
  );
});

test('a stale board refuses even my own task', () => {
  assert.deepEqual(
    startVerdict({ status: 'claimed', claimedByMe: true }, { stale: 'cached' }),
    { ok: false, reason: 'stale' },
  );
});

test('claimed by me passes; anything else is unclaimed', () => {
  assert.deepEqual(startVerdict({ status: 'claimed', claimedByMe: true }), { ok: true });
  assert.deepEqual(startVerdict({ status: 'todo' }), { ok: false, reason: 'unclaimed' });
  assert.deepEqual(startVerdict({ status: 'claimed', claimedByMe: false }), { ok: false, reason: 'unclaimed' });
});

// Every case above hands `startVerdict` an object written by hand, which is how `claimedByMe` came
// to be read here and produced nowhere: a real board row never carried it, so this decision could
// not be reached at all. This case derives the row instead of writing it.
test('a row reconcile BUILT for a task claimed here satisfies startVerdict', () => {
  const tasks = parseRoadmap(ROADMAP).tasks;
  const git = { refs: new Set(['demo/d1-first-thing']), mainSubjects: new Set() };
  const [row] = reconcile({ tasks, git, register: [], overlay: new Map() }).rows;
  assert.equal(row.status, 'claimed');
  assert.equal(row.claimedByMe, true);
  assert.deepEqual(startVerdict(row), { ok: true });
});
