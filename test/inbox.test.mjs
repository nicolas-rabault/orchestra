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
// `unconsumed` silently. The caller supplies only `task`/`pending`/`answer`: `ts` and `from` are
// stamped by `appendAnswer` itself, so this test reads them back off disk rather than asserting a
// value it chose.
test('an entry appendAnswer writes round-trips through readJsonl and unconsumed, stamping ts and from itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orchestra-inbox-'));
  const path = join(dir, 'inbox.jsonl');
  try {
    const item = { kind: 'question', ask: 'ship at 0.75 or 1.0?' };
    const pending = pendingId('demo/D1', item);
    const before = Date.now();
    appendAnswer(path, { task: 'demo/D1', pending, answer: '0.75' });
    const afterCall = Date.now();

    const { entries, skipped } = readJsonl(path);
    assert.equal(entries.length, 1);
    assert.equal(skipped, 0);
    const [entry] = entries;

    assert.equal(entry.task, 'demo/D1');
    assert.equal(entry.pending, pending);
    assert.equal(entry.answer, '0.75');
    assert.equal(entry.from, 'monitor');
    // Full millisecond precision, from the real clock, at the moment of the call — never a caller's
    // own `Date`, which `after()`'s own comment (above) explains could be truncated to the second.
    assert.match(entry.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const stampedAt = Date.parse(entry.ts);
    assert.ok(stampedAt >= before && stampedAt <= afterCall);

    // Unconsumed against an empty cursor — nothing has stamped past it yet.
    assert.equal(unconsumed(entries, state('', [item])).length, 1);
    // Not after `inboxSeen` is stamped past the entry's own timestamp AND the item it answers is no
    // longer open — the same two facts p2a's own acceptance test stamps together once a relay has
    // actually delivered an answer. `inboxSeen` alone is not enough: the OR in `unconsumed` still
    // re-delivers a recent answer while ITS OWN item is still open, on purpose (a free remark has no
    // item to close), so consuming a targeted answer means both.
    const seenPast = new Date(stampedAt + 1).toISOString();
    assert.equal(unconsumed(entries, state(seenPast, [])).length, 0);

    // Append-only: a second write is a second line, never a rewrite of the first.
    appendAnswer(path, { task: 'demo/D1', pending, answer: '1.0' });
    const again = readJsonl(path).entries;
    assert.equal(again.length, 2);
    assert.equal(again[0].answer, '0.75');
    assert.equal(again[1].answer, '1.0');
    assert.equal(again[1].from, 'monitor');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The core of the fix: a caller cannot get `ts`/`from` wrong because it can no longer supply them
// at all. Passing them anyway proves `appendAnswer` ignores rather than trusts a caller's version —
// `from` especially is not decoration: from Task 3 on, an inbox line is read onto the page as a
// rail entry only when `from === 'monitor'`, because in planetCraft a conductor's own journal line
// once landed in this same file and was rendered back as the user's own words.
test('appendAnswer ignores a caller-supplied ts or from — it stamps both itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orchestra-inbox-'));
  const path = join(dir, 'inbox.jsonl');
  try {
    appendAnswer(path, {
      task: 'demo/D1', pending: null, answer: 'yes',
      ts: '2000-01-01T00:00:00.000Z', from: 'conductor',
    });
    const [entry] = readJsonl(path).entries;
    assert.equal(entry.from, 'monitor');
    assert.notEqual(entry.ts, '2000-01-01T00:00:00.000Z');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
