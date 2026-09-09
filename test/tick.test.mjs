import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo } from './helpers/fixture.mjs';
import { writeState, emptyState, statePath } from '../lib/register/state.mjs';
import { writeBeat } from '../lib/register/beat.mjs';
import { inboxPath } from '../lib/register/inbox.mjs';
import { journalPath } from '../lib/register/journal.mjs';
import { decideTick, gateLine, tickOutcome, tickWake } from '../lib/register/tick.mjs';
import { tickOutcomeCommand, tickWakeCommand } from '../lib/cli/tick.mjs';
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

// ---- the one question no row can carry ----
// A run ENDS when its last row goes terminal, and the protocol makes a question obligatory at
// exactly that moment. So the end-of-run question is put in the very state this gate otherwise
// stands down for: in planetCraft on 2026-09-02 it was put on a register whose every row had
// landed, and nothing anywhere could see it (ticket `t-0antbtb`). The gate is the half of the fix
// that turns that silence into a refusal naming the question.
test('an unanswered run-level ask refuses the stand-down and names it', () => {
  const landed = [{ status: 'landed' }, { status: 'dropped' }];
  const line = decideTick({ register: reg({ tasks: landed,
    runAsks: [{ id: 'inertes-standdown-1', ask: 'work them down?' }] }) });
  assert.match(line, /^run/);
  assert.match(line, /1 run-level question\(s\) waiting on you: inertes-standdown-1/);
});

test('a run-level ask retired into runAnswered[] no longer holds the heartbeat awake', () => {
  const landed = [{ status: 'landed' }];
  assert.match(decideTick({ register: reg({ tasks: landed,
    runAsks: [{ id: 'a1', ask: 'x' }],
    runAnswered: [{ id: 'a1', askedAt: 'T1', answeredAt: 'T2' }] }) }),
  /^skip nothing to do/);
});

// The reason is ADDED to the line, never put in place of `hold-awake`: callers match that word
// anywhere, and a run-level question is not work in flight.
test('a run-level ask alongside live work keeps hold-awake and still names the question', () => {
  const line = decideTick({ register: reg({ tasks: [{ status: 'claimed' }],
    runAsks: [{ id: 'a1', ask: 'x' }] }) });
  assert.match(line, /^run hold-awake/);
  assert.match(line, /run-level question\(s\) waiting on you: a1/);
});

// This gate does not hash, so an ask with no id of its own cannot be matched against `runAnswered`
// and stays open — the safe direction: the tick runs and the conductor looks.
test('a run-level ask with no id stays open rather than being matched away', () => {
  const line = decideTick({ register: reg({ tasks: [{ status: 'landed' }],
    runAsks: [{ ask: 'no id at all' }], runAnswered: [{ id: 'a1' }] }) });
  assert.match(line, /run-level question\(s\) waiting on you: \(unnamed\)/);
});

// An ask the conductor already carried an answer onto is not waiting on the user.
test('a run-level ask that already carries an answer does not hold the tick', () => {
  assert.match(decideTick({ register: reg({ tasks: [{ status: 'landed' }],
    runAsks: [{ id: 'a1', ask: 'x', answer: 'B' }] }) }), /^skip nothing to do/);
});

// ---- what came back: the 2026-09-06 duckJam slots, verbatim from that project's tick.log ----------

const SPEND = "You've hit your individual spend limit · run /usage-credits to ask your admin for a"
  + ' higher limit · your session limit resets 1:40pm (Europe/Paris)';
const SESSION = "You've hit your session limit · resets 8:40pm (Europe/Paris)";

test('a tick refused on the ceiling names the refusal and the instant the next slot may run', () => {
  const now = Date.parse('2026-09-06T11:13:04.000Z');
  const o = tickOutcome({ output: `the baton is loose\n${SPEND}\n`, conducted: false, now });
  assert.equal(o.kind, 'budget');
  // 1:40pm in Europe/Paris, which is UTC+2 in September — 27 minutes after the slot that was refused.
  assert.equal(o.resetAt, '2026-09-06T11:40:00.000Z');
  assert.match(o.text, /stands down until 2026-09-06T11:40:00\.000Z/);
});

test("the other wording of the same ceiling reads the same, and it is the one the old regex knew", () => {
  const now = Date.parse('2026-09-06T18:13:03.000Z');
  assert.equal(tickOutcome({ output: SESSION, conducted: false, now }).resetAt, '2026-09-06T18:40:00.000Z');
});

// The witness that stops a working tick from being read as a refused one. duckJam's own tick.log
// holds a conductor's summary quoting the ceiling's wording back — a text match alone would have
// stood the heartbeat down on the strength of a tick that had just conducted.
test('a tick that wrote the register is never read as refused, whatever it printed', () => {
  const now = Date.parse('2026-09-06T18:13:03.000Z');
  assert.equal(tickOutcome({ output: SESSION, conducted: true, now }), null);
});

test('the refusal must be the LAST thing printed, not merely somewhere in the transcript', () => {
  const now = Date.parse('2026-09-06T18:13:03.000Z');
  const quoted = `the last three slots all died instantly on \`${SESSION}\`\nlanded three rows.`;
  assert.equal(tickOutcome({ output: quoted, conducted: false, now }), null);
});

test('a refusal that states no reset this can read still journals, and does not stand the slot down', () => {
  const o = tickOutcome({ output: "You've hit your session limit", conducted: false });
  assert.equal(o.kind, 'budget');
  assert.equal(o.resetAt, null);
  assert.match(o.text, /names no reset time/);
});

test('a reset further off than MAX_RESET_AHEAD_MS is not trusted', () => {
  // 2:10am the next day, read at 08:13Z — 18 hours away, past the twelve this will act on.
  const now = Date.parse('2026-09-07T08:13:00.000Z');
  const o = tickOutcome({ output: "You've hit your session limit · resets 2:10am (Europe/Paris)", conducted: false, now });
  assert.equal(o.resetAt, null);
});

test('an authentication refusal is journalled and stands nothing down', () => {
  const o = tickOutcome({ output: 'Failed to authenticate: OAuth session expired', conducted: false });
  assert.equal(o.kind, 'auth');
  assert.equal(o.resetAt, null);
});

test('a tick that conducted nothing and said nothing recognisable is not an outcome', () => {
  assert.equal(tickOutcome({ output: 'landed three rows and asked one question', conducted: false }), null);
  assert.equal(tickOutcome({ output: '', conducted: false }), null);
});

// The command that performs what `tickOutcome` decides, against a real register on disk — the two
// facts it gathers (the transcript, and whether the register moved) are exactly what the tick.sh
// line hands it, so this is the whole of constat 2's path bar the shell.
const transcriptOf = (r, text) => {
  const p = join(r.root, '.orchestra', 'tick.out');
  writeFileSync(p, text);
  return p;
};

test('tick-outcome writes budgetResetAt, journals the slot, and says so in one line', () => {
  const r = repo();
  writeState(r.root, emptyState(r.root));
  // The command reads the real clock, as it must in production, so the transcript states a reset
  // half an hour from now rather than a date frozen into the test.
  const reset = new Date(Math.floor((Date.now() + 30 * 60_000) / 60_000) * 60_000);
  const hhmm = reset.toISOString().slice(11, 16);
  // The register as the refused tick left it: last written before this slot started.
  const before = (Date.now() - 3600_000) / 1000;
  utimesSync(statePath(r.root), before, before);
  const from = transcriptOf(r,
    `the baton is loose\nYou've hit your individual spend limit · your session limit resets ${hhmm} (UTC)\n`);

  const said = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { said.push(s); return true; };
  try {
    tickOutcomeCommand({ cfg: { root: r.root },
      args: ['--from', from, '--since', new Date(Date.now() - 60_000).toISOString()] });
  } finally { process.stdout.write = write; }

  assert.match(said.join(''), /Tick refused before it conducted anything \(budget:/);
  assert.equal(JSON.parse(readFileSync(statePath(r.root), 'utf8')).budgetResetAt, reset.toISOString());
  const journal = readFileSync(journalPath(r.root), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(journal.length, 1);
  assert.equal(journal[0].kind, 'tick');
  assert.match(journal[0].text, new RegExp(`stands down until ${reset.toISOString()}`));
  // And the next slot's gate reads it, which is the whole point of writing it.
  assert.match(gateLine(r.root), /^skip budget resets/);
});

test('tick-outcome writes nothing at all for a tick that touched the register', () => {
  const r = repo();
  writeState(r.root, emptyState(r.root));
  const from = transcriptOf(r, SPEND);
  tickOutcomeCommand({ cfg: { root: r.root }, args: ['--from', from, '--since', '2026-09-06T11:13:04Z'] });
  assert.equal(JSON.parse(readFileSync(statePath(r.root), 'utf8')).budgetResetAt, null);
  assert.equal(existsSync(journalPath(r.root)), false);
});

// ---- the slot after a ceiling ---------------------------------------------------------------

test('a budget skip arms one wake at the reset, and nothing else arms anything', () => {
  const now = Date.parse('2026-09-06T11:13:04.000Z');
  const w = tickWake({ gate: 'skip budget resets 2026-09-06T11:40:00.000Z', now });
  assert.equal(w.at, '2026-09-06T11:40:00.000Z');
  // 26 min 56 s to the reset, plus the margin that puts the woken tick on the right side of it.
  assert.equal(w.seconds, 1616 + 30);

  assert.equal(tickWake({ gate: 'skip nothing to do — 3 row(s), all landed or dropped', now }), null);
  assert.equal(tickWake({ gate: 'run hold-awake', now }), null);
  assert.equal(tickWake({ gate: 'skip a conductor is live (s1, pid 7)', now }), null);
  // A reset already past is the grid's business, not a wake's.
  assert.equal(tickWake({ gate: 'skip budget resets 2026-09-06T10:00:00.000Z', now }), null);
  assert.equal(tickWake({ gate: 'skip budget resets soon', now }), null);
  // The same reset restated by a later slot is the same wake.
  assert.equal(tickWake({ gate: 'skip budget resets 2026-09-06T11:40:00.000Z', armedFor: '2026-09-06T11:40:00.000Z', now }), null);
  // A reset that MOVED is a different one and deserves its own.
  assert.ok(tickWake({ gate: 'skip budget resets 2026-09-06T17:10:00.000Z', armedFor: '2026-09-06T11:40:00.000Z', now }));
});

test('tick-wake prints the seconds once and remembers what it armed', () => {
  const r = repo();
  const at = new Date(Date.now() + 20 * 60_000).toISOString();
  const said = [];
  const write = process.stdout.write.bind(process.stdout);
  const call = () => {
    process.stdout.write = (s) => { said.push(s); return true; };
    try { tickWakeCommand({ cfg: { root: r.root }, args: ['--gate', `skip budget resets ${at}`] }); }
    finally { process.stdout.write = write; }
  };
  call();
  assert.equal(said.length, 1);
  assert.ok(Number(said[0]) > 0);
  assert.equal(readFileSync(join(r.root, '.orchestra', 'tick.wake'), 'utf8').trim(), at);
  // The next slot on the same reset arms nothing and prints nothing.
  call();
  assert.equal(said.length, 1);
});
