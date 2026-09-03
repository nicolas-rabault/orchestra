import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { makeRepo } from './helpers/fixture.mjs';
import { writeBeat } from '../lib/register/beat.mjs';
import { acquire, release, readHolder, holderIsDead, lockDir, MAX_AGE_MS } from '../lib/register/lock.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

const ALIVE = { alive: () => true };
const DEAD = { alive: () => false };

test('one holder at a time', () => {
  const r = repo();
  assert.equal(acquire(r.root, { kind: 'tick', pid: 111, deps: ALIVE }).ok, true);
  const second = acquire(r.root, { kind: 'tick', pid: 222, deps: ALIVE });
  assert.equal(second.ok, false);
  assert.equal(second.holder.pid, 111);
});

test('a tick holder whose pid is gone is broken and taken', () => {
  const r = repo();
  acquire(r.root, { kind: 'tick', pid: 111 });
  const taken = acquire(r.root, { kind: 'tick', pid: 222, deps: DEAD });
  assert.equal(taken.ok, true);
  assert.equal(readHolder(r.root).pid, 222);
});

test('a conductor holder is alive only while the beat names THAT session', () => {
  const r = repo();
  const now = Date.parse('2026-09-03T10:00:00.000Z');
  acquire(r.root, { kind: 'conductor', session: 's1', now });
  // `process.pid`, deliberately: `holderIsDead`'s `live` default is NOT reached by `deps.alive`, so
  // `liveConductor` runs the REAL `pidAlive` against whatever pid the beat carries. A made-up pid
  // like 9 is a kernel process on macOS and answers EPERM, so this test would pass by accident here
  // and flake anywhere else. The beat must name a process that is genuinely alive.
  writeBeat(r.root, { session: 's1', pid: process.pid, now });
  assert.equal(acquire(r.root, { kind: 'conductor', session: 's2', now, deps: ALIVE }).ok, false);
  // Somebody else has the baton: the holder is gone.
  writeBeat(r.root, { session: 's2', pid: process.pid, now });
  assert.equal(acquire(r.root, { kind: 'conductor', session: 's2', now, deps: ALIVE }).ok, true);
});

test('a holder older than MAX_AGE is broken whatever it claims', () => {
  const r = repo();
  const now = Date.parse('2026-09-03T10:00:00.000Z');
  acquire(r.root, { kind: 'tick', pid: 111, now });
  assert.equal(acquire(r.root, { kind: 'tick', pid: 222, now: now + MAX_AGE_MS + 1, deps: ALIVE }).ok, true);
});

test('a lock directory with no holder record is judged by age alone', () => {
  const r = repo();
  const now = Date.now();
  mkdirSync(lockDir(r.root), { recursive: true });
  // Unreadable AND undatable — an unparseable `startedAt` cannot be young, so `holderIsDead` has
  // nothing but age to judge it by and finds it already too old, on the very first check. This is
  // verified against the source's own equivalent case (planetCraft's tests/orchestraLock.test.js:
  // "a lock with no readable holder is judged on age alone"), which asserts the same thing directly
  // rather than through a fresh-vs-stale `acquire` pair — there is no fresh case for a null holder.
  assert.equal(holderIsDead(r.root, null, { now }), true);
  assert.equal(acquire(r.root, { kind: 'tick', pid: 1, now, deps: ALIVE }).ok, true);
  assert.equal(readHolder(r.root).pid, 1);
});

test('release is identity-checked: it never deletes a successor lock', () => {
  const r = repo();
  acquire(r.root, { kind: 'conductor', session: 's1' });
  assert.equal(release(r.root, { kind: 'conductor', session: 's2' }), false);
  assert.ok(existsSync(lockDir(r.root)));
  assert.equal(release(r.root, { kind: 'conductor', session: 's1' }), true);
  assert.equal(existsSync(lockDir(r.root)), false);
});
