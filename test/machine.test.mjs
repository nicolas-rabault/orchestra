// The machine registry, under a temporary HOME so the file under test is never the developer's own.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const HOME = process.env.HOME;
const homes = [];
beforeEach(() => {
  const h = mkdtempSync(join(tmpdir(), 'orchestra-home-'));
  homes.push(h);
  process.env.HOME = h;
});
after(() => { process.env.HOME = HOME; homes.forEach((h) => rmSync(h, { recursive: true, force: true })); });

const { machineDir, instancesPath, maxWorkers, readInstances, recordInstance, otherWorkers, DEFAULT_MAX_WORKERS } =
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
  const root = mkdtempSync(join(tmpdir(), 'orchestra-proj-'));
  recordInstance({ id: 'aaa111', name: 'A', root, mode: 'offline', workers: 2 });
  recordInstance({ id: 'aaa111', name: 'A', root, mode: 'offline', workers: 4 });
  const all = readInstances();
  assert.equal(all.length, 1);
  assert.equal(all[0].workers, 4);
  assert.ok(all[0].updatedAt);
  assert.ok(existsSync(instancesPath()));
});

test('an entry whose root no longer exists is reaped on the next write', () => {
  const gone = mkdtempSync(join(tmpdir(), 'orchestra-proj-'));
  const here = mkdtempSync(join(tmpdir(), 'orchestra-proj-'));
  const now = Date.now();
  // A FRESH beat on the entry that is about to be reaped, so the missing root is the ONLY reason it
  // can go. Without it the entry is dead twice over — no beat and no pid — and the test would pass
  // with the root still there, proving nothing about the check it is named after.
  recordInstance({ id: 'gone11', name: 'G', root: gone, mode: 'offline', workers: 3,
    beatAt: new Date(now).toISOString() }, { now });
  assert.deepEqual(readInstances().map((i) => i.id), ['gone11']);   // alive while its root stands
  rmSync(gone, { recursive: true, force: true });
  recordInstance({ id: 'here11', name: 'H', root: here, mode: 'offline', workers: 1 }, { now });
  assert.deepEqual(readInstances().map((i) => i.id), ['here11']);
});

test('an entry whose beat is stale AND whose pid is dead is reaped', () => {
  const a = mkdtempSync(join(tmpdir(), 'orchestra-proj-'));
  const b = mkdtempSync(join(tmpdir(), 'orchestra-proj-'));
  const now = Date.parse('2026-09-03T10:00:00.000Z');
  recordInstance({ id: 'stale1', name: 'S', root: a, mode: 'offline', workers: 5,
    conductorSession: 's1', conductorPid: 4242, beatAt: '2026-08-01T00:00:00.000Z' }, { now });
  recordInstance({ id: 'fresh1', name: 'F', root: b, mode: 'offline', workers: 1 },
    { now, alive: () => false });
  assert.deepEqual(readInstances().map((i) => i.id), ['fresh1']);
});

test('otherWorkers counts every instance but mine', () => {
  const a = mkdtempSync(join(tmpdir(), 'orchestra-proj-'));
  const b = mkdtempSync(join(tmpdir(), 'orchestra-proj-'));
  const now = Date.now();
  recordInstance({ id: 'aaa111', name: 'A', root: a, mode: 'offline', workers: 2, beatAt: new Date(now).toISOString() }, { now });
  recordInstance({ id: 'bbb222', name: 'B', root: b, mode: 'offline', workers: 3, beatAt: new Date(now).toISOString() }, { now });
  assert.equal(otherWorkers('aaa111', { now }), 3);
  assert.equal(otherWorkers('ccc333', { now }), 5);
});

test('a corrupt instances.json is replaced, not fatal', () => {
  const a = mkdtempSync(join(tmpdir(), 'orchestra-proj-'));
  mkdirSync(machineDir(), { recursive: true });
  writeFileSync(instancesPath(), 'not json at all');
  assert.deepEqual(readInstances(), []);
  recordInstance({ id: 'aaa111', name: 'A', root: a, mode: 'offline', workers: 1 });
  assert.deepEqual(readInstances().map((i) => i.id), ['aaa111']);
});
