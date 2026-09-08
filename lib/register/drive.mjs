// What a tick owes its workers — decided here, on paper, and read by three things that must never
// disagree about it: `orchestra ready` prints it, `orchestra drive` resolves it, and the
// conductor's worker watch (./watchWorkers.mjs) wakes the conductor over it.
//
// Measured 2026-09-08 in duckJam, the morning this file was written for: a conductor read the
// reports of an eleven-worker wave, spent its turn on other things, and ended it. Six `orchestra-*`
// sessions sat `idle`, four more had been stopped and never resumed, ten rows read `claimed`, and
// two relays written at 06:52Z and 07:13Z sat undelivered until the user asked why nothing moved.
// Nothing in the plugin named any of it: `tick-gate` stood down for the live conductor, `ready`
// printed the two `UNDELIVERED:` lines and nothing about the ten stopped workers, and `deliveredAt`
// was a field the conductor typed by hand, so writing a relay and delivering it were told apart by
// nobody. The two `UNDELIVERED:` lines were printed for three hours and not acted on — which is why
// naming an obligation is only the first third of this: `drive` makes resolving it one command, and
// the watch makes an idle conductor hear about it.
//
// A worker is STOPPED when no turn of its session is running anywhere: not `busy` in `claude agents
// --json`, no `claude -p --resume <uuid>` in the process table, and no driven turn on record whose
// process is alive. A `--bg` worker stops at the end of every turn and never restarts itself, so
// "stopped" is the ordinary state of a worker between two nudges — and a row that is stopped, not
// terminal, and not waiting on the USER is a row the conductor owes a turn. Waiting on the user is
// an open `pending[]` item or a `review` row; a relay owed to the worker overrides both, because a
// row can owe the user an answer and owe its worker a message at the same time (dev-loop/S3, eight
// hours, 2026-08-13 in planetCraft — the case `undeliveredRelays` used to carry).
import { TERMINAL } from './archive.mjs';
import { isAskedOf } from './pending.mjs';

// A relay WRITTEN onto a row is delivered only once a driven turn has carried its text and returned:
// `deliveredAt` alone is a stamp anybody can type, and on 2026-09-08 it was, over three rows whose
// workers were then resumed with a generic nudge — one came back asking, word for word, the question
// the user had already answered. The receipt is written by the turn that carried the text (`--turn`
// in lib/cli/drive.mjs), after it returned, and by nothing else.
export const relayOwed = (row) => Boolean(row?.relay?.text) && !(row.relay.deliveredAt && row.relay.receipt);

// The row's id, lowercased, one dash per run of non-alphanumerics — the same slug that names the
// worker's session (`orchestra-<project id>-<slug>`) and its worktree, so a `ls .orchestra/drive/`
// reads like `claude agents`.
export const driveSlug = (id) => String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-');

// How long a turn record may carry a null pid and still read as starting: `drive` writes the record
// before it forks and stamps the child's pid milliseconds later. Thirty seconds is the same margin
// the merge gate gives its own seed (`lib/gate/state.mjs`'s PRE_FORK_GRACE_SEC), for the same reason.
export const PRE_FORK_GRACE_MS = 30_000;

// What one driven turn's record says about its process. The recorded exit wins over liveness in both
// directions, as the gate's `runVerdict` reasons: a finished turn whose pid was recycled must not read
// as alive, and one that recorded its code microseconds before dying must not read as vanished.
export function turnVerdict(turn, { alive, now = Date.now() }) {
  if (typeof turn.exit === 'number') return 'ended';
  if (turn.pid === null) return now - Date.parse(turn.startedAt ?? '') < PRE_FORK_GRACE_MS ? 'running' : 'vanished';
  return alive(turn.pid) ? 'running' : 'vanished';
}

// Why a turn is running, or null when nothing is. Three witnesses, cheapest reading first; each one
// alone misses a real case — the agent list knows nothing about a `-p --resume` process, the process
// table cannot tell a background session's idle from its busy, and a driven turn's record is the
// only one that survives the process that wrote it.
function running(row, liveness, now) {
  if (liveness.registered.get(row.session)?.status === 'busy') return { why: 'busy in the agent list' };
  if (liveness.resuming.has(row.session)) return { why: 'a resume process is running' };
  const turn = liveness.turns.get(row.id);
  if (turn && turn.session === row.session && turnVerdict(turn, { alive: liveness.alive, now }) === 'running')
    return { why: `driven turn pid ${turn.pid ?? 'starting'}`, turn };
  return null;
}

const ageMin = (iso, now) => { const at = Date.parse(iso ?? ''); return Number.isFinite(at) ? Math.round((now - at) / 60_000) : null; };

// `liveness` is what `gatherLiveness` (./liveness.mjs) returns: `registered` (session uuid -> the
// `claude agents --json` entry), `resuming` (session uuids with a `--resume` process in the table),
// `turns` (row id -> the latest driven turn on record) and `alive` (pid -> bool). Injected rather
// than gathered, so this stays decidable with no process behind it.
export function obligations(tasks, liveness, { now = Date.now() } = {}) {
  const idle = [];
  const undelivered = [];
  const driving = [];
  for (const t of tasks) {
    if (TERMINAL.has(t.status)) continue;
    const owed = relayOwed(t);
    const base = { id: t.id, status: t.status, session: t.session ?? null, sessionName: t.sessionName ?? null };
    // No session: nothing to drive. A relay on such a row is for the relaunch brief, and it is
    // reported so it is not forgotten there.
    if (!t.session) {
      if (owed) undelivered.push({ ...base, writtenAt: t.relay.writtenAt ?? null, ageMin: ageMin(t.relay.writtenAt, now) });
      continue;
    }
    const busy = running(t, liveness, now);
    if (busy) { driving.push({ ...base, why: busy.why, turn: busy.turn ?? null, relayInFlight: owed }); continue; }
    const registered = liveness.registered.get(t.session) ?? null;
    const last = liveness.turns.get(t.id);
    const turn = last && last.session === t.session
      ? { ...last, verdict: turnVerdict(last, { alive: liveness.alive, now }) } : null;
    if (owed) { undelivered.push({ ...base, writtenAt: t.relay.writtenAt ?? null, ageMin: ageMin(t.relay.writtenAt, now), registered, turn }); continue; }
    if (isAskedOf(t) || t.status === 'review') continue;
    idle.push({ ...base, registered, turn });
  }
  return { idle, undelivered, driving };
}

// The plugin's own English, not the conductor's prose: everything the worker must HEAR from the
// conductor travels as `relay.text` on the row, in the project's language, and this frame is the
// tool's. There is deliberately no other way to put words in a resume — a nudge typed at the
// command line leaves no trace on the row, which is exactly the shape that lost three relays.
const CONTINUE = 'continue your task in this worktree. Commit what is already in your tree first; your previous '
  + 'turn may have been cut at the ceiling. When you stop, your final message is your report to the '
  + 'conductor: status, a question, or a done-report.';

export const nudgeFor = (row) => (relayOwed(row)
  ? `${row.relay.text.trim()}\n\n(From your conductor: act on the message above, then ${CONTINUE})`
  : `${CONTINUE[0].toUpperCase()}${CONTINUE.slice(1)}`);

// The three faces of a resume that executed nothing, measured 2026-08-25 in planetCraft and
// 2026-09-08 in duckJam, each with exit 0 or a plausible one-liner where a report should be. A turn
// that printed one of these did not receive its relay, so no receipt is written for it.
const REFUSALS = [
  ['budget', /[^\n]*hit your (?:session|usage) limit[^\n]*/i],
  ['auth', /[^\n]*(?:Failed to authenticate|Not logged in)[^\n]*/i],
  ['registered', /[^\n]*is running as a background session[^\n]*/i],
];

export function turnRefusal(output) {
  for (const [kind, re] of REFUSALS) {
    const m = re.exec(output ?? '');
    if (m) return `${kind}: ${m[0].trim()}`;
  }
  return null;
}
