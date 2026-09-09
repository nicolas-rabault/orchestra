// The hand-over's own two pieces of English, and the note it brings back.
//
// A retirement is worth doing only if the replacement can pick the work up cheaply — the whole
// arithmetic in ./cost.mjs is `prefix` against `boot + re-acquisition`, and the note IS the
// re-acquisition. A vague note makes the replacement re-read the branch to find out where it is,
// which is the cost the hand-over was meant to avoid; simulated over 122 real sessions, a
// re-acquisition of 30 k saves 36 % of all tokens read and one of 150 k saves 7.6 %. So the wrap-up
// asks for the note in a fixed shape, and asks for it in the same turn as the commit.
//
// The plugin's own English, like `nudgeFor`'s (./drive.mjs): a wrap-up typed by a conductor is a
// wrap-up that comes out differently every time, and the note's shape is what the saving rests on.
export const WRAP_UP = `Your conductor is retiring this session to drop its accumulated context. The work stays; you do not.
Two things, in this one turn, and then stop:
1. COMMIT everything in your tree. Nothing uncommitted survives this.
2. Make your FINAL MESSAGE a hand-over note for the session that replaces you, in at most 15 lines,
   under these four headings exactly:
   DONE: what is committed and finished, one line each.
   NEXT: the immediate next step, concretely — the file and what to do in it.
   FILES: the paths that matter, and for each one what it is for. Name the ones already correct, so
     your replacement does not re-read them.
   TRAPS: what you learned the hard way — a failing command, a wrong assumption, a thing that looks
     right and is not.
Do NOT summarise your reasoning, do not restate the task, and do not re-run the tests: your
replacement reads your note and the branch, not your transcript. The shorter and more specific this
note is, the less your replacement has to re-read to continue — that is the entire point of
retiring you.`;

// The note, taken off the wrap-up turn's own log.
//
// The log holds the whole turn's output and the note is its FINAL MESSAGE, so the note is found by
// its own first heading rather than by taking the tail: a tail of fixed length either cuts the note
// or drags in the tool output above it, and both were measured being written onto a row.
//
// Returns null when no heading is there at all — a turn that was refused, or that ignored the shape.
// Null is what stops a retirement: a hand-over with no note is the expensive kind.
export function noteFrom(log) {
  const at = String(log ?? '').search(/^\s*DONE:/m);
  if (at < 0) return null;
  const note = String(log).slice(at).trim();
  return note.length ? note : null;
}
