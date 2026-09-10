import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachCodex, codexStatus, codexOutbound, recordDispatch, observeCodex, OBSERVATION_TTL_MS } from '../lib/register/codex.mjs';
import { gatherLiveness } from '../lib/register/liveness.mjs';
import { obligations } from '../lib/register/drive.mjs';
import { fleetCost } from '../lib/register/cost.mjs';
import { startTurn } from '../lib/cli/drive.mjs';
const now = Date.now();
const iso = (delta = 0) => new Date(now + delta).toISOString();
const uuid = '01a08a8e-7713-71c1-803b-ce878c946267';
const make = () => attachCodex({ id: 'demo/A1', status: 'claimed', session: 'old', model: 'opus', pending: [], relay: { text: 'exact reply', writtenAt: iso(-2000) }, codexWorker: { agentId: 'wrong' } }, uuid);
const snap = (status, extra = {}) => ({ threadId: uuid, hostId: 'local', status, observedAt: iso(), ...extra });
test('attach retains old session and removes subagent field; rejects non-native identity', () => {
 const row = make(); assert.equal(row.previousSession.session, 'old'); assert.equal(row.model, null); assert.equal(row.previousSession.model, 'opus'); assert.equal(row.codexWorker, undefined);
 assert.throws(() => attachCodex(row, 'agent-name'));
 assert.deepEqual(attachCodex(row, uuid), row);
});
test('Codex-only liveness never asks Claude or process table, and ignores Claude witnesses', () => {
 const row = observeCodex(make(), snap('running'), now);
 const l = gatherLiveness('/private/tmp/nonexistent-orchestra-test', [row], { agents: () => { throw Error('called Claude'); }, ps: () => { throw Error('called ps'); } });
 assert.deepEqual(l.errors, []); assert.equal(obligations([row], l, { now }).driving.length, 1);
 assert.equal(obligations([row], l, { now: now + OBSERVATION_TTL_MS + 1 }).refresh.length, 1);
 assert.equal(codexStatus({ ...row, session: 'other' }, now), 'unknown');
 assert.throws(() => startTurn({}, { row, registered: { id: 'claude-id' } }), /native Codex/);
});
test('mixed fleet measures and queries Claude only for Claude rows', () => {
 let count = 0;
 const row = make(); const other = { id: 'demo/C', session: 'claude', status: 'claimed' };
 const l = gatherLiveness('/private/tmp/nonexistent-orchestra-test', [row, other], { agents: () => { count++; return '[]'; }, ps: () => '' });
 assert.equal(count, 1); assert.equal(obligations([row, other], l, { now }).idle[0].id, other.id);
 const calls = []; fleetCost([row, other], { measureOne: (id) => { calls.push(id); return null; } }); assert.deepEqual(calls, ['claude']);
});
test('dispatch and observations require exact identity, prompt, chronological evidence', () => {
 const row = observeCodex(make(), snap('completed', { observedAt: iso(-2000), turnId: 'turn-1', startedAt: iso(-5000) }), now); const outbound = { ...codexOutbound(row, now - 1500), acceptedAt: iso(-1000), turnId: 'turn-2' };
 assert.throws(() => recordDispatch(row, { ...outbound, arguments: { ...outbound.arguments, prompt: 'wrong' } }, now));
 const sent = recordDispatch(row, outbound, now);
 assert.equal(sent.relay.receipt, undefined);
 assert.throws(() => observeCodex(sent, snap('completed', { threadId: 'wrong' }), now));
 assert.throws(() => observeCodex(sent, snap('completed', { observedAt: iso(-2000) }), now));
 const noProof = observeCodex(sent, snap('completed', { dispatchId: outbound.dispatchId }), now); assert.equal(noProof.relay.receipt, undefined);
 const oldTurn = observeCodex(sent, snap('completed', { dispatchId: outbound.dispatchId, turnId: 'turn-1' }), now); assert.equal(oldTurn.relay.receipt, undefined);
 const done = observeCodex(sent, snap('completed', { dispatchId: outbound.dispatchId, turnId: 'turn-2' }), now); assert.equal(done.relay.receipt.dispatchId, outbound.dispatchId);
 const changed = observeCodex({ ...sent, relay: { ...sent.relay, writtenAt: iso(-500) } }, snap('completed', { dispatchId: outbound.dispatchId, turnId: 'turn-2' }), now); assert.equal(changed.relay.receipt, undefined);
});

test('native completion uses terminal baseline and a new turn even when startedAt precedes tool acceptance', () => {
 const row = observeCodex(make(), snap('completed', { observedAt: iso(-2000), turnId: 'before', startedAt: Math.floor((now - 5000) / 1000) }), now);
 const outbound = { ...codexOutbound(row, now - 1500), acceptedAt: iso(-500) };
 const sent = recordDispatch(row, outbound, now);
 const old = observeCodex(sent, snap('completed', { dispatchId: outbound.dispatchId, turnId: 'before', startedAt: row.observation.startedAt }), now);
 assert.equal(old.relay.receipt, undefined); assert.equal(codexStatus(old, now), 'unknown');
 const completed = snap('completed', { dispatchId: outbound.dispatchId, turnId: 'after', startedAt: Math.floor((now - 1500) / 1000) });
 const done = observeCodex(sent, completed, now);
 assert.equal(done.relay.receipt.dispatchId, outbound.dispatchId);
 assert.equal(codexStatus(done, now), 'completed');
 const legacy = { ...done, dispatch: { ...done.dispatch, completedAt: undefined, baseline: undefined } };
 assert.equal(codexStatus(observeCodex(legacy, snap('completed', { turnId: 'after', startedAt: completed.startedAt }), now), now), 'completed');
 const ordinary = observeCodex(done, snap('completed', { turnId: 'after', startedAt: completed.startedAt }), now);
 assert.equal(codexStatus(ordinary, now), 'completed');
 const manual = observeCodex(done, snap('running', { turnId: 'manual-next', startedAt: iso() }), now);
 assert.equal(codexStatus(manual, now), 'running');
 const preceding = observeCodex(sent, { ...completed, startedAt: Math.floor((now - 5000) / 1000) }, now);
 assert.equal(preceding.relay.receipt, undefined);
});
test('native dispatch refuses unknown or running baselines and changes between prepare and dispatch', () => {
 assert.throws(() => codexOutbound(make(), now), /terminal baseline/);
 const busy = observeCodex(make(), snap('running', { turnId: 'busy', startedAt: iso(-2000) }), now);
 assert.throws(() => codexOutbound(busy, now), /terminal baseline/);
 assert.throws(() => codexOutbound({ ...busy, observation: { ...busy.observation, status: 'needs-input' } }, now), /terminal baseline/);
 const row = observeCodex(make(), snap('completed', { observedAt: iso(-2000), turnId: 'before', startedAt: iso(-5000) }), now);
 const outbound = { ...codexOutbound(row, now - 1000), acceptedAt: iso(-500) };
 const changed = { ...row, observation: { ...row.observation, turnId: 'other' } };
 assert.throws(() => recordDispatch(changed, outbound, now), /baseline/);
 assert.throws(() => recordDispatch(row, { ...outbound, preparedAt: iso() }, now), /preparation/);
});
