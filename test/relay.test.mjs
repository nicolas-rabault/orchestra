import { test, after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { makeRepo } from './helpers/fixture.mjs';
import { writeState, emptyState, statePath } from '../lib/register/state.mjs';
import { inboxPath } from '../lib/register/inbox.mjs';
import { pendingId } from '../lib/register/pending.mjs';
import { relay } from '../lib/register/relay.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
afterAll(() => repos.forEach((r) => r.cleanup()));

const seed = (r, { pending = [], answer }) => {
  writeState(r.root, { ...emptyState(r.root),
    tasks: [{ id: 'demo/D1', branch: 'demo/d1', session: 'abcdef12-0000', sessionName: 'orchestra-a1-D1', pending }] });
  appendFileSync(inboxPath(r.root), `${JSON.stringify(answer)}\n`);
};

test('nothing to say is the empty string, not a header', () => {
  assert.equal(relay(repo().root), '');
});

test('an answer names the question, the session that asked it, and the answer verbatim', () => {
  const r = repo();
  const item = { kind: 'question', ask: 'Ship at 0.75 or 1.0?' };
  seed(r, { pending: [item], answer: { ts: '2026-09-03T10:00:00.000Z', task: 'demo/D1', pending: pendingId('demo/D1', item), answer: '0.75' } });
  const out = relay(r.root);
  assert.match(out, /Ship at 0\.75 or 1\.0\?/);
  assert.match(out, /orchestra-a1-D1 \(abcdef12\)/);
  assert.match(out, /the user's answer: "0\.75"/);
  assert.match(out, /conductor\.inboxSeen/);
});

test('an answer to an item no longer in pending says so instead of inventing one', () => {
  const r = repo();
  seed(r, { pending: [], answer: { ts: '2026-09-03T10:00:00.000Z', task: 'demo/D1', pending: 'demo-d1-deadbeef', answer: 'yes' } });
  assert.match(relay(r.root), /NO LONGER in this row's pending\[\]/);
});

test('a corrupt register during relay is silence, not a crash', () => {
  const r = repo();
  // Write the inbox FIRST: relay() bails on its own "no inbox" check before it ever reaches
  // readState(), so a corrupt-or-missing register with no inbox file would never exercise the
  // catch this test is actually for. Only with a real, unconsumed answer sitting in the inbox does
  // relay() proceed far enough to call readState() on the broken file below.
  appendFileSync(inboxPath(r.root), `${JSON.stringify({ ts: '2026-09-03T10:00:00.000Z', task: 'demo/D1', answer: 'x' })}\n`);
  writeFileSync(statePath(r.root), '{"tasks":');
  assert.equal(relay(r.root), '');
});

test('no register at all, with a real inbox, is silence too', () => {
  const r = repo();
  // Same ordering rule as above: the inbox is written first so relay() actually reaches
  // readState(), which here returns null (no state.json at all) rather than throwing — a different
  // branch than the corrupt-JSON case, and both must resolve to the same silent ''.
  appendFileSync(inboxPath(r.root), `${JSON.stringify({ ts: '2026-09-03T10:00:00.000Z', task: 'demo/D1', answer: 'x' })}\n`);
  assert.equal(relay(r.root), '');
});

test('the batch is the OLDEST unconsumed answers and it says how many are behind', () => {
  const r = repo();
  writeState(r.root, { ...emptyState(r.root), tasks: [{ id: 'demo/D1', branch: 'demo/d1', pending: [] }] });
  for (let i = 0; i < 25; i += 1)
    appendFileSync(inboxPath(r.root), `${JSON.stringify({ ts: `2026-09-03T10:${String(i).padStart(2, '0')}:00.000Z`, task: 'demo/D1', answer: `a${i}` })}\n`);
  const out = relay(r.root);
  assert.match(out, /count="20"/);
  assert.match(out, /"a0"/);
  assert.doesNotMatch(out, /"a20"/);
  assert.match(out, /5 further answers are waiting/);
});

test('an out-of-order timestamp past the cap is still shown, and shown first, sorted by instant not file order', () => {
  const r = repo();
  writeState(r.root, { ...emptyState(r.root), tasks: [{ id: 'demo/D1', branch: 'demo/d1', pending: [] }] });
  for (let i = 0; i < 20; i += 1)
    appendFileSync(inboxPath(r.root), `${JSON.stringify({ ts: `2026-09-03T10:${String(i).padStart(2, '0')}:00.000Z`, task: 'demo/D1', answer: `a${i}` })}\n`);
  // Appended LAST — file position 21, past RELAY_CAP — but its ts is the OLDEST of the whole batch:
  // a clock adjustment or a late-flushed write, exactly the case file order alone cannot survive.
  appendFileSync(inboxPath(r.root),
    `${JSON.stringify({ ts: '2026-09-03T09:00:00.000Z', task: 'demo/D1', answer: 'oldest-but-last' })}\n`);
  const out = relay(r.root);
  assert.match(out, /"oldest-but-last"/);
  // Sorted to the FRONT of the shown batch, ahead of every entry written before it in the file.
  assert.ok(out.indexOf('oldest-but-last') < out.indexOf('"a0"'));
  // Bumped out to make room: the newest of the original 20 is now behind the cap.
  assert.doesNotMatch(out, /"a19"/);
  assert.match(out, /1 further answers are waiting/);
});

test('an unparseable timestamp sorts LAST, never jumping ahead of a provably older entry', () => {
  const r = repo();
  writeState(r.root, { ...emptyState(r.root), tasks: [{ id: 'demo/D1', branch: 'demo/d1', pending: [] }] });
  appendFileSync(inboxPath(r.root),
    `${JSON.stringify({ ts: 'not-a-date', task: 'demo/D1', answer: 'unparseable-ts' })}\n`);
  appendFileSync(inboxPath(r.root),
    `${JSON.stringify({ ts: '2026-09-03T10:00:00.000Z', task: 'demo/D1', answer: 'provably-old' })}\n`);
  const out = relay(r.root);
  assert.ok(out.indexOf('provably-old') < out.indexOf('unparseable-ts'));
});
