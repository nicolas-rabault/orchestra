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
  const relaunch = [];
  for (const t of tasks) {
    if (TERMINAL.has(t.status)) continue;
    const owed = relayOwed(t);
    const base = { id: t.id, status: t.status, session: t.session ?? null, sessionName: t.sessionName ?? null };
    // No session: nothing to DRIVE, but a row past `todo` with none is a row whose branch exists
    // and whose worker does not — it needs relaunching, and NOTHING ANYWHERE REPORTED IT. Proved on
    // 2026-09-09 against `reconcileTasks` and `computeReadySet` both: a `claimed` row with a live
    // branch, a live worktree and `session: null` appeared in `ready`, in `blocked` and in all
    // three obligations as nothing at all. The skill has always told the conductor to relaunch such
    // a row at its launch step; the row it was to notice was invisible. Any worker killed by hand,
    // by a reboot or by `claude stop` leaves one — and so, deliberately, does `orchestra retire`,
    // which is what makes a retirement finish through the launch path that already exists rather
    // than through a second one written beside it.
    //
    // `todo` is excluded and is the whole of the exclusion: a `todo` row has never been launched,
    // and `computeReadySet` already schedules it.
    if (!t.session) {
      if (owed) undelivered.push({ ...base, writtenAt: t.relay.writtenAt ?? null, ageMin: ageMin(t.relay.writtenAt, now) });
      if (t.status !== 'todo') relaunch.push({ ...base, note: t.note ?? null, turns: t.turns ?? null, retiredAt: t.retiredAt ?? null });
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
  return { idle, undelivered, driving, relaunch };
}

// The plugin's own English, not the conductor's prose: everything the worker must HEAR from the
// conductor travels as `relay.text` on the row, in the project's language, and this frame is the
// tool's. There is deliberately no other way to put words in a resume — a nudge typed at the
// command line leaves no trace on the row, which is exactly the shape that lost three relays.
// The frame every resume carries, and the second sentence is the expensive one it used to be missing.
//
// Measured 2026-09-08 in duckJam: 6 of 28 driven turns produced no commit at all. Each had finished
// its work on the previous turn and was waiting only for the gate, and each read "continue your
// task", rebased, and replayed the whole suite to find out what it already knew — DW7 9 min 48,
// PV2 5 min, DW4 4 min 46, plus CD5, CG5, ET9. They say so themselves in `.orchestra/drive-*.out`:
// "Rien à committer", "Ce tour n'a fait que le rebase et la vérification". Every dead hour upstream
// of them was therefore paid for twice, once in waiting and once in re-verifying.
//
// A row that only waits on the gate is not something `obligations` can identify — status `review`
// is already excluded there, and a `claimed` row whose worker has quietly finished looks exactly
// like one mid-way through. The worker itself is the one actor that knows, so it is told, in one
// sentence, what to do with that knowledge.
const CONTINUE = 'continue your task in this worktree. Commit what is already in your tree first; your previous '
  + 'turn may have been cut at the ceiling. If there is nothing to commit because your work is already '
  + 'committed and reported, do NOT rebase and do NOT re-run the barrier — that costs a full suite to '
  + 'learn what your last report already said; answer in one line that you are waiting on the gate, and '
  + 'stop. When you stop, your final message is your report to the '
  + 'conductor: status, a question, or a done-report.';

export const nudgeFor = (row) => (relayOwed(row)
  ? `${row.relay.text.trim()}\n\n(From your conductor: act on the message above, then ${CONTINUE})`
  : `${CONTINUE[0].toUpperCase()}${CONTINUE.slice(1)}`);

// The three faces of a resume that executed nothing, measured 2026-08-25 in planetCraft and
// 2026-09-08 in duckJam, each with exit 0 or a plausible one-liner where a report should be. A turn
// that printed one of these did not receive its relay, so no receipt is written for it.
//
// THE BUDGET PATTERN IS A SHAPE, NOT A LIST OF WORDINGS, and it was a list until it cost a run.
// `hit your (?:session|usage) limit` was written from the two wordings that had been seen; duckJam's
// 2026-09-06 tick log carries a third, `You've hit your individual spend limit · run /usage-credits
// to ask your admin for a higher limit · your session limit resets 1:40pm (Europe/Paris)`, twice, and
// it matched nothing — a refused turn read as one that had produced a report. What every wording
// shares is `hit your <a word or three> limit`, so that is what this asks. Over-matching costs a
// turn read as refused when it was not, which is the same cost as re-driving it; under-matching
// costs a report that was never written being believed.
const REFUSALS = [
  ['budget', /[^\n]*hit your (?:[A-Za-z]+ ){0,3}limit[^\n]*/i],
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

// ---- when the ceiling lifts ---------------------------------------------------------------------
//
// Every budget refusal states its own reset time, in the reader's local wall clock and with the zone
// named: `… resets 8:40pm (Europe/Paris)`, `… your session limit resets 1:40pm (Europe/Paris)`. That
// is a KNOWN instant, and until it was read nothing did anything with it: on 2026-09-06 in duckJam
// the 11:13 tick was refused with a reset 27 minutes away and the 12:13 tick burned an opus session
// re-earning the identical refusal, because `budgetResetAt` — the field `decideTick` has read since
// 2026-08-13 — is written by a conductor and a refused tick has no conductor to write it.
//
// Bounded on both sides, and deliberately asymmetric. A reset in the past or unparseable writes
// nothing, so a tick runs; a reset further ahead than MAX_RESET_AHEAD_MS writes nothing either. The
// two errors do not cost the same: a needless tick costs one slot, and a stand-down computed from a
// misread clock costs every slot until it expires. Twelve hours clears every reset measured (27 min,
// 5 h) by more than double and still refuses a day-long silence taken off a garbled line.
export const MAX_RESET_AHEAD_MS = 12 * 60 * 60 * 1000;

// `resets 1:40pm (Europe/Paris)`, `resets at 14:00`, `resets 2am`. The zone is optional in the
// grammar and always present in practice; when it is missing this machine's own is the honest
// reading, because the message was rendered for the person sitting at it.
const RESET = /\bresets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)?(?:\s*\(([^)\n]{1,64})\))?/i;

// What a wall clock in `zone` reads at instant `ms`. `hour12: false` renders midnight as `24` in
// some ICU builds, which is the same instant said differently and must not become hour 24.
function zoneParts(zone, ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
}

// The instant at which `zone`'s wall clock reads the given date and time. Solved rather than looked
// up: Intl exposes no offset table, but it will render any instant into any zone, so one guess and
// two corrections converge — the second correction is what handles a guess that landed on the far
// side of a DST change from its own answer.
function zonedToUtc({ y, mo, d, h, mi }, zone) {
  const want = Date.UTC(y, mo - 1, d, h, mi);
  let guess = want;
  for (let i = 0; i < 2; i += 1) {
    const seen = zoneParts(zone, guess);
    const diff = want - Date.UTC(seen.y, seen.mo - 1, seen.d, seen.h, seen.mi);
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

// The absolute instant a refusal's stated reset names, or null when the message carries none this
// function is willing to act on.
export function refusalResetAt(output, { now = Date.now() } = {}) {
  const m = RESET.exec(String(output ?? ''));
  if (!m) return null;
  const meridiem = m[3]?.toLowerCase() ?? null;
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  let hour = Number(m[1]);
  // A 12-hour clock's `12am` is hour 0 and its `12pm` is hour 12; a 24-hour clock's hours stand.
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = meridiem === 'pm' ? (hour % 12) + 12 : hour % 12;
  } else if (hour > 23) return null;
  if (minute > 59) return null;

  const zone = m[4] ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  let today;
  try {
    today = zoneParts(zone, now);
  } catch {
    // An unknown zone name is a message this cannot read, not a reason to guess in another one.
    return null;
  }
  let at = zonedToUtc({ ...today, h: hour, mi: minute }, zone);
  // A reset earlier in the day than now is tomorrow's: the clock is a time of day, not a date.
  if (at <= now) {
    const tomorrow = zoneParts(zone, now + 24 * 60 * 60 * 1000);
    at = zonedToUtc({ ...tomorrow, h: hour, mi: minute }, zone);
  }
  if (!(at > now) || at - now > MAX_RESET_AHEAD_MS) return null;
  return new Date(at).toISOString();
}
