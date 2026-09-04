import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo } from './helpers/fixture.mjs';
import { withQueueLock, LOCK_WAIT_MS } from '../lib/tickets/lock.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

const file = (r) => join(r.root, '.orchestra', 'tickets.jsonl');
const lockDirFor = (r) => join(r.root, '.orchestra', '.queue.lock');

test('withQueueLock runs fn and cleans up the lock directory afterwards', () => {
  const r = repo();
  mkdirSync(join(r.root, '.orchestra'), { recursive: true });
  let ran = false;
  const result = withQueueLock(file(r), () => { ran = true; return 'ok'; });
  assert.equal(ran, true);
  assert.equal(result, 'ok');
  assert.equal(existsSync(lockDirFor(r)), false);
});

test('a second acquirer takes the lock immediately once a dead holder is found', () => {
  const r = repo();
  mkdirSync(lockDirFor(r), { recursive: true });
  // A pid that cannot possibly be alive: process 0 is invalid and 2**31-1 is far past any real
  // pid on this machine, and `withQueueLock` reads a non-numeric or unreachable pid as a dead
  // holder either way.
  writeFileSync(join(lockDirFor(r), 'pid'), '999999999');
  let ran = false;
  withQueueLock(file(r), () => { ran = true; }, { waitMs: 5000 });
  assert.equal(ran, true, 'a dead holder must be broken and taken, not waited out');
});

// The one test here that cannot be written after the fact (task-2-brief.md, step 1): it proves a
// second acquirer genuinely WAITS behind a live holder, and only then throws once the deadline
// passes — not that it throws immediately because a directory happens to exist. A lock that
// checked liveness once and gave up, or one that never checked the deadline and spun forever,
// would both fail this differently: the elapsed-time assertion catches the first (an instant
// throw), and the bounded `waitMs` itself keeps the second from hanging the test suite.
test('a second acquirer waits behind a LIVE holder and throws only at the deadline', () => {
  const r = repo();
  mkdirSync(lockDirFor(r), { recursive: true });
  // This test's own process: guaranteed alive for as long as the assertion runs.
  writeFileSync(join(lockDirFor(r), 'pid'), String(process.pid));
  const start = Date.now();
  assert.throws(
    () => withQueueLock(file(r), () => {}, { waitMs: 200 }),
    (e) => new RegExp(`held by pid ${process.pid}`).test(e.message) && /200ms/.test(e.message),
  );
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 200, `expected to wait out the 200ms deadline, only waited ${elapsed}ms`);
  // The lock is left in place — a live holder's lock is never removed by a caller that failed to
  // get it, which is the whole point of refusing instead of breaking it.
  assert.equal(existsSync(lockDirFor(r)), true);
});

test('the production default is 30 seconds, unless a caller passes its own waitMs', () => {
  assert.equal(LOCK_WAIT_MS, 30_000);
});

// A lock directory with no `pid` file at all is the window between a holder's own `mkdir` and its
// pid write — a caller cannot yet tell whether that holder is alive, so it is waited out for the
// full deadline rather than broken on sight (the same caution `holderPid` returning null gets in
// `lib/register/lock.mjs`). This is not a hang: past the deadline it is cleared like any other
// stale lock, which is what this test proves with a short `waitMs` rather than the real 30s.
test('a lock directory with no readable pid is waited out, then cleared at the deadline', () => {
  const r = repo();
  mkdirSync(lockDirFor(r), { recursive: true });
  let ran = false;
  const start = Date.now();
  withQueueLock(file(r), () => { ran = true; }, { waitMs: 150 });
  assert.equal(ran, true);
  assert.ok(Date.now() - start >= 150, 'a pid-less holder must be waited out for the full deadline');
});

const readLines = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };

test('mutual exclusion: two sequential callers both see the effect of the one before them', () => {
  const r = repo();
  const seen = [];
  withQueueLock(file(r), () => { seen.push(readLines(file(r))); writeFileSync(file(r), 'a\n'); });
  withQueueLock(file(r), () => { seen.push(readLines(file(r))); writeFileSync(file(r), 'a\nb\n'); });
  assert.deepEqual(seen, [0, 1]);
  assert.equal(readFileSync(file(r), 'utf8'), 'a\nb\n');
});
