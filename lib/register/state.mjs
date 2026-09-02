// The register: what THIS MACHINE is doing about the roadmap's tasks. The roadmap says what the
// work is; git says what landed; this says which session is on it, what it is waiting for and what
// it was told. Nothing here is a source of truth about status — that is derived (lib/roadmap/board).
import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { orchestraDir, assertRoot } from '../paths.mjs';

export const STATE_REL = '.orchestra/state.json';
export const statePath = (root) => join(orchestraDir(root), 'state.json');

export const emptyState = (root) => ({
  version: 1,
  root,
  adopted: false,
  conductor: { session: null, language: null, inboxSeen: null },
  tasks: [],
});

export function readState(root) {
  const p = statePath(root);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`orchestra: ${p} did not parse (${e.message}) — most likely a read mid-write; try again`);
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
export function registerRow(task, { roadmapSlug, status = 'todo', note = '' }) {
  return {
    id: task.key,
    order: task.order ?? null,
    title: task.title,
    roadmap: roadmapSlug,
    deps: (task.deps ?? []).map((d) => qualifyDep(task.roadmap, d)),
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
    note,
    pending: [],
  };
}
