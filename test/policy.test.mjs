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

// A guard that demanded evidence its own store cannot produce. Offline, and for a
// `destination: local` roadmap in any mode, `claim` writes nothing (lib/store/files.mjs) — there is
// nobody to tell — so the row reads `todo` until its branch exists, which is what the refused
// `git worktree add -b` was about to create. Measured 2026-09-07: `pr/PR91` refused one second
// after `orchestra roadmap claim pr/PR91` succeeded, telling the conductor to re-run that command.
test('a row no shared channel carries may start, and the verdict says why it was allowed', () => {
  assert.deepEqual(startVerdict({ status: 'todo', shared: false }), { ok: true, reason: 'unrecordable' });
});

// The permission needs `shared: false` in as many words. A row that never mentions the field is a
// board this policy does not recognise, and the honest answer to "can a claim be recorded here" is
// then "I do not know" — which must keep the refusal rather than disarm the guard by omission.
test('the permission needs shared:false outright — a row that never mentions it still refuses', () => {
  assert.deepEqual(startVerdict({ status: 'todo' }), { ok: false, reason: 'unclaimed' });
  assert.deepEqual(startVerdict({ status: 'todo', shared: true }), { ok: false, reason: 'unclaimed' });
});

// The case the guard exists for, and the half of it that must not move: online, an issue's assignee
// genuinely records the claim, so a task somebody else holds — and a roadmap somebody else owns —
// is refused exactly as before.
test('online, a claim held by somebody else is still REFUSED', () => {
  assert.deepEqual(
    startVerdict({ status: 'claimed', claimedByMe: false, shared: true, mine: true }),
    { ok: false, reason: 'unclaimed' },
  );
  assert.deepEqual(
    startVerdict({ status: 'todo', shared: true, mine: false, open: false }),
    { ok: false, reason: 'foreign' },
  );
});

test('a stale board still refuses a row no shared channel carries', () => {
  assert.deepEqual(
    startVerdict({ status: 'todo', shared: false }, { stale: 'cached' }),
    { ok: false, reason: 'stale' },
  );
});

// Built by reconcile rather than written by hand, for the same reason the case above it exists:
// `claimedByMe` was once read here and produced nowhere, and a hand-written row proves only that
// the test agrees with itself.
test('a row reconcile BUILT with no overlay carries shared:false, so its FIRST launch may start', () => {
  const tasks = parseRoadmap(ROADMAP).tasks;
  const git = { refs: new Set(), mainSubjects: new Set() };
  const [row] = reconcile({ tasks, git, register: [], overlay: new Map() }).rows;
  assert.equal(row.status, 'todo');
  assert.equal(row.shared, false);
  assert.deepEqual(startVerdict(row), { ok: true, reason: 'unrecordable' });
});

test('a row reconcile BUILT from an overlay entry held by a colleague is still REFUSED', () => {
  const tasks = parseRoadmap(ROADMAP).tasks;
  const git = { refs: new Set(), mainSubjects: new Set() };
  const overlay = new Map([['demo/D1', {
    status: 'claimed', ref: 5, owner: 'nico', open: false, mine: true, claimedByMe: false,
  }]]);
  const [row] = reconcile({ tasks, git, register: [], overlay }).rows;
  assert.equal(row.shared, true);
  assert.deepEqual(startVerdict(row), { ok: false, reason: 'unclaimed' });
});
