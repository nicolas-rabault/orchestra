// Who is holding the baton, as a fact rather than as an inference.
//
// `state.json` NAMES a conductor; it has never been able to say whether that conductor is alive. On
// 2026-08-13 six session identities wrote themselves into `conductor.session` in half an hour and
// each died within minutes of doing so; at 07:45Z the register named one that was not running at
// all. A register naming a dead conductor is indistinguishable from a healthy one until an answer
// rots in it — three did that morning, the newest eighteen minutes old when the user came into the
// session and said so himself.
//
// The beat is written by a loop that lives exactly as long as the session holding the baton:
// `watch.mjs`, armed as a persistent Monitor at the top of every tick, which the harness
// runs until that session ends. So "is somebody reading" stops being a guess and becomes two cheap
// local facts — a pid that answers signal 0, and a stamp younger than a handful of the loop's own
// periods.
//
// It deliberately does NOT ask `claude agents --json`. That call costs 2.2 s (measured 2026-08-13)
// and cannot answer the question anyway: `status`/`state` are reported for BACKGROUND sessions
// only, so an interactive conductor mid-turn carries neither, and a liveness test built on it is
// permanently false for exactly the session that matters most.
import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { orchestraDir } from '../paths.mjs';
import { statePath } from './state.mjs';

// How often the watcher rewrites the beat. It is also how fast a posted answer reaches the
// conductor, because one loop does both jobs — a second timer would be a second thing to get wrong,
// and two seconds of a 120-byte write is nothing next to the page's own two-second poll.
export const BEAT_EVERY_MS = 2_000;

// How old a beat may be before the session that wrote it stops counting as a conductor. Thirty
// missed periods: a loop that is running cannot miss thirty, and a loop that is not running is the
// only state this window admits. Shorter starts calling a conductor dead across an ordinary stall;
// longer re-opens the window an answer rots in, which is the whole defect.
//
// The one gap it leaves, named rather than hidden: a machine that sleeps freezes the loop, so on
// wake the beat reads stale for up to one period before the loop stamps it again. A tick firing
// inside that sliver takes the baton from a conductor that is in fact alive. It is two seconds wide,
// it costs a redundant tick and not a lost answer, and `lib/register/wake.mjs` is the second
// guard under it.
export const BEAT_STALE_MS = 30 * BEAT_EVERY_MS;

export const beatPath = (root) => join(orchestraDir(root), 'conductor.beat.json');

// Written through a rename, which is atomic within one filesystem: a reader polling this file every
// couple of seconds sees the previous beat or the next one, never half of one. The register is
// rewritten in place and readers of THAT have had to carry a "mid-write or malformed" branch since
// the day it was written — this file does not reproduce that.
export function writeBeat(repo, { session, pid = process.pid, now = Date.now() }) {
  const path = beatPath(repo);
  // The pid is in the temporary name so two writers — a conductor and a test, or two conductors
  // mid-handover — cannot land on the same scratch file and truncate each other's.
  const scratch = `${path}.${pid}.tmp`;
  writeFileSync(scratch, `${JSON.stringify({ session, pid, ts: new Date(now).toISOString() })}\n`);
  renameSync(scratch, path);
  return path;
}

export const readBeat = (repo) => {
  try { return JSON.parse(readFileSync(beatPath(repo), 'utf8')); } catch { return null; }
};

// EPERM means the pid exists and belongs to somebody else, which is alive for our purposes. Any
// other throw — ESRCH above all — means no such process.
export const pidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

// Both tests, and neither alone. A fresh stamp with no process behind it is what a killed session
// leaves; a live pid with a frozen stamp is a loop that has stopped looping inside a process that
// has not exited. Either on its own reports a conductor that cannot read.
export function liveConductor(repo, { now = Date.now(), alive = pidAlive } = {}) {
  const beat = readBeat(repo);
  if (!beat || typeof beat.session !== 'string' || !beat.session) return null;
  const ts = Date.parse(beat.ts ?? '');
  // Written as `!(… <= …)` so an unparsable stamp (NaN) reports no conductor rather than one.
  if (!(now - ts <= BEAT_STALE_MS)) return null;
  return alive(beat.pid) ? beat : null;
}

// ---- alive is not the same fact as conducting ------------------------------------------------
//
// Everything above answers "can this session be reached". The heartbeat needs a second answer — "is
// it doing anything" — and the beat is structurally unable to give it: `watch.mjs` is armed
// for the life of the SESSION, so an interactive window left open and untouched refreshes it every
// two seconds for as long as it stays open. THERE IS THEREFORE NO WINDOW ON THE BEAT'S OWN AGE THAT
// SEPARATES THE TWO, and shortening BEAT_STALE_MS is the answer that looks obvious and measures
// nothing.
//
// Measured on this machine, in planetCraft: four consecutive heartbeat slots (2026-08-17T18:23Z,
// 22:23Z, 2026-08-18T03:23Z, 08:23Z) stood down for `e3a9fcc5, pid 8237` while `journal.jsonl`
// took not one line between 08-17 22:01Z and 08-18 11:41Z. Four workers finished and sat
// uncollected about thirteen hours, until a human typed /orchestra.

// How long a conductor may leave the register untouched and still hold the baton. Ninety minutes.
//
// Taken from the journal's own gaps over the six days the beat has existed: the largest gap that was
// NOT one of the known blackouts is 55 minutes (2026-08-13 13:45→14:40Z), p95 is 29 minutes, and the
// next one up is the 3 h 56 of 2026-08-17 15:54→19:50Z, which is this same defect in miniature. So
// the window clears every measured working silence by 1.6x and still fires inside the shortest
// instance of the failure. It is also far longer than any tick: the longest real one on this machine,
// in planetCraft, ran a full suite at ~4.5 minutes (see lock.mjs MAX_AGE_MS).
export const CONDUCT_STALE_MS = 90 * 60 * 1000;

// The register's write time, and it is the register on purpose:
//
//   - it has exactly ONE writer by design — that is the whole reason `lock.mjs` exists — and the
//     conductor rewrites it at step 8 of every tick, unconditionally, including a tick that changed
//     nothing. `lib/register/state.mjs`'s `writeState` is the only place in this plugin that ever
//     touches this file on disk — every caller that wants a change goes through it.
//   - `journal.jsonl` was the other candidate and it fails on both counts: `wake.mjs` appends a
//     handback line to it, so a RIVAL tick standing down would refresh the very evidence that stood
//     it down; and its stamps are CONTENT, which a conductor types. One line dated 2099 would keep
//     the veto alive for ever — the exact shape that made a guard blind an hour before
//     `tests/orchestraWake.test.js` was written, and which that file's header exists to forbid.
//     An mtime is set by the filesystem from the same clock this function reads, so the two cannot
//     disagree the way a typed stamp can.
const lastConductedAt = (repo) => {
  try { return statSync(statePath(repo)).mtimeMs; } catch { return null; }
};

// The live conductor, plus whether it is conducting. `null` still means nobody is there, so the
// callers that only ever asked the first question read the same as before.
//
// A checkout with no register at all keeps the baton: there is nothing to conduct there, so the
// silence measures nothing, and reading it as idleness would double a conductor on no evidence.
//
// It deliberately does NOT ask whether the conductor is inside a tick right now — that is the lock's
// question, and the lock asks it by calling THIS function: `holderIsDead` judges a `conductor` holder
// on `conducting`, so the door and the guard behind it now reach one verdict. Asking the lock from
// here would mean importing lock.mjs, which imports this one, and the dependency runs the other way
// on purpose. Until 2026-09-09 the lock asked `liveConductor` instead and could hold a slot shut for
// four hours after this call had already declared the baton loose (lock.mjs's header measures it).
export function conductorState(repo, { now = Date.now(), alive = pidAlive, staleMs = CONDUCT_STALE_MS } = {}) {
  const beat = liveConductor(repo, { now, alive });
  if (!beat) return null;
  const at = lastConductedAt(repo);
  const silentFor = at === null ? null : now - at;
  return { ...beat, conducting: silentFor === null || silentFor <= staleMs, silentFor };
}
