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
import { basename, join } from 'node:path';
import { parseRoadmap } from '../roadmap/parse.mjs';
import { lintRoadmap, formatViolations } from '../roadmap/lint.mjs';

const NOOP_WHY = 'offline mode: one machine, one register — there is nobody else to tell';

export function makeFileStore(cfg) {
  // No injection seam here, deliberately: unlike `gh`, git is cheap to run for real against a temp
  // repository, and the tests do exactly that. A recorder would be a second implementation of git
  // to keep honest, for nothing.
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: cfg.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      // ORCHESTRA_WRITES_MAIN marks a write the plugin itself makes on the main branch, so the
      // integrate-only guard (P5) can let it through without exempting `git commit` generally.
      env: { ...process.env, ORCHESTRA_WRITES_MAIN: '1' },
    });

  const publishedDir = join(cfg.root, cfg.roadmaps.published);
  const draftsDir = join(cfg.root, cfg.roadmaps.drafts);

  const mdIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : []);

  const readRoadmap = (file) => {
    const path = join(publishedDir, file);
    const parsed = parseRoadmap(readFileSync(path, 'utf8'), { source: path });
    return { slug: parsed.roadmap ?? basename(file, '.md'), parsed, ref: join(cfg.roadmaps.published, file) };
  };

  const me = () => {
    try { return git('config', 'user.name').trim() || 'unknown'; } catch { return 'unknown'; }
  };

  return {
    mode: 'offline',

    whoami: me,

    drafts: () => mdIn(draftsDir).map((f) => ({ slug: basename(f, '.md'), path: join(draftsDir, f) })),

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
      const slug = parsed.roadmap ?? basename(draftPath, '.md');
      const known = new Set(
        mdIn(publishedDir)
          .filter((f) => basename(f, '.md') !== slug)
          .flatMap((f) => readRoadmap(f).parsed.tasks.map((t) => t.key)),
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
      rmSync(draftPath, { force: true });
      git('add', '--', target);
      git('commit', '-q', '-m', `roadmap: publish ${slug}`, '--', target);
      return { slug, keys: parsed.tasks.map((t) => t.key), ref: join(cfg.roadmaps.published, `${slug}.md`) };
    },

    // The register row and the branch ref are the interlock here — the same one that actually held
    // in the online design. There is nothing to broadcast, so there is nothing to lose.
    claim: () => ({ ok: true }),
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
