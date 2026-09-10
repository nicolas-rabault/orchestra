// Native app tools execute Codex turns. The CLI records their evidence, never spawns a runtime.
import { randomUUID } from 'node:crypto';
import { nudgeFor, relayOwed } from './drive.mjs';
export const OBSERVATION_TTL_MS = 5 * 60_000;
const stamp = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const identity = (row, data) => row.runtime === 'codex' && row.session === data.threadId && (row.hostId ?? 'local') === data.hostId;
export function codexStatus(row, now = Date.now()) {
  const o = row.observation;
  if (!o || !identity(row, o) || !stamp(o.observedAt) || Date.parse(o.observedAt) > now || now - Date.parse(o.observedAt) > OBSERVATION_TTL_MS) return 'unknown';
  return ['running', 'completed', 'needs-input', 'unknown'].includes(o.status) ? o.status : 'unknown';
}
export function codexOutbound(row) {
  return { task: row.id, dispatchId: randomUUID(), tool: 'send_message_to_thread',
    arguments: { threadId: row.session, hostId: row.hostId ?? 'local', prompt: nudgeFor(row) },
    relay: relayOwed(row) ? { text: row.relay.text, writtenAt: row.relay.writtenAt ?? null } : null };
}
export function attachCodex(row, threadId, hostId = 'local') {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId)) throw new Error('attach needs a resolved native thread UUID, not a clientThreadId or sub-agent name');
  if (!hostId) throw new Error('hostId is required');
  if (row.runtime === 'codex' && row.session === threadId && row.hostId === hostId) return row;
  const { codexWorker, observation, dispatch, ...rest } = row;
  return { ...rest, previousSession: row.session ? { runtime: row.runtime ?? 'claude', session: row.session, sessionName: row.sessionName ?? null, hostId: row.hostId ?? null } : row.previousSession ?? null,
    runtime: 'codex', session: threadId, hostId, sessionName: null };
}
export function recordDispatch(row, data, now = Date.now()) {
  if (!identity(row, data.arguments ?? {}) || data.task !== row.id || data.tool !== 'send_message_to_thread' || typeof data.dispatchId !== 'string' || !data.dispatchId) throw new Error('dispatch identity does not match native row');
  if (!stamp(data.acceptedAt) || Date.parse(data.acceptedAt) > now || now - Date.parse(data.acceptedAt) > OBSERVATION_TTL_MS) throw new Error('dispatch needs a recent acceptedAt from the successful tool call');
  if (data.arguments.prompt !== nudgeFor(row)) throw new Error('dispatch prompt no longer matches row relay');
  const relay = relayOwed(row) ? { text: row.relay.text, writtenAt: row.relay.writtenAt ?? null } : null;
  if (JSON.stringify(data.relay) !== JSON.stringify(relay)) throw new Error('dispatch relay no longer matches row');
  if (row.dispatch && Date.parse(data.acceptedAt) <= Date.parse(row.dispatch.acceptedAt)) throw new Error('dispatch is not newer than the recorded dispatch');
  return { ...row, dispatch: { ...data }, observation: { threadId: row.session, hostId: row.hostId ?? 'local', status: 'running', observedAt: data.acceptedAt } };
}
export function observeCodex(row, data, now = Date.now()) {
  if (!identity(row, data)) throw new Error('observation identity does not match native row');
  if (!['running', 'completed', 'needs-input', 'unknown'].includes(data.status)) throw new Error('invalid native task status');
  if (!stamp(data.observedAt) || Date.parse(data.observedAt) > now || now - Date.parse(data.observedAt) > OBSERVATION_TTL_MS) throw new Error('snapshot needs a fresh observedAt');
  if (row.observation && Date.parse(data.observedAt) < Date.parse(row.observation.observedAt)) throw new Error('snapshot predates previous observation');
  const next = { ...row, observation: { ...data } };
  const d = row.dispatch;
  const sameTurn = d && data.dispatchId === d.dispatchId &&
    ((d.turnId && data.turnId === d.turnId) || (stamp(data.startedAt) && Date.parse(data.startedAt) >= Date.parse(d.acceptedAt) && Date.parse(data.startedAt) <= Date.parse(data.observedAt)));
  if (data.status === 'completed' && sameTurn && Date.parse(data.observedAt) >= Date.parse(d.acceptedAt) && d.relay && row.relay?.text === d.relay.text && (row.relay.writtenAt ?? null) === d.relay.writtenAt) {
    next.relay = { ...row.relay, deliveredAt: data.observedAt, receipt: { runtime: 'codex', session: row.session, dispatchId: d.dispatchId, turnAt: d.acceptedAt } };
  }
  return next;
}
