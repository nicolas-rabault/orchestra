// One writer at a time, across processes, for the ticket ledger — and for anything else a project
// keeps beside it.
//
// Ported from planetCraft's `tools/tickets.mjs` (2026-09-04, at 869 lines); what travelled and
// what stayed behind is docs/plans/2026-09-04-p5-hooks-init-tickets-heartbeat.md, scope answer 7.
//
// Every write to the ledger is a read-modify-write of the WHOLE file, and the ledger has no single
// writer: `orchestra tickets add` shares the file with `orchestra land`, which commits it as one of
// the project's configured `ledgers` at the head of every landing (`lib/gate/land.mjs`'s
// `commitLedgers`). Two writers loading the same ten tickets and each writing back eleven loses
// one, with no error and no trace.
//
// A torn read is already loud — `loadTickets` (`./ledger.mjs`) throws on a half-written line. The
// lost update is the silent one, and it is what this closes.
//
// `mkdir` is the mutex, for the reason `lib/gate/land.mjs`'s own mutex uses it: it is atomic on
// every filesystem here and needs no dependency. Keyed on the DIRECTORY the caller's file lives in,
// not the file itself, so two tracked files a project keeps in one directory are taken together —
// a lock per file would let another process slip in between two writes meant to land as one.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LOCK_DIR = '.queue.lock';
const LOCK_POLL_MS = 50;
// 30 seconds. Generous for what this guards — a handful of file writes, and from `commitLedgers`
// one `git add` plus one `git commit` — but the deadline itself is the point, not its length: a
// lock that waited forever would turn a stuck ticket write into a stuck landing with nothing in
// the log (spec §9), and throwing here is what keeps that failure visible instead of silent.
export const LOCK_WAIT_MS = 30_000;

// `process.kill(pid, 0)` sends no signal; it only asks whether the process is there.
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const holderPid = (dir) => {
  try { return Number(readFileSync(join(dir, 'pid'), 'utf8')) || null; } catch { return null; }
};
// Atomics.wait rather than a spin: a caller running from its own event loop (a hook, a heartbeat
// tick) must not burn a core while the holder does its own work.
const sleepMs = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/**
 * Run `fn` with the exclusive lock on the directory `file` lives in, waiting (via `Atomics.wait`,
 * never a busy spin) for up to `waitMs` if somebody else holds it, and breaking a holder whose pid
 * is no longer alive without waiting for it at all.
 *
 * Throws, rather than waiting forever, when a LIVE holder is still there at the deadline — a
 * filing that failed can be retried, a ticket silently overwritten by a lost update cannot.
 * `waitMs` is a seam for tests, which have to prove what happens at the deadline without spending
 * it; nothing in production should pass it.
 */
export function withQueueLock(file, fn, { waitMs = LOCK_WAIT_MS } = {}) {
  const dir = join(dirname(file), LOCK_DIR);
  mkdirSync(dirname(file), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try { mkdirSync(dir); break; } catch { /* somebody holds it */ }
    const pid = holderPid(dir);
    // A holder that is gone cannot finish. Breaking a DEAD holder's lock is free; breaking a live
    // one's would reintroduce exactly the lost update this exists to stop.
    if (pid && !alive(pid)) { rmSync(dir, { recursive: true, force: true }); continue; }
    if (Date.now() < deadline) { sleepMs(LOCK_POLL_MS); continue; }
    // No pid after all that: the holder died between its `mkdir` and naming itself — a window of
    // microseconds, but a permanent deadlock for every later run if nobody clears it.
    if (!pid) { rmSync(dir, { recursive: true, force: true }); continue; }
    throw new Error(`tickets: ${file} is held by pid ${pid}, still running after `
      + `${waitMs}ms — not writing over a queue somebody else is editing`);
  }
  // Named after taking it, not before: the name is what lets the NEXT process tell a live holder
  // from a dead one.
  try { writeFileSync(join(dir, 'pid'), String(process.pid)); return fn(); } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
