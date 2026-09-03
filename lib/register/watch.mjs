// The wake-up an interactive conductor never had.
//
// `orchestra watch-answers <session-uuid>`, armed by the conductor itself as a persistent Monitor at
// the top of its first tick. Every line it prints is delivered to that session as an event, whatever
// the session is doing — including sitting idle waiting for the user. Measured in this harness
// 2026-08-13: one second from the file changing to the event arriving.
//
// WHY THIS FILE EXISTS AT ALL. Delivering an answer was wired to CREATE a conductor rather than to
// REACH the live one: every answer posted on the page spawned a fresh headless tick, which followed
// the skill correctly — "if conductor.session is not you, you are a replacement: record yourself" —
// and took the baton from the session the user was actually talking in. Six identities did that in
// half an hour on 2026-08-13. The standing belief that made it look harmless is in
// `monitor/server.mjs`'s own comment: that nothing a process can do reaches inside a live
// interactive session to wake it. That is true of pushing from outside, and false of the session
// watching from inside, which is this loop.
//
// It does two jobs on one timer, deliberately. The beat is what lets everything else STOP
// manufacturing conductors (`beat.mjs`), and the announcement is what makes the live one act in
// seconds instead of at the next five-hourly cron. Two timers would be two things to get wrong, and
// the loop's liveness IS the session's liveness only if the same loop writes both.
import { BEAT_EVERY_MS, writeBeat } from './beat.mjs';
import { readState } from './state.mjs';
import { inboxPath, readJsonl, unconsumed } from './inbox.mjs';

const ANSWER_CAP = 120;

// An answer's identity. The page writes full millisecond precision on purpose, so the stamp alone is
// already unique in practice; the item it answers is added because that is what makes two answers to
// two questions written in the same millisecond two announcements rather than one.
export const keyOf = (e) => `${e?.ts ?? ''}|${e?.pending ?? ''}`;

// At most this many lines per round. Every line is a notification, and a harness that considers a
// monitor too chatty stops it outright — which would take the wake-up away silently, the one failure
// this file may not have. Human-typed answers never approach it; a register rewritten in a way that
// makes the whole inbox look unread would, and that is the case this cap is for.
export const MAX_PER_ROUND = 10;

const oneLine = (s) => {
  const flat = String(s ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > ANSWER_CAP ? `${flat.slice(0, ANSWER_CAP)}…` : flat;
};

// One line per answer, written for someone who will read it as a notification and then go and run
// the ordinary inbox read. It names what was answered, not what to do about it: `relay.mjs` owns
// that text and there must not be a second copy of it here to rot.
export const lineFor = (e) => `ANSWER ${e.task ?? 'no task'} · ${e.pending ?? 'a free remark'} · ${e.ts} — "${oneLine(e.answer)}"`;

// The unconsumed answers this loop has not already announced. `unconsumed` is imported rather than
// re-derived so the loop and the relay cannot come to disagree about what "unread" means.
export function newAnnouncements(entries, state, announced, now = Date.now()) {
  return unconsumed(entries, state, now).filter((e) => !announced.has(keyOf(e)));
}

// A round that cannot read the register announces NOTHING and forgets nothing. This is not defensive
// tidiness: with no register, `unconsumed` compares every stamp against an empty cursor and every
// entry in the file comes back unread, so a register caught mid-write would announce the entire
// inbox in one round. Silence costs one period; the flood costs the watch itself.
export function round(repo, announced, { now = Date.now(), emit = console.log } = {}) {
  let state;
  try { state = readState(repo); } catch { return 0; }
  if (!state) return 0;
  const { entries } = readJsonl(inboxPath(repo));
  let fresh;
  try { fresh = newAnnouncements(entries, state, announced, now); } catch { return 0; }
  for (const e of fresh.slice(0, MAX_PER_ROUND)) {
    announced.add(keyOf(e));
    emit(lineFor(e));
  }
  // The overflow is added to the set WITHOUT being announced, because the next round would announce
  // it as new and the cap would never actually bound anything. The tick's own inbox read carries
  // them: the wake-up's job is to make the conductor read, not to be the reading.
  for (const e of fresh.slice(MAX_PER_ROUND)) announced.add(keyOf(e));
  return Math.min(fresh.length, MAX_PER_ROUND);
}

// The first round announces nothing and simply remembers what is already there. The tick that arms
// this watch reads the inbox itself, in that same tick, at its own step 4 — so announcing the
// backlog here would fire the session for answers it is in the middle of relaying. What this leaves
// uncovered is the tick that dies before relaying them, and that is not this loop's to catch: it
// dies with the session too, and there is no level-triggered net under it in this plugin to relay
// them instead.
export function seed(repo, announced, now = Date.now()) {
  round(repo, announced, { now, emit: () => {} });
  return announced;
}

// Armed by the conductor itself as a persistent watch at the top of its first tick. It never
// returns: the interval is the point.
export function watch(root, session, { emit = console.log } = {}) {
  const announced = new Set();
  seed(root, announced);
  const tick = () => {
    // The beat first and unconditionally: a register this loop cannot read must not also cost the
    // machine its only evidence that a conductor is alive.
    try { writeBeat(root, { session }); } catch { /* a beat that cannot be written is reported by its own staleness */ }
    try { round(root, announced, { emit }); } catch { /* a round that throws is one missed period, never a dead watch */ }
  };
  tick();
  setInterval(tick, BEAT_EVERY_MS);
}
