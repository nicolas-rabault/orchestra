import { test } from 'node:test';
import assert from 'node:assert/strict';
import { obligations } from '../lib/register/drive.mjs';
import { codexOutbound, recordDispatch } from '../lib/register/codex.mjs';
const now = Date.now();
const live = { registered: new Map(), resuming: new Set(), turns: new Map(), alive: () => false };
const row = { id: 'x/A', status: 'claimed', session: 'session', autoResumes: 3 };

test('both engines stop automatic nudges at the same budget and retain user relays', () => {
 for (const runtime of ['claude', 'codex']) {
  const task = { ...row, runtime, hostId: 'local', observation: { threadId: row.session, hostId: 'local', observedAt: new Date(now).toISOString(), status: 'completed', turnId: 't1', startedAt: new Date(now - 1000).toISOString() } };
  const o = obligations([task], live, { now, maxAutoResumes: 3 });
  assert.equal(o.idle.length, 0); assert.equal(o.limited[0].id, task.id);
  assert.equal(obligations([{ ...task, relay: { text: 'user answer' } }], live, { now }).undelivered.length, 1);
  if (runtime === 'codex') assert.throws(() => codexOutbound(task, now), /resume budget/);
 }
});

test('budget survives loss of session and never interrupts a running worker', () => {
 assert.equal(obligations([{ ...row, session: null }], live, { now }).relaunch.length, 0);
 const running = { ...live, registered: new Map([[row.session, { status: 'busy' }]]) };
 assert.equal(obligations([row], running, { now }).driving.length, 1);
});

test('accepted native nudges consume budget once; preparing a message consumes nothing', () => {
 let task = { ...row, autoResumes: 0, runtime: 'codex', hostId: 'local', observation: { threadId: row.session, hostId: 'local', observedAt: new Date(now).toISOString(), status: 'completed', turnId: 't1', startedAt: new Date(now - 2000).toISOString() } };
 const data = { ...codexOutbound(task, now), acceptedAt: new Date(now).toISOString() };
 assert.equal(task.autoResumes, 0);
 const accepted = recordDispatch(task, data, now);
 assert.equal(accepted.autoResumes, 1);
 assert.throws(() => recordDispatch(accepted, data, now));
});

test('a configured native budget is used on recording as well as preparing a dispatch', () => {
 const task = { ...row, runtime: 'codex', hostId: 'local', observation: { threadId: row.session, hostId: 'local', observedAt: new Date(now).toISOString(), status: 'completed', turnId: 't1', startedAt: new Date(now - 2000).toISOString() } };
 const cfg = { maxAutoResumes: 4 };
 const data = { ...codexOutbound(task, now, cfg), acceptedAt: new Date(now).toISOString() };
 assert.equal(recordDispatch(task, data, now, cfg).autoResumes, 4);
});
