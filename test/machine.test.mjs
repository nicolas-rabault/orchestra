// The machine registry, under a temporary HOME so the file under test is never the developer's own.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const HOME = process.env.HOME;
const homes = [];
beforeEach(() => {
  const h = mkdtempSync(join(tmpdir(), 'orchestra-home-'));
  homes.push(h);
  process.env.HOME = h;
});
const roots = [];
// `force: true` so a root a test already removed itself (the "reaped" fixture below) is a no-op
// here rather than an error — every OTHER scratch root leaked into the OS tmpdir until this ran.
const projectRoot = () => { const r = mkdtempSync(join(tmpdir(), 'orchestra-proj-')); roots.push(r); return r; };
after(() => {
  process.env.HOME = HOME;
  homes.forEach((h) => rmSync(h, { recursive: true, force: true }));
  roots.forEach((r) => rmSync(r, { recursive: true, force: true }));
});

const { machineDir, instancesPath, maxWorkers, readInstances, recordInstance, otherWorkers, liveInstances, DEFAULT_MAX_WORKERS } =
  await import('../lib/machine.mjs');

test('os.homedir follows HOME, which is what makes this suite safe', () => {
  assert.equal(homedir(), process.env.HOME);
  assert.equal(machineDir(), join(process.env.HOME, '.orchestra'));
});

test('an empty machine is an empty list and the default budget', () => {
  assert.deepEqual(readInstances(), []);
  assert.equal(maxWorkers(), DEFAULT_MAX_WORKERS);
});

test('maxWorkers comes from machine.json when it is there', () => {
  mkdirSync(machineDir(), { recursive: true });
  writeFileSync(join(machineDir(), 'machine.json'), '{"maxWorkers":3}\n');
  assert.equal(maxWorkers(), 3);
});

test('an unreadable machine.json falls back to the default rather than throwing', () => {
  mkdirSync(machineDir(), { recursive: true });
  writeFileSync(join(machineDir(), 'machine.json'), '{oops');
  assert.equal(maxWorkers(), DEFAULT_MAX_WORKERS);
});

test('an entry round-trips and is keyed on id', () => {
  const root = projectRoot();
  recordInstance({ id: 'aaa111', name: 'A', root, mode: 'offline', workers: 2 });
  recordInstance({ id: 'aaa111', name: 'A', root, mode: 'offline', workers: 4 });
  const all = readInstances();
  assert.equal(all.length, 1);
  assert.equal(all[0].workers, 4);
  assert.ok(all[0].updatedAt);
  assert.ok(existsSync(instancesPath()));
});

test('an entry whose root no longer exists is reaped on the next write', () => {
  const gone = projectRoot();
  const here = projectRoot();
  const now = Date.now();
  // No explicit freshness needed: `recordInstance` stamps `updatedAt` from its own clock on every
  // write, so this entry is fresh by construction the moment it is recorded. The missing root is
  // the ONLY reason it can go — without that check, a freshly-written entry would never be reaped,
  // and this test would prove nothing about the check it is named after.
  recordInstance({ id: 'gone11', name: 'G', root: gone, mode: 'offline', workers: 3 }, { now });
  assert.deepEqual(readInstances().map((i) => i.id), ['gone11']);   // alive while its root stands
  rmSync(gone, { recursive: true, force: true });
  recordInstance({ id: 'here11', name: 'H', root: here, mode: 'offline', workers: 1 }, { now });
  assert.deepEqual(readInstances().map((i) => i.id), ['here11']);
});

test('a dead-pid entry that has gone quiet past the freshness window is reaped', () => {
  const a = projectRoot();
  const b = projectRoot();
  const past = Date.parse('2026-09-03T00:00:00.000Z');
  const now = past + 6 * 60 * 60 * 1000 + 1;   // one ms past the six-hour SEEN_STALE_MS window
  // Recorded once, by a conductor that is now gone, and never written again: `updatedAt` sits at
  // `past` because nothing has reported since, and the pid it named no longer answers.
  recordInstance({ id: 'stale1', name: 'S', root: a, mode: 'offline', workers: 5,
    conductorSession: 's1', conductorPid: 4242 }, { now: past });
  // A later write, past the window, reaps it. `alive` is overridden here so the test does not
  // depend on pid 4242 happening to be free on the machine running it.
  recordInstance({ id: 'fresh1', name: 'F', root: b, mode: 'offline', workers: 1 },
    { now, alive: () => false });
  assert.deepEqual(readInstances().map((i) => i.id), ['fresh1']);
});

test('otherWorkers counts every instance but mine', () => {
  const a = projectRoot();
  const b = projectRoot();
  const now = Date.now();
  recordInstance({ id: 'aaa111', name: 'A', root: a, mode: 'offline', workers: 2 }, { now });
  recordInstance({ id: 'bbb222', name: 'B', root: b, mode: 'offline', workers: 3 }, { now });
  assert.equal(otherWorkers('aaa111', { now }), 3);
  assert.equal(otherWorkers('ccc333', { now }), 5);
});

test('a corrupt instances.json is replaced, not fatal', () => {
  const a = projectRoot();
  mkdirSync(machineDir(), { recursive: true });
  writeFileSync(instancesPath(), 'not json at all');
  assert.deepEqual(readInstances(), []);
  recordInstance({ id: 'aaa111', name: 'A', root: a, mode: 'offline', workers: 1 });
  assert.deepEqual(readInstances().map((i) => i.id), ['aaa111']);
});

// The registry is multi-writer: `ready` sends the worker side (`workers`, `conductorPid`,
// `conductorSession`), `discoverProjects` (`lib/monitor/discover.mjs`, called from
// `orchestra monitor` and from the page's own request handler) sends `id`, `name`, `root` and
// `mode` the first time it finds the current directory's project unregistered, onto the SAME
// entry. A replacing write (today's behaviour) would let each erase the other's fields — the
// dangerous direction is `discoverProjects` erasing `workers`, since another project would then
// read `undefined`, count 0, and launch MORE. `recordInstance` must merge instead. The monitor
// process itself writes neither: `port` and `monitorPid` left this registry entirely, for
// `~/.orchestra/monitor.json`.
test('recordInstance merges a discoverProjects-shaped write onto a conductor-shaped one, keeping both field sets', () => {
  const root = projectRoot();
  const now = Date.now();
  recordInstance({ id: 'aaa111', name: 'A', root, mode: 'offline', workers: 2,
    conductorSession: 's1', conductorPid: 4242 }, { now });
  const firstWorkersAt = readInstances()[0].workersAt;
  recordInstance({ id: 'aaa111', name: 'A', root, mode: 'offline' }, { now: now + 1000 });
  const all = readInstances();
  assert.equal(all.length, 1);
  assert.equal(all[0].workers, 2);
  assert.equal(all[0].conductorSession, 's1');
  assert.equal(all[0].conductorPid, 4242);
  // The write side of the `workersAt` rule: a write that carries no `workers` (the
  // discoverProjects-shaped one here) must NOT restamp it. `recordInstance`'s `if ('workers' in
  // entry)` guard is the whole fix — deleting that condition (stamping `workersAt`
  // unconditionally) would make `workersAt` track `updatedAt` exactly, which is the bug
  // `otherWorkers`'s own staleness check exists to prevent: this write would then refresh a dead
  // conductor's `workersAt` right along with `updatedAt`, and the staleness check below would
  // never trigger.
  assert.equal(all[0].workersAt, firstWorkersAt);
});

// `updatedAt` doubles as "does this entry still exist" (isLive) — `discoverProjects`'s own
// registration write refreshes it with NO `workers` field, which must not be read as "the worker
// count is still current". `otherWorkers` must trust `workers` only while its OWN stamp,
// `workersAt`, is fresh, falling back to `updatedAt` for an entry written before this change (an
// entry `ready` wrote under today's code, which never stamped `workersAt` at all). Raw fixture
// entries on disk, deliberately bypassing `recordInstance`, so this proves `otherWorkers`'s OWN
// read-time rule in isolation from the write-side merge fix above.
test('otherWorkers only trusts workers while workersAt is fresh, falling back to updatedAt for an entry that predates it', () => {
  const stale = projectRoot();
  const legacy = projectRoot();
  const now = Date.now();
  const past = new Date(now - 6 * 60 * 60 * 1000 - 1).toISOString();   // one ms past SEEN_STALE_MS
  const fresh = new Date(now).toISOString();

  mkdirSync(machineDir(), { recursive: true });
  writeFileSync(instancesPath(), `${JSON.stringify({ version: 1, instances: [
    // `updatedAt` fresh — a monitor keepalive refreshed the entry (§8.3) — but `workersAt` stale:
    // the worker count it reported must stop being trusted, even though the entry stays LISTED.
    { id: 'stale1', name: 'S', root: stale, mode: 'offline', workers: 5, updatedAt: fresh, workersAt: past },
    // A legacy entry, in exactly the shape TODAY's `ready` writes — no `workersAt` field at all —
    // must still count, falling back to `updatedAt`.
    { id: 'legacy', name: 'L', root: legacy, mode: 'offline', workers: 3, updatedAt: fresh },
  ] }, null, 2)}\n`);

  // 0 from the stale entry (workersAt too old) + 3 from the legacy one (falls back to updatedAt).
  assert.equal(otherWorkers('mine11', { now }), 3);
});

// The staleness check above is not the whole rule: a LIVE conductor pid counts its workers
// regardless of how stale `workersAt`/`updatedAt` are — exactly like `isLive` already treats a live
// `conductorPid` as proof of life on its own. A watch loop armed overnight on a long-running task,
// with no `ready` tick in between, is exactly this shape: alive, but hours past `SEEN_STALE_MS` on
// both stamps. Without the OR, its workers would silently read as 0 and every OTHER project on the
// machine would budget as if it held nothing — too MANY launches, the direction `machine.mjs`'s own
// header (line 11) forbids.
test('otherWorkers still counts a live conductor\'s workers, however stale workersAt and updatedAt are', () => {
  const root = projectRoot();
  const now = Date.now();
  const stale = new Date(now - 6 * 60 * 60 * 1000 - 1).toISOString();   // one ms past SEEN_STALE_MS

  mkdirSync(machineDir(), { recursive: true });
  writeFileSync(instancesPath(), `${JSON.stringify({ version: 1, instances: [
    { id: 'armed1', name: 'A', root, mode: 'offline', workers: 6, conductorPid: 4242,
      updatedAt: stale, workersAt: stale },
  ] }, null, 2)}\n`);

  assert.equal(otherWorkers('mine11', { now, alive: (pid) => pid === 4242 }), 6);
});

// The read half of the same liveness rule, for `orchestra instances` and `doctor` — a dead entry on
// disk (its root gone) must not appear, without needing a write to reap it first.
test('liveInstances lists only entries that are still live, not the ones a write would reap', () => {
  const here = projectRoot();
  const gone = projectRoot();
  const now = Date.now();
  recordInstance({ id: 'here11', name: 'H', root: here, mode: 'offline' }, { now });
  mkdirSync(machineDir(), { recursive: true });
  const raw = JSON.parse(readFileSync(instancesPath(), 'utf8'));
  raw.instances.push({ id: 'gone11', name: 'G', root: gone, mode: 'offline',
    updatedAt: new Date(now).toISOString() });
  writeFileSync(instancesPath(), `${JSON.stringify(raw, null, 2)}\n`);
  rmSync(gone, { recursive: true, force: true });
  assert.deepEqual(liveInstances({ now }).map((e) => e.id), ['here11']);
});
