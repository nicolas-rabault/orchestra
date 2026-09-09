// What a tick owes its workers, decided on paper: which rows are stopped with nothing owed by the
// user (`idle`), which owe their worker a message nobody has handed it (`undelivered`), and which
// are being driven right now. One definition, read by `orchestra ready`, `orchestra drive` and the
// conductor's worker watch — so a test here is a test of all three at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { obligations, relayOwed, nudgeFor, turnVerdict, turnRefusal, refusalResetAt, driveSlug,
  PRE_FORK_GRACE_MS } from '../lib/register/drive.mjs';

const row = (id, over = {}) => ({ id, status: 'claimed', session: `${id}-uuid`, sessionName: null, pending: [], ...over });

const liveness = ({ registered = [], resuming = [], turns = [], alive = () => true } = {}) => ({
  registered: new Map(registered.map(([s, r]) => [s, r])),
  resuming: new Set(resuming),
  turns: new Map(turns.map((t) => [t.id, t])),
  alive,
});

const NOW = Date.parse('2026-09-08T10:00:00.000Z');

test('relayOwed: written is not delivered, and delivered without a receipt is not delivered either', () => {
  assert.equal(relayOwed({ relay: { text: 'x', writtenAt: 't' } }), true);
  // The guard for the second defect: a `deliveredAt` a conductor typed by hand, with no receipt from
  // the turn that carried the text, still owes the worker its message.
  assert.equal(relayOwed({ relay: { text: 'x', writtenAt: 't', deliveredAt: 't2' } }), true);
  assert.equal(relayOwed({ relay: { text: 'x', writtenAt: 't', deliveredAt: 't2', receipt: { turnAt: 't2' } } }), false);
  assert.equal(relayOwed({ relay: null }), false);
  assert.equal(relayOwed({}), false);
});

test('N stopped workers on live rows and one undelivered relay are all named, each on its own list', () => {
  const tasks = [
    row('demo/A1'),
    row('demo/A2'),
    row('demo/A3'),
    row('demo/R1', { relay: { text: 'the user said B', writtenAt: '2026-09-08T09:00:00.000Z' } }),
    row('demo/L1', { status: 'landed' }),
  ];
  const out = obligations(tasks, liveness(), { now: NOW });
  assert.deepEqual(out.idle.map((e) => e.id), ['demo/A1', 'demo/A2', 'demo/A3']);
  assert.deepEqual(out.undelivered.map((e) => e.id), ['demo/R1']);
  assert.equal(out.undelivered[0].ageMin, 60);
  assert.deepEqual(out.driving, []);
});

test('a row whose worker is mid-turn owes nothing yet: busy in the agent list, a resume process, or a live driven turn', () => {
  const turn = { id: 'demo/T1', session: 'demo/T1-uuid', pid: 4242, startedAt: '2026-09-08T09:58:00.000Z', exit: null, endedAt: null };
  const tasks = [
    row('demo/B1'),
    row('demo/P1'),
    row('demo/T1', { relay: { text: 'in flight', writtenAt: '2026-09-08T09:50:00.000Z' } }),
  ];
  const out = obligations(tasks, liveness({
    registered: [['demo/B1-uuid', { id: 'b1short', status: 'busy', pid: 1 }]],
    resuming: ['demo/P1-uuid'],
    turns: [turn],
  }), { now: NOW });
  assert.deepEqual(out.idle, []);
  assert.deepEqual(out.undelivered, []);
  assert.deepEqual(out.driving.map((e) => e.id), ['demo/B1', 'demo/P1', 'demo/T1']);
});

test('a registered background session that has gone idle is stopped, and the entry says so, so drive can unregister it first', () => {
  const out = obligations([row('demo/B1')], liveness({
    registered: [['demo/B1-uuid', { id: 'b1short', status: 'idle', pid: 1 }]],
  }), { now: NOW });
  assert.equal(out.idle.length, 1);
  assert.deepEqual(out.idle[0].registered, { id: 'b1short', status: 'idle', pid: 1 });
});

test('a driven turn whose process is gone without an exit is a stopped worker, not a running one', () => {
  const turn = { id: 'demo/V1', session: 'demo/V1-uuid', pid: 4242, startedAt: '2026-09-08T09:00:00.000Z', exit: null, endedAt: null };
  const out = obligations([row('demo/V1')], liveness({ turns: [turn], alive: () => false }), { now: NOW });
  assert.deepEqual(out.idle.map((e) => e.id), ['demo/V1']);
  assert.equal(out.idle[0].turn.verdict, 'vanished');
});

test('a turn recorded for a previous session of the row says nothing about the current one', () => {
  const turn = { id: 'demo/S1', session: 'old-uuid', pid: 4242, startedAt: '2026-09-08T09:58:00.000Z', exit: null, endedAt: null };
  const out = obligations([row('demo/S1')], liveness({ turns: [turn] }), { now: NOW });
  assert.deepEqual(out.idle.map((e) => e.id), ['demo/S1']);
  assert.equal(out.idle[0].turn, null);
});

test('waiting on the user is not idle: an open pending item, or a review row — unless a relay is owed', () => {
  const tasks = [
    row('demo/Q1', { pending: [{ kind: 'question', ask: 'which?', answer: null }] }),
    row('demo/W1', { status: 'review' }),
    row('demo/W2', { status: 'review', relay: { text: 'fix the defect first', writtenAt: '2026-09-08T09:30:00.000Z' } }),
    row('demo/Q2', { pending: [{ kind: 'question', ask: 'which?', answer: 'B' }] }),
  ];
  const out = obligations(tasks, liveness(), { now: NOW });
  assert.deepEqual(out.idle.map((e) => e.id), ['demo/Q2']);
  assert.deepEqual(out.undelivered.map((e) => e.id), ['demo/W2']);
});

test('a row with no session is never idle, and an undelivered relay on it is reported with no session to drive', () => {
  const tasks = [
    row('demo/N1', { session: null, status: 'todo' }),
    row('demo/N2', { session: null, relay: { text: 'for the relaunch brief', writtenAt: '2026-09-08T09:00:00.000Z' } }),
  ];
  const out = obligations(tasks, liveness(), { now: NOW });
  assert.deepEqual(out.idle, []);
  assert.deepEqual(out.undelivered.map((e) => [e.id, e.session]), [['demo/N2', null]]);
});

test('a relay with an unreadable timestamp is still owed, with no age rather than NaN', () => {
  const out = obligations([row('demo/U1', { relay: { text: 'x', writtenAt: 'soon' } })], liveness(), { now: NOW });
  assert.equal(out.undelivered[0].ageMin, null);
});

test('the nudge carries the relay text verbatim at its head, and only the continue nudge otherwise', () => {
  const text = 'L\'UTILISATEUR A REGARDÉ LE DÔME.\n\n« passe la barre en dessous »';
  const withRelay = nudgeFor(row('demo/R1', { relay: { text, writtenAt: 't' } }));
  assert.ok(withRelay.startsWith(text));
  assert.match(withRelay, /act on the message above/i);
  const plain = nudgeFor(row('demo/A1'));
  assert.ok(!plain.includes('message above'));
  assert.match(plain, /final message is your report/);
  // 6 of 28 driven turns on 2026-09-08 in duckJam replayed a whole suite to learn what their own
  // last report already said. Both forms of the nudge carry the sentence that stops it.
  for (const n of [withRelay, plain]) assert.match(n, /do NOT rebase and do NOT re-run the barrier/);
});

test('turnVerdict: an exit is ended, a live pid is running, a dead pid is vanished, and a null pid is running only briefly', () => {
  const base = { startedAt: '2026-09-08T09:59:50.000Z', exit: null, endedAt: null };
  assert.equal(turnVerdict({ ...base, pid: 1, exit: 0 }, { alive: () => false, now: NOW }), 'ended');
  assert.equal(turnVerdict({ ...base, pid: 1 }, { alive: () => true, now: NOW }), 'running');
  assert.equal(turnVerdict({ ...base, pid: 1 }, { alive: () => false, now: NOW }), 'vanished');
  assert.equal(turnVerdict({ ...base, pid: null }, { alive: () => false, now: NOW }), 'running');
  assert.equal(turnVerdict({ ...base, pid: null }, { alive: () => false, now: NOW + PRE_FORK_GRACE_MS + 1 }), 'vanished');
});

test('turnRefusal names the three measured non-turns and nothing else', () => {
  assert.equal(turnRefusal("You've hit your session limit · resets 1:50pm"), 'budget: You\'ve hit your session limit · resets 1:50pm');
  assert.match(turnRefusal('Failed to authenticate: OAuth session expired'), /^auth:/);
  assert.match(turnRefusal('Error: Session abc is running as a background session (abc). Run `claude attach abc`'), /^registered:/);
  assert.equal(turnRefusal('Done. 3 commits on the branch, tests green.'), null);
});

// The wording that cost duckJam two heartbeat slots on 2026-09-06: the old pattern listed the two
// wordings it had seen, and a turn refused with a third read as one that had produced a report.
test('the budget pattern is the shape every wording shares, not the list of wordings seen so far', () => {
  assert.match(turnRefusal("You've hit your individual spend limit · run /usage-credits to ask your admin for a higher limit"), /^budget:/);
  assert.match(turnRefusal("You've hit your usage limit"), /^budget:/);
  // Still not a refusal: the shape needs "hit your … limit", not the word on its own.
  assert.equal(turnRefusal('Raised the retry limit to 5 and landed it.'), null);
});

test('refusalResetAt reads the stated wall clock into an instant, in the zone the message names', () => {
  const now = Date.parse('2026-09-06T11:13:04.000Z');
  assert.equal(refusalResetAt('… your session limit resets 1:40pm (Europe/Paris)', { now }),
    '2026-09-06T11:40:00.000Z');
  // Midnight and noon are where a 12-hour clock goes wrong, so both are asserted.
  assert.equal(refusalResetAt('resets 12:00pm (UTC)', { now }), '2026-09-06T12:00:00.000Z');
  assert.equal(refusalResetAt('resets 12:30am (UTC)', { now: Date.parse('2026-09-06T23:00:00.000Z') }),
    '2026-09-07T00:30:00.000Z');
  // A 24-hour clock, and a bare hour with no minutes.
  assert.equal(refusalResetAt('resets at 14:00 (UTC)', { now }), '2026-09-06T14:00:00.000Z');
  assert.equal(refusalResetAt('resets 2pm (UTC)', { now }), '2026-09-06T14:00:00.000Z');
});

test('refusalResetAt refuses what it cannot trust rather than guessing', () => {
  const now = Date.parse('2026-09-06T11:13:04.000Z');
  assert.equal(refusalResetAt("You've hit your session limit", { now }), null);
  assert.equal(refusalResetAt('resets 1:40pm (Middle/Earth)', { now }), null);
  assert.equal(refusalResetAt('resets 25:00 (UTC)', { now }), null);
  assert.equal(refusalResetAt('resets 13:40pm (UTC)', { now }), null);
  // Tomorrow's 2:10am read at 08:13Z is eighteen hours out — past what this will act on, because a
  // stand-down taken off a misread clock costs every slot until it expires.
  assert.equal(refusalResetAt('resets 2:10am (Europe/Paris)', { now: Date.parse('2026-09-07T08:13:00.000Z') }), null);
});

// A reset stated across a DST boundary must be the instant the clock will really read, not the one
// today's offset would give it. Europe/Paris leaves summer time at 03:00 local on 2026-10-25.
test('refusalResetAt solves the zone offset at the reset, not at the moment it is read', () => {
  const before = Date.parse('2026-10-24T23:00:00.000Z');   // 25 Oct 01:00 local, still UTC+2
  assert.equal(refusalResetAt('resets 9:00am (Europe/Paris)', { now: before }), '2026-10-25T08:00:00.000Z');
});

test('driveSlug is the session-name slug: lowercase, one dash per run of non-alphanumerics', () => {
  assert.equal(driveSlug('dome-web-app-and-broadcast/DW1'), 'dome-web-app-and-broadcast-dw1');
});
