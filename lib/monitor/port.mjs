// Binding the monitor's port. One page serves this machine, so there is no allocation question left
// here — `lib/machine.mjs` decides WHICH port (4380, or `monitorPort` in machine.json) and this
// module only binds it, stepping upward when something else already holds it.

// Binds `server` — made by the CALLER, never opened here — starting at `port`, stepping upward on
// `EADDRINUSE` up to `tries` attempts, and resolves with the port it actually bound. There is no
// pinned mode any more: the one caller (`lib/monitor/server.mjs`) always wants the step-upward
// behaviour, because the machine-wide port has nothing left to pin against — `monitor.port`, the
// config key that used to force a refusal instead of a step, is gone. The probe IS the real bind:
// never a throwaway socket opened to test a port and closed before the real `listen`, which is a
// window another process can take between the close and the real call (measured 2026-08-12 in
// planetCraft as a `curl` hang from the same confusion between "is a page there" — `lsof` — and "is
// this port free" — a real `bind`).
//
// `server.listen()` reports failure on the `error` EVENT, never as a throw, so this attaches one
// `error` listener and one `listening` listener for the whole retry loop and removes both together
// the instant either settles the promise — never per attempt, which would leave a stale listener
// from an earlier failed attempt still registered when a later one succeeds. The same `server` is
// reused across every attempt; a second `.listen()` call after an `error` event is exactly how Node
// expects a server to be retried, so no second socket is ever opened.
export function listenOnFreePort(server, { port, host = '127.0.0.1', tries = 100 } = {}) {
  return new Promise((resolve, reject) => {
    let current = port;
    let attempts = 0;
    const cleanup = () => {
      server.removeListener('error', onError);
      server.removeListener('listening', onListening);
    };
    function onError(err) {
      if (err.code !== 'EADDRINUSE') { cleanup(); reject(err); return; }
      attempts += 1;
      if (attempts >= tries) {
        cleanup();
        reject(new Error(`orchestra: the monitor found no free port in ${tries} attempt(s) starting at ${port}`));
        return;
      }
      current += 1;
      server.listen(current, host);
    }
    // `server.address().port`, not `current`: the port it ACTUALLY bound (§3) — the two agree in
    // the ordinary case, but resolving the OS's own answer makes that a fact instead of an
    // assumption about how `current` was tracked.
    function onListening() { cleanup(); resolve(server.address().port); }
    server.on('error', onError);
    server.on('listening', onListening);
    server.listen(current, host);
  });
}
