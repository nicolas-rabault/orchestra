// Roadmaps as committed markdown, and nothing else.
//
// A draft is gitignored and invisible to everything; `publish` moves it under
// `roadmaps.published`, commits it, and from that moment its tasks are the roadmap. Status is
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
import { join } from 'node:path';
import { parseRoadmap } from '../roadmap/parse.mjs';
import { lintRoadmap, formatViolations } from '../roadmap/lint.mjs';
import { draftSlug, slugOf } from './draft.mjs';

const NOOP_WHY = 'offline mode: one machine, one register — there is nobody else to tell';

export function makeFileStore(cfg) {
  // No injection seam here, deliberately: unlike `gh`, git is cheap to run for real against a temp
  // repository, and the tests do exactly that. A recorder would be a second implementation of git
  // to keep honest, for nothing.
  const runGit = (env) => (...args) =>
    execFileSync('git', args, {
      cwd: cfg.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env,
    });

  // A read touches neither the working tree nor HEAD and needs no exemption from anything, so it
  // gets none — only the two calls that actually write (`add`, `commit`) carry
  // ORCHESTRA_WRITES_MAIN, marking a write the plugin itself makes on the main branch so the
  // integrate-only guard (P5) can let it through without exempting git generally. Putting the
  // marker on a shared helper instead would hand the bypass to every future read too, by default,
  // which is the opposite of a guard — keep the two apart.
  const git = runGit(process.env);
  const gitWrite = runGit({ ...process.env, ORCHESTRA_WRITES_MAIN: '1' });

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
      // handed its own keys and lint rejected them as already taken. `readRoadmap` returns the slug
      // the one rule produced, one line down; ask it, not the directory entry.
      const slug = slugOf(parsed, draftPath);
      const known = new Set(
        mdIn(publishedDir)
          .map(readRoadmap)
          .filter((r) => r.slug !== slug)
          .flatMap((r) => r.parsed.tasks.map((t) => t.key)),
      );
      const violations = lintRoadmap(parsed, {
        source: draftPath,
        fileExists: (p) => existsSync(join(cfg.root, p)),
        knownKeys: known,
      }).filter((v) => v.level === 'error');
      if (violations.length) throw new Error(formatViolations(violations).join('\n'));

      mkdirSync(publishedDir, { recursive: true });
      const target = join(publishedDir, `${slug}.md`);
      writeFileSync(target, text);
      gitWrite('add', '--', target);
      // A byte-identical republish stages nothing: skip the commit rather than let git throw on
      // "nothing to commit, working tree clean", and remove the draft only once the commit (or
      // this deliberate skip) has succeeded — never before. That ordering is the whole point: a
      // git failure between the write and the commit now leaves the draft in place to retry from,
      // instead of deleting the one copy of the work before it is safely committed anywhere.
      const staged = git('status', '--porcelain', '--', target);
      if (staged.trim()) gitWrite('commit', '-q', '-m', `roadmap: publish ${slug}`, '--', target);
      rmSync(draftPath, { force: true });
      return { slug, keys: parsed.tasks.map((t) => t.key), ref: join(cfg.roadmaps.published, `${slug}.md`) };
    },

    // The register row and the branch ref are the interlock here — the same one that actually held
    // in the online design. There is nothing to broadcast, so there is nothing to lose.
    claim: () => ({ ok: true }),
    // `force` is accepted and ignored, not merely absent: the online store's `release` refuses a
    // claim it does not hold unless `force` is set, because there IS another machine that might
    // hold it. Offline, one machine and one register mean there is no other holder to protect —
    // this is a deliberate asymmetry between the two stores, not a gap this one forgot to fill.
    release: () => ({ ok: true }),

    setStatus: () => ({ noop: true, why: 'status is derived, never written' }),
    close: () => ({ noop: true, why: 'status is derived, never written' }),
    openRoadmap: () => ({ noop: true, why: NOOP_WHY }),
    reserve: () => ({ noop: true, why: NOOP_WHY }),

    // Empty on purpose, and it is the definition of offline mode: with no overlay entry for a key,
    // the board derives that row's status from git and the register.
    overlay: () => new Map(),
  };
}
