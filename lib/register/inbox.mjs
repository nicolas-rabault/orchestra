// The answer channel, one way: the monitor appends, orchestra reads. Append-only, so nothing the
// user typed can be lost by a later write, and a crash mid-write costs at most one skipped line.
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { orchestraDir } from '../paths.mjs';
import { pendingId } from './pending.mjs';

export const inboxPath = (root) => join(orchestraDir(root), 'inbox.jsonl');

export function readJsonl(path) {
  if (!existsSync(path)) return { entries: [], skipped: 0 };
  const entries = [];
  let skipped = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { skipped += 1; }
  }
  return { entries, skipped };
}

// The page's own write, and the only one this channel has: `appendAnswer` is what makes
// `.orchestra/inbox.jsonl` exist at all, and this module's header ("the monitor appends, orchestra
// reads") is a promise until this function is called from somewhere.
//
// The caller supplies only `task`, `pending` and `answer` — never `ts` or `from`. This function
// stamps both itself, which is the whole point of the writer living in this module rather than at
// the call site: "one module defines the channel's shape, its timestamp precision and its `from`
// marker, so the writer and the reader cannot drift" only holds if a caller CANNOT get either
// wrong, and a pass-through that took a caller's own `ts`/`from` would define nothing.
//
//   - `ts` is stamped here as `new Date().toISOString()`, at full millisecond precision. Truncated
//     to the second, a remark written in the same second as `conductor.inboxSeen` is
//     indistinguishable from the stamp, and `after()` above would silently drop it — a caller
//     building its own `Date` has no reason to know that, and every reason to get it wrong once.
//   - `from` is stamped here as `'monitor'`, and it is NOT decoration. From the model this plugin
//     builds on top of this channel, an inbox line is read onto the page as a rail entry only when
//     `from === 'monitor'` — because in planetCraft, before that check existed, a conductor's own
//     journal line landed in this same file and was rendered back as the USER's own words,
//     duplicating the sentence they had actually typed. Stamping it here, unconditionally, is what
//     makes that check trustworthy: a caller can no more claim to be the user than an entry it never
//     wrote can claim to be an answer.
//   - `pending` is passed through as given — the id `pendingId(reg.id, item)` already computes, or
//     `null` for a free remark that targets no item. Computing it is the caller's job: it needs the
//     register row and the item this function has no reason to see.
//
// Append only. Never rewrite, never truncate: a crash mid-write costs at most one skipped line, and
// `readJsonl` already counts it.
export function appendAnswer(path, { task, pending, answer }) {
  const entry = { ts: new Date().toISOString(), task, pending, answer, from: 'monitor' };
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

export function openPendingIds(state) {
  const ids = new Set();
  for (const t of state.tasks ?? []) for (const p of t?.pending ?? []) ids.add(pendingId(t?.id, p));
  return ids;
}

// The pending rule exists for one narrow case: an answer injected into a session that died before
// relaying it. That window is minutes. Past it the rule turns harmful, because the fallback
// pending id is a hash of row/kind/ask — a playtest gate asked twice in the same words carries the
// SAME id, so last round's reply would be delivered as the answer to this round's question, with
// nothing on screen to say it was old. Four hours is generous for a dead session and far shorter
// than the gap between two rounds of the same task.
export const PENDING_GRACE_MS = 4 * 60 * 60 * 1000;

// Timestamps are compared as instants, not as strings: the inbox writes millisecond precision and
// a conductor may stamp `inboxSeen` to the second, and '…:30Z' > '…:30.500Z' in string order —
// which would silently drop an answer written in the same second as the stamp. A ts that is not a
// date at all (and the never-stamped case, where `seen` is '') falls back to string order rather
// than being dropped.
export const at = (ts) => { const t = Date.parse(ts ?? ''); return Number.isNaN(t) ? null : t; };
export const after = (ts, seen) => {
  const a = at(ts);
  const b = at(seen);
  return a !== null && b !== null ? a > b : (ts ?? '') > (seen ?? '');
};
const within = (ts, now, ms) => { const t = at(ts); return t !== null && now - t <= ms; };

// An entry is unconsumed when the conductor has not stamped past it, OR the item it answers is
// still open AND the answer is recent. Either rule alone loses something real: the timestamp alone
// loses an answer injected into a session that died before relaying it; the pending rule alone
// never delivers a free remark, which targets no item. A duplicate relay costs a worker one
// repeated sentence; a lost answer costs the user their decision, so the OR is the deliberate
// asymmetry — bounded in age, because an unbounded re-delivery is not a duplicate but a wrong one.
export function unconsumed(entries, state, now = Date.now()) {
  const seen = state.conductor?.inboxSeen ?? '';
  const open = openPendingIds(state);
  return entries.filter((e) => after(e.ts, seen)
    || (e.pending && open.has(e.pending) && within(e.ts, now, PENDING_GRACE_MS)));
}

// Collapsed to one line and capped, for a caller about to fold user-typed text into a notification
// or a relay: `relay.mjs` and `watch.mjs` each read this, with their own cap — the two lengths differ
// deliberately (a relay line has room a one-line notification does not) and both stay.
export const oneLine = (s, cap) => {
  const flat = String(s ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > cap ? `${flat.slice(0, cap)}…` : flat;
};
