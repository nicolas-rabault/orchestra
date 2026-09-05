// lib/monitor/port.mjs: binding the monitor's port. One page serves this machine now, so the only
// question left here is stepping upward when something else already holds the port —
// `candidatePort`, `resolvePort` and `pinConflict` answered the per-project allocation question and
// are gone with it (see lib/machine.mjs and lib/cli/monitor.mjs for what replaced them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { listenOnFreePort } from '../lib/monitor/port.mjs';

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
