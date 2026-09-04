// One conductor at a time — including the interactive one.
//
// `tick.lock` has existed since the beginning, but only the heartbeat (P5) ever took it, so it
// guarded cron against cron and nothing else. An interactive `/orchestra` took nothing at all.
// Measured on 2026-08-12 and again on 2026-08-14: three times a second tick ran beside the first,
// once double-running merge_agent on the same branch, and the journal ended up with 21 landings for
// 16 rows. The register has exactly one writer by design; two is the only way it corrupts.
//
// The mutex stays what it was — `mkdir` of a directory, which is atomic on every filesystem that
// matters. What is new is `holder.json` INSIDE it, so the lock can say who has it and whether that
// somebody is still alive. Nothing under `lib/monitor/` reads `tick.lock` — the monitoring page
// starts no tick (`lib/monitor/server.mjs`), so it has nothing to serialise against and that check
// was deliberately not ported.
//
// Liveness is answered differently for the two kinds of holder, because they are different things:
//
//   - `tick`: a shell running the heartbeat (P5). It has a pid, that pid lives exactly as long as
//     the tick, and an EXIT trap releases the lock. So: pid.
//   - `conductor`: an interactive session. It has NO pid a shell could name — `orchestra lock
//     acquire --kind conductor --session <id>` exits immediately, so recording its own pid would
//     mark the lock dead on the spot.
//     Its liveness is the beat (`beat.mjs`), written every two seconds by the answer watch the
//     conductor arms in step 1 and running exactly as long as that session. That is what the beat
//     is for, and reusing it means there is one definition of "a conductor is alive" rather than
//     two that can disagree.
//
// A holder that fails its own liveness test is broken automatically. So is one older than MAX_AGE,
// which is the backstop for a record this file cannot read at all — a lock written before this file
// existed, or truncated by a crash mid-write.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { orchestraDir } from '../paths.mjs';
import { liveConductor, pidAlive } from './beat.mjs';

const HOLDER = 'holder.json';

// Four hours. Long enough that a genuinely slow tick is never robbed mid-run — the longest real
// tick measured on this machine, in planetCraft, ran a full suite at ~4.5 minutes — and short
// enough that a lock orphaned by a kill -9 does not freeze the heartbeat for a working day.
export const MAX_AGE_MS = 4 * 60 * 60 * 1000;

export const lockDir = (root) => join(orchestraDir(root), 'tick.lock');
const holderPath = (root) => join(lockDir(root), HOLDER);

export function readHolder(root) {
  try { return JSON.parse(readFileSync(holderPath(root), 'utf8')); } catch { return null; }
}

// `null` holder = the lock exists but says nothing about itself: an old-format lock, or one caught
// between mkdir and the holder write. There is no timestamp to read either way, so it can never be
// judged young — it is dead on the very first check, not once MAX_AGE_MS has passed. For an
// old-format lock that is simply correct: there is nothing more recent to wait for. For the write
// in progress, that window is microseconds wide, and losing the race costs a redundant break, not a
// lost lock.
export function holderIsDead(root, holder, { now = Date.now(), alive = pidAlive, live = liveConductor } = {}) {
  const startedAt = Date.parse(holder?.startedAt ?? '');
  const tooOld = !Number.isFinite(startedAt) || now - startedAt > MAX_AGE_MS;
  if (!holder) return tooOld;
  if (tooOld) return true;
  if (holder.kind === 'tick') return !alive(holder.pid);
  if (holder.kind === 'conductor') {
    const beat = live(root, { now });
    // A conductor holder is alive only if the beat names THAT session. A beat from a different
    // session means the holder is gone and somebody else has the baton.
    return !beat || beat.session !== holder.session;
  }
  return tooOld;
}

export function acquire(root, { kind, session = null, pid = process.pid, now = Date.now(), deps = {} } = {}) {
  const write = () => {
    const rec = { kind, session, pid, startedAt: new Date(now).toISOString() };
    // Through a rename so a reader never sees half a record — the same discipline beat.mjs uses,
    // and the reason `readHolder` returning null has to mean "unknown", not "free".
    const scratch = `${holderPath(root)}.${pid}.tmp`;
    writeFileSync(scratch, `${JSON.stringify(rec)}\n`);
    renameSync(scratch, holderPath(root));
    return { ok: true, holder: rec };
  };
  try {
    mkdirSync(lockDir(root), { recursive: false });
    return write();
  } catch (e) {
    if (e?.code !== 'EEXIST') throw e;
  }
  const held = readHolder(root);
  if (!holderIsDead(root, held, { now, ...deps })) return { ok: false, holder: held };
  // Break it and take it. rmSync of the whole directory rather than the record alone: a lock whose
  // holder is dead is not a lock, and leaving the directory would leave that existence check
  // reporting true.
  rmSync(lockDir(root), { recursive: true, force: true });
  try {
    mkdirSync(lockDir(root), { recursive: false });
  } catch {
    // Somebody else broke and took it in the same instant. Losing that race is a correct outcome.
    return { ok: false, holder: readHolder(root) };
  }
  return write();
}

// Releasing is deliberately identity-checked: a conductor that has already lost the lock to a
// staleness break must not delete the lock its successor is holding.
export function release(root, { kind, session = null, pid = process.pid } = {}) {
  const held = readHolder(root);
  if (held && !(held.kind === kind && (kind === 'conductor' ? held.session === session : held.pid === pid)))
    return false;
  rmSync(lockDir(root), { recursive: true, force: true });
  return true;
}
