// lib/monitor/port.mjs: which port a project's monitor binds, and the registry conflict a pinned
// one can cause. All of it is NEW behaviour — none of this module exists before this task, so every
// test here was watched failing (module not found, or a real assertion mismatch) before the
// implementation landed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { candidatePort, resolvePort, pinConflict, listenOnFreePort } from '../lib/monitor/port.mjs';

// Two ids precomputed from `projectId('/…/work/foo')` and `projectId('/…/side/foo')` — two projects
// that happen to share a directory name (`foo`) under different parents. Literals rather than a
// live `projectId` call so this file never depends on a temp directory's random suffix: `projectId`
// uniqueness for the path case is already proven in test/paths.test.mjs, so what is at stake here
// is only whether `candidatePort` keeps two real, DIFFERENT ids apart after folding them into a
// 100-wide range.
const ID_A = '19222a';
const ID_B = '1acd0b';

test('candidatePort is a stable, pure function of a six-hex id', () => {
  assert.equal(candidatePort(ID_A), candidatePort(ID_A));
  assert.equal(candidatePort(ID_A), 4380 + (parseInt(ID_A, 16) % 100));
});

test('candidatePort differs for two ids that stand for two projects sharing a directory name', () => {
  assert.notEqual(candidatePort(ID_A), candidatePort(ID_B));
});

// `parseInt(id, 16)` on anything that is not six hex characters is `NaN`, and `NaN % 100` is `NaN`
// — a candidate port of `NaN` that would fail far from here. `projectId` always produces six hex;
// asserted rather than defended against, so a future change to `projectId` fails loudly at this
// line instead.
test('candidatePort refuses an id that is not six hex characters, rather than silently returning NaN', () => {
  assert.throws(() => candidatePort('not-hex'), /six hex/);
  assert.throws(() => candidatePort(''), /six hex/);
});

test('resolvePort: "auto" is the deterministic candidate, unpinned', () => {
  const cfg = { id: ID_A, monitor: { port: 'auto' } };
  assert.deepEqual(resolvePort(cfg), { port: candidatePort(ID_A), pinned: false });
});

test('resolvePort: a configured number pins it', () => {
  const cfg = { id: ID_A, monitor: { port: 45123 } };
  assert.deepEqual(resolvePort(cfg), { port: 45123, pinned: true });
});

test('pinConflict is null for "auto" by construction, even given a same-port collision on file', () => {
  const cfg = { id: ID_A, monitor: { port: 'auto' } };
  const instances = [{ id: 'other1', name: 'Other', root: '/x', port: candidatePort(ID_A) }];
  assert.equal(pinConflict(cfg, instances), null);
});

test('pinConflict names the other live project holding a pinned port', () => {
  const cfg = { id: 'mine11', monitor: { port: 45123 } };
  const instances = [
    // my own entry: never my own conflict
    { id: 'mine11', name: 'Mine', root: '/mine', port: 45123, monitorPid: process.pid },
    { id: 'other1', name: 'Other', root: '/other', port: 45123, monitorPid: process.pid },
  ];
  assert.deepEqual(pinConflict(cfg, instances), { name: 'Other', root: '/other', port: 45123 });
});

test('pinConflict is null when no other live instance holds the pinned port', () => {
  const cfg = { id: 'mine11', monitor: { port: 45123 } };
  const instances = [{ id: 'other1', name: 'Other', root: '/other', port: 9999, monitorPid: process.pid }];
  assert.equal(pinConflict(cfg, instances), null);
});

// A `port` claim outlives the monitor process that made it: nothing ever restamps it the way
// `workersAt` gets restamped, and `ready`'s own periodic writes keep the entry's general liveness
// (`isLive`, via `updatedAt`) fresh forever regardless of whether the monitor that claimed the port
// is still running. So `pinConflict` checks `monitorPid` itself, right now — not the `instances`
// array's own already-computed liveness — or a `doctor` error would become permanent and
// unclearable the moment a monitor exits without a later write ever clearing `port`.
test('pinConflict reports a conflict only for a live monitor pid, not a dead one still on file', () => {
  const cfg = { id: 'mine11', monitor: { port: 45123 } };
  const instances = [{ id: 'other1', name: 'Other', root: '/other', port: 45123, monitorPid: 999999 }];
  assert.deepEqual(pinConflict(cfg, instances, { alive: (pid) => pid === 999999 }),
    { name: 'Other', root: '/other', port: 45123 });
  assert.equal(pinConflict(cfg, instances, { alive: () => false }), null);
});

const closeServer = (server) => new Promise((resolve) => server.close(() => resolve()));
const listenPort0 = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

test('listenOnFreePort steps past a port a real listener holds, and resolves with the port it actually bound', async () => {
  // Bind port 0 first to learn a free port from the OS, then hold THAT as the obstacle — never a
  // number from the 4380 band, which a real orchestra on this machine might be using.
  const obstacle = createServer();
  await listenPort0(obstacle);
  const taken = obstacle.address().port;
  const server = createServer();
  try {
    const bound = await listenOnFreePort(server, { port: taken, pinned: false });
    assert.notEqual(bound, taken);
    assert.equal(server.address().port, bound);
    assert.ok(server.listening);
  } finally {
    await closeServer(server);
    await closeServer(obstacle);
  }
});

test('listenOnFreePort rejects instead of stepping when pinned and the port is taken', async () => {
  const obstacle = createServer();
  await listenPort0(obstacle);
  const taken = obstacle.address().port;
  const server = createServer();
  try {
    await assert.rejects(listenOnFreePort(server, { port: taken, pinned: true }), /monitor\.port/);
  } finally {
    await closeServer(server);
    await closeServer(obstacle);
  }
});
