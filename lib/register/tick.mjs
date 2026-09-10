// Whether this heartbeat should conduct a tick at all, and whether it should hold the machine
// awake while it does. One decision, taken in JavaScript rather than in the shell, because the
// shell half of the heartbeat is the half no test can reach — and every failure this file exists
// to prevent was a heartbeat that ran when it should not have, or did not run when it should.
//
// Measured on the 2026-08-12/14 roadmap, in planetCraft (`docs/orchestra-retrospective.md`):
//   - two conductors ran side by side twice on 08-14, one of them double-running merge_agent on
//     the same branch; the journal recorded 21 landings for 16 rows. The heartbeat (P5) fired
//     directly and checked nothing. This is that guard, at the door that was missing it.
//   - the 08-13 08:09 tick burned a scheduled slot on a refusal the 07:22 session limit had
//     already made certain, three hours before the reset.
//   - eight heartbeat slots of 1h23 to 3h26 were missed to macOS sleep, ~6h in a 46h roadmap.
//     Nobody was ever going to remember to run `caffeinate`, so the tick holds the machine awake
//     itself, for exactly as long as there is work.
import { readFileSync } from 'node:fs';
import { conductorState } from './beat.mjs';
import { inboxPath, readJsonl, unconsumed } from './inbox.mjs';
import { isAskedOf } from './pending.mjs';
import { statePath } from './state.mjs';
import { TERMINAL } from './archive.mjs';
import { relayOwed, turnRefusal, refusalResetAt } from './drive.mjs';

// The one line the shell reads. Its FIRST word is the verb (`run` or `skip`); `hold-awake` appears
// when the register still holds work. A line rather than JSON because the consumer is /bin/sh, and
// a shell that has to parse JSON is a shell that will one day parse it wrong.
//
// `register` is the parsed state.json, or the string 'absent' (no such file — orchestra was never
// adopted here) or 'unreadable' (it exists and could not be parsed). Those two are NOT the same
// case and must not be collapsed: the register is rewritten in place, so an unreadable read is
// most likely a mid-write and the tick must still run; an absent one is a machine where nobody has
// ever typed /orchestra, and firing an opus session at it every hour buys nothing.
export function decideTick({ conductor = null, register = 'absent', unconsumedAnswers = 0, now = Date.now(), runtime = 'claude' } = {}) {
  // Order matters, and this one is first for a reason: the cost of a second conductor is corruption
  // (two writers on one register), while the cost of a late tick is only lateness.
  //
  // `conducting`, not merely live, and that distinction is the fifth exception to the stand-down
  // below. The beat proves a session can be REACHED; it is written by a loop armed for the whole
  // session, so a window left open and untouched beats for ever and this rule used to silence the
  // heartbeat permanently. `conductorState` carries the second fact and beat.mjs holds the evidence.
  if (conductor?.conducting) return `skip a conductor is live (${conductor.session ?? 'unnamed'}, pid ${conductor.pid ?? '?'})`;
  // Named on every line the gate produces from here down, because the heartbeat's own log (P5) is
  // the only place this decision is ever seen, and "the heartbeat took the baton back" must never
  // look like an ordinary slot. It carries no `hold-awake`: the shell matches that word anywhere in
  // the line.
  const took = conductor
    ? ` — took the baton back from ${conductor.session ?? 'unnamed'} (pid ${conductor.pid ?? '?'}), beating but silent for ${Math.round(conductor.silentFor / 60000)} min`
    : '';
  // A register nobody can read is not a register that says stop. Run, and let the tick sort it out.
  if (register === 'unreadable') return `run${took}`;
  if (register === 'absent') return 'skip no register — orchestra has not been adopted here';

  const ownerRuntime = register?.conductor?.runtime ?? 'claude';
  if (runtime !== ownerRuntime) return `skip ${ownerRuntime} conductor — use its native heartbeat`;

  const { budgetResetAt = null, tasks = [], runAsks = [], runAnswered = [] } = register ?? {};
  const reset = Date.parse(budgetResetAt ?? '');
  // `!(now >= reset)` rather than `now < reset` so an unreadable stamp falls through to running.
  // A budget note nobody can parse must not become a heartbeat nobody can fire.
  if ((register.budgetRuntime ?? 'claude') === runtime && Number.isFinite(reset) && !(now >= reset)) return `skip budget resets ${budgetResetAt}`;

  // EVERY reason the tick still has something to do, before the stand-down below can fire. This
  // list is the safety net, and each entry is a way orchestra could otherwise go permanently deaf:
  //
  //   - an answer waiting in the inbox: P4's monitoring page starts no tick — it answers `awake`
  //     or `no-conductor` and spawns nothing, deliberately (`lib/monitor/server.mjs`) — so this
  //     gate is the ONLY thing standing between a typed answer and a finished roadmap swallowing
  //     it in silence. With no page-side spawn to fall back on, this check is more load-bearing
  //     than it was, not less. This is the one that matters most.
  //   - a pending item on any row, whatever that row's status: it is a question already put.
  //   - an undelivered relay: a worker is owed a message nobody has handed it (the eight-hour
  //     failure this whole increment family exists to prevent).
  //   - any row not yet landed or dropped: there is work in flight.
  //   - an unanswered RUN-LEVEL ask, which is the one question no row can carry: a run ends when
  //     its last row goes terminal, so the end-of-run question the protocol makes obligatory is
  //     put in the very state this gate otherwise stands down for. In planetCraft on 2026-09-02
  //     it was put on a register whose every row had landed, and nothing anywhere could see it
  //     (ticket `t-0antbtb`). This entry turns that silence into a refusal that NAMES the
  //     question it is waiting for.
  //
  // The conductor rule above does not shortcut any of them and must not be read as a fifth entry in
  // this list. It only lifts a VETO that sits over the whole file; what to do once it is lifted is
  // still decided here, so a beating-but-idle conductor over a finished roadmap stands down exactly
  // as an absent one does — taking the baton back is not a reason to invent work.
  if (unconsumedAnswers > 0) return `run${took}`;
  const holdAwake = tasks.some((t) => !TERMINAL.has(t.status));
  const questionsOpen = tasks.some(isAskedOf);
  // `relayOwed` is ./drive.mjs's, the same predicate `ready` and `drive` read: a relay stamped
  // delivered by hand, with no receipt from the turn that carried it, still holds the tick up.
  const owed = tasks.some((t) => !TERMINAL.has(t.status) && relayOwed(t));
  // `runAnswered` is authority over `runAsks`, exactly as it is on the page: the register is
  // rewritten whole at every tick, so an ask already retired and still listed must not keep the
  // heartbeat awake for ever. An ask with no id of its own cannot be matched here — this gate does
  // not hash — and stays open, which is the safe direction: the tick runs and the conductor looks.
  const retired = new Set(runAnswered.map((a) => a?.id).filter(Boolean));
  const runOpen = runAsks.filter((a) => a?.answer == null && !(a?.id && retired.has(a.id)));
  if (holdAwake || questionsOpen || owed || runOpen.length) {
    // The reason is ADDED to the line and never put in place of `hold-awake`: callers match that
    // word anywhere, and a run-level question is not work in flight. Naming the ids is the point — a
    // tick that will not tidy the run away has to say who it is still waiting for, or the refusal is
    // the same silence in a different shape.
    const why = runOpen.length
      ? ` — ${runOpen.length} run-level question(s) waiting on you: ${runOpen.map((a) => a?.id ?? '(unnamed)').join(', ')}`
      : '';
    return `${holdAwake ? 'run hold-awake' : 'run'}${took}${why}`;
  }

  // Nothing in flight, nothing asked, nothing owed, nothing answered. The roadmap is finished (or
  // was never started), and an hourly opus session that reads a register full of `landed` rows and
  // exits costs real budget for nothing — the account ceiling was hit twice during the roadmap this
  // came from, freezing everything for 2h48. Waking back up costs one `/orchestra`, which writes
  // todo rows and makes this return `run` again on the very next slot.
  return `skip nothing to do — ${tasks.length} row(s), all landed or dropped`;
}

// What `main()` used to do: read the beat, tell `absent` from `unreadable`, count unconsumed
// answers, and hand all three to `decideTick`. `root` arrives from the caller's config instead of
// being walked up from `import.meta.url`.
export function gateLine(root, { now = Date.now(), runtime = process.env.ORCHESTRA_RUNTIME ?? 'claude' } = {}) {
  const conductor = conductorState(root, { now });

  // 'absent' and 'unreadable' are told apart by the error code, not guessed: ENOENT is a machine
  // where orchestra was never adopted, anything else is a file that exists and did not parse —
  // most likely caught mid-write, since the register is rewritten in place.
  //
  // Read directly here rather than through `readState` (./state.mjs) — the deliberate exception to
  // this plugin's one-reader rule. `readState`'s own catch block cannot make this distinction: its
  // `existsSync` pre-check handles the ORDINARY absent case, but is a separate syscall from the
  // `readFileSync` that follows it, so a file removed in that gap still surfaces there as a generic
  // "did not parse" — the one caller that must tell ENOENT from a parse failure reads the error
  // code itself instead, in one syscall with no gap to race.
  let register;
  try {
    register = JSON.parse(readFileSync(statePath(root), 'utf8'));
  } catch (e) {
    register = e?.code === 'ENOENT' ? 'absent' : 'unreadable';
  }

  // The inbox is read with the SAME `unconsumed` the answer watch and the relay use, rather than
  // re-derived here: three definitions of "unread" would eventually disagree, and the one that
  // disagreed would silently drop a user's answer.
  let unconsumedAnswers = 0;
  if (typeof register === 'object') {
    try {
      const { entries } = readJsonl(inboxPath(root));
      unconsumedAnswers = unconsumed(entries, register).length;
    } catch {
      // Cannot tell whether an answer is waiting → assume one is. Standing down here is the only
      // failure mode of this gate that loses something a user typed.
      unconsumedAnswers = 1;
    }
  }
  return decideTick({ conductor, register, unconsumedAnswers, now, runtime });
}

// ---- what came back ------------------------------------------------------------------------------
//
// The other half of the gate, and it did not exist until 2026-09-09. Everything above decides whether
// to SPEND a slot; this reads what the slot bought, because a tick that is refused by the account
// ceiling buys nothing and, until now, said so to nobody.
//
// Measured 2026-09-06 in duckJam. The 11:13 and 12:13 ticks both passed the gate, both correctly saw
// the baton loose, and both died on `You've hit your individual spend limit · … your session limit
// resets 1:40pm (Europe/Paris)`. That single line in `tick.log` was the entire record: `budgetResetAt`
// stayed null, so the 12:13 slot re-earned the identical refusal an hour later; `journal.jsonl` took
// no line, so the monitoring page showed a healthy system; and nobody conducted, over a baton the tick
// had been right to want. Six of the run's twenty-nine dead hours are that shape.
//
// TWO WITNESSES, AND NEITHER ALONE. The refusal must be the LAST thing the session printed, and the
// register must not have moved since the tick started. Each on its own is wrong in a way this log
// proves: a tick that conducts writes the register at step 8 unconditionally, but it also writes prose
// — `tick.log` already holds a conductor's own summary of three refused slots, quoting the ceiling's
// wording verbatim, and a text match alone would have read that working tick as refused and stood the
// heartbeat down on the strength of it. A refused `claude -p` prints the notice and stops, so the
// notice is its last line and its register is untouched.
//
// The direction of the remaining error is chosen: an unrecognised refusal costs one slot, and a
// working tick misread as refused costs every slot until the reset it invented.
export function tickOutcome({ output = '', conducted = true, now = Date.now() } = {}) {
  if (conducted) return null;
  const lastLine = String(output).split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
  const refused = turnRefusal(lastLine);
  if (!refused) return null;
  const [kind] = refused.split(':');
  const resetAt = kind === 'budget' ? refusalResetAt(lastLine, { now }) : null;
  return {
    kind,
    refused,
    resetAt,
    // English, like every other line this plugin writes into a log of its own — the project's
    // `language` governs the conductor's prose, not the tool's.
    text: `Tick refused before it conducted anything (${refused}).`
      + (kind !== 'budget' ? ''
        : resetAt ? ` The next slot stands down until ${resetAt}.`
          : ' The message names no reset time this could read, so the next slot runs.'),
  };
}

// ---- the slot after a ceiling -----------------------------------------------------------------
//
// `budgetResetAt` is a KNOWN instant, and the gate above only knows how to stand a slot down until
// it passes — the hourly grid then decides when "after" is. Measured 2026-09-06 in duckJam: the
// ceiling reopened at 08:10Z and the first worker commit landed at 12:00. Most of that is constat 1
// (the 09:13 slot was refused the lock by a conductor that had stopped conducting) and is fixed
// elsewhere; what is left is the grid's own rounding, up to fifty-nine minutes of a window that has
// just opened.
//
// So a slot skipped on budget arms ONE wake at the reset. Best effort in the strongest sense: the
// wake is a detached `sleep` started by `tick.sh`, and if the machine sleeps, the job's process group
// is torn down, or the shell simply loses it, nothing is broken — the hourly grid is still there and
// still fires, which is exactly the behaviour this replaces. It can only ever make the resumption
// earlier.
//
// `armedFor` is the instant a wake is already armed for, so an hour of skipped slots arms one wake
// rather than a queue of them. Comparing the INSTANT rather than counting: the same reset restated
// by a later slot is the same wake, and a reset that moved is a different one and deserves its own.
export const WAKE_MARGIN_MS = 30_000;

export function tickWake({ gate = '', armedFor = null, now = Date.now() } = {}) {
  const m = /^skip budget resets (\S+)/.exec(String(gate));
  if (!m) return null;
  const at = Date.parse(m[1]);
  if (!Number.isFinite(at) || at <= now) return null;
  if (armedFor === m[1]) return null;
  // Thirty seconds past the reset, not on it: the woken tick re-reads the same gate, and `decideTick`
  // stands down again for `now < reset`. Landing on the wrong side of that comparison would spend the
  // wake on the refusal it exists to skip.
  return { at: m[1], seconds: Math.ceil((at - now + WAKE_MARGIN_MS) / 1000) };
}
