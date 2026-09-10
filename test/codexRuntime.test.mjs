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
const make = () => attachCodex({ id: 'demo/A1', status: 'claimed', session: 'old', pending: [], relay: { text: 'exact reply', writtenAt: iso(-2000) }, codexWorker: { agentId: 'wrong' } }, uuid);
const snap = (status, extra = {}) => ({ threadId: uuid, hostId: 'local', status, observedAt: iso(), ...extra });
test('attach retains old session and removes subagent field; rejects non-native identity', () => {
 const row = make(); assert.equal(row.previousSession.session, 'old'); assert.equal(row.codexWorker, undefined);
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
 const row = make(); const outbound = { ...codexOutbound(row), acceptedAt: iso(-1000), turnId: 'turn-2' };
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
