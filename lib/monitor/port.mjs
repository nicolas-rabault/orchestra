// Which port a project's monitor binds, and the registry conflict a pinned one can cause.
//
// This module answers "which port", never "what serves it": `listenOnFreePort` binds a `server`
// the CALLER already made. It creates no server of its own and imports no `node:http` — the
// monitor itself does not exist yet, and this module's subject stays the port, not the page.

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

// A pinned port already held by another LIVE registered instance — the one thing `doctor` treats
// as an error rather than a warning (§8.3): a pinned port that is taken refuses to start rather
// than silently moving, so someone who chose a stable, hand-picked URL is not served by finding it
// moved. `instances` is whatever the caller already read (`liveInstances()` in `lib/machine.mjs`)
// — a reaped or otherwise dead entry is already gone from it, so a pin that collides only with a
// stale one is not a conflict. `"auto"` is never in conflict, by construction: the candidate is a
// pure function of this project's own id, so nothing else can be pinned to exactly the same one on
// purpose and steal it out from under it.
export function pinConflict(cfg, instances) {
  if (cfg.monitor.port === 'auto') return null;
  const other = instances.find((e) => e.id !== cfg.id && e.port === cfg.monitor.port);
  return other ? { name: other.name, root: other.root, port: other.port } : null;
}

// Binds `server` — made by the CALLER, never opened here — starting at `port`, stepping upward on
// `EADDRINUSE` unless `pinned`, up to `tries` attempts, and resolves with the port it actually
// bound. The probe IS the real bind: never a throwaway socket opened to test a port and closed
// before the real `listen`, which is a window another process can take between the close and the
// real call (measured 2026-08-12 in the project this was extracted from as a `curl` hang from the
// same confusion between "is a page there" — `lsof` — and "is this port free" — a real `bind`).
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
    function onListening() { cleanup(); resolve(current); }
    server.on('error', onError);
    server.on('listening', onListening);
    server.listen(current, host);
  });
}
