import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { at, after, unconsumed, openPendingIds, appendAnswer, readJsonl, PENDING_GRACE_MS } from '../lib/register/inbox.mjs';
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

// P4's own write: `appendAnswer` is what makes `.orchestra/inbox.jsonl` exist at all. The round
// trip that matters is not "the line is on disk" but "the SAME reader that consumes every other
// entry consumes this one too" — a second idea of what an answer looks like would drift from
// `unconsumed` silently.
test('an entry appendAnswer writes round-trips through readJsonl and unconsumed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orchestra-inbox-'));
  const path = join(dir, 'inbox.jsonl');
  try {
    const item = { kind: 'question', ask: 'ship at 0.75 or 1.0?' };
    const entry = {
      ts: '2026-09-04T10:00:00.123Z', task: 'demo/D1',
      pending: pendingId('demo/D1', item), answer: '0.75', from: 'monitor',
    };
    appendAnswer(path, entry);

    const { entries, skipped } = readJsonl(path);
    assert.deepEqual(entries, [entry]);
    assert.equal(skipped, 0);

    // Unconsumed against an empty cursor — nothing has stamped past it yet.
    assert.equal(unconsumed(entries, state('', [item])).length, 1);
    // Not after `inboxSeen` is stamped past the entry's own timestamp AND the item it answers is no
    // longer open — the same two facts p2a's own acceptance test stamps together once a relay has
    // actually delivered an answer. `inboxSeen` alone is not enough: the OR in `unconsumed` still
    // re-delivers a recent answer while ITS OWN item is still open, on purpose (a free remark has no
    // item to close), so consuming a targeted answer means both.
    assert.equal(unconsumed(entries, state('2026-09-04T10:00:01.000Z', [])).length, 0);

    // Append-only: a second write is a second line, never a rewrite of the first.
    const second = { ...entry, ts: '2026-09-04T10:00:05.000Z', answer: '1.0' };
    appendAnswer(path, second);
    assert.deepEqual(readJsonl(path).entries, [entry, second]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
