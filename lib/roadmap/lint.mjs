// The roadmap contract, enforced. parse.mjs reports shape; this reports rules.
//
// Why each rule exists, in one line, because a rule whose reason is lost gets deleted by the
// next person who finds it inconvenient:
//
// - every field required        every field is read by someone, and a missing one is a question
//                              the next reader has to go and ask. Touches is the one to be clear
//                              about: it says where a task expects to work and **blocks nothing**
//                              (docs/roadmap-format.md) — files stopped blocking on 2026-09-01, two
//                              tasks naming the same file run side by side, and the conflict is
//                              resolved wherever the branches land. Deps and Lane are the only
//                              declarative blockers left.
// - no status field             status is DERIVED (git for local, the issue for shared). Both live
//                              roadmaps say in their own text that their hand-written board goes
//                              stale; a board written nowhere cannot.
// - Roadmap must agree          the field makes a block self-describing wherever it is pasted; a
//                              field that can disagree with its file is a second source of truth.
// - branch names its task       the id is what reconciliation matches on. The PREFIX is free on
//                              purpose: it names the subject, which legitimately differs from the
//                              roadmap (an instrument task in the council programme lands on tools/).
// - deps resolve                a dep pointing at nothing is a task that will never be scheduled.
//                              A BARE dep names a task in its own file, always resolvable from what
//                              is on disk right now, so an unresolved one stays an error. A
//                              QUALIFIED dep (contains "/") can name a task on the shared channel,
//                              which lint never fetches (no network in the keystroke path) — so an
//                              unresolved qualified dep is only a warning: offline, lint cannot
//                              tell "wrong" from "not published yet".
// - keys unique globally        eight ids collide across the five roadmaps today, and the conductor
//                              had already invented a G1L/G2L/G3L suffix by hand to survive it.
//                              A key already carries its roadmap slug (`<roadmap>/<ID>`), so this
//                              rule only ever fires between DIFFERENT files that both declare the
//                              same roadmap slug for the same id — `knownKeys` is deliberately the
//                              keys of OTHER local files, never the shared channel: a key that
//                              matches an already-published issue is not a collision, it is the
//                              same task by the grammar's own definition (`publish` treats it as an
//                              update, and `cmdPublish` prints that plainly before writing anything
//                              — see issues.mjs's `planPublish`).
// - Why and Acceptance          a task nobody can judge done is a task that never closes.
import { FIELD_NAMES, EMPTY } from './parse.mjs';

// Anything that smells like a written-down state. The list is deliberately broad: the failure it
// prevents is someone helpfully "keeping the file up to date".
export const STATUS_FIELDS = ['Status', 'State', 'Landed', 'Done', 'Progress', 'Session', 'Owner', 'Claimed'];

// The em dash is a value for a field that can genuinely have none. These three always have one:
// every task belongs to a roadmap, lands on a branch, and either needs a design pass or does not.
// parse.mjs normalises their em dash to null so no '—/N2' key reaches a consumer; rejecting it is
// this file's job, and it reads the raw value because the normalised one is indistinguishable from
// a field that was never written.
const NO_EMPTY = ['Roadmap', 'Branch', 'Design'];

// opts.knownKeys carries the keys of OTHER roadmaps only — never the keys of the roadmap being
// linted. Passing this roadmap's own keys makes every task collide with itself.
export function lintRoadmap(parsed, {
  source = '<input>', fileExists = () => true, knownKeys = new Set(),
} = {}) {
  const out = [];
  const at = (line, message, level = 'error') => out.push({ level, source, line, message });

  // A status field (Landed, Status, ...) is never in FIELD_NAMES, so parse.mjs has already
  // rejected it as an "unknown field" shape error — t.fields can never carry one for the per-task
  // loop below to find. parse.mjs's error carries the field name and enclosing task id alongside
  // its message precisely so this rule can read the facts instead of the sentence.
  for (const e of parsed.errors) {
    if (e.field && STATUS_FIELDS.includes(e.field))
      at(e.line, `${e.task}: "${e.field}" is a status field, and status is derived — remove it`);
    else at(e.line, e.message);
  }
  // Unconditional, and the `&&` it replaces is the bug: `publish` reads the FILE's slug to find or
  // create the programme issue, so a file whose tasks all declare their own Roadmap field used to
  // pass lint and then die inside publish on `escapeRegExp(null)` — a bare TypeError naming
  // nothing. Measured 2026-09-01, on the first publication of the share roadmap. Lint must refuse
  // exactly what publish cannot survive, and no more.
  if (!parsed.roadmap)
    at(1, 'no `roadmap:` in the frontmatter — publish needs it to find this roadmap\'s programme issue');

  const localIds = new Set(parsed.tasks.map((t) => t.id));
  const seen = new Set();

  for (const t of parsed.tasks) {
    for (const name of FIELD_NAMES)
      if (!(name in t.fields)) at(t.line, `${t.id}: missing required field "${name}"`);

    if (parsed.roadmap && t.roadmap && t.roadmap !== parsed.roadmap)
      at(t.fields.Roadmap.line, `${t.id}: Roadmap "${t.roadmap}" disagrees with the frontmatter "${parsed.roadmap}"`);
    if (t.fields.Order && t.order !== null && Number.isNaN(t.order))
      at(t.fields.Order.line, `${t.id}: Order "${t.fields.Order.raw}" is neither a number nor "—"`);
    if (t.fields.Design && !['yes', 'no'].includes(t.fields.Design.raw))
      at(t.fields.Design.line, `${t.id}: Design must be "yes" or "no", not "${t.fields.Design.raw}"`);
    for (const name of NO_EMPTY)
      if (t.fields[name]?.raw === EMPTY)
        at(t.fields[name].line, `${t.id}: "${name}" does not admit "${EMPTY}" — every task has one`);

    if (t.branch) {
      const seg = t.branch.split('/').pop();
      const want = `${t.id.toLowerCase()}-`;
      if (!seg.startsWith(want))
        at(t.fields.Branch.line, `${t.id}: branch "${t.branch}" — its last segment must start with "${want}"`);
    }

    for (const d of t.deps) {
      const qualified = d.includes('/');
      if (!(qualified ? knownKeys.has(d) : localIds.has(d)))
        at(t.fields.Deps.line, `${t.id}: dep "${d}" resolves to no task`, qualified ? 'warning' : 'error');
    }

    for (const p of t.touches) {
      if (p.startsWith('new ')) continue;
      if (!fileExists(p))
        at(t.fields.Touches.line, `${t.id}: Touches "${p}" does not exist`);
    }

    if (t.why === null) at(t.line, `${t.id}: no paragraph beginning "**Why"`);
    if (t.acceptance === null) at(t.line, `${t.id}: no paragraph beginning "**Acceptance"`);

    if (t.key) {
      if (seen.has(t.key) || knownKeys.has(t.key)) at(t.line, `${t.id}: key "${t.key}" is already taken`);
      seen.add(t.key);
    }
  }
  return out;
}

export const formatViolations = (v) => v.map((x) => `${x.level}: ${x.source}:${x.line} — ${x.message}`);
