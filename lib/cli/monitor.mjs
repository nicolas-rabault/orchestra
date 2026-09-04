// `orchestra monitor` and `orchestra instances`: the page's own command, and the machine-wide
// answer to "what else is running here".
//
// This file owns everything about `~/.orchestra` that the page needs — the registry write, the
// keepalive, and the refuse-and-point — and `lib/monitor/server.mjs` owns none of it. That split is
// not tidiness: it is what lets a test build a handler in-process without touching the developer's
// own machine registry.
import { liveInstances, recordInstance } from '../machine.mjs';
import { pidAlive } from '../register/beat.mjs';
import { listServers } from '../monitor/sources.mjs';
import { serve } from '../monitor/server.mjs';

const out = (s) => process.stdout.write(`${s}\n`);
const pad = (s, n) => String(s).padEnd(n);

// The registry entry is refreshed at this cadence for as long as the page is open. `isLive`
// deliberately does NOT count `monitorPid` as proof of life — a page left open for days must not
// pin a dead conductor's whole entry, worker count included, alive behind a browser tab — so the
// page keeps itself listed the way every other writer does: by reporting itself. Five minutes is
// far inside `lib/machine.mjs`'s six-hour staleness window and costs one small file rewrite an hour.
const REFRESH_MS = 5 * 60 * 1000;

// Only the fields this writer owns, plus the four every writer sends identically. `recordInstance`
// MERGES, so the worker side of the entry — `workers`, `conductorSession`, `conductorPid`, `beatAt`,
// written by `orchestra ready` — survives untouched. Erasing `workers` here would make every other
// project on this machine read `undefined`, count 0, and launch MORE, which is the one direction
// `lib/machine.mjs`'s header forbids.
const claim = (cfg, port) => ({
  id: cfg.id, name: cfg.name, root: cfg.root, mode: cfg.mode, port, monitorPid: process.pid,
});

// One page per project (plan scope answer 9). Two pages are not wrong, they are confusing, and the
// second one makes the recorded port flap between two numbers — the one field §8.3 asks to be
// trustworthy.
//
// BOTH legs, and neither alone: a recycled pid names some other process entirely, and an unrelated
// process can be sitting on the recorded port. `lsof` answers "is a page there"; it is never asked
// "is this port free", which only a real bind can answer. When lsof cannot answer at all (`ok:
// false` — not installed, or killed by its own timeout), nothing is known, so nothing is refused and
// the bind decides.
function pageAlreadyUp(cfg) {
  const mine = liveInstances().find((e) => e.id === cfg.id);
  if (!mine || !Number.isInteger(mine.port) || !pidAlive(mine.monitorPid)) return null;
  const probe = listServers([mine.port]);
  if (!probe.ok || !probe.list.some((s) => s.port === mine.port)) return null;
  return mine;
}

export async function monitorCommand({ cfg, args }) {
  const already = pageAlreadyUp(cfg);
  if (already) {
    // A second monitor is a normal thing to try, and its stop is a sentence rather than a stack
    // trace or a second port.
    out(`a page for ${cfg.name} is already open at http://127.0.0.1:${already.port} (pid ${already.monitorPid})`);
    out('one page per project — open that one, or stop it first');
    return;
  }

  // `--no-open` is the only flag this command takes. There is deliberately no `--port`: the port has
  // exactly one source of truth, `monitor.port` in the project's config, and a flag would be a
  // second one — the first thing it would break is the registry's promise that the recorded port is
  // where the page is. Anything else is refused rather than ignored, because the flag somebody is
  // most likely to try is exactly the one that does not exist, and silently serving on a different
  // port than they asked for is the confusion this refuses to create.
  const unknown = args.filter((a) => a !== '--no-open');
  if (unknown.length)
    throw new Error(`orchestra monitor: unknown argument ${unknown[0]} — the only flag is --no-open, and the port is monitor.port in .orchestra/config.json`);

  const { port, url } = await serve(cfg, { open: !args.includes('--no-open') });

  // AFTER the bind, with the port actually bound — never the intended one. Writing a port and then
  // binding another is the exact failure §8.3 exists to prevent, and a project that had to probe
  // past a collision is findable only if the recorded number is the true one.
  recordInstance(claim(cfg, port));
  const keepalive = setInterval(() => recordInstance(claim(cfg, port)), REFRESH_MS);
  // The listening socket is what keeps this process alive; the keepalive must never be the thing
  // that does, or a server that somehow closed would leave a timer ticking on an empty process.
  keepalive.unref();

  out(`orchestra monitor — ${cfg.name}`);
  out(`  ${url}`);
  out(`  ${cfg.root}`);
}

const sinceWords = (iso, now) => {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return 'never reported';
  const minutes = Math.round((now - t) / 60_000);
  if (minutes < 1) return 'seen just now';
  if (minutes < 60) return `seen ${minutes} min ago`;
  return `seen ${Math.round(minutes / 60)} h ago`;
};

const workerWords = (e) => (Number.isInteger(e.workers)
  ? `${e.workers} worker${e.workers === 1 ? '' : 's'}`
  : 'workers unknown');

export function instancesCommand() {
  const now = Date.now();
  const live = liveInstances({ now });
  if (!live.length) {
    out('no orchestra project has reported itself on this machine — run `orchestra ready` or `orchestra monitor` in one');
    return;
  }
  // ONE lsof call for every recorded port, never one per row: the same reader the page uses, asked
  // the same question. `ok: false` is this machine saying it cannot tell, which is a third answer
  // and not a quiet "no".
  const probe = listServers(live.map((e) => e.port));
  const listening = new Set(probe.list.map((s) => s.port));
  const state = (e) => {
    if (!Number.isInteger(e.port)) return 'no page yet';
    if (!probe.ok) return 'cannot tell';
    return listening.has(e.port) ? 'listening' : 'no listener';
  };
  for (const e of live) {
    const url = Number.isInteger(e.port) ? `http://127.0.0.1:${e.port}` : '—';
    out(`${pad(e.name, 16)} ${pad(e.id, 7)} ${pad(e.mode, 8)} ${pad(url, 23)} ${pad(state(e), 12)} ${pad(workerWords(e), 15)} ${pad(sinceWords(e.updatedAt, now), 15)} ${e.root}`);
  }
}
