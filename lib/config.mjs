// The only place that knows anything about the target project. Everything a project could
// reasonably do differently is a key here; nothing else in the plugin hardcodes a path or a
// command.
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { mainCheckout, projectId } from './paths.mjs';
import { MODEL_DEFAULTS, THINKING_DEFAULTS, MAX_AUTO_RESUMES } from './register/workerPolicy.mjs';

export const DEFAULTS = {
  name: null,                 // filled from the checkout's directory name
  language: 'English',
  mainBranch: 'main',
  worktrees: '.orchestra/worktrees',
  roadmapRuntimes: {},        // per-roadmap future worker runtime; otherwise inherit conductor
  // `published` lives under `.orchestra/` — excluded from this clone by the line `orchestra init`
  // appends to the clone's own exclude, never committed — and publishing makes no commit of its
  // own. That is offline mode's own claim made structural: one machine, one register, one owner,
  // so a roadmap is this checkout's working state rather than something the repository carries. It
  // is also what `destination: local` (lib/roadmap/parse.mjs) reaches for in an ONLINE project,
  // where the shared channel is the issue tracker and a sweep roadmap must publish to neither.
  //
  // A project that wants its roadmaps shared points this at `docs/roadmaps` and commits them like
  // anything else — by hand, or through the merge gate's `ledgers`. Nothing here will do it.
  roadmaps: { drafts: '.orchestra/drafts', published: '.orchestra/roadmaps' },
  docs: { specs: 'docs/specs', plans: 'docs/plans', results: 'docs/results' },
  branchTests: null,
  // When a worker session's context has grown past this many tokens, `orchestra ready` says to
  // retire it onto a fresh session on the same worktree. 200 000 is not a round guess: it is the
  // lowest round threshold that saves tokens at EVERY re-acquisition cost simulated over 122 real
  // sessions — see `lib/register/cost.mjs`, which also holds the guard that makes a lower one safe
  // to try. A project raises it if its hand-overs are expensive, and the rule raises it by itself
  // when they turn out to be.
  retireAt: 200_000,
  gates: [],
  ledgers: [],
  queue: null,
  tickets: { file: '.orchestra/tickets.jsonl' },
  // The pull-request half. `direction` is a key rather than a fixed path for one reason worth
  // stating where someone will read it: under `.orchestra/` the direction memory is kept out of
  // git, so a fresh clone loses every principle the sweep has learned. That is the default because
  // the spec's own constraint is that a review adds nothing to the repository — a project that
  // wants its principles shared points this at `docs/direction/` and they are committed like
  // anything else.
  pr: { ledger: '.orchestra/pr-log.jsonl', direction: '.orchestra/direction' },
  workerModels: MODEL_DEFAULTS,
  workerThinking: THINKING_DEFAULTS,
  maxAutoResumes: MAX_AUTO_RESUMES,
  briefExtra: '',
};

// The main checkout, when the caller is standing in a git working tree. Outside one there is no
// boundary to enforce and no project either — `loadConfig` fails on `mainCheckout` a few lines
// later, with its own message naming the directory — so the walk below is left unbounded there
// rather than made to guess.
const repoBoundary = (dir) => { try { return mainCheckout(dir); } catch { return null; } };

// Walks up from `cwd`, and STOPS at the repository. A config found ABOVE the repository root
// describes a different project from the one `mainCheckout` resolves: the merged object's `mode`,
// `roadmaps` and `gates` would come from the outer project while its `root` and `id` name the inner
// one, and every path in it would then be resolved against a tree it was never written for. The
// default worktree layout never reaches that; a repository cloned under a directory somebody had
// configured does, and it would be silent and permanent.
//
// A linked worktree may live outside the main checkout. Stop at its .git boundary
// and fall back to the shared main config; never inherit another project above it.
//
// Finding nothing anywhere still returns null and never throws: that absence IS the off switch.
export function findConfig(cwd = process.cwd()) {
  let dir = resolve(cwd);
  const stop = repoBoundary(dir);
  for (;;) {
    const p = join(dir, '.orchestra', 'config.json');
    if (existsSync(p)) return p;
    if (dir === stop || existsSync(join(dir, '.git'))) {
      const shared = stop && join(stop, '.orchestra', 'config.json');
      return shared && existsSync(shared) ? shared : null;
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

const MODES = ['online', 'offline'];

// Shape classification shared by validate() and defaultedKeys(): a plain object, an array, or
// anything else (a scalar, including null — null is never a DEFAULTS shape by itself except as a
// scalar placeholder, e.g. `queue: null`).
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const shapeOf = (x) => (Array.isArray(x) ? 'array' : isPlain(x) ? 'object' : 'scalar');
const article = (shape) => (shape === 'scalar' ? 'a' : 'an');

export function validate(raw) {
  const errors = [];
  if (!MODES.includes(raw?.mode))
    errors.push('config: "mode" is required and must be "online" or "offline"');

  const gates = Array.isArray(raw?.gates) ? raw.gates : [];
  const seen = new Set();
  gates.forEach((g, i) => {
    if (!g?.name || !g?.cmd) errors.push(`config: gates[${i}] needs both "name" and "cmd"`);
    else if (seen.has(g.name))
      errors.push(`config: gate name "${g.name}" is used twice — a gate is named in its refusal, so names must be unique`);
    else seen.add(g.name);
  });

  // A key the file sets must be the same shape class as its default (plain object, array, or
  // scalar) — a group replaced by a string or an array merges wholesale (see mergeInto below) into
  // a config whose nested reads silently produce `undefined`, far from this, its actual cause.
  // Scalar sub-types (a string where a number is expected) are a different question, not this one.
  const shaped = raw ?? {};
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (!(k in shaped)) continue;
    const want = shapeOf(v);
    const got = shapeOf(shaped[k]);
    if (want !== got)
      errors.push(`config: "${k}" must be ${article(want)} ${want} like the default, not ${article(got)} ${got}`);
  }

  if (isPlain(raw?.roadmapRuntimes)) {
    for (const [slug, runtime] of Object.entries(raw.roadmapRuntimes)) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !['claude', 'codex'].includes(runtime))
        errors.push(`config: roadmapRuntimes.${slug} needs a roadmap slug and runtime claude or codex`);
    }
  }
  if (raw?.maxAutoResumes !== undefined && (!Number.isInteger(raw.maxAutoResumes) || raw.maxAutoResumes < 0))
    errors.push('config: maxAutoResumes must be a non-negative integer');
  for (const group of ['workerModels', 'workerThinking']) {
    if (!isPlain(raw?.[group])) continue;
    for (const [key, value] of Object.entries(raw[group])) {
      if (!Object.hasOwn(MODEL_DEFAULTS, key)) { errors.push(`config: unknown ${group}.${key}`); continue; }
      if (value === null && key.startsWith('codex')) continue;
      if (group === 'workerModels' ? typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value)
        : !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(value)
          || (key.startsWith('claude') && !['low', 'medium', 'high', 'xhigh', 'max'].includes(value)))
        errors.push(`config: invalid ${group}.${key}`);
    }
  }
  return errors;
}

// Nested objects merge key by key. Replacing `roadmaps` wholesale because a project set one of its
// two keys is the kind of surprise a config file must never hold.
const mergeInto = (base, over) => {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? { ...base[k], ...v }
      : v;
  }
  return out;
};

// Which DEFAULTS keys the file left unset. An object-valued default (DEFAULTS is only ever one
// level deep) always contributes LEAF entries — `group.key` for each key the file did not set
// inside that group — including every leaf when the group itself is absent, or set to something
// that is not a plain object (mergeInto then replaces the whole group wholesale, so no leaf holds
// a configured value either way). A scalar-valued default contributes its own bare name. Never
// both, and never a bare name for an object-valued key: that under-reports the common case where a
// project has not touched the group at all — `doctor` would then mark neither of its leaf rows.
function defaultedKeys(raw) {
  const defaulted = [];
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (!isPlain(v)) { if (!(k in raw)) defaulted.push(k); continue; }
    const given = isPlain(raw[k]) ? raw[k] : {};
    for (const nk of Object.keys(v)) if (!(nk in given)) defaulted.push(`${k}.${nk}`);
  }
  return defaulted;
}

export function loadConfig(cwd = process.cwd()) {
  const configPath = findConfig(cwd);
  if (!configPath) return null;
  let raw;
  const text = readFileSync(configPath, 'utf8');
  try {
    raw = JSON.parse(text);
  } catch (e) {
    // An unparseable config is a broken project, not an absent one: falling through to the off
    // switch would make a typo look like "orchestra is not set up here".
    throw new Error(`orchestra: ${configPath} is not valid JSON (${e.message})`);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error(`orchestra: ${configPath} must contain a JSON object, not ${Array.isArray(raw) ? 'an array' : raw === null ? 'null' : typeof raw}`);
  const root = mainCheckout(cwd);
  const merged = mergeInto(DEFAULTS, raw);
  return {
    ...merged,
    name: merged.name ?? basename(root),
    root,
    id: projectId(root),
    configPath,
    defaulted: defaultedKeys(raw),
  };
}

export function loadConfigOrThrow(cwd = process.cwd()) {
  const cfg = loadConfig(cwd);
  if (!cfg) return null;
  const errors = validate(cfg);
  if (errors.length) throw new Error(`${errors.join('\n')}\n  in ${cfg.configPath}`);
  return cfg;
}
