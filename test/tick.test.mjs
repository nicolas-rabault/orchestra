import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { makeRepo } from './helpers/fixture.mjs';
import { writeState, emptyState, statePath } from '../lib/register/state.mjs';
import { writeBeat } from '../lib/register/beat.mjs';
import { inboxPath } from '../lib/register/inbox.mjs';
import { journalPath } from '../lib/register/journal.mjs';
import { decideTick, gateLine } from '../lib/register/tick.mjs';
import { yieldVerdict } from '../lib/register/wake.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

const reg = (over = {}) => ({ tasks: [], ...over });

test('a live CONDUCTING conductor stands the tick down; a silent one hands the baton back', () => {
  assert.match(decideTick({ conductor: { conducting: true, session: 's1', pid: 7 } }), /^skip a conductor is live/);
  const line = decideTick({ conductor: { conducting: false, session: 's1', pid: 7, silentFor: 7_200_000 },
    register: reg({ tasks: [{ status: 'todo' }] }) });
  assert.match(line, /^run hold-awake/);
  assert.match(line, /took the baton back from s1 \(pid 7\), beating but silent for 120 min/);
});

test('absent and unreadable are not the same case', () => {
  assert.match(decideTick({ register: 'absent' }), /^skip no register/);
  assert.equal(decideTick({ register: 'unreadable' }), 'run');
});

test('a budget that has not reset stands the tick down; one nobody can parse does not', () => {
  const now = Date.parse('2026-09-03T10:00:00.000Z');
  assert.match(decideTick({ register: reg({ budgetResetAt: '2026-09-03T12:00:00.000Z' }), now }), /^skip budget resets/);
  assert.match(decideTick({ register: reg({ budgetResetAt: 'soon', tasks: [{ status: 'todo' }] }), now }), /^run/);
});

test('every reason the tick still has something to do', () => {
  assert.match(decideTick({ register: reg(), unconsumedAnswers: 1 }), /^run$/);
  assert.match(decideTick({ register: reg({ tasks: [{ status: 'claimed' }] }) }), /^run hold-awake$/);
  assert.match(decideTick({ register: reg({ tasks: [{ status: 'landed', pending: [{ answer: null }] }] }) }), /^run$/);
  assert.match(decideTick({ register: reg({ tasks: [{ status: 'review', relay: { text: 'x' } }] }) }), /^run hold-awake$/);
});

test('nothing in flight, nothing asked, nothing owed: stand down', () => {
  assert.match(decideTick({ register: reg({ tasks: [{ status: 'landed' }, { status: 'dropped' }] }) }),
    /^skip nothing to do — 2 row\(s\), all landed or dropped/);
});

test('gateLine reads the same unconsumed rule the relay does', () => {
  const r = repo();
  writeState(r.root, { ...emptyState(r.root), tasks: [] });
  assert.match(gateLine(r.root), /^skip nothing to do/);
  appendFileSync(inboxPath(r.root), `${JSON.stringify({ ts: new Date().toISOString(), task: null, answer: 'yes' })}\n`);
  assert.match(gateLine(r.root), /^run$/);
});

// This register never reaches the "cannot tell whether an answer is waiting" catch below: JSON.parse
// fails on it, so `gateLine` reads it as the string 'unreadable' and `decideTick`'s own
// `register === 'unreadable'` branch returns 'run' directly, before the inbox is ever consulted.
test('a register that fails to parse takes decideTick\'s own unreadable branch, not the assumed-answer one', () => {
  const r = repo();
  writeFileSync(statePath(r.root), '{"tasks":');
  assert.equal(gateLine(r.root), 'run');
});

// Here JSON.parse SUCCEEDS — `register` is a real object, not the string 'unreadable' — so this is
// the branch that actually reaches `unconsumedAnswers = 1`: `openPendingIds`'s
// `for (const t of state.tasks ?? [])` iterates over the number 5, throws, and gateLine's catch
// assumes an answer is waiting rather than losing one nobody could confirm.
test('an object register whose task list cannot be iterated still assumes an answer is waiting', () => {
  const r = repo();
  writeFileSync(statePath(r.root), '{"tasks":5}');
  assert.equal(gateLine(r.root), 'run');
});

test('yieldVerdict hands back to a live conductor, once, and journals it once', () => {
  const r = repo();
  const now = Date.parse('2026-09-03T10:00:00.000Z');
  writeState(r.root, emptyState(r.root));
  // `conductorState`'s `silentFor` is measured against the register's REAL mtime, not against
  // `now` — pinned here to `now` itself, as test/beat.test.mjs does, so this passes because the
  // conductor genuinely just wrote it, not because `now` happens to be close to the real clock
  // when the suite runs.
  utimesSync(statePath(r.root), now / 1000, now / 1000);
  writeBeat(r.root, { session: 'abcdef12-1111', pid: 9, now });
  const v = yieldVerdict({ root: r.root, selfSession: 'other', now, alive: () => true });
  assert.equal(v.yield, true);
  yieldVerdict({ root: r.root, selfSession: 'other', now, alive: () => true });
  const lines = readFileSync(journalPath(r.root), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).kind, 'tick');
});

test('my own beat is not somebody else holding the baton', () => {
  const r = repo();
  const now = Date.parse('2026-09-03T10:00:00.000Z');
  writeState(r.root, emptyState(r.root));
  writeBeat(r.root, { session: 'abcdef12', pid: 9, now });
  assert.equal(yieldVerdict({ root: r.root, selfSession: 'abcdef12-1111-2222', now, alive: () => true }).yield, false);
});

test('a beat shorter than eight characters is not an identity', () => {
  const r = repo();
  const now = Date.parse('2026-09-03T10:00:00.000Z');
  writeState(r.root, emptyState(r.root));
  // Same pin as above: `conducting` must be true here for `.yield` to be true, and that has to
  // hold regardless of the real clock at the moment the suite happens to run.
  utimesSync(statePath(r.root), now / 1000, now / 1000);
  writeBeat(r.root, { session: 'abc', pid: 9, now });
  // `selfSession.startsWith('abc')` would read a garbled beat as MY OWN and conduct beside it.
  assert.equal(yieldVerdict({ root: r.root, selfSession: 'abcdef12-1111', now, alive: () => true }).yield, true);
});

test('no beat is no baton, and the register is never consulted as a fallback', () => {
  const r = repo();
  writeState(r.root, { ...emptyState(r.root), conductor: { session: 'ghost', language: null, inboxSeen: null } });
  assert.equal(yieldVerdict({ root: r.root, selfSession: 'me', alive: () => true }).yield, false);
});
