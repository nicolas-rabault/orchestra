import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mayTake, startVerdict } from '../lib/roadmap/policy.mjs';

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
