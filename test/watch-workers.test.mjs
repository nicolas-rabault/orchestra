// The wake-up policy of the worker watch, on paper: a grace after a stop, one line per change, and
// a reminder while the same debt stands — the shape that would have reached the 2026-09-08 conductor
// between its turns, which nothing else did.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo } from './helpers/fixture.mjs';
import { writeState, emptyState } from '../lib/register/state.mjs';
import { announcement, round, GRACE_MS, REMIND_MS } from '../lib/register/watchWorkers.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

const NOW = Date.parse('2026-09-08T10:00:00.000Z');
const memory = () => ({ key: null, at: 0, idleSince: new Map() });
const idle = (id, over = {}) => ({ id, status: 'claimed', session: `${id}-uuid`, sessionName: null, registered: null, turn: null, ...over });
const owed = (id, ageMin) => ({ id, status: 'claimed', session: `${id}-uuid`, writtenAt: 't', ageMin });
const obl = ({ idle: i = [], undelivered: u = [], driving = [] } = {}) => ({ idle: i, undelivered: u, driving });

test('a worker first seen stopped is not a debt until the grace has passed; then it is said once', () => {
  const m = memory();
  assert.equal(announcement(obl({ idle: [idle('demo/A1')] }), m, NOW), null);
  assert.equal(announcement(obl({ idle: [idle('demo/A1')] }), m, NOW + GRACE_MS - 1), null);
  const line = announcement(obl({ idle: [idle('demo/A1')] }), m, NOW + GRACE_MS);
  assert.match(line, /^OWED: 1 stopped worker\(s\) on live rows \(A1\) — run `orchestra drive`$/);
  assert.equal(announcement(obl({ idle: [idle('demo/A1')] }), m, NOW + GRACE_MS + 60_000), null);
});

test('a driven turn carries its own end time, so the grace is measured from the record, not from first sight', () => {
  const m = memory();
  const turn = { endedAt: new Date(NOW - GRACE_MS).toISOString(), exit: 0, verdict: 'ended' };
  assert.match(announcement(obl({ idle: [idle('demo/A1', { turn })] }), m, NOW), /A1/);
});

test('an undelivered relay is a debt at once, and the line carries its age', () => {
  const line = announcement(obl({ undelivered: [owed('demo/R1', 180)] }), memory(), NOW);
  assert.match(line, /1 undelivered relay\(s\) \(R1 180 min\)/);
});

test('the same debt is said again after REMIND_MS, and a changed set is said at once', () => {
  const m = memory();
  const one = obl({ undelivered: [owed('demo/R1', 1)] });
  assert.ok(announcement(one, m, NOW));
  assert.equal(announcement(one, m, NOW + REMIND_MS - 1), null);
  assert.ok(announcement(one, m, NOW + REMIND_MS));
  const two = obl({ undelivered: [owed('demo/R1', 1), owed('demo/R2', 1)] });
  assert.match(announcement(two, m, NOW + REMIND_MS + 1), /2 undelivered/);
});

test('a debt that is paid is forgotten, so the next one is a change and not a reminder', () => {
  const m = memory();
  assert.ok(announcement(obl({ undelivered: [owed('demo/R1', 1)] }), m, NOW));
  assert.equal(announcement(obl(), m, NOW + 1), null);
  assert.ok(announcement(obl({ undelivered: [owed('demo/R1', 1)] }), m, NOW + 2));
});

test('more than four stopped workers are counted, not listed', () => {
  const m = memory();
  const six = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map((n) => idle(`demo/${n}`));
  announcement(obl({ idle: six }), m, NOW);
  assert.match(announcement(obl({ idle: six }), m, NOW + GRACE_MS), /6 stopped worker\(s\) on live rows \(A1, A2, A3, A4 \+2\)/);
});

test('round reads the register and emits through the injected liveness, and says nothing on a register it cannot read', () => {
  const r = repo();
  writeState(r.root, { ...emptyState(r.root), tasks: [
    { id: 'demo/D1', branch: 'demo/d1', deps: [], status: 'claimed', session: 'd1-uuid', pending: [], subjects: [] },
  ] });
  r.git('branch', 'demo/d1');
  const liveness = { registered: new Map(), resuming: new Set(), turns: new Map(), alive: () => true, errors: [] };
  const m = memory();
  const said = [];
  const cfg = { mainBranch: 'main' };
  assert.equal(round(r.root, cfg, m, { now: NOW, liveness, emit: (s) => said.push(s) }), 0);
  assert.equal(round(r.root, cfg, m, { now: NOW + GRACE_MS, liveness, emit: (s) => said.push(s) }), 1);
  assert.match(said[0], /^OWED: 1 stopped worker/);
  // The ref gone: reconcile returns the row to todo with no session, and the debt is gone with it.
  r.git('branch', '-D', 'demo/d1');
  assert.equal(round(r.root, cfg, m, { now: NOW + GRACE_MS + 1, liveness, emit: (s) => said.push(s) }), 0);
});
