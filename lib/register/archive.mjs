// Move finished work out of the conductor's register and into an append-only archive:
//
//   orchestra archive            # what would move, and what it would save
//   orchestra archive --write    # move it
//
// The register is what a conductor rehydrates from, and it had become a graveyard. Measured
// 2026-08-30, at the end of the space roadmap: `state.json` was 202 KB, and 87 of its 87 rows
// were `landed` or `dropped` — not one live row anywhere. Those rows were 136 663 bytes, 67.7% of
// the file, and the weight was their post-mortem `note`s (6 100 bytes for `sky/SK3` alone). The
// conductor re-read every byte of it on every hourly tick, and `ready.mjs` reconciled 87 dead
// rows against git each time, to describe work that had landed weeks earlier.
//
// So this is a MOVE, not a purge. Nothing is deleted: every archived row is appended whole, note
// included, to `.orchestra/archive.jsonl`, which is the register's own history — and a project
// that configures a retrospective tool reads it there. The two needs serve each other rather than
// compete: a retrospective wants this history and the conductor does not, which is why the file is
// append-only rather than pruned.
//
// TWO OUTCOMES FOR A FINISHED ROW, and which one it gets is decided by the rest of the register,
// never by its age:
//
//   - nothing that SURVIVES depends on it, AND nothing still ASKS OF it -> the row leaves
//     entirely. This is the case at the end of a programme, when every roadmap is terminal and
//     every question on it is answered: the register empties, and the monitoring page stops
//     painting months of finished work as if it were the current session.
//   - something that survives depends on it, OR a question on it is still unanswered -> the row
//     stays, stripped of its prose. `ready.mjs` resolves `deps` against the ids whose status is
//     `landed`, so removing a depended-on row would leave the row that needs it `blocked:` for
//     ever with no error printed anywhere; dropping a row with an open question would leave the
//     user's eventual answer with nothing to attach to (see the `pending` note below).
//
// The register held three cross-roadmap deps when this was written, which is exactly why the test
// is "does anything surviving still point at it" and not "is its roadmap finished".
//
// WHAT LEAVES A SURVIVING ROW IS ONLY ITS PROSE — and that shape was chosen by measuring, not by taste.
// The first design here kept a four-field tombstone and dropped everything else; a test caught it
// breaking `computeReadySet`, which validates `t.deps` on EVERY row, terminal or not. Rather than
// patch that one field, the weight was measured across all 87 rows:
//
//     note 48.8% | subjects 12.4% | decisions 8.7% | touches 6.6% | everything else 23.5%
//
// Four prose fields carry 76.5% of it. Removing exactly those gets nearly the whole saving and
// CANNOT break a reader, because every field any reader touches is still there. The remaining
// three readers keep working for free rather than by careful arrangement:
//
//   - `ready.mjs` resolves `deps` against the ids whose status is `landed`, and validates `deps`
//     on every row — a dropped row would block every future row depending on it, in silence.
//   - the monitoring page's `monitor/progress.mjs` tallies `landed` into the progress bar.
//   - the monitoring page's `monitor/model.mjs` joins register rows to roadmap rows using
//     `branch`, `lane`, `session`.
//
// `pending` is deliberately NOT prose, and an unanswered question is a second reason to keep a
// terminal row — exactly as a surviving dependency already is. "Asked-of" is `isAskedOf` from
// `./pending.mjs`, the same predicate `lib/register/tick.mjs`'s heartbeat gate uses to hold the
// heartbeat up on an open question, imported rather than re-derived here so the two cannot drift.
// Three readers depend on a row with an open question staying in the register at all:
//   - `decideTick` (`lib/register/tick.mjs`) stands the heartbeat down once nothing is asked of
//     any row; dropping the row would stand it down while the question is still open.
//   - `openPendingIds` (`lib/register/inbox.mjs`) is how the user's eventual answer still finds
//     an item to attach to; a row gone from `state.tasks` has no id left to recognise.
//   - the monitoring page (`lib/monitor/model.mjs`) is what shows the ask on screen at all.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { orchestraDir } from '../paths.mjs';
import { isAskedOf } from './pending.mjs';
import { readState, writeState, STRUCTURAL } from './state.mjs';

export const archivePath = (root) => join(orchestraDir(root), 'archive.jsonl');

export const TERMINAL = new Set(['landed', 'dropped']);

// The prose that moves to the archive. Everything else on a finished row stays in the register,
// because something reads it. Ordered by the weight each carries, measured 2026-08-30.
export const PROSE_FIELDS = ['note', 'subjects', 'decisions', 'touches'];

const strippedOf = (row) => Object.fromEntries(
  Object.entries(row).filter(([k]) => !PROSE_FIELDS.includes(k)),
);

// A stripped row is still `landed`, so a second pass would archive it again — appending a
// duplicate line per row on every tick, for ever. What tells the two apart is that a stripped row
// has none of the prose fields left to take.
export const isStripped = (row) => !PROSE_FIELDS.some((k) => row[k] !== undefined);

// The whole decision, as one pure function over the parsed register. Returns the register as it
// should be written and the lines the archive should gain — never touching a disk, so the test
// can ask it anything.
export function partition(state, { at = new Date().toISOString() } = {}) {
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const survives = (row) => !TERMINAL.has(row.status);
  // Every id a surviving row still points at. Computed once, before anything moves, because a
  // row removed in this pass must not stop protecting the row that depends on it.
  const needed = new Set(tasks.filter(survives).flatMap((t) => t.deps ?? []));
  const kept = [];
  const archived = [];
  for (const row of tasks) {
    if (survives(row)) { kept.push(row); continue; }
    // A reason to keep the stripped husk: something surviving still points at it, or a question
    // on it is still unanswered. Either alone is enough; both use `isAskedOf` from `./pending.mjs`
    // — see the header for why it lives there instead of being re-derived here.
    const keptFor = needed.has(row.id) || isAskedOf(row);
    if (isStripped(row) && !keptFor) continue;   // already filed; drop the husk
    if (isStripped(row)) { kept.push(row); continue; }      // already filed, but still needed or asked of
    archived.push({ archivedAt: at, kind: 'task', ...row });
    if (keptFor) kept.push(strippedOf(row));
  }
  // Nothing finished means nothing moves — INCLUDING the prose. An archive pass on a register
  // with live work must be a no-op, not a quiet confiscation of the conductor's own notes, and
  // returning the register untouched is the only way to promise that.
  if (!archived.length) return { next: state, archived };
  const prose = Object.fromEntries(Object.entries(state).filter(([k]) => !STRUCTURAL.has(k)));
  const next = Object.fromEntries(Object.entries(state).filter(([k]) => STRUCTURAL.has(k)));
  next.tasks = kept;
  if (Object.keys(prose).length) {
    archived.push({ archivedAt: at, kind: 'lessons', keys: Object.keys(prose).sort(), lessons: prose });
  }
  return { next, archived };
}

export const sizeOf = (value) => Buffer.byteLength(JSON.stringify(value, null, 2), 'utf8');

// Append whole lines, then replace the register in one rename. The order matters and is the
// safe one: if the process dies between the two, the archive holds rows the register also still
// holds — a duplicate a reader can see — rather than rows that exist nowhere.
export function archive(root, { at = new Date().toISOString() } = {}) {
  const state = readState(root);
  const { next, archived } = partition(state, { at });
  if (!archived.length) return { archived: 0, before: sizeOf(state), after: sizeOf(state) };
  appendFileSync(archivePath(root), archived.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeState(root, next);
  return { archived: archived.length, before: sizeOf(state), after: sizeOf(next) };
}

export const loadArchive = (root) => {
  const file = archivePath(root);
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* torn tail line, like every reader here */ }
  }
  return out;
};
