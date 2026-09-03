// The derived board. Status is computed here and written nowhere.
//
// Two sources, and the split is not a detail: a shared task landed by another developer closes
// its issue and its commit NEVER reaches my local main, so asking git about it would report todo
// forever. Git is the authority for what is local, the overlay for what is shared.
//
// The board is what the ROADMAP says. state.json is what THIS MACHINE is doing (session, model,
// port, note, pending, sessionName, subjects). This function merges the second's `subjects` into
// the derivation and copies nothing else across — a runtime field leaking into a board row is how
// a board starts being maintained by hand again.
//
// Nothing is ever dropped. A key in one source and not the other is an orphan and is reported: on
// 2026-08-11, in planetCraft, seven register rows named a roadmap that did not define them and
// thirteen roadmap tasks were absent from the register, and both went unnoticed because nothing
// looked.
import { execFileSync } from 'node:child_process';
import { gitEnv } from '../paths.mjs';
import { mayTake } from './policy.mjs';

export function deriveLocalStatus(task, git, subjects = []) {
  if (subjects.some((s) => git.mainSubjects.has(s))) return 'landed';
  if (task.branch && git.refs.has(task.branch)) return 'claimed';
  return 'todo';
}

// `todo` is a CLAIM — "nobody has done this" — and this derivation cannot make it honestly when
// it had nothing to check. A landed row whose register entry carries no `subjects` is not a task
// nobody started; it is a task whose landing was never recorded, and the two are opposite
// instructions to whoever reads the board next.
//
// Measured on 2026-08-20, in planetCraft: 22 of the 41 landed rows carried `subjects: []`, because
// recording them was a step a conductor had to remember (see planetCraft's
// `tools/roadmap/register.mjs`, which is why new landings there record themselves — this plugin
// has no landing-recorder yet). Eight of those rows printed as `todo`, and one session re-planned
// `gates/G3` off that word two days after it had landed — an hour of a shared machine, and the
// third time planetCraft re-derived finished work in one evening.
//
// So the absence gets its own word. `landed?` reads as landed for dependency purposes — the
// register is this machine's own record of what it did, and blocking every dependent of a
// finished task is the more expensive error — but it is printed differently and listed
// separately, so "unverified" never quietly becomes "verified".
export const UNVERIFIED = 'landed?';

export function isLanded(status) {
  return status === 'landed' || status === UNVERIFIED;
}

// A register row that says `landed` with nothing to prove it is a RECORDING GAP, not a
// disagreement between two sources. Keeping the two in one list is what made the corrections
// unreadable: ten lines, of which one was real.
function recordingGap(reg, derived) {
  return reg?.status === 'landed' && !(reg.subjects?.length) && derived === 'todo';
}

// A SHARED task the register deliberately dropped is the third category, and it is not a problem
// at any point in its life. The two sources are answering different questions — the overlay says
// "is this done", the register says "is this OURS to work" — and for a task another developer owns
// the honest answers are `claimed` and `dropped` at the same time. Nothing will ever reconcile
// them, so printing them as corrections is permanent noise, and permanent noise is how a list
// stops being read (planetCraft's `firsthour/A3`, `firsthour/A4`: "tâche partagée détenue par …, ne
// jamais la lancer ici" — the register note there says it in as many words).
function notOurs(reg, shared) {
  return shared && reg?.status === 'dropped';
}

// And the one shape that IS worth a human: work that landed here while its shared overlay entry
// stayed open. In planetCraft, `tools/roadmap/sync.mjs` closes such an issue automatically — but
// only off the recorded subjects, so the recording gap above disables it too. This plugin has no
// `sync` yet (a later phase), so here the line IS the whole mechanism: a human closes it. Named
// rather than folded into a generic disagreement, because the action is specific and it is
// OUTWARD-FACING: closing someone's issue is not a local edit, and no tool here does it on its own
// initiative.
function staleIssue(reg, shared, derived) {
  return shared && reg?.status === 'landed' && derived !== 'landed';
}

// deriveSharedStatus lives in lib/store/github/index.mjs — it reads an ISSUE, so it belongs to the
// store that has one. The overlay hands us its answer already computed.

// The two sources, in one decision, per row.
//
// A closed shared entry is landed whatever git says — another developer's commit never reaches this
// main. With no entry at all (offline, or a task not yet published) git and the register are all
// there is. A task somebody ELSE owns is the overlay's to answer: git here knows nothing about it.
//
// Mine, and shared, is the case with two answers. Git is the authority for what has a branch here
// and what landed — but it cannot see a CLAIM. A task claimed a minute ago has no branch yet, so
// git says `todo` while its issue says `claimed`, and `todo` is the answer that would refuse the
// worktree the claim was taken for (`startVerdict`, ./policy.mjs). So a local `todo` yields to the
// overlay's word; anything git DOES see — a branch, a landing — still wins, because that is the
// half the shared channel cannot know.
function deriveStatus(task, git, subjects, over) {
  if (over?.status === 'landed') return 'landed';
  if (!over) return deriveLocalStatus(task, git, subjects);
  if (!over.mine) return over.status;
  const local = deriveLocalStatus(task, git, subjects);
  return local === 'todo' ? over.status : local;
}

export function reconcile({ tasks, git, register = [], overlay = new Map() }) {
  const byKey = new Map(register.map((r) => [r.id, r]));
  const corrections = [];
  const unverified = [];
  const notMine = [];
  const statused = tasks.map((t) => {
    const reg = byKey.get(t.key);
    const over = overlay.get(t.key) ?? null;
    const derived = deriveStatus(t, git, reg?.subjects ?? [], over);
    const gap = recordingGap(reg, derived);
    const status = gap ? UNVERIFIED : derived;
    if (gap) unverified.push(`${t.key}: register says landed and recorded no commit subject — unverified, not todo`);
    else if (notOurs(reg, overlay.has(t.key))) notMine.push(`${t.key}: shared, owned elsewhere (issue #${over?.ref ?? '?'}) — dropped here on purpose, derived ${status}`);
    else if (staleIssue(reg, overlay.has(t.key), status))
      corrections.push(`${t.key}: landed here${reg.subjects?.length ? '' : ' (unrecorded)'} but issue #${over?.ref ?? '?'} is still ${status} — closing it is a shared-channel action, not a local one`);
    else if (reg?.status && reg.status !== status)
      corrections.push(`${t.key}: register says ${reg.status}, derived ${status}`);
    return {
      ...t,
      status,
      issue: over?.ref ?? null,
      owner: over?.owner ?? null,
      open: over?.open ?? false,
      mine: over ? over.mine : true,
      // Whether the claim on this row is MINE — read by `startVerdict` (./policy.mjs), which the
      // worktree guard asks before letting work start. The store answers it wherever there is a
      // shared channel to answer from; offline there is no overlay at all, and one machine with one
      // register means a locally derived `claimed` (a branch ref, here, made by me) IS my claim.
      claimedByMe: over ? Boolean(over.claimedByMe) : status === 'claimed',
      // What orchestra is allowed to take. `mayTake` is the one place that rule lives.
      schedulable: mayTake(over),
      programme: over?.programme ?? null,
      programmeState: over?.programmeState ?? null,
    };
  });

  // depsMet/blockedBy read every row's status at once, so they are computed over the whole
  // set the caller passed in — tasks is already one row per key, whether or not the overlay has
  // an opinion about it, or a dep on a shared task would resolve to nothing and every dependent
  // row would read as blocked. A bare dep (no "/") names a task in ITS OWN roadmap, per the
  // grammar lint.mjs already enforces; a dep with "/" is already a qualified key.
  //
  // The row's own `deps` is OVERWRITTEN with the resolved (qualified) form, not left as
  // authored: a board spanning several roadmaps showing a bare `G0` beside a key of
  // `lighting/S5` is exactly the ambiguity qualification exists to end, and a consumer reading
  // `deps` off a row (orchestra's register, `renderBoard`) must never have to re-derive the
  // resolution `reconcile` already did. Safe to do here — each store's own `publish()` reads a
  // task's `deps` from `parse.mjs`'s output directly and never touches `reconcile`, so a
  // published roadmap still round-trips the dep exactly as the roadmap author wrote it.
  const statusByKey = new Map(statused.map((r) => [r.key, r.status]));
  const depKey = (t, d) => (d.includes('/') ? d : `${t.roadmap}/${d}`);
  const rows = statused.map((t) => {
    const deps = t.deps.map((d) => depKey(t, d));
    const blockedBy = deps.filter((d) => !isLanded(statusByKey.get(d)));
    return { ...t, deps, depsMet: blockedBy.length === 0, blockedBy };
  });

  rows.sort((a, b) => {
    const ao = a.order ?? Infinity;
    const bo = b.order ?? Infinity;
    return ao - bo || a.key.localeCompare(b.key);
  });

  const roadmapKeys = new Set(tasks.map((t) => t.key));
  const terminal = new Set(['landed', 'dropped']);
  return {
    rows,
    corrections,
    unverified,
    notMine,
    orphans: {
      inRegisterOnly: register.filter((r) => !roadmapKeys.has(r.id) && !terminal.has(r.status)).map((r) => r.id),
      inRoadmapOnly: [...roadmapKeys].filter((k) => !byKey.has(k)),
    },
  };
}

// Renders in the order reconcile already established. It does not re-sort: one ordering, decided
// in one place, is what stops a reader and a tool disagreeing about which task is next.
export function renderBoard(rows) {
  const head = '| Order | Key | Task | Status | Owner | Deps | Branch | Issue |\n|---|---|---|---|---|---|---|---|';
  // A `todo` row with an unmet dep prints why, instead of a bare `todo` a human would have to
  // cross-read against the Deps column to explain — the exact hand-maintained failure mode this
  // board replaces.
  const statusCell = (r) => (r.status === 'todo' && !r.depsMet ? `blocked by ${r.blockedBy.join(', ')}` : r.status);
  // Mine prints as an em dash rather than as my own login: the column exists to make a stranger's
  // work stand out, and a name on every row would hide the few that are not mine. The `+` is the
  // difference between someone else's work and someone else's work I am allowed to take.
  const ownerCell = (r) => (r.mine === false ? `${r.owner ?? '?'}${r.open ? ' +' : ''}` : '—');
  const body = rows.map((r) =>
    `| ${r.order ?? '—'} | \`${r.key}\` | ${r.title} | ${statusCell(r)} | ${ownerCell(r)} | ${r.deps.join(', ') || '—'} | \`${r.branch}\` | ${r.issue ? `#${r.issue}` : '—'} |`);
  return [head, ...body].join('\n');
}

// The two things git is asked, once per board: which branches exist, and what main's subjects are.
// Both are sets because every consumer only ever asks "does it contain".
//
// `mainSubjects` is read from `mainBranch` explicitly, never from a bare `git log` (which reads
// HEAD). The main checkout's HEAD is main today, but `deriveLocalStatus`'s whole job is "did this
// LAND", and that answer must not depend on which branch someone happened to leave checked out —
// pin it rather than trust it.
//
// No `-n` window, on purpose. A bounded log turns a landed task into permanent noise the moment
// its commit falls outside the window: `deriveLocalStatus` stops finding the subject, `derived`
// becomes `todo`, and — because the register's `subjects` is non-empty — `recordingGap` does NOT
// fire, so the row prints a permanent `register says landed, derived todo` correction. That is
// exactly the "permanent noise is how a list stops being read" failure this file's own header
// warns about. Reading every subject of one branch costs a few hundred kilobytes even on a
// repository of several thousand commits, which is a trade worth making to avoid it. If that ever
// stops being true, the fix is to invert the lookup — ask git whether one specific subject exists
// — not to reintroduce a cap; write it down here so the next person does not just put the number
// back.
export function gatherGit(root, { mainBranch = 'main', run } = {}) {
  const git = run ?? ((...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv() }));
  const refs = new Set(
    git('for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').map((s) => s.trim()).filter(Boolean),
  );
  // An unborn `mainBranch` — a fresh repository, or a default branch nobody has committed to yet —
  // is not a broken repository; it is a project with no landed history, and the honest answer is
  // an empty set. Asked via `refs`, which is already built above, rather than by matching git's
  // own error text: that text is locale-dependent (a French or Japanese git says something else),
  // so a message match would miss on this exact repository the moment it runs somewhere else, and
  // silently rethrowing would crash `board` for a user who did nothing wrong. Checking `refs`
  // first means any OTHER git failure (a missing binary, a corrupted `.git`, a permission error) is
  // no longer caught at all — it throws, which is correct: a broken repository must still be loud.
  const mainSubjects = refs.has(mainBranch)
    ? new Set(git('log', '--format=%s', mainBranch).split('\n').map((s) => s.trim()).filter(Boolean))
    : new Set();
  return { refs, mainSubjects };
}
