import { test, after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { makeRepo } from './helpers/fixture.mjs';
import { writeState, emptyState, statePath } from '../lib/register/state.mjs';
import { inboxPath } from '../lib/register/inbox.mjs';
import { pendingId, runAskId } from '../lib/register/pending.mjs';
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

// ---- an answer to a question about the RUN ----
// It carries no task, because it is about no row. Before this branch existed it reached the
// conductor as "a remark for you", losing both which question it answered and the words of that
// question — on the one tick where the protocol REQUIRES a question to have been put.
test('an answer with no task names the run-level question it answers, and its words', () => {
  const r = repo();
  const ask = { id: 'inertes-standdown-1', roadmap: 'inertes', kind: 'decision',
    ask: 'work the seven tickets down now, or leave them for the queue?' };
  writeState(r.root, { ...emptyState(r.root), tasks: [], runAsks: [ask] });
  appendFileSync(inboxPath(r.root), `${JSON.stringify({
    ts: '2026-09-03T10:00:00.000Z', task: null, pending: runAskId(ask), answer: 'A) work them down' })}\n`);

  const out = relay(r.root);
  assert.match(out, /the run inertes · item inertes-standdown-1 · decision/);
  assert.match(out, /work the seven tickets down now/);
  assert.match(out, /move the item into `runAnswered\[\]`/);
  assert.doesNotMatch(out, /a remark for you/);
});

test('an answer to a run-level ask that is gone says so instead of inventing a question', () => {
  const r = repo();
  writeState(r.root, { ...emptyState(r.root), tasks: [], runAsks: [] });
  appendFileSync(inboxPath(r.root), `${JSON.stringify({
    ts: '2026-09-03T10:00:00.000Z', task: null, pending: 'gone-1', answer: 'B' })}\n`);
  assert.match(relay(r.root), /NO LONGER in runAsks\[\]/);
});

// A free remark still targets no item and must not be dressed up as an answer to anything.
test('a remark that names no item is still a remark', () => {
  const r = repo();
  writeState(r.root, { ...emptyState(r.root), tasks: [] });
  appendFileSync(inboxPath(r.root), `${JSON.stringify({
    ts: '2026-09-03T10:00:00.000Z', task: null, pending: null, answer: 'keep the box quiet' })}\n`);
  assert.match(relay(r.root), /no task — a remark for you/);
});
