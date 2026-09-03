import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at, after, unconsumed, openPendingIds, PENDING_GRACE_MS } from '../lib/register/inbox.mjs';
import { pendingId } from '../lib/register/pending.mjs';

const state = (seen, pending = []) => ({ conductor: { inboxSeen: seen }, tasks: [{ id: 'demo/D1', pending }] });

test('timestamps compare as instants, not as strings', () => {
  // '…:30Z' > '…:30.500Z' in string order, which would drop an answer written in the same second
  // as the stamp.
  assert.equal(after('2026-09-03T10:00:30.500Z', '2026-09-03T10:00:30Z'), true);
  assert.equal(at('soon'), null);
});

test('a never-stamped cursor falls back to string order and keeps everything', () => {
  assert.equal(after('2026-09-03T10:00:00.000Z', ''), true);
});

test('an answer past the cursor is unconsumed', () => {
  const entries = [{ ts: '2026-09-03T10:00:00.000Z', task: 'demo/D1' }];
  assert.equal(unconsumed(entries, state('2026-09-03T09:00:00.000Z')).length, 1);
  assert.equal(unconsumed(entries, state('2026-09-03T11:00:00.000Z')).length, 0);
});

test('an answer BEHIND the cursor comes back while its item is open and recent, and not after', () => {
  const item = { kind: 'question', ask: 'A or B?' };
  const id = pendingId('demo/D1', item);
  const now = Date.parse('2026-09-03T12:00:00.000Z');
  const entry = { ts: '2026-09-03T10:00:00.000Z', task: 'demo/D1', pending: id };
  const s = state('2026-09-03T11:00:00.000Z', [item]);
  assert.equal(unconsumed([entry], s, now).length, 1);
  assert.equal(unconsumed([entry], s, now + PENDING_GRACE_MS).length, 0);
});

test('openPendingIds keys on the row id the register carries', () => {
  const item = { kind: 'question', ask: 'A or B?' };
  assert.deepEqual([...openPendingIds(state('', [item]))], [pendingId('demo/D1', item)]);
});

test('an explicit item id wins over the hash', () => {
  assert.equal(pendingId('demo/D1', { id: 'chosen', kind: 'question', ask: 'x' }), 'chosen');
});
