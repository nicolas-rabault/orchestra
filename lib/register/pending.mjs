// What a question is called. Shared by every reader of the answer channel, and it may not drift
// between them: an id computed one way in the relay and another way in the page would deliver an
// answer to nothing.
import { createHash } from 'node:crypto';

// A row whose id is missing or is not a string still gets a key. state.json is rewritten by the
// conductor at every tick, so a half-written row is a real transient state — and in the source
// project's monitor server (whose port arrives here in P4), `row.id.includes` on one of them threw
// out of the request handler and killed the whole server, answer channel included.
const UNNAMED = '(unnamed)';

// Keyed on the REGISTER row's own id, never on the joined node key: this plugin's two readers of
// it — the relay here, and P4's page — read state.json and nothing else, so an id derived from the
// roadmap board would be computable by neither, and an answer would be delivered to nothing.
//
// It is NOT protection against adoption re-opening answered questions: adopting a task rewrites
// `reg.id` itself, so every id derived from it changes anyway. Only the two readers agreeing
// matters here.
export function pendingId(rowId, item = {}) {
  if (item?.id) return item.id;
  const row = typeof rowId === 'string' && rowId.trim() ? rowId.trim() : UNNAMED;
  const h = createHash('sha1').update(`${row}/${item?.kind}/${item?.ask}`).digest('hex');
  return `${row.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-${h.slice(0, 8)}`;
}

// A question about the RUN itself is attached to no row: it lives at the top of the register in
// `runAsks[]`, so there is no row id to key it on. Both readers of an answer — the page that offers
// the question and the inbox that reads the reply back — must derive the same id from the same
// item, so the synthetic row name is written once here rather than twice at the two ends. An
// explicit `id` on the item still wins, and the skill asks the conductor for one.
const RUN_ROW = '(run)';
export const runAskId = (item) => pendingId(RUN_ROW, item);

// Whether a row still has a question outstanding: any `pending[]` item with no `answer` yet.
// Shared for the same reason `pendingId` is — `lib/register/tick.mjs`'s heartbeat gate and
// `lib/register/archive.mjs`'s archive pass both have to agree on "is this row asked-of", and a
// predicate written twice is a predicate that drifts the day only one of the two copies is edited.
export const isAskedOf = (row) => (row?.pending ?? []).some((p) => p?.answer == null);
