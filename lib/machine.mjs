// The two files this plugin writes outside a project, both under `~/.orchestra/`: `instances.json`,
// the advisory registry of every orchestra that has run here, and `monitor.json`, the one
// monitoring page this machine serves. They are separate files because they have separate
// lifetimes and separate writers — an entry belongs to a project, the page belongs to the machine —
// and because folding the page into the registry is what made P4 record a port per project in the
// first place.
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
const machinePath = () => join(machineDir(), 'machine.json');

export const monitorPath = () => join(machineDir(), 'monitor.json');

// 4380 with no hashing and no probing rule: there is one page on this machine, so there is nothing
// to spread across a band. `lib/monitor/port.mjs`'s `listenOnFreePort` still steps upward when
// something else holds it — a page one port along beats a page that refused to start.
export const DEFAULT_MONITOR_PORT = 4380;

// `monitorPort` in `~/.orchestra/machine.json`, beside `maxWorkers`, for someone who wants a
// hand-chosen URL. Validated HERE rather than trusted, for the same reason `maxWorkers` is: this
// file is hand-edited, and a string or a float reaching `server.listen` is a failure far from its
// cause. Anything that is not a plausible port falls back to the default.
export function machineMonitorPort() {
  const n = readJsonOr(machinePath(), {})?.monitorPort;
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : DEFAULT_MONITOR_PORT;
}

// Written on bind and refreshed by the page's keepalive. No lock and no merge, unlike
// `recordInstance`: this file has exactly one writer at a time by construction — the one page — and
// the whole point of the refuse-and-point is that a second writer never gets that far.
export function recordMonitor({ port, pid, now = Date.now() }) {
  mkdirSync(machineDir(), { recursive: true });
  const record = { version: 1, port, pid, startedAt: new Date(now).toISOString() };
  const tmp = `${monitorPath()}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(tmp, monitorPath());
  return record;
}

// Null when there is no page, when the file is half-written, or when what is on file is not a
// record — three conditions with one honest answer, "nothing is claiming the port", which is the
// safe direction: the caller then binds, and the bind is the only thing that can be wrong about it.
export function readMonitor() {
  const raw = readJsonOr(monitorPath(), null);
  return Number.isInteger(raw?.port) && Number.isInteger(raw?.pid) ? raw : null;
}

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

// How long since a project last reported itself (`updatedAt`, stamped by `recordInstance` on every
// write from ITS OWN clock — never from the conductor's beat, which is legitimately absent whenever
// no watch loop is armed) before its instance stops counting on that evidence alone. Six hours is
// generous because this file is written once per tick rather than every two seconds: a project that
// ticks hourly is alive and its entry must not be reaped between two ticks.
const SEEN_STALE_MS = 6 * 60 * 60 * 1000;

// An entry is reaped when its project is gone, or when nothing about it is alive any more. Both
// tests, and neither alone: a checkout deleted while its conductor still runs is gone, and a
// conductor killed while its checkout stands is dead. "Alive" is either leg below, not just the
// first: a live conductor pid proves it directly, and a recent self-report (`updatedAt`) proves it
// for every project whose conductor is not currently watching for answers — which is the ordinary
// case between ticks, and must not make an entry read as dead the moment it is written.
//
// Deliberately not a third leg here: `monitorPid`. Spec §8.2 says an entry is reaped when "its
// pids are dead", plural, but a page left open for days must not pin a dead conductor's whole
// entry — worker count included — alive for as long as the browser tab stays open. The one place
// `monitorPid` DOES matter is a `port` claim specifically, checked on its own in
// `lib/monitor/port.mjs`'s `pinConflict` — see the comment there for why that check could not live
// here either.
function isLive(e, now, alive) {
  if (typeof e?.id !== 'string' || !e.id) return false;
  if (typeof e.root !== 'string' || !existsSync(e.root)) return false;
  if (alive(e.conductorPid)) return true;
  const seen = Date.parse(e.updatedAt ?? '');
  // `!(… > …)` so an unreadable stamp reads as stale rather than as fresh.
  return Number.isFinite(seen) && !(now - seen > SEEN_STALE_MS);
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

// The caller's own entry, MERGED into whatever is already on file for that id — never a full
// replace — and every dead entry reaped in the same pass — §8.2's "reaped on the next write". A
// full replace was fine while `ready` was this file's only writer; P4 makes the monitor a second
// one, writing the SAME entry's port side (`port`, `monitorPid`) while `ready` writes its worker
// side (`workers`, `conductorPid`, …), and a replace would let each erase the other's fields. The
// dangerous direction is the monitor erasing `workers`: another project would then read
// `undefined`, count 0, and launch MORE — the wrong direction for an advisory cap. Each writer
// sends only the fields it owns; both send `id`, `name`, `root`, `mode` identically.
//
// `updatedAt` is stamped here rather than by the caller so two projects cannot disagree about the
// clock, on every write regardless of what it carries. `workersAt` is stamped only when the
// incoming entry itself carries `workers` — see `otherWorkers` below for why the two stamps must
// not be the same one.
export function recordInstance(entry, { now = Date.now(), alive = pidAlive } = {}) {
  return withLock(() => {
    const all = readInstances();
    const existing = all.find((e) => e.id === entry.id);
    const updatedAt = new Date(now).toISOString();
    const merged = { ...existing, ...entry, updatedAt };
    if ('workers' in entry) merged.workersAt = updatedAt;
    const kept = all.filter((e) => e.id !== entry.id && isLive(e, now, alive));
    const next = [...kept, merged].sort((a, b) => a.id.localeCompare(b.id));
    const tmp = `${instancesPath()}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, instances: next }, null, 2)}\n`);
    renameSync(tmp, instancesPath());
    return next;
  });
}

// `workers` counts only while its OWN freshness stamp, `workersAt`, is inside `SEEN_STALE_MS` —
// never `updatedAt`, which the monitor's own keepalive (a self-refresh every five minutes, §8.3)
// can now move without a fresh worker count behind it. Coupling the count to `updatedAt` would
// freeze a `-9`-killed conductor's count alive for as long as its browser tab stayed open. An entry
// written before this change carries no `workersAt` at all; it falls back to `updatedAt`, which is
// exactly today's behaviour.
const workersStamp = (e) => e.workersAt ?? e.updatedAt;

// What everybody ELSE believes they are holding. Read-only: reaping happens on write, so a stale
// entry is counted here for as long as it survives, which is the safe direction (§16).
//
// The `workersAt` freshness check above is not the whole rule: a live `conductorPid` counts
// REGARDLESS of how stale both stamps are, same as `isLive` already treats it as proof of life on
// its own. A watch loop armed overnight on a long-running task, with no `ready` tick in between, is
// exactly that — alive, but hours past `SEEN_STALE_MS` on both `updatedAt` and `workersAt`. Without
// this OR, its workers would silently drop to 0 and every OTHER project on the machine would budget
// as if it held nothing — too MANY launches, the one direction this file's header forbids (line 11).
// The keepalive case the freshness check exists for is unaffected: a `-9`-killed conductor's pid is
// not alive, so it still falls through to the stamp check exactly as before.
export const otherWorkers = (id, { now = Date.now(), alive = pidAlive } = {}) =>
  readInstances()
    .filter((e) => e.id !== id && isLive(e, now, alive))
    .reduce((n, e) => {
      if (!Number.isInteger(e.workers) || e.workers <= 0) return n;
      const seen = Date.parse(workersStamp(e) ?? '');
      // `!(… > …)` so an unreadable or missing stamp reads as stale rather than as fresh.
      const fresh = Number.isFinite(seen) && !(now - seen > SEEN_STALE_MS);
      return fresh || alive(e.conductorPid) ? n + e.workers : n;
    }, 0);

// The live entries, for `orchestra instances` and `doctor` — the read half of the same liveness
// rule `otherWorkers` applies to a worker count, applied here to the whole entry.
export const liveInstances = ({ now = Date.now(), alive = pidAlive } = {}) =>
  readInstances().filter((e) => isLive(e, now, alive));
