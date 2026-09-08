// The register: what THIS MACHINE is doing about the roadmap's tasks. The roadmap says what the
// work is; git says what landed; this says which session is on it, what it is waiting for and what
// it was told. Nothing here is a source of truth about status — that is derived (lib/roadmap/board).
import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { orchestraDir, assertRoot } from '../paths.mjs';

export const statePath = (root) => join(orchestraDir(root), 'state.json');

export const emptyState = (root) => ({
  version: 1,
  root,
  adopted: false,
  conductor: { session: null, language: null, inboxSeen: null },
  // When the account's usage budget frees up again. Read by `decideTick` (./tick.mjs), which stands
  // the heartbeat down until then rather than spending a session on a refusal that is already
  // certain — a slot was burned on exactly that, three hours before a reset, on 2026-08-13.
  budgetResetAt: null,
  tasks: [],
  // A question about the RUN, which hangs on no row — and its retirement, the way a row's
  // `pending[]` item retires into that row's `answered[]`. STRUCTURAL by being here, which is the
  // whole point: a run ends when its last row goes terminal, the protocol makes a question
  // obligatory at exactly that moment, and the archive pass runs on that same tick. An unknown
  // top-level key is filed as prose, so a run-level ask kept anywhere else would be tidied into
  // `archive.jsonl` and onto no screen — the defect reproduced from inside the housekeeping.
  runAsks: [],
  runAnswered: [],
});

// The top-level keys the machinery reads. EVERYTHING ELSE at the top of the register is prose a
// conductor wrote to itself — 43 523 bytes of it on the run this was measured from, some of it
// actively wrong and contradicted by the skill that read it — and `lib/register/archive.mjs` moves
// it out with the rows.
//
// DERIVED from `emptyState`, not written out a second time. The project this is ported from keeps a
// hand-maintained list, and copying it would have shipped a live bug here: that list has no
// `version` and no `root`, which are exactly the two keys this plugin's register added, so the first
// archive pass would have filed `root` away as prose — and `assertRoot` returns early when the
// recorded root is absent, so the wrong-project guard would have been silently switched off by the
// tidy-up pass. A key a conductor INVENTS is still not in `emptyState`, so the loud failure the
// original wanted — the new key turning up named in the archive — is unchanged.
export const STRUCTURAL = new Set(Object.keys(emptyState(null)));

export function readState(root) {
  const p = statePath(root);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`orchestra: ${p} did not parse (${e.message}) — the file was edited or corrupted outside this tool`);
  }
}

// Written through a temp file and a rename so a reader can never see half of it: the register is
// re-read by a page, a heartbeat and a conductor at once, and a torn read reads as a lost run.
export function writeState(root, state) {
  assertRoot(state.root, root);
  const p = statePath(root);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ ...state, root }, null, 2)}\n`);
  renameSync(tmp, p);
}

// A row's `deps` must be byte-for-byte comparable with another row's `id`, both qualified: the
// scheduler matches them with `===` and throws rather than resolve anything at read time.
export const qualifyDep = (roadmap, d) => (d.includes('/') ? d : `${roadmap}/${d}`);

// A task this machine may not take is enroled terminal, so nothing schedules it and the heartbeat
// does not stay awake for another developer's programme.
export const FOREIGN = 'dropped';

// The row shape, in one place. Every runtime field is written as null or empty rather than omitted:
// the page, the inbox and the archiver all read them, and an absent `pending` is one `?? []` away
// from crashing a request handler.
//
// `roadmap` is the SLUG. planetCraft stored a file path here and had to carry a rule about not
// confusing the two; the slug is what both stores already key on, and it is what a page derives a
// frame name from.
export function registerRow(task, { roadmapSlug, status = 'todo', note = '', mine = true }) {
  return {
    id: task.key,
    order: task.order ?? null,
    title: task.title,
    roadmap: roadmapSlug,
    deps: (task.deps ?? []).map((d) => qualifyDep(roadmapSlug, d)),
    touches: task.touches ?? [],
    lane: task.lane ?? null,
    branch: task.branch,
    subjects: [],
    status,
    design: Boolean(task.design),
    model: null,
    session: null,
    sessionName: null,
    port: null,
    // Everywhere this row can be OPENED that is not a localhost port — its pull request, a staging
    // deploy, a CI run, a design file — as `{ label, url }`, drawn by the card as one button each
    // beside the dev server (`openablesFor`, lib/monitor/model.mjs). Written by the conductor, like
    // `pending[]` and for the same reason: the page has to be told what is worth a look, and only
    // the conductor knows. A pull-request review row needs no entry for its own pull request — the
    // page derives that one from the row id.
    links: [],
    note,
    pending: [],
    // Whether this task is MINE to prioritise. Read by `planLaunches` (./ready.mjs), which puts my
    // own roadmaps first and gives a stranger's OPEN task a slot only once my queue has nothing left
    // to run: a developer who opened their roadmap offered spare capacity, not priority. Offline
    // there is no other developer, so it is always true.
    mine,
  };
}

// What the merge gate writes onto a row the moment its branch reaches the main branch, from the one
// process that knows both halves. The conductor is asked to record these by hand BEFORE handing a
// branch over; measured 2026-08-20 in planetCraft, that was skipped for 22 of 41 landed rows, every
// one left with `subjects: []` — which the board can never match, so it printed `todo` for finished
// work and a session re-planned a task two days after it had landed.
//
// Matched on the BRANCH, which is what the gate was given, and never on a key it would have to
// guess. A branch with no row is the ordinary case — a fix, a study — and matches nothing.
export function recordLanding(state, branch, subjects) {
  const rows = state?.tasks;
  if (!Array.isArray(rows) || !branch) return { state, matched: null };
  const i = rows.findIndex((t) => t.branch === branch);
  if (i < 0) return { state, matched: null };

  const row = rows[i];
  // Union, existing first: a row that lands in two goes — a follow-up after a held branch — keeps
  // the subjects of both, and re-running `land` on the same branch cannot duplicate them.
  const seen = new Set(row.subjects ?? []);
  const merged = [...(row.subjects ?? [])];
  for (const s of subjects) if (s && !seen.has(s)) { seen.add(s); merged.push(s); }

  const tasks = rows.slice();
  tasks[i] = { ...row, subjects: merged, status: 'landed' };
  return { state: { ...state, tasks }, matched: row.id ?? branch };
}
