// Whether somebody is already reading, before this session decides it must act — the one question
// this file answers.
//
// It exists because the reader is what dies, never the worker: a register can go on naming a
// conductor for hours after that conductor is gone, and finding out the slow way costs whatever
// rots in the meantime while nobody is watching for it. `conductor.session` did exactly that for
// half an hour on 2026-08-13, and the residual gap this file used to leave open — a conductor that
// beats without acting — cost thirteen more hours and four uncollected workers on 2026-08-17/18;
// both are measured again at `yieldVerdict` itself, below.
//
// THE FAST PATH IS `beat.mjs`/`watch.mjs`, AND THIS FILE IS NOT IT. A conductor arms a two-second
// watch that hands it each answer as an event and writes the beat while it lives, so the page stops
// spawning a rival tick per answer and the live session is reached in seconds. That is the fix;
// `yieldVerdict` is what is left once it is in place — the guard the ENTRY POINTS still need,
// because the fast path only helps a conductor that is already running, and every entry point still
// has to decide what to do when one already is.
//
// It is not the ONLY guard: the interactive tick also takes a conductor lock (`lock.mjs`), a second,
// independent defence — this file answers "is anybody already reading", the lock answers "can two
// writers land on the register at once", and an entry point takes both.
import { existsSync, readFileSync } from 'node:fs';
import { append, journalPath } from './journal.mjs';
import { conductorState } from './beat.mjs';

// Exit code, not output, is the channel here: a shell reads a code reliably and a string only by
// grepping. 10 means FOUND what it looks for — a live conductor already holding the baton.
// Everything else, a crash included, means "nothing to do", which is the safe direction: the guard
// stays quiet, the tick proceeds.
export const FOUND_EXIT = 10;

// One line per handback, and never the same line twice in a row: `yieldVerdict` can be asked
// whether to hand back on every tick while one conductor holds the baton for hours, and the page
// shows a history, not a heartbeat.
function journalOnce(root, kind, text) {
  const path = journalPath(root);
  if (existsSync(path)) {
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
    try { if (JSON.parse(lines[lines.length - 1])?.text === text) return false; } catch { /* an unparsable tail is not a duplicate */ }
  }
  // Millisecond precision here, not the second-precision stamp this file used to write by hand:
  // `journal.line` (./journal.mjs) is the one clock this plugin's journal uses, and letting this
  // function keep its own would reopen exactly the defect that clock exists to end.
  append(root, { kind, task: null, text });
  return true;
}

// English, unlike everything else written into `.orchestra/` — this is a committed tool's log
// message, not the conductor's prose, and the plugin's own English-only rule covers it (the
// project's `language` governs what the conductor writes, not what this tool does).
const handback = (beat) => `Tick handed back without acting: the session beating at ${String(beat.session).slice(0, 8)} (pid ${beat.pid}) is a live conductor and has the baton.`;

const act = (why) => ({ yield: false, why, held: null });

// Below eight characters it is not an identity: a truncated or garbled beat would prefix-match an
// arbitrary session, and here the consequence points the wrong way — the caller would read the beat
// as its OWN and go on to conduct beside whoever wrote it.
const SHORT_ID_LEN = 8;
const isSelf = (beat, selfSession) => typeof beat.session === 'string' && beat.session.length >= SHORT_ID_LEN
  && typeof selfSession === 'string' && selfSession.startsWith(beat.session);

// The check the ENTRY POINTS need, which P4's monitoring page already makes for itself: nothing
// starts a tick beside a live conductor. It is no longer the only such check and must not be read as
// one — `./tick.mjs`'s `gateLine` stands the heartbeat (P5) down for a live conductor as its first
// rule, off this same beat. The entry point with nothing else on it is the interactive `/orchestra`,
// at step 0. On the heartbeat's path (P5) this is instead the last-moment repeat of a decision taken
// much earlier, and the only one of the two that leaves a line in the journal the monitoring page
// reads.
//
// The evidence is `beat.mjs`'s and there is deliberately no second opinion here. An earlier version
// of this file had its own `liveConductor`, built on `claude agents --json` plus the age of
// state.json, because nothing better existed when it was written. The beat is strictly better and
// two rivals would be worse than either: it is written every two seconds by the very loop whose
// existence IS the conductor's ability to be reached, so it answers "will this answer be read"
// rather than "does a session with that id exist". It also costs one file read and a signal-0
// against 2.2 s of subprocess.
//
// NO FALLBACK TO THE REGISTER, and that is the point rather than an omission: `conductor.session`
// named a dead conductor for half an hour on 2026-08-13 while three answers rotted in it. No beat
// means no baton, which is exactly what P4's monitoring page already concludes.
//
// THE RESIDUAL GAP THIS FILE USED TO NAME AND LEAVE OPEN — "a conductor that beats and does not act;
// the beat says it can be reached, so every tick hands back, and nothing bounds that" — is closed
// here, by `conductorState` rather than by a rule of this file's own. It cost thirteen hours and four
// uncollected workers on 2026-08-17/18 before it was, and `./tick.mjs` lifts the same veto off the
// same call: a gate that let a tick through while this one still handed it back would be no fix at
// all, since the heartbeat (P5) runs both on the way to one `claude`.
export function yieldVerdict({ root, selfSession = process.env.CODEX_THREAD_ID ?? process.env.CLAUDE_CODE_SESSION_ID, now = Date.now(), alive }) {
  const beat = conductorState(root, alive ? { now, alive } : { now });
  if (!beat) return act('no live conductor beat: nobody is holding the baton');
  if (isSelf(beat, selfSession)) return act('the live beat is my own');
  if (!beat.conducting) return act(`the session beating at ${String(beat.session).slice(0, 8)} (pid ${beat.pid}) has not conducted for ${Math.round(beat.silentFor / 60000)} min: the baton is loose`);

  journalOnce(root, 'tick', handback(beat));
  return { yield: true, why: `handing back to the session beating at ${String(beat.session).slice(0, 8)} (pid ${beat.pid})`, held: beat };
}
