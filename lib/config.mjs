// The only place that knows anything about the target project. Everything a project could
// reasonably do differently is a key here; nothing else in the plugin hardcodes a path or a
// command.
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { mainCheckout, projectId } from './paths.mjs';

export const DEFAULTS = {
  name: null,                 // filled from the checkout's directory name
  language: 'English',
  mainBranch: 'main',
  worktrees: '.orchestra/worktrees',
  roadmaps: { drafts: '.orchestra/drafts', published: 'docs/roadmaps' },
  docs: { specs: 'docs/specs', plans: 'docs/plans', results: 'docs/results' },
  branchTests: null,
  gates: [],
  ledgers: [],
  queue: null,
  monitor: { port: 'auto' },
  tickets: { file: '.orchestra/tickets.jsonl' },
  briefExtra: '',
};

export function findConfig(cwd = process.cwd()) {
  let dir = resolve(cwd);
  for (;;) {
    const p = join(dir, '.orchestra', 'config.json');
    if (existsSync(p)) return p;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

const MODES = ['online', 'offline'];

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

  const port = raw?.monitor?.port;
  const okPort = port === undefined || port === 'auto'
    || (Number.isInteger(port) && port >= 1024 && port <= 65535);
  if (!okPort) errors.push('config: monitor.port must be "auto" or an integer between 1024 and 65535');

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
  const root = mainCheckout(cwd);
  const merged = mergeInto(DEFAULTS, raw);
  return {
    ...merged,
    name: merged.name ?? basename(root),
    root,
    id: projectId(root),
    configPath,
    defaulted: Object.keys(DEFAULTS).filter((k) => !(k in raw)),
  };
}

export function loadConfigOrThrow(cwd = process.cwd()) {
  const cfg = loadConfig(cwd);
  if (!cfg) return null;
  const errors = validate(JSON.parse(readFileSync(cfg.configPath, 'utf8')));
  if (errors.length) throw new Error(`${errors.join('\n')}\n  in ${cfg.configPath}`);
  return cfg;
}
