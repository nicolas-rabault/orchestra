// Whether this heartbeat should conduct a tick at all, and whether it should hold the machine
// awake while it does. One decision, taken in JavaScript rather than in the shell, because the
// shell half of the heartbeat is the half no test can reach — and every failure this file exists
// to prevent was a heartbeat that ran when it should not have, or did not run when it should.
//
// Measured on the 2026-08-12/14 roadmap, in planetCraft (`docs/orchestra-retrospective.md`):
//   - two conductors ran side by side twice on 08-14, one of them double-running merge_agent on
//     the same branch; the journal recorded 21 landings for 16 rows. P4's monitoring page already
//     refuses to spawn a tick when a conductor is alive; the heartbeat (P5) fired directly and
//     checked nothing. This is that same guard, at the door that was missing it.
//   - the 08-13 08:09 tick burned a scheduled slot on a refusal the 07:22 session limit had
//     already made certain, three hours before the reset.
//   - eight heartbeat slots of 1h23 to 3h26 were missed to macOS sleep, ~6h in a 46h roadmap.
//     Nobody was ever going to remember to run `caffeinate`, so the tick holds the machine awake
//     itself, for exactly as long as there is work.
import { readFileSync } from 'node:fs';
import { conductorState } from './beat.mjs';
import { inboxPath, readJsonl, unconsumed } from './inbox.mjs';
import { statePath } from './state.mjs';
import { TERMINAL } from './archive.mjs';

// The one line the shell reads. Its FIRST word is the verb (`run` or `skip`); `hold-awake` appears
// when the register still holds work. A line rather than JSON because the consumer is /bin/sh, and
// a shell that has to parse JSON is a shell that will one day parse it wrong.
//
// `register` is the parsed state.json, or the string 'absent' (no such file — orchestra was never
// adopted here) or 'unreadable' (it exists and could not be parsed). Those two are NOT the same
// case and must not be collapsed: the register is rewritten in place, so an unreadable read is
// most likely a mid-write and the tick must still run; an absent one is a machine where nobody has
// ever typed /orchestra, and firing an opus session at it every hour buys nothing.
export function decideTick({ conductor = null, register = 'absent', unconsumedAnswers = 0, now = Date.now() } = {}) {
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

  const { budgetResetAt = null, tasks = [] } = register ?? {};
  const reset = Date.parse(budgetResetAt ?? '');
  // `!(now >= reset)` rather than `now < reset` so an unreadable stamp falls through to running.
  // A budget note nobody can parse must not become a heartbeat nobody can fire.
  if (Number.isFinite(reset) && !(now >= reset)) return `skip budget resets ${budgetResetAt}`;

  // EVERY reason the tick still has something to do, before the stand-down below can fire. This
  // list is the safety net, and each entry is a way orchestra could otherwise go permanently deaf:
  //
  //   - an answer waiting in the inbox: P4's monitoring page spawns a tick from its own reply
  //     button, so a gate that stood down on a finished roadmap would swallow the reply the user
  //     just typed, in silence. This is the one that matters most.
  //   - a pending item on any row, whatever that row's status: it is a question already put.
  //   - an undelivered relay: a worker is owed a message nobody has handed it (the eight-hour
  //     failure this whole increment family exists to prevent).
  //   - any row not yet landed or dropped: there is work in flight.
  //
  // The conductor rule above does not shortcut any of them and must not be read as a fifth entry in
  // this list. It only lifts a VETO that sits over the whole file; what to do once it is lifted is
  // still decided here, so a beating-but-idle conductor over a finished roadmap stands down exactly
  // as an absent one does — taking the baton back is not a reason to invent work.
  if (unconsumedAnswers > 0) return `run${took}`;
  const holdAwake = tasks.some((t) => !TERMINAL.has(t.status));
  const questionsOpen = tasks.some((t) => (t.pending ?? []).some((p) => p?.answer == null));
  const relayOwed = tasks.some((t) => !TERMINAL.has(t.status) && t.relay?.text && !t.relay.deliveredAt);
  if (holdAwake || questionsOpen || relayOwed) return `${holdAwake ? 'run hold-awake' : 'run'}${took}`;

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
export function gateLine(root, { now = Date.now() } = {}) {
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
  return decideTick({ conductor, register, unconsumedAnswers, now });
}
