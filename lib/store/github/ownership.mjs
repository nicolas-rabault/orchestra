// Who owns a roadmap, and whose orchestra may schedule its tasks.
//
// A roadmap's owner is the AUTHOR of its programme issue. Nothing is stored, nothing is
// maintained, GitHub displays it already, and nobody can rewrite it — which is exactly why this is
// not a label or a field: an owner that can be edited is an owner that can be edited by mistake,
// and the whole point of publishing everyone's work is that you can see whose it is.
//
// Openness is one label on the PROGRAMME, never on a task. A task resolves its owner through its
// programme, by the `Programme: #N` line issues.mjs already writes, so opening a roadmap is ONE
// write instead of a fan-out over N+1 issues that can half-fail and leave a roadmap half open.
//
// Pure: issues in, ownership out. No gh, no fs, no git — the same discipline parse.mjs keeps, and
// for the same reason: this decides who may take what, and a decision that needs a network to be
// tested is a decision nobody tests.
import { keyFromTitle } from './issues.mjs';

export const OPEN_LABEL = 'open';

// Anchored to its own line. The body is prose plus a task block, and prose may say anything; a
// pattern a sentence can forge is a parser that can be lied to.
const PROGRAMME = /^Programme:\s*#(\d+)\s*$/m;

export function programmeOf(body) {
  const m = PROGRAMME.exec(String(body ?? ''));
  return m ? Number(m[1]) : null;
}

// An ORPHAN — no `Programme:` line, or one naming an issue that is not in `programmeIssues` — is
// owned by nobody and is never mine. Defaulting an unaccountable task to mine is how it would get
// scheduled here; the caller reports it and excludes it, the way `unreadable` already works in
// planetCraft's `tools/roadmap/sync.mjs`.
//
// `mine` needs `Boolean(owner)` before the comparison: GitHub returns no author for an issue whose
// account was deleted, and `undefined === undefined` would hand me a stranger's roadmap on the
// strength of two logins nobody could read.
export function ownershipIndex({ taskIssues, programmeIssues, me }) {
  const byNumber = new Map((programmeIssues ?? []).map((i) => [i.number, i]));
  const out = new Map();
  for (const t of taskIssues ?? []) {
    const key = keyFromTitle(t.title);
    const number = programmeOf(t.body);
    const p = number === null ? null : byNumber.get(number) ?? null;
    if (!p) {
      out.set(key, { programme: number, programmeState: null, owner: null, open: false, mine: false, orphan: true });
      continue;
    }
    const owner = p.author ?? null;
    out.set(key, {
      programme: p.number,
      programmeState: p.state ?? null,
      owner,
      open: (p.labels ?? []).includes(OPEN_LABEL),
      mine: Boolean(owner) && owner === me,
      orphan: false,
    });
  }
  return out;
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The programme issue a roadmap SLUG names — `open` and `reserve` take a slug, not an issue number.
//
// Anchored and whole-line, which is not fussiness: `open light` reaching the `lighting` programme
// would hand thirteen tasks to every developer on the repository, and no later command takes that
// back quietly. issues.mjs's `publishIssues` calls THIS to decide whether to create a programme or
// update one — it carried its own byte-identical copy until a review found them, which is two
// matches that happen to agree rather than one both channels read.
export function programmeForRoadmap(programmeIssues, roadmap) {
  const re = new RegExp(`^- \\*\\*Roadmap\\*\\* ${escapeRegExp(roadmap)}$`, 'm');
  return (programmeIssues ?? []).find((i) => re.test(i.body ?? '')) ?? null;
}
