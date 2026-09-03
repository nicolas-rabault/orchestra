// The one file this plugin writes outside a project: `~/.orchestra/`, which exists because one
// conductor per project is the point of a portable plugin, so several run side by side and each of
// them caps its own launches at a width of eight. Four conductors is thirty-two worker sessions and
// a machine that stops answering (spec §8.6).
//
// IT IS ADVISORY, NEVER AUTHORITY. The truth about a project stays inside that project — its
// register, its git — exactly as `state.json` and git are the truth today. Nothing here may be read
// as a statement about what a project's own register says; it answers one question only, "how many
// worker sessions do the OTHER projects on this machine believe they are holding", and it answers it
// in the safe direction: a conductor killed with -9 leaves its count behind until its entry is
// reaped, which under-budgets everybody else for a few minutes. Too few launches, never too many.
//
// `homedir()` and not a configurable directory: the whole point is that every project on this
// machine reads the same file, so making the location a per-project setting would let a project opt
// itself out of the budget by accident. Node resolves `homedir()` from HOME on POSIX, which is what
// lets the suite run against a temporary one instead of the developer's own.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const machineDir = () => join(homedir(), '.orchestra');
export const instancesPath = () => join(machineDir(), 'instances.json');
export const machinePath = () => join(machineDir(), 'machine.json');

// Eight, which is the width a single conductor already used. The budget's job is to stop four
// projects reaching thirty-two between them, not to make one project slower than it was alone.
export const DEFAULT_MAX_WORKERS = 8;

const readJsonOr = (path, fallback) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
};

// A machine.json nobody can read must not stop every project on the machine from launching. Falling
// back is the only safe direction, and it is the same reasoning `decideTick` applies to an
// unreadable register.
export function maxWorkers() {
  const n = readJsonOr(machinePath(), {})?.maxWorkers;
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_WORKERS;
}

export function readInstances() {
  const raw = readJsonOr(instancesPath(), null);
  return Array.isArray(raw?.instances) ? raw.instances : [];
}

// EPERM means the pid exists and belongs to somebody else, which is alive for our purposes. The same
// test `lib/register/beat.mjs` makes, and it is duplicated here on purpose rather than imported:
// importing the register into the machine registry would make the one file that must know nothing
// about a project depend on a project's own module.
const pidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

// How stale a recorded beat may be before its instance stops counting. Generous next to the beat's
// own 60-second window, because this file is written once per tick rather than every two seconds: a
// project that ticks hourly is alive and its entry must not be reaped between two ticks.
const BEAT_STALE_MS = 6 * 60 * 60 * 1000;

// An entry is reaped when its project is gone, or when nothing about it is alive any more. Both
// tests, and neither alone: a checkout deleted while its conductor still runs is gone, and a
// conductor killed while its checkout stands is dead.
function isLive(e, now, alive) {
  if (typeof e?.id !== 'string' || !e.id) return false;
  if (typeof e.root !== 'string' || !existsSync(e.root)) return false;
  if (alive(e.conductorPid)) return true;
  const beat = Date.parse(e.beatAt ?? '');
  // `!(… > …)` so an unreadable stamp reads as stale rather than as fresh.
  return Number.isFinite(beat) && !(now - beat > BEAT_STALE_MS);
}

// Whole-file rewrite through a temp file and a rename, behind one lock directory. Contention is a
// handful of writes an hour, so nothing more is warranted — and the lock is broken on age rather
// than waited on, because a crashed writer must not freeze every other project's budget for ever.
const LOCK_STALE_MS = 30_000;

function withLock(fn) {
  const lock = join(machineDir(), 'instances.lock');
  mkdirSync(machineDir(), { recursive: true });
  for (let i = 0; i < 2; i += 1) {
    try { mkdirSync(lock); } catch {
      const age = (() => { try { return Date.now() - Number(readFileSync(join(lock, 'at'), 'utf8')); } catch { return Infinity; } })();
      if (age < LOCK_STALE_MS) { if (i === 0) continue; return fn(); }
      rmSync(lock, { recursive: true, force: true });
      continue;
    }
    try {
      writeFileSync(join(lock, 'at'), String(Date.now()));
      return fn();
    } finally { rmSync(lock, { recursive: true, force: true }); }
  }
  // Lost the race twice against a live writer. Doing the work anyway is the right failure here: this
  // file is advisory, a lost write costs one tick's accuracy, and refusing would cost a launch.
  return fn();
}

// The caller's own entry, merged in, and every dead entry reaped in the same pass — §8.2's "reaped
// on the next write". `updatedAt` is stamped here rather than by the caller so two projects cannot
// disagree about the clock.
export function recordInstance(entry, { now = Date.now(), alive = pidAlive } = {}) {
  return withLock(() => {
    const kept = readInstances().filter((e) => e.id !== entry.id && isLive(e, now, alive));
    const next = [...kept, { ...entry, updatedAt: new Date(now).toISOString() }]
      .sort((a, b) => a.id.localeCompare(b.id));
    const tmp = `${instancesPath()}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, instances: next }, null, 2)}\n`);
    renameSync(tmp, instancesPath());
    return next;
  });
}

// What everybody ELSE believes they are holding. Read-only: reaping happens on write, so a stale
// entry is counted here for as long as it survives, which is the safe direction (§16).
export const otherWorkers = (id, { now = Date.now(), alive = pidAlive } = {}) =>
  readInstances()
    .filter((e) => e.id !== id && isLive(e, now, alive))
    .reduce((n, e) => n + (Number.isInteger(e.workers) && e.workers > 0 ? e.workers : 0), 0);
