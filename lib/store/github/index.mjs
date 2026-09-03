// Roadmaps as GitHub issues: one programme issue, one task issue each. The issue bodies are
// rendered so that the SAME parser reads them back — one grammar, two channels, rather than a
// second format to keep in step.
import { readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeGh } from './gh.mjs';
import { LABELS, keyFromTitle, publishIssues } from './issues.mjs';
import { ownershipIndex, programmeForRoadmap, OPEN_LABEL } from './ownership.mjs';
import { parseRoadmap } from '../../roadmap/parse.mjs';
import { lintRoadmap, formatViolations } from '../../roadmap/lint.mjs';
import { draftSlug, slugOf } from '../draft.mjs';

// The `# ` heading is the programme's title; everything between it and the first task block is
// the prose GitHub will show above the checklist.
//
// The heading is OPTIONAL here, unlike the source this was ported from: this repository's grammar
// does not require one, lint does not check for one, and the sample roadmap has none — so a
// headingless draft still has to publish. Title falls back to the given slug, and prose falls back
// to everything between the frontmatter and the first task block (the old, heading-blind
// extraction) — so nobody later "restores" the original's empty-string return and quietly breaks
// every draft that never had a `# ` line.
function titleAndProse(text, slug) {
  const lines = text.split('\n');
  const headingIdx = lines.findIndex((l) => l.startsWith('# '));
  if (headingIdx < 0) {
    const prose = text.replace(/^---[\s\S]*?---\n/, '').split(/^### /m)[0].trim();
    return { title: slug, prose };
  }
  const firstTaskIdx = lines.findIndex((l, i) => i > headingIdx && l.startsWith('### '));
  const proseLines = lines.slice(headingIdx + 1, firstTaskIdx >= 0 ? firstTaskIdx : lines.length);
  return { title: lines[headingIdx].slice(2).trim(), prose: proseLines.join('\n').trim() };
}

// A shared task's status comes from its ISSUE, never from git: another developer's landing closes
// the issue and its commit never reaches this machine's main, so git would report todo for ever.
export function deriveSharedStatus(issue) {
  if (!issue) return 'todo';
  if (issue.state === 'closed') return 'landed';
  // LABELS.wip is the GitHub label; 'claimed' is the board's own status word. Two vocabularies,
  // and a status a caller reads must not change name because a label did.
  if (issue.assignees?.length || issue.labels?.includes(LABELS.wip)) return 'claimed';
  return 'todo';
}

export function makeGithubStore(cfg, { gh: injected, run } = {}) {
  const gh = injected ?? makeGh({ run });
  const draftsDir = join(cfg.root, cfg.roadmaps.drafts);

  const taskIssues = () => gh.listIssues({ labels: [LABELS.task] });
  const programmeIssues = () => gh.listIssues({ labels: [LABELS.programme] });

  const parseIssue = (i) => {
    const parsed = parseRoadmap(`---\nroadmap: ${keyFromTitle(i.title).split('/')[0]}\n---\n\n${i.body}`,
      { source: `#${i.number}` });
    const t = parsed.tasks[0];
    return t ? { ...t, ref: i.number } : null;
  };

  return {
    whoami: () => gh.me(),

    // Sorted, like the offline store's: `publish` with no argument takes `drafts()[0]`, and that
    // must be a decided draft rather than whichever one the filesystem listed first.
    drafts: () => (existsSync(draftsDir) ? readdirSync(draftsDir) : [])
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => ({ slug: draftSlug(join(draftsDir, f)), path: join(draftsDir, f) })),

    programmes: () => {
      const me = gh.me();
      return programmeIssues().map((i) => ({
        slug: /^- \*\*Roadmap\*\* (.+)$/m.exec(i.body ?? '')?.[1] ?? i.title.split(' — ')[0],
        owner: i.author ?? null,
        open: (i.labels ?? []).includes(OPEN_LABEL),
        state: i.state,
        mine: Boolean(i.author) && i.author === me,
        ref: i.number,
      }));
    },

    list: () => taskIssues().map(parseIssue).filter(Boolean),

    overlay() {
      const tasks = taskIssues();
      const me = gh.me();
      const own = ownershipIndex({ taskIssues: tasks, programmeIssues: programmeIssues(), me });
      const out = new Map();
      for (const i of tasks) {
        const key = keyFromTitle(i.title);
        const o = own.get(key) ?? {};
        out.set(key, {
          status: deriveSharedStatus(i),
          ref: i.number,
          owner: o.owner ?? null,
          open: o.open ?? false,
          mine: o.mine ?? false,
          // WHO holds the claim, not merely that one exists — `deriveSharedStatus` collapses the
          // assignees to the word `claimed`, and `owner` is the roadmap's author, so without this
          // the identity was thrown away and `startVerdict` (lib/roadmap/policy.mjs) could never
          // let work start on a task the caller had just claimed. Computed here because this store
          // is what knows an identity: `reconcile` is told the answer, never taught the question.
          claimedByMe: (i.assignees ?? []).includes(me),
          programme: o.programme ?? null,
          programmeState: o.programmeState ?? null,
        });
      }
      return out;
    },

    publish(draftPath) {
      const text = readFileSync(draftPath, 'utf8');
      const parsed = parseRoadmap(text, { source: draftPath });
      const slug = slugOf(parsed, draftPath);
      const known = new Set(taskIssues().map((i) => keyFromTitle(i.title))
        .filter((k) => k.split('/')[0] !== slug));
      const violations = lintRoadmap(parsed, {
        source: draftPath,
        fileExists: (p) => existsSync(join(cfg.root, p)),
        knownKeys: known,
      }).filter((v) => v.level === 'error');
      if (violations.length) throw new Error(formatViolations(violations).join('\n'));

      const { title, prose } = titleAndProse(text, slug);
      const res = publishIssues(gh, { roadmap: slug, title, prose, tasks: parsed.tasks });
      rmSync(draftPath, { force: true });
      return { slug, keys: parsed.tasks.map((t) => t.key), ref: res.programme };
    },

    claim(key, who) {
      const issue = taskIssues().find((i) => keyFromTitle(i.title) === key);
      if (!issue) return { ok: false, holder: null };
      gh.assign(issue.number, who);
      gh.addLabel(issue.number, LABELS.wip);
      const after = taskIssues().find((i) => i.number === issue.number);
      const holder = after?.assignees?.[0] ?? null;
      return holder === who ? { ok: true } : { ok: false, holder };
    },

    // A plain release only ever gives up a claim the caller holds — `release` with no `--force` is
    // the polite path, meant for "I'm done with this", not "take it from whoever has it". Without
    // this check a plain `release` freed ANY assignee, so the same command already released
    // somebody else's claim silently, which is the thing `--force` was supposed to gate.
    release(key, { force = false } = {}) {
      const issue = taskIssues().find((i) => keyFromTitle(i.title) === key);
      if (!issue) return { ok: true };
      const holder = issue.assignees?.[0] ?? null;
      if (holder && holder !== gh.me() && !force) return { ok: false, holder };
      // `assign` is `--add-assignee`, which only ever ADDS — leaving the label off the assignee
      // meant the next claimant's own `assign` could never displace the name still sitting on
      // the issue, and `claim`'s own success check (reading the assignee back) would forever
      // report the task held by whoever released it.
      for (const who of issue.assignees ?? []) gh.unassign(issue.number, who);
      gh.removeLabel(issue.number, LABELS.wip);
      return { ok: true };
    },

    setStatus(key, status) {
      const issue = taskIssues().find((i) => keyFromTitle(i.title) === key);
      if (!issue) return { noop: true };
      gh.addLabel(issue.number, status === 'claimed' ? LABELS.wip : LABELS.todo);
      return { noop: false };
    },

    close(key) {
      const issue = taskIssues().find((i) => keyFromTitle(i.title) === key);
      if (!issue) return { noop: true };
      gh.closeIssue(issue.number);
      return { noop: false };
    },

    openRoadmap(slug) {
      const p = programmeForRoadmap(programmeIssues(), slug);
      if (!p) return { noop: true, why: `no programme issue names the roadmap "${slug}"` };
      gh.addLabel(p.number, OPEN_LABEL);
      return { noop: false };
    },

    reserve(slug) {
      const p = programmeForRoadmap(programmeIssues(), slug);
      if (!p) return { noop: true, why: `no programme issue names the roadmap "${slug}"` };
      gh.removeLabel(p.number, OPEN_LABEL);
      return { noop: false };
    },
  };
}
