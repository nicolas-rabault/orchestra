// One journal line, with a timestamp that was MEASURED.
//
//   orchestra journal <kind> <task|-> "<text>"
//
// The 2026-08-12/14 journal was written by hand, one `printf` at a time, and it shows: 75% of its
// 165 timestamps end in :00 or :30, and 29 lines are out of chronological order against the file's
// own append order — a conductor writing the clock from memory rather than reading it. The known
// "+2h Paris local, still suffixed Z" defect is a symptom of that, not a separate bug. The cost
// landed on the retrospective that tried to use the file afterwards: question latency could not be
// measured from the journal at all, and had to be reconstructed from tick.log and inbox.jsonl.
//
// Four lines of that same file (117, 123-125) are also truncated mid-JSON, missing their closing
// brace — two conductors appending at once, which `lib/register/tick.mjs`'s gate now prevents and
// which this file survives anyway: the append is one write of one complete line, and a file that
// does not end in a newline gets one before the next line rather than being glued to it.
import { join } from 'node:path';
import { appendLine } from '../jsonl.mjs';
import { orchestraDir } from '../paths.mjs';

export const journalPath = (root) => join(orchestraDir(root), 'journal.jsonl');

// The page reads these by name and shows nothing else. An unknown kind is refused rather than
// written: a line the monitor cannot place is a line the user never sees, which is worse than an
// error, because it looks like it worked.
// `ruling` is a decision the conductor took INSTEAD of asking — see the skill's framing pass. It
// carries the question, the choice, the reason and the precedent, and the morning digest leads with
// them, so that deciding alone stays visible rather than becoming quiet.
export const KINDS = ['launch', 'question', 'answer', 'report', 'landing', 'note', 'tick', 'ruling'];

// Exactly four keys, in the order the skill documents them. `task` is null for a line about the
// tick itself — the CLI spells that `-`, because an empty shell argument is too easy to pass by
// accident.
export function line({ kind, task, text, now = new Date() }) {
  if (!KINDS.includes(kind)) throw new Error(`unknown kind "${kind}" — one of ${KINDS.join(', ')}`);
  if (typeof text !== 'string' || !text.trim()) throw new Error('a journal line needs text');
  return JSON.stringify({ ts: now.toISOString(), kind, task: task || null, text });
}

export const append = (root, entry) => appendLine(journalPath(root), line(entry));
