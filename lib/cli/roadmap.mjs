// `orchestra roadmap <subcommand>` — the same eight verbs against either store.
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { makeStore } from '../store/index.mjs';
import { parseRoadmap } from '../roadmap/parse.mjs';
import { lintRoadmap, formatViolations } from '../roadmap/lint.mjs';
import { reconcile, gatherGit, renderBoard } from '../roadmap/board.mjs';
import { enrol } from '../roadmap/enrol.mjs';
import { readState, writeState, emptyState } from '../register/state.mjs';

const out = (s) => process.stdout.write(`${s}\n`);

// PATHS ONLY, and lint is its one caller: lint is a file operation with no store seam by design
// (it must read a draft in a project whose channel is unreachable), and it never needs a slug — the
// one rule for that is `lib/store/draft.mjs`, reached through `store.drafts()`, which is what
// `board` and `publish` use below. Sorted, so a set of drafts is reported in a decided order rather
// than in whatever order the filesystem hands back.
function draftFiles(cfg) {
  const dir = join(cfg.root, cfg.roadmaps.drafts);
  return existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => join(dir, f))
    : [];
}

function cmdLint(cfg, paths) {
  const files = paths.length ? paths : draftFiles(cfg);
  // Each file is read and parsed once, up front — `knownKeys` for file A is drawn from the
  // ALREADY-PARSED tasks of every other file, instead of re-reading and re-parsing every sibling
  // once per file in the set (an O(n^2) re-read that costs nothing on the two-file fixture and
  // adds up on a real drafts directory).
  const parsedByFile = new Map(files.map((f) => [f, parseRoadmap(readFileSync(f, 'utf8'), { source: f })]));
  let bad = 0;
  let total = 0;
  for (const file of files) {
    const others = files.filter((f) => f !== file)
      .flatMap((f) => parsedByFile.get(f).tasks.map((t) => t.key).filter(Boolean));
    const v = lintRoadmap(parsedByFile.get(file), {
      source: file,
      fileExists: (p) => existsSync(join(cfg.root, p)),
      knownKeys: new Set(others),
    });
    formatViolations(v).forEach(out);
    total += v.length;
    bad += v.filter((x) => x.level === 'error').length;
  }
  if (!files.length) out('lint: nothing to check');
  // Silence-means-success reads as "did this even run" the first time someone sees it — this
  // plugin's other commands each say why a no-op was a no-op, and a clean lint deserves the same
  // one line rather than nothing at all.
  else if (!total) out(`lint: ${files.length} file${files.length === 1 ? '' : 's'} checked, clean`);
  if (bad) process.exitCode = 1;
}

function cmdBoard(cfg, args, deps) {
  const store = makeStore(cfg, deps);
  const state = readState(cfg.root);
  const b = reconcile({
    tasks: store.list(),
    git: gatherGit(cfg.root, { mainBranch: cfg.mainBranch }),
    register: state?.tasks ?? [],
    overlay: store.overlay(),
  });
  if (args.includes('--json')) { out(JSON.stringify(b)); return; }
  out(renderBoard(b.rows));
  b.corrections.forEach((c) => out(`correction: ${c}`));
  b.unverified.forEach((c) => out(`unverified: ${c}`));
  b.notMine.forEach((c) => out(`not ours: ${c}`));
  b.orphans.inRegisterOnly.forEach((k) =>
    out(`orphan: ${k} is in the register and in no roadmap — write a roadmap line for it, then publish`));
  b.orphans.inRoadmapOnly.forEach((k) =>
    out(`orphan: ${k} is in a roadmap and not in the register — nothing will schedule it; run \`orchestra roadmap enrol\``));
  // The draft's own slug, never its filename: a draft named `zzz-notes.md` that declares
  // `roadmap: demo` publishes as `demo`, so printing `zzz-notes` names a roadmap that will never
  // exist. `store.drafts()` is the one rule for that (lib/store/draft.mjs).
  store.drafts().forEach((d) => out(`unpublished: ${d.slug} is a draft — nobody else can see it`));
}

function cmdPublish(cfg, [path], deps) {
  const store = makeStore(cfg, deps);
  // Through the store, in its decided order — the default target of a bare `publish` must not
  // depend on which draft the filesystem happened to list first.
  const target = path ?? store.drafts()[0]?.path;
  if (!target) throw new Error(`nothing to publish: no draft under ${cfg.roadmaps.drafts}`);
  const res = store.publish(target);
  out(`published ${res.slug}: ${res.keys.join(', ')}`);
  // Publishing is the moment a roadmap becomes schedulable and nothing else in the system notices.
  // By the time this runs, `store.publish` has already succeeded — the draft is gone, the roadmap
  // is live — so an enrolment failure here must never read as "nothing happened", and must never
  // send the user to re-run `publish`, which would now fail on a missing draft. Report both facts
  // (published; enrolment did not) and name the one command that finishes the job.
  try {
    enrolInto(cfg, store);
  } catch (e) {
    out(`published, but enrolment failed: ${e.message}`);
    out('the roadmap is live but nothing will schedule it yet — fix the problem above, then run `orchestra roadmap enrol`');
    process.exitCode = 1;
  }
}

function enrolInto(cfg, store) {
  const state = readState(cfg.root) ?? emptyState(cfg.root);
  // The overlay is taken ONCE, before the loop: `foreign` runs once per task, and re-listing every
  // issue from the store on every task is a network round-trip per task in online mode, for a
  // value that cannot change mid-loop.
  const overlay = store.overlay();
  const { state: next, added } = enrol(state, store.list(), {
    at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    host: hostname(),
    foreign: (t) => {
      const o = overlay.get(t.key);
      return Boolean(o) && o.mine === false && o.open !== true;
    },
  });
  if (added.length) { writeState(cfg.root, next); out(`enroled: ${added.join(', ')}`); }
}

export function roadmapCommand({ cfg, args, deps = {} }) {
  const [sub, ...rest] = args;
  const store = () => makeStore(cfg, deps);
  switch (sub) {
    case 'lint': return cmdLint(cfg, rest);
    case 'board': return cmdBoard(cfg, rest, deps);
    case 'publish': return cmdPublish(cfg, rest, deps);
    case 'enrol': return enrolInto(cfg, store());
    case 'claim': {
      const s = store();
      const r = s.claim(rest[0], s.whoami());
      if (!r.ok) throw new Error(`claim lost: ${rest[0]} is held by ${r.holder ?? 'someone else'}`);
      return out(`claimed ${rest[0]}`);
    }
    case 'release': {
      const r = store().release(rest[0], { force: rest.includes('--force') });
      if (!r.ok) throw new Error(`release refused: ${rest[0]} is held by ${r.holder ?? 'someone else'} — pass --force to release it anyway`);
      return out(`released ${rest[0]}`);
    }
    case 'open': { const r = store().openRoadmap(rest[0]); return out(r.noop ? `open: nothing to do — ${r.why}` : `opened ${rest[0]}`); }
    case 'reserve': { const r = store().reserve(rest[0]); return out(r.noop ? `reserve: nothing to do — ${r.why}` : `reserved ${rest[0]}`); }
    default:
      throw new Error(`orchestra roadmap: unknown subcommand "${sub ?? ''}"\nknown: lint, board, publish, claim, release, open, reserve, enrol`);
  }
}
