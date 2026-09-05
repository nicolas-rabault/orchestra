// `orchestra monitor` and `orchestra instances`: the page's own command, and the machine-wide
// answer to "what else is running here".
//
// This file owns everything the page needs that is not serving it: the registry write, the
// keepalive, the refuse-and-point, and the browser launch. `lib/monitor/server.mjs` owns none of
// them, which is what keeps its own header true — it reads files, serves a model, appends one line
// — and what lets a test build a handler, or bind a server, without touching the developer's
// machine registry or opening a window on their screen.
import { spawn } from 'node:child_process';
import { liveInstances, readMonitor, recordMonitor } from '../machine.mjs';
import { pidAlive } from '../register/beat.mjs';
import { listServers } from '../monitor/sources.mjs';
import { serve } from '../monitor/server.mjs';
import { discoverProjects } from '../monitor/discover.mjs';

const out = (s) => process.stdout.write(`${s}\n`);
const pad = (s, n) => String(s).padEnd(n);

// The record is rewritten at this cadence for as long as the page is open, so it keeps itself
// listed even if `~/.orchestra/monitor.json` is lost or hand-edited away while the page still runs
// — the same self-reporting reasoning P4's per-project registry used, adapted to the one
// machine-wide record. Five minutes is twelve rewrites an hour of one small JSON file, cheap next
// to `orchestra ready`'s own per-tick rewrite of the neighbouring instances.json.
const REFRESH_MS = 5 * 60 * 1000;

// One page per MACHINE, which is what replaced P4's one page per project. Both legs and neither
// alone, unchanged in reasoning from that rule: a recycled pid names some other process entirely,
// and an unrelated process can be sitting on the recorded port. `lsof` answers "is a page there";
// it is never asked "is this port free", which only a real bind can answer. When lsof cannot answer
// at all, nothing is known, so nothing is refused and the bind decides — and unlike P4, a second
// page then binding one port along is harmless, because there is one record to overwrite rather
// than a per-project port left flapping between two numbers.
function pageAlreadyUp() {
  const rec = readMonitor();
  if (!rec || !pidAlive(rec.pid)) return null;
  const probe = listServers([rec.port]);
  if (!probe.ok || !probe.list.some((s) => s.port === rec.port)) return null;
  return rec;
}

// darwin has `open`, everything else this runs on has `xdg-open`. A browser that cannot be started
// is not a reason to fail: this command prints the URL either way and the page is there. It lives
// here and not in `lib/monitor/server.mjs` for two reasons — that module's header promises it reads
// files, serves a model and appends one line, which would be false the moment it spawned anything;
// and a `serve` that opened a browser by default would open one on the developer's screen for any
// in-process caller that forgot to say otherwise.
function openBrowser(url) {
  const child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
  // spawn's own ENOENT arrives asynchronously as this event — no try/catch can see it — and on a
  // headless machine with neither opener installed that is the ordinary case, not an incident.
  child.on('error', () => out(`could not open a browser — the page is at ${url}`));
  child.unref();
}

export async function monitorCommand({ args }) {
  // FIRST, before anything is read or decided. `--no-open` is the only flag this command takes:
  // there is deliberately no `--port`, because the port has exactly one source of truth,
  // `monitorPort` in `~/.orchestra/machine.json`, and a flag would be a second one — the first
  // thing it would break is the registry's promise that the recorded port is where the page is.
  // Anything else is refused rather than ignored, and refused HERE rather than after the
  // refuse-and-point below, or `orchestra monitor --prot` with the page already up would print
  // "already open", exit 0, and never mention the argument it did not understand.
  const unknown = args.filter((a) => a !== '--no-open');
  if (unknown.length)
    throw new Error(`orchestra monitor: unknown argument ${unknown[0]} — the only flag is --no-open, and the port is monitorPort in ~/.orchestra/machine.json`);

  const already = pageAlreadyUp();
  if (already) {
    // A second monitor is a normal thing to try, and its stop is a sentence rather than a stack
    // trace or a second port. `already.pid`, not a per-project `monitorPid`: this record is the
    // machine-level one `readMonitor` returns, which never carries that field.
    out(`the orchestra page is already open at http://127.0.0.1:${already.port} (pid ${already.pid})`);
    out('one page for this machine — open that one, or stop it first');
    return;
  }

  const { port, url } = await serve({ cwd: process.cwd() });

  // AFTER the bind, with the port actually bound — never the intended one.
  recordMonitor({ port, pid: process.pid });
  const keepalive = setInterval(() => recordMonitor({ port, pid: process.pid }), REFRESH_MS);
  // The listening socket is what keeps this process alive; the keepalive must never be the thing
  // that does, or a server that somehow closed would leave a timer ticking on an empty process.
  keepalive.unref();

  const set = discoverProjects({ cwd: process.cwd() });
  out('orchestra monitor');
  out(`  ${url}`);
  out(`  ${set.length} project${set.length === 1 ? '' : 's'}: ${set.map((p) => p.name).join(', ') || 'none yet'}`);
  // Last, so the URL is on screen before a browser is asked for.
  if (!args.includes('--no-open')) openBrowser(url);
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

// Spec §8.2 names both as the registry entry's content and `orchestra instances` as what prints
// it — a conductor session id beside a worker count is what turns "which page is which" into
// "which conductor is which". Both are legitimately null whenever no `watch-answers` loop is
// armed (`orchestra ready` typed by hand, or a tick before the loop starts), so a dash prints
// rather than an empty column — a blank cell reads as a bug, a dash reads as "nobody's watching".
// The session is truncated to 8 characters, the same length the protocol's own resume line uses
// (`claude stop <session>`, `lib/monitor/model.mjs`), to keep one already-wide row readable.
const sessionWords = (e) => (e.conductorSession ? String(e.conductorSession).slice(0, 8) : '—');

const beatWords = (beatAt, now) => {
  if (!beatAt) return '—';
  const t = Date.parse(beatAt);
  if (!Number.isFinite(t)) return '—';
  const minutes = Math.round((now - t) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
};

export function instancesCommand() {
  const now = Date.now();
  const rec = readMonitor();
  const probe = listServers(rec ? [rec.port] : []);
  const page = !rec ? 'no page is open — run `orchestra monitor`'
    : !probe.ok ? `http://127.0.0.1:${rec.port} (cannot tell whether it is listening)`
    : probe.list.some((s) => s.port === rec.port) ? `http://127.0.0.1:${rec.port}`
    : `http://127.0.0.1:${rec.port} — recorded, but nothing is listening there`;
  out(`page: ${page}`);

  const live = liveInstances({ now });
  if (!live.length) {
    out('no orchestra project has reported itself on this machine — run `orchestra ready` or `orchestra monitor` in one');
    return;
  }
  for (const e of live) {
    out(`${pad(e.name, 16)} ${pad(e.id, 7)} ${pad(e.mode, 8)} ${pad(workerWords(e), 15)} ${pad(sessionWords(e), 10)} ${pad(beatWords(e.beatAt, now), 10)} ${pad(sinceWords(e.updatedAt, now), 15)} ${e.root}`);
  }
}
