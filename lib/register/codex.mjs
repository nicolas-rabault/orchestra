// Native app tools execute Codex turns. The CLI records their evidence, never spawns a runtime.
import { randomUUID } from 'node:crypto';
import { nudgeFor, relayOwed } from './drive.mjs';
export const OBSERVATION_TTL_MS = 5 * 60_000;
const turnTime = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v * 1000 : Date.parse(v ?? '');
const stamp = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const identity = (row, data) => row.runtime === 'codex' && row.session === data.threadId && (row.hostId ?? 'local') === data.hostId;
export function codexStatus(row, now = Date.now()) {
  const o = row.observation;
  if (!o || !identity(row, o) || !stamp(o.observedAt) || Date.parse(o.observedAt) > now || now - Date.parse(o.observedAt) > OBSERVATION_TTL_MS) return 'unknown';
  return ['running', 'completed', 'needs-input', 'unknown'].includes(o.status) ? o.status : 'unknown';
}
export function codexOutbound(row, now = Date.now()) {
  const status = codexStatus(row, now);
  const o = row.observation;
  if (status !== 'completed' || typeof o?.turnId !== 'string' || !o.turnId || !Number.isFinite(turnTime(o.startedAt)))
    throw new Error('refresh native snapshot: dispatch requires a terminal baseline with latestTurn.id and startedAt');
  return { preparedAt: new Date(now).toISOString(), baseline: { turnId: o.turnId, startedAt: o.startedAt, status: o.status, observedAt: o.observedAt }, task: row.id, dispatchId: randomUUID(), tool: 'send_message_to_thread',
    arguments: { threadId: row.session, hostId: row.hostId ?? 'local', prompt: nudgeFor(row) },
    relay: relayOwed(row) ? { text: row.relay.text, writtenAt: row.relay.writtenAt ?? null } : null };
}
export function attachCodex(row, threadId, hostId = 'local') {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId)) throw new Error('attach needs a resolved native thread UUID, not a clientThreadId or sub-agent name');
  if (!hostId) throw new Error('hostId is required');
  if (row.runtime === 'codex' && row.session === threadId && row.hostId === hostId) return row;
  const { codexWorker, observation, dispatch, ...rest } = row;
  return { ...rest, previousSession: row.session ? { runtime: row.runtime ?? 'claude', session: row.session, sessionName: row.sessionName ?? null, model: row.model ?? null, hostId: row.hostId ?? null } : row.previousSession ?? null,
    runtime: 'codex', session: threadId, hostId, sessionName: null, model: null };
}
export function recordDispatch(row, data, now = Date.now()) {
  if (!identity(row, data.arguments ?? {}) || data.task !== row.id || data.tool !== 'send_message_to_thread' || typeof data.dispatchId !== 'string' || !data.dispatchId) throw new Error('dispatch identity does not match native row');
  if (!stamp(data.acceptedAt) || Date.parse(data.acceptedAt) > now || now - Date.parse(data.acceptedAt) > OBSERVATION_TTL_MS) throw new Error('dispatch needs a recent acceptedAt from the successful tool call');
  if (!stamp(data.preparedAt) || Date.parse(data.preparedAt) > Date.parse(data.acceptedAt)) throw new Error('dispatch preparation must precede tool acceptance');
  const baseline = data.baseline;
  const current = codexOutbound(row, Date.parse(data.preparedAt)).baseline;
  if (!baseline || JSON.stringify(baseline) !== JSON.stringify(current)) throw new Error('dispatch baseline no longer matches the observed terminal turn');
  if (data.dispatchId === row.dispatch?.dispatchId) throw new Error('dispatch id has already been used');
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
  // Native send_message returns no turn id. A pre-send terminal snapshot plus a different,
  // post-preparation turn is the evidence available from wait_threads. Native turn timestamps
  // have second precision and may precede the tool's acceptedAt, so compare with preparation.
  const started = turnTime(data.startedAt);
  const afterBaseline = d?.baseline && data.turnId && data.turnId !== d.baseline.turnId &&
    Number.isFinite(started) && started >= Math.floor(Date.parse(d.preparedAt) / 1000) * 1000 && started <= Date.parse(data.observedAt);
  const sameTurn = d && data.dispatchId === d.dispatchId &&
    (d.turnId ? data.turnId === d.turnId : Boolean(afterBaseline));
  // A stale completion is not a stopped native worker. Keep it unknown until a matching turn is
  // observed, instead of emitting another nudge and silently duplicating the message.
  const acknowledged = d?.completedAt || (d && row.relay?.receipt?.dispatchId === d.dispatchId && row.relay.receipt.session === row.session && stamp(row.relay.deliveredAt) && Date.parse(row.relay.deliveredAt) >= Date.parse(d.acceptedAt));
  if (d && !acknowledged && !sameTurn && data.status !== 'unknown') next.observation = { ...data, status: 'unknown' };
  if (data.status === 'completed' && sameTurn) next.dispatch = { ...d, completedAt: data.observedAt, completedTurnId: data.turnId };
  if (data.status === 'completed' && sameTurn && Date.parse(data.observedAt) >= Date.parse(d.acceptedAt) && d.relay && row.relay?.text === d.relay.text && (row.relay.writtenAt ?? null) === d.relay.writtenAt) {
    next.relay = { ...row.relay, deliveredAt: data.observedAt, receipt: { runtime: 'codex', session: row.session, dispatchId: d.dispatchId, turnAt: d.acceptedAt } };
  }
  return next;
}
