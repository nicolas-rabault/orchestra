// What a session actually costs, measured — not estimated from its turn count.
//
// The protocol's retirement rule used to open with "this plugin ships no tool that measures a
// session's token use ... the turn count is therefore the only signal a conductor has here". That
// was true of the plugin and never true of the machine: Claude Code writes every request's own
// usage into the session transcript, so the number was on disk all along, one file per session,
// named by the session uuid the register already stores.
//
// WHY THE PREFIX IS THE NUMBER THAT MATTERS. A session's context only grows, and every request
// re-reads the whole of it, so the cost of a session is not its length but the INTEGRAL of its
// prefix over its length. Measured 2026-09-09 across duckJam's 122 worker sessions: a worker boots
// at 34.4 k, grows 1.18 k per request, and ends at 253 k median (707 k worst) — 4.17 billion tokens
// read to produce 30.7 million written. Cutting a session in two and paying a fresh boot plus a
// re-acquisition is cheaper than carrying the prefix, past a point this file's `retireVerdict`
// decides and `docs/` records the simulation for.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Where Claude Code keeps its transcripts. `CLAUDE_CONFIG_DIR` moves the whole config directory and
// is honoured here for the same reason `gitEnv` strips `GIT_*`: a caller that has moved its config
// must not be measured against a directory it stopped writing to.
export const transcriptRoot = (env = process.env) =>
  join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');

// A transcript is `<project dir>/<session uuid>.jsonl`, and it is found BY THE UUID, never by
// encoding the project's path into a directory name. The encoding rule (every `/` and `.` in the
// absolute path becomes `-`) is Claude Code's own internal layout, and a worker's transcript lives
// under its WORKTREE's encoding rather than the project's, so a plugin that derived the directory
// would have to reproduce both facts and would break silently the day either changed. One readdir
// over the project directories costs nothing and depends on neither.
export function findTranscript(session, { env = process.env } = {}) {
  if (!session || !/^[0-9a-f-]{8,}$/i.test(session)) return null;
  const root = transcriptRoot(env);
  if (!existsSync(root)) return null;
  let dirs;
  try { dirs = readdirSync(root); } catch { return null; }
  for (const d of dirs) {
    const p = join(root, d, `${session}.jsonl`);
    if (existsSync(p)) return p;
  }
  return null;
}

// The four numbers, off one pass.
//
// `prefix` is the LAST request's input — what this session now costs to make one more request, and
// the number every decision below is made on. `boot` is its FIRST, which is what a REPLACEMENT
// session would pay before it has read anything: the floor `retireVerdict` protects itself with.
//
// Lines are filtered by `indexOf` before they are parsed. That is not micro-optimisation: the
// largest transcript on this machine is 28 MB and about a tenth of its lines carry a usage block, so
// parsing every line would cost the tick a second per worker to reach the same four numbers.
export function measure(text) {
  let requests = 0;
  let boot = null;
  let prefix = 0;
  let read = 0;
  let output = 0;
  for (const line of text.split('\n')) {
    if (line.indexOf('"usage"') < 0) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e?.type !== 'assistant') continue;
    const u = e.message?.usage;
    if (!u) continue;
    const total = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    // A request that read nothing at all is not a request this measurement can see — a streamed
    // continuation, or a record written before the usage block was complete.
    if (!total) continue;
    requests += 1;
    if (boot === null) boot = total;
    prefix = total;
    read += total;
    output += u.output_tokens ?? 0;
  }
  return requests ? { requests, boot, prefix, read, output } : null;
}

// The measurement for one session, or null when there is no transcript to read — a session on
// another machine, one whose transcript has been cleaned up, or a uuid that was never a session.
// Null is a first-class answer everywhere below: NOT MEASURED must never read as NOT GROWN.
export function sessionCost(session, { env = process.env } = {}) {
  const path = findTranscript(session, { env });
  if (!path) return null;
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return null; }
  const m = measure(text);
  if (!m) return null;
  let bytes = 0;
  try { bytes = statSync(path).size; } catch { /* the size is a courtesy, not the measurement */ }
  return { ...m, session, path, bytes };
}

// ---- the retirement rule ----------------------------------------------------------------------
//
// Retire when the prefix has grown past `retireAt`, AND past twice this session's OWN boot, AND the
// session has run at least `minRequests` since it started.
//
// **`retireAt` = 200 k, chosen by simulation over the 122 real sessions** (docs/specs carries the
// table). Replaying each one under this rule, cutting whenever it fired and paying a fresh boot plus
// a re-acquisition R, 200 k saves 36 % of all tokens read at R = 30 k, 31 % at 60 k, 21 % at 100 k
// and 7.6 % at 150 k. It is the lowest round threshold that is POSITIVE at every R simulated: 150 k
// saves more when a hand-over is cheap (45.7 % at R = 30 k) and goes negative when it is not.
//
// **TWICE ITS OWN BOOT is the guard that makes this safe, and it is not a belt-and-braces rule.**
// Without it, a threshold below `boot + R` means a replacement session is born ALREADY OVER the
// line and is retired again on its next request, for ever: simulated at R = 150 k and a 100 k
// threshold, that is 141 cuts per session and 160 % MORE tokens read than doing nothing at all. The
// floor closes it without needing to know R, because a session's own boot IS `boot + R` for the
// replacement of an expensive hand-over — so an expensive hand-over automatically raises the bar for
// the next one, and the same rule that fires too eagerly corrects itself. Same simulation, floor on:
// −17 % and 1.4 cuts, bad but bounded, and no runaway anywhere in the sweep.
//
// **`minRequests` = 20** stops the other waste the simulation showed: 11 % of sessions cross 200 k
// with fewer than 20 requests left to run, and a hand-over they pay for is never recouped.
export const RETIRE_AT = 200_000;
export const FLOOR_MULTIPLE = 2;
export const MIN_REQUESTS = 20;

// `row` is the register row; `cost` is `sessionCost`'s answer for its session, or null.
//
// Every refusal names itself, because this is read by a conductor deciding whether to act and
// "no" without a reason is what makes a tool get overridden by hand. Ordered by decisiveness, not
// by cost: they are all field reads.
export function retireVerdict(row, cost, { retireAt = RETIRE_AT, terminal = new Set(), driving = new Set() } = {}) {
  if (!row?.session) return { ok: false, reason: 'no-session' };
  if (terminal.has(row.status)) return { ok: false, reason: 'terminal' };
  // A turn is running in that session right now. Stopping it mid-turn loses the work of the turn,
  // and the prefix it is measured at is already out of date.
  if (driving.has(row.id)) return { ok: false, reason: 'driving' };
  // A row mid-question is a row whose worker is holding a thread the user is about to pull. The
  // answer is relayed to THAT session, and a replacement would have to be told what it asked.
  if (row.pending?.length) return { ok: false, reason: 'asked' };
  if (row.status === 'review') return { ok: false, reason: 'waiting-on-the-gate' };
  if (!cost) return { ok: false, reason: 'unmeasured' };

  const floor = FLOOR_MULTIPLE * cost.boot;
  const at = Math.max(retireAt, floor);
  if (cost.requests < MIN_REQUESTS) return { ok: false, reason: 'young', ...cost, at };
  if (cost.prefix <= at) {
    return { ok: false, reason: floor > retireAt ? 'below-its-own-floor' : 'below', ...cost, at };
  }
  return { ok: true, reason: 'grown', ...cost, at, floor };
}

// The whole live fleet, measured once: one row per non-terminal task that has a session, carrying
// its measurement and its verdict. `ready` prints the rows that fire; `orchestra cost` prints them
// all, which is the only way a human can see WHY a row is not firing.
//
// One implementation for both, so the line a conductor acts on and the table it checks can never
// disagree about the same session.
export function fleetCost(tasks, { retireAt = RETIRE_AT, terminal = new Set(), driving = new Set(), env = process.env, measureOne = sessionCost } = {}) {
  const rows = [];
  for (const t of tasks ?? []) {
    if (terminal.has(t.status)) continue;
    if (!t.session) continue;
    const cost = measureOne(t.session, { env });
    rows.push({
      id: t.id, status: t.status, session: t.session, sessionName: t.sessionName ?? null,
      cost, verdict: retireVerdict(t, cost, { retireAt, terminal, driving }),
    });
  }
  // Dearest first: a conductor that retires one row a tick should retire the one that costs most.
  rows.sort((a, b) => (b.cost?.prefix ?? -1) - (a.cost?.prefix ?? -1));
  return rows;
}

export const k = (n) => `${Math.round(n / 1000)}k`;

// The line `ready` prints, and the reason it is worth a conductor's turn: what this session now
// costs per request, and what a replacement would cost instead.
export const retireLine = (r) => `RETIRE: ${r.id} [${r.status}] — ${r.cost.requests} requests, prefix ${k(r.cost.prefix)}`
  + ` (booted ${k(r.cost.boot)}, threshold ${k(r.verdict.at)}), ${k(r.cost.read)} read so far.`
  + ` Every further request re-reads ${k(r.cost.prefix)}; a replacement on the same worktree starts near ${k(r.cost.boot)}.`
  + ` Run \`orchestra retire ${r.id}\`.`;
