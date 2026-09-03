// Enroling a published roadmap's tasks in the orchestra register, from the process that publishes
// it — because a task with no register row is a task orchestra will never even consider.
//
// THE HOLE THIS CLOSES, and it had been open since the register existed. In planetCraft, the
// project this protocol comes from, `.orchestra/state.json` has exactly three writers:
// `tools/roadmap/register.mjs` (edits ONE existing row at a landing), `tools/orchestra/archive.mjs`
// (drops prose from terminal rows) — and the conductor, an LLM, rewriting the whole file by hand.
// NOTHING has ever CREATED a row. The only instruction that says to create any is the orchestra
// skill's "Adoption" section, and its own first line is "first run, or state lost": it builds the
// table from the board ONCE and then records `adopted: true`. So a roadmap published after that
// moment reaches GitHub, reaches the board, and reaches nothing else. Its
// `tools/orchestra/ready.mjs` schedules off the register — this plugin's own scheduler, a later
// phase, will read the same column — so the whole programme looks idle while every one of its
// tasks is ready to start.
//
// In planetCraft, measured three times, each caught by a human reading the board and hand-patched
// row by row: 22 tasks on 2026-08-19, 15 on 2026-08-25, 28 on 2026-09-02 (share/R1–R5,
// menage/Z1–Z17, lodinvisible/LV1–LV6). Every one of those roadmaps was published from that
// machine, which is what makes `publish` the right door: it is the one process that always knows
// a roadmap has just become schedulable, exactly as planetCraft's `tools/merge-queue.mjs` is the
// one process that always knows which commits it just put on main (see register.mjs, the same
// argument one level down).
//
// Pure on purpose, and for the same reason as register.mjs: the caller owns reading and writing
// the file — which matters more here than there, since the conductor is otherwise the register's
// only writer and this must be provably append-only. An existing row is returned UNTOUCHED, by
// identity, so re-publishing a roadmap can never overwrite a conductor's note, session or
// subjects.
import { registerRow, FOREIGN } from '../register/state.mjs';

export function enrol(state, tasks, { at, host, foreign = () => false }) {
  const rows = Array.isArray(state?.tasks) ? state.tasks : [];
  const known = new Set(rows.map((r) => r?.id));
  const added = [];
  const appended = [];
  for (const task of tasks) {
    // A task with no key is a roadmap with no `roadmap:` frontmatter and no `Roadmap` field —
    // `lint.mjs` refuses to publish one, so reaching here means a caller bypassed the lint. Skip
    // it rather than write `null` into the register's identity column: planetCraft's
    // `tools/orchestra/ready.mjs` throws on it for the whole tick, and the scheduler a later phase
    // brings here reads the same column.
    if (!task.key || known.has(task.key)) continue;
    known.add(task.key);
    const alien = foreign(task);
    const status = alien ? FOREIGN : 'todo';
    const note = alien
      ? `[ENROLLED ${at} ${host}] Shared task owned elsewhere — dropped here on purpose so nothing schedules it, and so the board prints "not ours" instead of an orphan.`
      : `[ENROLLED ${at} ${host}] Enroled by \`roadmap publish\`. No status was written: \`orchestra roadmap board\` derives it from git and this register.`;
    // `task.roadmap` is already the SLUG `parse.mjs` produced, not a file path. planetCraft stored
    // a file path in this field and derived a task's canvas frame from its basename; a slug
    // satisfies that derivation exactly as well, so the switch changes nothing a page reads (see
    // `lib/register/state.mjs`'s own `registerRow` for the fuller argument).
    appended.push(registerRow(task, { roadmapSlug: task.roadmap, status, note }));
    added.push(task.key);
  }
  if (!added.length) return { state, added };
  return { state: { ...state, tasks: [...rows, ...appended] }, added };
}
