// Which port a project's monitor binds, and the registry conflict a pinned one can cause.
//
// This module answers "which port", never "what serves it": `listenOnFreePort` binds a `server`
// the CALLER already made. It creates no server of its own and imports no `node:http` — that lives
// in `lib/monitor/server.mjs`, beside this file; this module's subject stays the port, not the page.

// `4380 + (parseInt(id, 16) % 100)`: a project keeps the same URL across restarts because the
// candidate is a pure function of its path (via `projectId`), never of the moment it happens to
// start (§8.3). `id` is always six hex from `projectId` (24 bits, safely inside a JS number) —
// asserted here rather than defended against, so a future change to `projectId` that stops
// emitting six hex fails loudly at this line instead of silently handing out `NaN`
// (`parseInt('not-hex', 16)` is `NaN`, and `NaN % 100` is `NaN`).
export function candidatePort(id) {
  if (!/^[0-9a-f]{6}$/.test(id))
    throw new Error(`orchestra: candidatePort expected six hex characters from projectId, got ${JSON.stringify(id)}`);
  return 4380 + (parseInt(id, 16) % 100);
}

// `monitor.port` is `"auto"` (the default) or an integer, already validated by `lib/config.mjs`.
// "auto" resolves to the deterministic candidate; a number pins it.
export function resolvePort(cfg) {
  return cfg.monitor.port === 'auto'
    ? { port: candidatePort(cfg.id), pinned: false }
    : { port: cfg.monitor.port, pinned: true };
}

// EPERM means the pid exists and belongs to somebody else, which is alive for our purposes — the
// same check `lib/machine.mjs`'s own `pidAlive` makes, duplicated here rather than imported so this
// module keeps its own dependency exactly what its header claims: nothing.
const pidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

// A pinned port already held by another LIVE registered instance — the one thing `doctor` treats
// as an error rather than a warning (§8.3): a pinned port that is taken refuses to start rather
// than silently moving, so someone who chose a stable, hand-picked URL is not served by finding it
// moved. `"auto"` is never in conflict, by construction: the candidate is a pure function of this
// project's own id, so nothing else can be pinned to exactly the same one on purpose and steal it
// out from under it.
//
// `instances` is whatever the caller already read (`liveInstances()` in `lib/machine.mjs`), which
// filters on `isLive` — but `isLive` deliberately does NOT look at `monitorPid` (see the comment on
// `isLive` itself), so an entry can stay "live" in that array for as long as `ready` keeps ticking
// (which refreshes `updatedAt` on EVERY write, port write or not) long after the monitor that
// claimed the port has exited. `workers` got its own freshness stamp for exactly this shape of
// problem; `port` gets none — nothing here ever clears it, so it would otherwise survive every
// later `ready` write forever, and `doctor`'s error would become permanent and unclearable without
// hand-editing `~/.orchestra/instances.json`. So this checks `monitorPid` itself, RIGHT NOW,
// instead of trusting the entry's general liveness — symmetric with how `otherWorkers` checks
// `workersAt` instead of trusting it. This is intentionally local to the port question alone: it
// must not become a third liveness leg on `isLive` for the WHOLE entry, which would let an open
// browser tab pin a dead conductor's worker count alive indefinitely — the opposite problem.
export function pinConflict(cfg, instances, { alive = pidAlive } = {}) {
  if (cfg.monitor.port === 'auto') return null;
  const other = instances.find((e) => e.id !== cfg.id && e.port === cfg.monitor.port && alive(e.monitorPid));
  return other ? { name: other.name, root: other.root, port: other.port } : null;
}

// Binds `server` — made by the CALLER, never opened here — starting at `port`, stepping upward on
// `EADDRINUSE` unless `pinned`, up to `tries` attempts, and resolves with the port it actually
// bound. The probe IS the real bind: never a throwaway socket opened to test a port and closed
// before the real `listen`, which is a window another process can take between the close and the
// real call (measured 2026-08-12 in planetCraft as a `curl` hang from the same confusion between
// "is a page there" — `lsof` — and "is this port free" — a real `bind`).
//
// `server.listen()` reports failure on the `error` EVENT, never as a throw, so this attaches one
// `error` listener and one `listening` listener for the whole retry loop and removes both together
// the instant either settles the promise — never per attempt, which would leave a stale listener
// from an earlier failed attempt still registered when a later one succeeds. The same `server` is
// reused across every attempt; a second `.listen()` call after an `error` event is exactly how Node
// expects a server to be retried, so no second socket is ever opened.
export function listenOnFreePort(server, { port, pinned, host = '127.0.0.1', tries = 100 } = {}) {
  return new Promise((resolve, reject) => {
    let current = port;
    let attempts = 0;
    const cleanup = () => {
      server.removeListener('error', onError);
      server.removeListener('listening', onListening);
    };
    function onError(err) {
      if (err.code !== 'EADDRINUSE') { cleanup(); reject(err); return; }
      if (pinned) {
        cleanup();
        reject(new Error(`orchestra: monitor.port ${port} is already in use — free it, or set monitor.port to "auto"`));
        return;
      }
      attempts += 1;
      if (attempts >= tries) {
        cleanup();
        reject(new Error(`orchestra: monitor.port found no free port in ${tries} attempt(s) starting at ${port}`));
        return;
      }
      current += 1;
      server.listen(current, host);
    }
    // `server.address().port`, not `current`: the port it ACTUALLY bound (§8.3) — the two agree in
    // the ordinary case, but resolving the OS's own answer makes that a fact instead of an
    // assumption about how `current` was tracked.
    function onListening() { cleanup(); resolve(server.address().port); }
    server.on('error', onError);
    server.on('listening', onListening);
    server.listen(current, host);
  });
}
