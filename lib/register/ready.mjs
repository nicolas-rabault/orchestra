// The orchestra conductor's scheduling brain. Pure functions over a task table and a git
// snapshot; the CLI is in ../cli/tick.mjs, which gathers the snapshot. Spec:
// docs/specs/2026-09-02-orchestra-plugin-design.md
//
// Git is the only truth for claimed/landed. Landed = exact commit SUBJECT on main, never a
// hash (merge_agent rebases). A ref that exists = claimed; a ref matching no task's declared
// branch claims nothing.
//
// A task is blocked ONLY by a functional blocker: an unlanded `Deps`, or a busy serial `Lane`.
// Files are not one. Until 2026-09-01 this refused to schedule two tasks declaring the same file,
// which failed on its own terms — the declared `Touches` never predicted what a task would edit
// (the comment that said so, measured, was in this file), so the check was widened to every
// in-flight branch's actual diff, which made it worse: a branch's diff grows as the work proceeds,
// so a task could be blocked hours after it was cleared to start, by a file nobody had planned to
// touch. The conflicts happened anyway. They are merge_agent's job, and it holds the merge lock
// precisely so that it can do it.

import { execFileSync } from 'node:child_process';
import { gitEnv } from '../paths.mjs';
import { TERMINAL } from './archive.mjs';

export function reconcileTasks(tasks, git) {
  const corrections = [];
  const branches = new Set(git.branches);
  const subjects = new Set(git.mainSubjects);
  const out = tasks.map((t) => {
    if (TERMINAL.has(t.status)) return t;
    if (t.subjects.some((s) => subjects.has(s))) {
      if (t.status !== 'landed') corrections.push(`${t.id}: subject found on main -> landed`);
      return { ...t, status: 'landed' };
    }
    const claimed = branches.has(t.branch);
    if (claimed && t.status === 'todo') {
      corrections.push(`${t.id}: ref ${t.branch} exists -> claimed`);
      return { ...t, status: 'claimed' };
    }
    if (!claimed && (t.status === 'claimed' || t.status === 'review')) {
      corrections.push(`${t.id}: ref ${t.branch} gone without landing -> todo`);
      return { ...t, status: 'todo', session: null, port: null, note: 'ref gone; check worktree before relaunch' };
    }
    return t;
  });
  return { tasks: out, corrections };
}

export function computeReadySet(tasks, git) {
  // Identity is DATA, not code: `id` must already be the qualified `<roadmap>/<ID>` key by the
  // time it reaches here — this function never disambiguates it. An unqualified id is not a task
  // to schedule cautiously, it is the table-builder having done it wrong: measured 2026-08-11,
  // qualifying the register's `id` without also qualifying its `deps` silently emptied the whole
  // ready set (every dep looked unmet, even a landed one) with no error anywhere. Surface it here
  // instead of absorbing it into a wrong-but-quiet answer.
  const unqualifiedIds = tasks.filter((t) => !t.id.includes('/'));
  if (unqualifiedIds.length)
    throw new Error(`computeReadySet: unqualified id(s) — ${unqualifiedIds.map((t) => t.id).join(', ')} — every task's id must already be a qualified <roadmap>/<ID> key`);
  // Same reasoning, the other end of the match: a bare dep is exactly as unresolvable here as a
  // bare id, and the board (lib/roadmap/board.mjs) already resolves every dep to a qualified
  // key before it ever reaches a register row — a bare one reaching here means the table was
  // built by hand, or built wrong.
  const unqualifiedDeps = tasks.flatMap((t) => t.deps.filter((d) => !d.includes('/')));
  if (unqualifiedDeps.length)
    throw new Error(`computeReadySet: unqualified dep(s) — ${unqualifiedDeps.join(', ')} — every dep must already be a qualified <roadmap>/<ID> key`);

  const inFlight = tasks.filter((t) => t.status === 'claimed' || t.status === 'review');
  const lanesBusy = new Set(inFlight.filter((t) => t.lane).map((t) => t.lane));
  const landed = new Set(tasks.filter((t) => t.status === 'landed').map((t) => t.id));

  const ready = [];
  const blocked = [];
  for (const t of tasks) {
    if (t.status !== 'todo') continue;
    const reasons = [
      ...t.deps.filter((d) => !landed.has(d)).map((d) => `dep ${d} not landed`),
      ...(t.lane && lanesBusy.has(t.lane) ? [`lane ${t.lane} busy`] : []),
    ];
    if (reasons.length) blocked.push({ id: t.id, reasons });
    else ready.push(t);
  }
  ready.sort((a, b) => a.order - b.order);
  return { ready, blocked };
}

// My own roadmaps first; a foreign OPEN task only once my queue has nothing left to run. A
// developer who opened their roadmap to everyone offered spare capacity, not priority — filling a
// slot with a stranger's task while one of mine waits is the one way this could make my own work
// slower than before it existed.
//
// `mine !== false` rather than `mine === true`: a register row written before ownership existed
// carries no such field, and demoting it behind a stranger's task on the strength of a field nobody
// wrote is a silent reordering nobody would ever think to look for. `ready` arrives sorted by
// order, and partitioning preserves that within each half.
export function planLaunches(ready, inFlightCount, width) {
  const ordered = [
    ...ready.filter((t) => t.mine !== false),
    ...ready.filter((t) => t.mine === false),
  ];
  return ordered.slice(0, Math.max(0, width - inFlightCount))
    .map((t) => ({ ...t, model: t.design ? 'fable' : 'opus' }));
}

// What a tick owes its WORKERS — an undelivered relay, a stopped worker on a live row — is decided in
// ./drive.mjs (`obligations`), beside the command that resolves it, and read from there.

// Which questions have been sitting on the page long enough that the user should be TOLD, rather
// than left to come and look.
//
// Measured 2026-08-12/14, nine answers stamped by the monitor: the user answered in 8 to 15 minutes
// every time he knew something was waiting, and in 2 to 8 hours every time he did not. Same person,
// same kind of question — the difference was entirely whether anything had told him. The proof is
// four asks that had waited between 2 h 19 and 8 h 07 and were then all answered inside the same
// four minutes: he batches, and nothing was announcing the batch.
//
// Blockingness is deliberately NOT the filter, because it was the wrong one: the four asks that sat
// longest were all merge approvals, none of which blocks a conductor from doing anything else.
export function pendingWaiting(tasks, { now = Date.now(), minAgeMs = 30 * 60_000 } = {}) {
  const out = [];
  for (const t of tasks) {
    if (TERMINAL.has(t.status)) continue;
    for (const p of t.pending ?? []) {
      if (p.answer != null) continue;
      const at = Date.parse(p.askedAt ?? '');
      // An item written before `askedAt` existed is reported with no age rather than dropped: the
      // register carries both shapes for as long as it takes the old rows to clear, and silently
      // ignoring the old ones would hide exactly the questions that have waited longest.
      const known = Number.isFinite(at);
      if (known && now - at < minAgeMs) continue;
      out.push({ id: t.id, kind: p.kind ?? 'question', ask: p.ask ?? '', askedAt: p.askedAt ?? null,
        ageMin: known ? Math.round((now - at) / 60_000) : null });
    }
  }
  // Oldest first; unknown age last, since it cannot be ranked and must not displace a measured wait.
  return out.sort((a, b) => (b.ageMin ?? -1) - (a.ageMin ?? -1));
}

// What the two surviving rules need, and nothing more: which branches exist (claimed/landed
// reconciliation) and main's commit subjects (the landing oracle — the exact SUBJECT, never a hash,
// because merge_agent rebases).
//
// The per-branch file lists, the parked-ref discount and the degraded channel were all removed with
// the file-collision rule they served. Their absence is not a loss of safety: they existed to
// decide who "held" a file, and nobody holds a file any more.
//
// GIT_DIR and GIT_WORK_TREE are exported inside a git hook, and under one of those git ignores
// `cwd` entirely — so a call meant for `root` silently retargets whichever repository invoked the
// hook. Scrubbed here rather than trusted, since this function's whole job is to describe one
// specific checkout.
export function gatherGit(root, { mainBranch = 'main' } = {}) {
  const env = gitEnv();
  const sh = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env }).trim();
  const refs = sh(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
    .split('\n').map((s) => s.trim()).filter(Boolean);
  const branches = refs.filter((b) => b !== mainBranch);
  // An unborn `mainBranch` — a fresh repository, or a default branch nobody has committed to yet —
  // is not a broken repository; it is a project with no landed history, and the honest answer is an
  // empty list. Asked via `refs`, which is already in hand, rather than by matching git's own error
  // text: that text is locale-dependent, so a message match would miss the moment this runs on
  // somebody else's machine. `lib/roadmap/board.mjs` answers the same question the same way.
  const mainSubjects = refs.includes(mainBranch)
    ? sh(['log', '--format=%s', '-200', mainBranch]).split('\n').filter(Boolean)
    : [];
  return { branches, mainSubjects };
}
