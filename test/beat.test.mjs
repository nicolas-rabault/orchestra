import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { utimesSync, writeFileSync } from 'node:fs';
import { makeRepo } from './helpers/fixture.mjs';
import { writeState, emptyState, statePath } from '../lib/register/state.mjs';
import { writeBeat, readBeat, beatPath, liveConductor, conductorState, BEAT_STALE_MS, CONDUCT_STALE_MS }
  from '../lib/register/beat.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

const ALIVE = () => true;
const DEAD = () => false;

test('a beat round-trips', () => {
  const r = repo();
  writeBeat(r.root, { session: 'abcdef12-1111', pid: 4242, now: Date.parse('2026-09-03T10:00:00.000Z') });
  assert.equal(readBeat(r.root).session, 'abcdef12-1111');
  assert.equal(readBeat(r.root).pid, 4242);
});

test('BOTH tests, and neither alone: a stale stamp and a dead pid each mean no conductor', () => {
  const r = repo();
  const now = Date.parse('2026-09-03T10:00:00.000Z');
  writeBeat(r.root, { session: 's1', pid: 1, now });
  assert.ok(liveConductor(r.root, { now, alive: ALIVE }));
  assert.equal(liveConductor(r.root, { now: now + BEAT_STALE_MS + 1, alive: ALIVE }), null);
  assert.equal(liveConductor(r.root, { now, alive: DEAD }), null);
});

test('an unparsable stamp reports no conductor rather than one', () => {
  const r = repo();
  writeFileSync(beatPath(r.root), '{"session":"s1","pid":1,"ts":"soon"}\n');
  assert.equal(liveConductor(r.root, { alive: ALIVE }), null);
});

test('alive is not the same fact as conducting', () => {
  const r = repo();
  const now = Date.parse('2026-09-03T10:00:00.000Z');
  writeState(r.root, emptyState(r.root));
  writeBeat(r.root, { session: 's1', pid: 1, now });
  const touched = (now - CONDUCT_STALE_MS - 60_000) / 1000;
  utimesSync(statePath(r.root), touched, touched);
  const s = conductorState(r.root, { now, alive: ALIVE });
  assert.equal(s.session, 's1');
  assert.equal(s.conducting, false);
  assert.ok(s.silentFor > CONDUCT_STALE_MS);
});

test('a checkout with no register keeps the baton', () => {
  const r = repo();
  writeBeat(r.root, { session: 's1', pid: 1, now: Date.now() });
  assert.equal(conductorState(r.root, { alive: ALIVE }).conducting, true);
});
