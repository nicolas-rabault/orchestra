// `~/.orchestra/monitor.json` — the one page on this machine, its port and its pid. Under a
// temporary HOME (spec §14), never the developer's own.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_MONITOR_PORT, machineMonitorPort, monitorPath, readMonitor, recordMonitor,
} from '../lib/machine.mjs';

const HOME = process.env.HOME;
const homes = [];
beforeEach(() => { const h = mkdtempSync(join(tmpdir(), 'orchestra-home-')); homes.push(h); process.env.HOME = h; });
after(() => { process.env.HOME = HOME; homes.forEach((h) => rmSync(h, { recursive: true, force: true })); });

const writeMachine = (obj) => {
  mkdirSync(join(process.env.HOME, '.orchestra'), { recursive: true });
  writeFileSync(join(process.env.HOME, '.orchestra', 'machine.json'), `${JSON.stringify(obj)}\n`);
};

test('no record at all reads as null, never as a throw', () => {
  assert.equal(readMonitor(), null);
});

test('a record round-trips, and carries the port, the pid and a stamp', () => {
  const written = recordMonitor({ port: 4380, pid: 4242, now: Date.parse('2026-09-04T20:00:00.000Z') });
  assert.equal(written.port, 4380);
  assert.equal(written.pid, 4242);
  assert.equal(written.startedAt, '2026-09-04T20:00:00.000Z');
  assert.deepEqual(readMonitor(), { version: 1, port: 4380, pid: 4242, startedAt: '2026-09-04T20:00:00.000Z' });
  assert.match(readFileSync(monitorPath(), 'utf8'), /\n$/);
});

test('an unreadable record reads as null rather than taking the caller down', () => {
  mkdirSync(join(process.env.HOME, '.orchestra'), { recursive: true });
  writeFileSync(monitorPath(), '{ half written');
  assert.equal(readMonitor(), null);
});

test('the port defaults to 4380 and is overridden by machine.json', () => {
  assert.equal(machineMonitorPort(), DEFAULT_MONITOR_PORT);
  assert.equal(DEFAULT_MONITOR_PORT, 4380);
  writeMachine({ monitorPort: 4500 });
  assert.equal(machineMonitorPort(), 4500);
});

test('a nonsense override falls back to the default rather than handing out NaN', () => {
  for (const bad of ['4500', 0, -1, 70000, 4380.5, null]) {
    writeMachine({ monitorPort: bad });
    assert.equal(machineMonitorPort(), DEFAULT_MONITOR_PORT, `override ${JSON.stringify(bad)}`);
  }
});

test('machine.json holding maxWorkers and monitorPort keeps both', async () => {
  writeMachine({ maxWorkers: 3, monitorPort: 4500 });
  const { maxWorkers } = await import('../lib/machine.mjs');
  assert.equal(maxWorkers(), 3);
  assert.equal(machineMonitorPort(), 4500);
});
