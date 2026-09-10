// `orchestra roadmap <subcommand>` — drafting and lifecycle commands.
import { readdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { validate } from '../config.mjs';
import { workerRuntime } from '../register/runtime.mjs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { makeStore } from '../store/index.mjs';
import { writeDraft } from '../roadmap/draft.mjs';
import { parseRoadmap } from '../roadmap/parse.mjs';
import { lintRoadmap, formatViolations } from '../roadmap/lint.mjs';
import { reconcile, gatherGit, renderBoard } from '../roadmap/board.mjs';
import { enrol } from '../roadmap/enrol.mjs';
import { readState, writeState, emptyState } from '../register/state.mjs';

const out = (s) => process.stdout.write(`${s}\n`);

// Both destinations, every time. A local roadmap is published — to a place only this machine can
// see — so it must reach the board and the register beside the shared ones, or `orchestra ready`
// will not schedule a single one of its tasks and the board will not count them.
//
// `drafts()` is deliberately NOT unioned: both stores read the same drafts directory, so asking
// both would print every unpublished draft twice.
// Offline both destinations ARE one store (lib/store/index.mjs), so unioning them there would
// list every task twice. The union is what an online project needs to see its `pr` roadmap at all.
const stores = (cfg, deps) => (cfg.mode === 'offline'
  ? [makeStore(cfg, deps)]
  : [makeStore(cfg, deps), makeStore(cfg, deps, { destination: 'local' })]);
const listAll = (ss) => ss.flatMap((s) => s.list());
const overlayAll = (ss) => new Map(ss.flatMap((s) => [...s.overlay()]));

// `claim`, `release`, `open` and `reserve` name ONE roadmap, so the union above is not their
// answer: they must reach the store that HOLDS it, which is the roadmap's destination and not the
// project's mode. Online, a `destination: local` roadmap lives in the file store and the GitHub
// store has never heard of its keys — `claim` came back `{ok:false, holder:null}`, rendered as
// "held by someone else", which the protocol reads as a reason to drop the row. So on an online
// project every pull-request review row was dropped at launch, blamed on a holder that does not
// exist.
//
// Asking each store which one knows the name is what routes them, and the mode store stays the
// fallback: a name no store lists still fails exactly the way it always did.
const storeHolding = (ss, knows) => ss.find(knows) ?? ss[0];
// `list()` for a task key (`<roadmap>/<ID>`), `programmes()` for a roadmap slug — the two verbs
// take two different names, and a roadmap with no tasks yet still has a programme.
const storeForKey = (cfg, deps, key) =>
  storeHolding(stores(cfg, deps), (s) => s.list().some((t) => t.key === key));
const storeForSlug = (cfg, deps, slug) =>
  storeHolding(stores(cfg, deps), (s) => s.programmes().some((p) => p.slug === slug));

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
  const ss = stores(cfg, deps);
  const state = readState(cfg.root);
  const b = reconcile({
    tasks: listAll(ss),
    git: gatherGit(cfg.root, { mainBranch: cfg.mainBranch }),
    register: state?.tasks ?? [],
    overlay: overlayAll(ss),
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
  ss[0].drafts().forEach((d) => out(`unpublished: ${d.slug} is a draft — nobody else can see it`));
}

function cmdPublish(cfg, [path], deps) {
  // The default target still comes from the mode store, because both stores read the same drafts
  // directory and either would answer identically.
  const target = path ?? makeStore(cfg, deps).drafts()[0]?.path;
  if (!target) throw new Error(`nothing to publish: no draft under ${cfg.roadmaps.drafts}`);
  // The roadmap says where it goes. Read from the file rather than from the store's own listing:
  // this is the one decision the store cannot make, because it is what chooses the store.
  const { destination } = parseRoadmap(readFileSync(target, 'utf8'), { source: target });
  const res = makeStore(cfg, deps, { destination }).publish(target);
  out(`published ${res.slug}: ${res.keys.join(', ')}`);
  // Only the shared channel has a programme to report on; a local roadmap is one file.
  if (res.report) out(res.report);
  // Publishing is the moment a roadmap becomes schedulable and nothing else in the system notices.
  // By the time this runs, `store.publish` has already succeeded — the draft is gone, the roadmap
  // is live — so an enrolment failure here must never read as "nothing happened", and must never
  // send the user to re-run `publish`, which would now fail on a missing draft. Report both facts
  // (published; enrolment did not) and name the one command that finishes the job.
  try {
    enrolInto(cfg, stores(cfg, deps));
  } catch (e) {
    out(`published, but enrolment failed: ${e.message}`);
    out('the roadmap is live but nothing will schedule it yet — fix the problem above, then run `orchestra roadmap enrol`');
    process.exitCode = 1;
  }
}

function cmdSync(cfg, deps) {
  const ss = stores(cfg, deps);
  const state = readState(cfg.root);
  const b = reconcile({
    tasks: listAll(ss),
    git: gatherGit(cfg.root, { mainBranch: cfg.mainBranch }),
    register: state?.tasks ?? [],
    overlay: overlayAll(ss),
  });
  const r = ss[0].sync(b.rows);
  if (r.noop) return out(`sync: nothing to do — ${r.why}`);
  out(`sync: closed ${r.closed.length ? r.closed.join(', ') : 'nothing'};`
    + ` ${r.labels} label change(s); ${r.programmes} programme(s) updated`);
}

function enrolInto(cfg, ss) {
  const state = readState(cfg.root) ?? emptyState(cfg.root);
  // The overlay is taken ONCE, before the loop: `foreign` runs once per task, and re-listing every
  // issue from the store on every task is a network round-trip per task in online mode, for a
  // value that cannot change mid-loop.
  const overlay = overlayAll(ss);
  const { state: next, added } = enrol(state, listAll(ss), {
    at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    host: hostname(),
    foreign: (t) => {
      const o = overlay.get(t.key);
      return Boolean(o) && o.mine === false && o.open !== true;
    },
    // `!== false`, not `=== true`: a task with no overlay entry at all — offline, or one not yet
    // published — is mine.
    mine: (t) => overlay.get(t.key)?.mine !== false,
  });
  if (added.length) { writeState(cfg.root, next); out(`enroled: ${added.join(', ')}`); }
}

function cmdRuntime(cfg, args) {
  const [slug, runtime] = args;
  if (args.length > 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug ?? '') || (runtime && !['claude', 'codex', 'inherit'].includes(runtime)))
    throw new Error('usage: orchestra roadmap runtime <slug> [claude|codex|inherit]');
  const raw = JSON.parse(readFileSync(cfg.configPath, 'utf8'));
  const assignments = { ...raw.roadmapRuntimes };
  if (runtime) {
    if (runtime === 'inherit') delete assignments[slug];
    else assignments[slug] = runtime;
    const next = { ...raw, roadmapRuntimes: assignments };
    const errors = validate(next);
    if (errors.length) throw new Error(errors.join('\n'));
    const scratch = `${cfg.configPath}.${process.pid}.tmp`;
    writeFileSync(scratch, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(scratch, cfg.configPath);
  }
  const conductorRuntime = readState(cfg.root)?.conductor?.runtime ?? 'claude';
  const selected = workerRuntime({ roadmap: slug }, { roadmapRuntimes: assignments, conductorRuntime });
  out(`${slug}: ${selected}${Object.hasOwn(assignments, slug) ? ' (assigned)' : ' (inherited)'} — future workers; existing sessions keep their runtime`);
}

export function roadmapCommand({ cfg, args, deps = {} }) {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'draft': {
      if (rest.length !== 1) throw new Error('usage: orchestra roadmap draft <JSON file>');
      const path = writeDraft(cfg, JSON.parse(readFileSync(rest[0], 'utf8')));
      return out(`drafted ${path} — not published`);
    }
    case 'runtime': return cmdRuntime(cfg, rest);
    case 'lint': return cmdLint(cfg, rest);
    case 'board': return cmdBoard(cfg, rest, deps);
    case 'publish': return cmdPublish(cfg, rest, deps);
    case 'enrol': return enrolInto(cfg, stores(cfg, deps));
    case 'claim': {
      const s = storeForKey(cfg, deps, rest[0]);
      const r = s.claim(rest[0], s.whoami());
      if (!r.ok) throw new Error(`claim lost: ${rest[0]} is held by ${r.holder ?? 'someone else'}`);
      return out(`claimed ${rest[0]}`);
    }
    case 'release': {
      const r = storeForKey(cfg, deps, rest[0]).release(rest[0], { force: rest.includes('--force') });
      if (!r.ok) throw new Error(`release refused: ${rest[0]} is held by ${r.holder ?? 'someone else'} — pass --force to release it anyway`);
      return out(`released ${rest[0]}`);
    }
    case 'open': { const r = storeForSlug(cfg, deps, rest[0]).openRoadmap(rest[0]); return out(r.noop ? `open: nothing to do — ${r.why}` : `opened ${rest[0]}`); }
    case 'reserve': { const r = storeForSlug(cfg, deps, rest[0]).reserve(rest[0]); return out(r.noop ? `reserve: nothing to do — ${r.why}` : `reserved ${rest[0]}`); }
    case 'sync': return cmdSync(cfg, deps);
    default:
      throw new Error(`orchestra roadmap: unknown subcommand "${sub ?? ''}"\nknown: draft, runtime, lint, board, publish, claim, release, open, reserve, enrol, sync`);
  }
}
