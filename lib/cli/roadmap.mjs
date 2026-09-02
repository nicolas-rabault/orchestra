// `orchestra roadmap <subcommand>` — the same eight verbs against either store.
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, join } from 'node:path';
import { makeStore } from '../store/index.mjs';
import { parseRoadmap } from '../roadmap/parse.mjs';
import { lintRoadmap, formatViolations } from '../roadmap/lint.mjs';
import { reconcile, gatherGit, renderBoard } from '../roadmap/board.mjs';
import { enrol } from '../roadmap/enrol.mjs';
import { readState, writeState, emptyState } from '../register/state.mjs';

const out = (s) => process.stdout.write(`${s}\n`);

function draftFiles(cfg) {
  const dir = join(cfg.root, cfg.roadmaps.drafts);
  return existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => join(dir, f))
    : [];
}

function cmdLint(cfg, paths) {
  const files = paths.length ? paths : draftFiles(cfg);
  let bad = 0;
  for (const file of files) {
    const parsed = parseRoadmap(readFileSync(file, 'utf8'), { source: file });
    const others = files.filter((f) => f !== file)
      .flatMap((f) => parseRoadmap(readFileSync(f, 'utf8')).tasks.map((t) => t.key).filter(Boolean));
    const v = lintRoadmap(parsed, {
      source: file,
      fileExists: (p) => existsSync(join(cfg.root, p)),
      knownKeys: new Set(others),
    });
    formatViolations(v).forEach(out);
    bad += v.filter((x) => x.level === 'error').length;
  }
  if (!files.length) out('lint: nothing to check');
  if (bad) process.exitCode = 1;
}

function cmdBoard(cfg, args) {
  const store = makeStore(cfg);
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
  draftFiles(cfg).forEach((f) => out(`unpublished: ${basename(f, '.md')} is a draft — nobody else can see it`));
}

function cmdPublish(cfg, [path]) {
  const store = makeStore(cfg);
  const target = path ?? draftFiles(cfg)[0];
  if (!target) throw new Error(`nothing to publish: no draft under ${cfg.roadmaps.drafts}`);
  const res = store.publish(target);
  out(`published ${res.slug}: ${res.keys.join(', ')}`);
  // Publishing is the moment a roadmap becomes schedulable and nothing else in the system notices.
  enrolInto(cfg, store);
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

export function roadmapCommand({ cfg, args }) {
  const [sub, ...rest] = args;
  const store = () => makeStore(cfg);
  switch (sub) {
    case 'lint': return cmdLint(cfg, rest);
    case 'board': return cmdBoard(cfg, rest);
    case 'publish': return cmdPublish(cfg, rest);
    case 'enrol': return enrolInto(cfg, store());
    case 'claim': {
      const r = store().claim(rest[0], store().whoami());
      if (!r.ok) throw new Error(`claim lost: ${rest[0]} is held by ${r.holder ?? 'someone else'}`);
      return out(`claimed ${rest[0]}`);
    }
    case 'release': return out(store().release(rest[0], { force: rest.includes('--force') }).ok ? `released ${rest[0]}` : 'not released');
    case 'open': { const r = store().openRoadmap(rest[0]); return out(r.noop ? `open: nothing to do — ${r.why}` : `opened ${rest[0]}`); }
    case 'reserve': { const r = store().reserve(rest[0]); return out(r.noop ? `reserve: nothing to do — ${r.why}` : `reserved ${rest[0]}`); }
    default:
      throw new Error(`orchestra roadmap: unknown subcommand "${sub ?? ''}"\nknown: lint, board, publish, claim, release, open, reserve, enrol`);
  }
}
