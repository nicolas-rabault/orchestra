// Roadmaps as markdown files this checkout keeps to itself, and nothing else.
//
// A draft is excluded from this clone and invisible to everything; `publish` moves it under
// `roadmaps.published` — excluded too, by default — and from that moment its tasks are the
// roadmap. It makes no commit and stages nothing: offline mode's own claim is one machine, one
// register, one owner, so a roadmap is this checkout's working state, not something the repository
// carries. A project that wants them shared points `roadmaps.published` at a committed directory
// and commits them itself. Status is
// derived from git and the register (lib/roadmap/board), so there is no field here to write one
// into — which is the "never write a status anywhere" rule made structural rather than merely
// enforced.
//
// What this store deliberately cannot do: tell you whether ANOTHER MACHINE has taken a task.
// There is one owner and one register. `doctor` says so under the mode line.
import { execFileSync } from 'node:child_process';
import {
  readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { parseRoadmap } from '../roadmap/parse.mjs';
import { lintRoadmap, formatViolations } from '../roadmap/lint.mjs';
import { draftSlug, slugOf } from './draft.mjs';

const NOOP_WHY = 'offline mode: one machine, one register — there is nobody else to tell';

export function makeFileStore(cfg) {
  // The one git call this store makes, and it only reads: `whoami`. No injection seam here,
  // deliberately — git is cheap to run for real against a temp repository and the tests do exactly
  // that, where a recorder would be a second implementation to keep honest, for nothing.
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: cfg.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });

  const publishedDir = join(cfg.root, cfg.roadmaps.published);
  const draftsDir = join(cfg.root, cfg.roadmaps.drafts);

  const mdIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : []);

  // `slugOf` is the one slug rule (./draft.mjs): its own frontmatter, falling back to the filename
  // only when the frontmatter names none. `drafts()` and `publish()` below apply the same one, so a
  // file named `foo.md` that declares `roadmap: bar` can never be listed as `foo` and published as
  // `bar.md`: that would make the filename and the frontmatter two sources for the same fact, free
  // to disagree.
  const readRoadmap = (file) => {
    const path = join(publishedDir, file);
    const parsed = parseRoadmap(readFileSync(path, 'utf8'), { source: path });
    return { slug: slugOf(parsed, path), parsed, ref: join(cfg.roadmaps.published, file) };
  };

  const me = () => {
    try { return git('config', 'user.name').trim() || 'unknown'; } catch { return 'unknown'; }
  };

  return {
    whoami: me,

    drafts: () => mdIn(draftsDir).map((f) => ({ slug: draftSlug(join(draftsDir, f)), path: join(draftsDir, f) })),

    programmes: () => mdIn(publishedDir).map((f) => {
      const { slug, ref } = readRoadmap(f);
      return { slug, owner: me(), open: true, state: 'open', ref };
    }),

    list: () => mdIn(publishedDir).flatMap((f) => {
      const { parsed, ref } = readRoadmap(f);
      return parsed.tasks.map((t) => ({ ...t, ref }));
    }),

    publish(draftPath) {
      const text = readFileSync(draftPath, 'utf8');
      const parsed = parseRoadmap(text, { source: draftPath });
      // Every OTHER published roadmap's keys, never this one's: passing a roadmap its own keys
      // makes every task collide with itself.
      //
      // Filtered by SLUG, never by filename. Filtering by filename is what the online store never
      // did, and the difference was a whole mode refusing a publish the other accepted: a
      // hand-authored `2026-09-lighting.md` declaring `roadmap: lighting` — a date-named file, an
      // ordinary convention — is the `lighting` roadmap, so every later publish of `lighting` was
      // handed its own keys and lint rejected them as already taken. `readRoadmap` above already
      // returns the slug the one rule produced; ask it, never the directory entry.
      const slug = slugOf(parsed, draftPath);
      // Every published file, read once: `known` needs the ones that are NOT this slug, and the
      // target needs the ones that ARE.
      const publishedFiles = mdIn(publishedDir).map(readRoadmap);
      const known = new Set(
        publishedFiles.filter((r) => r.slug !== slug).flatMap((r) => r.parsed.tasks.map((t) => t.key)),
      );
      // WHERE this slug already lives, if anywhere. Offline a slug is declared in frontmatter and
      // the filename is only a convention, so two hand-written files can claim one slug — `publish`
      // used to refuse that and no longer can, since P1 made the slug rather than the filename the
      // identity. One file is unambiguous and is rewritten in place, which is what keeps a
      // date-named `2026-09-lighting.md` the lighting roadmap instead of growing a `lighting.md`
      // beside it. Two files have no honest answer to "which one is the roadmap", so the refusal IS
      // the answer, and it names them rather than picking.
      const holding = publishedFiles.filter((r) => r.slug === slug).map((r) => r.ref);
      if (holding.length > 1)
        throw new Error(`orchestra: ${holding.length} published files declare the roadmap "${slug}" — ${holding.join(', ')}\n`
          + 'delete or re-slug all but one; publishing cannot choose which of them is the roadmap');

      const violations = lintRoadmap(parsed, {
        source: draftPath,
        fileExists: (p) => existsSync(join(cfg.root, p)),
        knownKeys: known,
      }).filter((v) => v.level === 'error');
      if (violations.length) throw new Error(formatViolations(violations).join('\n'));

      mkdirSync(publishedDir, { recursive: true });
      const target = holding.length === 1 ? join(cfg.root, holding[0]) : join(publishedDir, `${slug}.md`);
      // The draft goes only once the published file is on disk — never before, so a failed write
      // leaves the one copy of the work where it can be retried from.
      writeFileSync(target, text);
      rmSync(draftPath, { force: true });
      return { slug, keys: parsed.tasks.map((t) => t.key), ref: relative(cfg.root, target) };
    },

    // The register row and the branch ref are the interlock here — the same one that actually held
    // in the online design. There is nothing to broadcast, so there is nothing to lose.
    claim: () => ({ ok: true }),
    // `force` is accepted and ignored, not merely absent: the online store's `release` refuses a
    // claim it does not hold unless `force` is set, because there IS another machine that might
    // hold it. Offline, one machine and one register mean there is no other holder to protect —
    // this is a deliberate asymmetry between the two stores, not a gap this one forgot to fill.
    release: () => ({ ok: true }),

    openRoadmap: () => ({ noop: true, why: NOOP_WHY }),
    reserve: () => ({ noop: true, why: NOOP_WHY }),
    // Spec §4.1: offline there is nowhere to write a status, so this does nothing — and that is
    // correct rather than missing. The "never write a status anywhere" invariant is structural here:
    // there is no field to write one into.
    sync: () => ({ noop: true, why: `${NOOP_WHY} — and nowhere to write a status` }),

    // Empty on purpose, and it is the definition of offline mode: with no overlay entry for a key,
    // the board derives that row's status from git and the register.
    overlay: () => new Map(),
  };
}
