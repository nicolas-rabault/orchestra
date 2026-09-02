# P1 — Configuration, project identity, the store seam and the roadmap layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `orchestra roadmap <lint|board|publish|claim|enrol>` work in a project that has never seen this plugin, in either mode, with the same observable behaviour in both.

**Architecture:** One CLI entry point reads one committed config file. A `Store` interface with two implementations — GitHub issues (`online`) and committed markdown (`offline`) — sits between the roadmap layer and the world. The roadmap layer itself (grammar, lint, board reconciliation) is ported unchanged from `planetCraft` and stays pure: text and rows in, verdicts out. The one seam that used to name GitHub in the reconciler becomes a single `overlay()` map, which the file store returns empty — so the offline path *is* the local derivation, provably, rather than by resemblance.

**Tech Stack:** Node ≥ 20, ESM only, `node:test` + `node:assert/strict`, `git` CLI, `gh` CLI (online mode only). No runtime dependencies of any kind.

**Spec:** `docs/specs/2026-09-02-orchestra-plugin-design.md`

## Global Constraints

- **Node ≥ 20**, **git ≥ 2.31** (`git rev-parse --path-format=absolute` is used and was added in 2.31).
- **Zero runtime dependencies.** Nothing under `bin/`, `lib/` or `hooks/` may import anything but a `node:` builtin or a relative path. Task 1 makes this a test.
- **ESM only.** `package.json` carries `"type": "module"`; `package.json` has **no** `dependencies` and no `devDependencies`.
- **Everything committed is in English** — code, comments, docs, commit messages, test names. What the plugin *says to a user at runtime* follows the project's `language` config; that is P2's concern, not P1's.
- **A ported file keeps its original comments verbatim.** They carry the measurements that justify each rule, and a rule stripped of its evidence gets deleted by the next reader. Where a comment names a `planetCraft` path that no longer exists, rewrite the path and keep the sentence.
- **Every subcommand except `init`, `doctor` and `instances` exits 0 and silent when `.orchestra/config.json` is absent.** This is the plugin's off switch (spec §3.1).
- Commit after every task. Run `npm test` before every commit.

---

### Task 1: Plugin skeleton and the zero-dependency invariant

**Files:**
- Create: `package.json`, `.gitignore`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `README.md`
- Test: `test/no-dependencies.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: the repository layout every later task writes into; `npm test` runs `node --test test/`.

- [ ] **Step 1: Write the failing test**

`test/no-dependencies.test.mjs`:

```js
// The invariant that makes this plugin installable in a project that runs `npm install` never:
// nothing it executes may import anything but a node builtin or a relative path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

function* files(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

const IMPORT = /(?:^|\n)\s*(?:import|export)[^'"\n]*from\s+['"]([^'"]+)['"]/g;

test('nothing under bin/, lib/ or hooks/ imports a package', () => {
  const offenders = [];
  for (const dir of ['bin', 'lib', 'hooks']) {
    for (const file of files(join(repo, dir))) {
      const src = readFileSync(file, 'utf8');
      for (const [, spec] of src.matchAll(IMPORT)) {
        const ok = spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../');
        if (!ok) offenders.push(`${file.slice(repo.length + 1)} imports ${spec}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('package.json declares no dependencies', () => {
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.type, 'module');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — there is no `package.json`, so npm cannot run anything.

- [ ] **Step 3: Write the skeleton**

`package.json`:

```json
{
  "name": "orchestra-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Claude Code plugin: a conductor, a monitoring page, a merge gate and a roadmap grammar, for any project",
  "scripts": {
    "test": "node --test test/"
  }
}
```

`.gitignore`:

```
node_modules/
.DS_Store
```

`.claude-plugin/plugin.json`:

```json
{
  "name": "orchestra",
  "version": "0.1.0",
  "description": "Conduct a project's roadmaps with background worker sessions, a monitoring page and a one-at-a-time merge gate. Roadmaps live on GitHub or as committed markdown.",
  "author": { "name": "Nicolas Rabault" }
}
```

`.claude-plugin/marketplace.json`:

```json
{
  "name": "orchestra",
  "owner": { "name": "Nicolas Rabault" },
  "metadata": {
    "description": "Orchestra — autonomous development ecosystem for Claude Code",
    "version": "0.1.0"
  },
  "plugins": [
    {
      "name": "orchestra",
      "source": "./",
      "description": "Conductor, monitoring page, merge gate and roadmap grammar, online (GitHub) or offline (markdown)",
      "version": "0.1.0",
      "author": { "name": "Nicolas Rabault" }
    }
  ]
}
```

`README.md`: a stub naming the plugin, the two modes, and pointing at `docs/specs/2026-09-02-orchestra-plugin-design.md`. Add the line the spec's §16 asks for: **extracted from `planetCraft` at commit `86bf8412`**.

- [ ] **Step 4: Create the empty directories the test walks**

```bash
mkdir -p bin lib hooks test
```

The test tolerates a missing directory (`readdirSync` in a `try`), but the directories are about to be used.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: plugin skeleton and the zero-dependency invariant"
```

---

### Task 2: `lib/paths.mjs` — the main checkout, the project id, the cross-project guard

**Files:**
- Create: `lib/paths.mjs`, `test/helpers/fixture.mjs`
- Test: `test/paths.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `mainCheckout(cwd = process.cwd()) -> string` — absolute path of the main working tree, resolved through `git rev-parse --path-format=absolute --git-common-dir`, so a call from inside a linked worktree returns the **main** checkout.
  - `projectId(root) -> string` — 6 lowercase hex characters, `sha256` of the resolved absolute root.
  - `orchestraDir(root) -> string` — `<root>/.orchestra`.
  - `assertRoot(recorded, actual) -> void` — throws an `Error` naming both paths when they differ; returns silently when `recorded` is null or undefined.
  - `test/helpers/fixture.mjs` exports `makeRepo({ mode, config, name })` and the `ROADMAP` sample every later task reuses.

- [ ] **Step 1: Write the fixture helper**

`test/helpers/fixture.mjs`:

```js
// A throwaway git repository with an .orchestra/config.json, built in a temp directory. Every
// suite that touches git, the register or a store uses this rather than the developer's own tree.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeRepo({ mode = 'offline', config = {}, name = 'fixture' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'orchestra-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture User');
  git('config', 'user.email', 'fixture@example.com');
  mkdirSync(join(root, '.orchestra'), { recursive: true });
  writeFileSync(
    join(root, '.orchestra', 'config.json'),
    `${JSON.stringify({ name, mode, ...config }, null, 2)}\n`,
  );
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');
  return { root, git, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// One valid task, in the grammar, used by the parse, lint, store and board suites.
export const ROADMAP = `---
roadmap: demo
---

Demo roadmap prose.

### D1 — First thing

- **Roadmap** demo
- **Order** 1
- **Deps** —
- **Touches** \`README.md\`
- **Branch** \`demo/d1-first-thing\`
- **Design** no
- **Lane** —

**Why.** The player sees the first thing.

**Acceptance.** A test asserts it.
`;
```

- [ ] **Step 2: Write the failing test**

`test/paths.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo } from './helpers/fixture.mjs';
import { mainCheckout, projectId, orchestraDir, assertRoot } from '../lib/paths.mjs';

const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

test('mainCheckout returns the root from the root', () => {
  const r = repo();
  assert.equal(mainCheckout(r.root), r.root);
});

test('mainCheckout returns the MAIN checkout from inside a linked worktree', () => {
  const r = repo();
  const wt = join(r.root, 'wt');
  r.git('worktree', 'add', '-q', wt, '-b', 'side');
  assert.equal(mainCheckout(wt), r.root);
});

test('mainCheckout refuses a directory that is not a working tree', () => {
  assert.throws(() => mainCheckout('/'), /not a working tree|fatal/i);
});

test('projectId is stable, 6 hex, and keyed on the PATH not the name', () => {
  const a = repo({ name: 'same' });
  const b = repo({ name: 'same' });
  assert.match(projectId(a.root), /^[0-9a-f]{6}$/);
  assert.equal(projectId(a.root), projectId(a.root));
  assert.notEqual(projectId(a.root), projectId(b.root));
});

test('orchestraDir hangs off the root', () => {
  const r = repo();
  assert.equal(orchestraDir(r.root), join(r.root, '.orchestra'));
});

test('assertRoot is silent when it matches or has nothing recorded', () => {
  assertRoot(null, '/a');
  assertRoot('/a', '/a');
  assertRoot('/a/', '/a');
});

test('assertRoot throws naming BOTH paths when they differ', () => {
  assert.throws(
    () => assertRoot('/projects/alpha', '/projects/beta'),
    (e) => e.message.includes('/projects/alpha') && e.message.includes('/projects/beta'),
  );
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test test/paths.test.mjs`
Expected: FAIL — `Cannot find module '../lib/paths.mjs'`.

- [ ] **Step 4: Write the implementation**

`lib/paths.mjs`:

```js
// Where a project's files are, and which project this is.
//
// Runtime state always belongs to the MAIN checkout, never to the worktree the caller happens to
// be standing in: `git worktree add` copies no untracked file, so a worker's tree has no register,
// no journal and no drafts, and resolving them relative to cwd would silently create a second,
// empty set beside the real one.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

export function mainCheckout(cwd = process.cwd()) {
  // --path-format=absolute (git 2.31) removes the only ambiguity here: --git-common-dir answers
  // relatively from the main checkout and absolutely from a linked worktree, and a caller that
  // resolved the relative form against its own cwd would be right by accident.
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!/[/\\]\.git$/.test(common))
    throw new Error(`orchestra: ${cwd} is not a working tree with a .git directory (git-common-dir = ${common})`);
  return dirname(common);
}

// Six hex of sha256 over the ABSOLUTE path, never over the name: two checkouts of one repository,
// and two unrelated projects that happen to share a directory name, must not collide. Derived on
// demand and never stored in the config, which would carry a wrong id to another machine.
export const projectId = (root) => createHash('sha256').update(resolve(root)).digest('hex').slice(0, 6);

export const orchestraDir = (root) => join(root, '.orchestra');

// `cd` persists between an agent's shell calls, and a conductor that has just launched a worker is
// one relative path away from writing another project's state. A mismatch is an error naming both
// paths — never a warning, and never a silent write.
export function assertRoot(recorded, actual) {
  if (!recorded) return;
  if (resolve(recorded) !== resolve(actual))
    throw new Error(
      `orchestra: this state belongs to ${resolve(recorded)}, but the working tree resolved to ${resolve(actual)} — refusing to write across projects`,
    );
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/paths.mjs test/paths.test.mjs test/helpers/fixture.mjs
git commit -m "feat(paths): main-checkout resolution, project id and the cross-project guard"
```

---

### Task 3: `lib/config.mjs` — defaults, validation, resolution

**Files:**
- Create: `lib/config.mjs`
- Test: `test/config.test.mjs`

**Interfaces:**
- Consumes: `mainCheckout`, `projectId` from `lib/paths.mjs`.
- Produces:
  - `DEFAULTS` — the object below.
  - `findConfig(cwd) -> string | null` — walks up from `cwd` for `.orchestra/config.json`.
  - `validate(raw) -> string[]` — human-readable errors, empty when valid.
  - `loadConfig(cwd = process.cwd()) -> Config | null` — `null` when there is no config file (the off switch). A `Config` is `DEFAULTS` deep-merged with the file, plus `root`, `id`, `configPath`, and `defaulted` (the list of top-level keys the file did not set).
  - `loadConfigOrThrow(cwd)` — same, but throws an `Error` listing `validate`'s messages when the file is present and invalid.

- [ ] **Step 1: Write the failing test**

`test/config.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo } from './helpers/fixture.mjs';
import { DEFAULTS, findConfig, validate, loadConfig, loadConfigOrThrow } from '../lib/config.mjs';

const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

test('loadConfig returns null when there is no config — the off switch', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  assert.equal(loadConfig(r.root), null);
});

test('loadConfig fills every default and records which ones it filled', () => {
  const r = repo({ mode: 'offline', name: 'demo' });
  const cfg = loadConfig(r.root);
  assert.equal(cfg.mode, 'offline');
  assert.equal(cfg.name, 'demo');
  assert.equal(cfg.mainBranch, DEFAULTS.mainBranch);
  assert.equal(cfg.roadmaps.published, DEFAULTS.roadmaps.published);
  assert.equal(cfg.root, r.root);
  assert.match(cfg.id, /^[0-9a-f]{6}$/);
  assert.ok(cfg.defaulted.includes('mainBranch'));
  assert.ok(!cfg.defaulted.includes('mode'));
});

test('name defaults to the checkout directory name', () => {
  const r = repo();
  writeFileSync(join(r.root, '.orchestra', 'config.json'), JSON.stringify({ mode: 'offline' }));
  assert.equal(loadConfig(r.root).name, r.root.split('/').pop());
});

test('a nested object is merged key by key, not replaced wholesale', () => {
  const r = repo({ config: { roadmaps: { published: 'plans' } } });
  const cfg = loadConfig(r.root);
  assert.equal(cfg.roadmaps.published, 'plans');
  assert.equal(cfg.roadmaps.drafts, DEFAULTS.roadmaps.drafts);
});

test('findConfig walks up from a subdirectory', () => {
  const r = repo();
  const deep = join(r.root, 'a', 'b');
  mkdirSync(deep, { recursive: true });
  assert.equal(findConfig(deep), join(r.root, '.orchestra', 'config.json'));
});

test('validate rejects a missing or unknown mode', () => {
  assert.deepEqual(validate({}), ['config: "mode" is required and must be "online" or "offline"']);
  assert.deepEqual(validate({ mode: 'hybrid' }), ['config: "mode" is required and must be "online" or "offline"']);
  assert.deepEqual(validate({ mode: 'online' }), []);
});

test('validate rejects a gate with no name or no cmd, and duplicate gate names', () => {
  assert.deepEqual(validate({ mode: 'offline', gates: [{ cmd: 'x' }] }),
    ['config: gates[0] needs both "name" and "cmd"']);
  assert.deepEqual(validate({ mode: 'offline', gates: [{ name: 'a', cmd: 'x' }, { name: 'a', cmd: 'y' }] }),
    ['config: gate name "a" is used twice — a gate is named in its refusal, so names must be unique']);
});

test('validate rejects a port that is neither "auto" nor a usable number', () => {
  assert.deepEqual(validate({ mode: 'offline', monitor: { port: 80 } }),
    ['config: monitor.port must be "auto" or an integer between 1024 and 65535']);
  assert.deepEqual(validate({ mode: 'offline', monitor: { port: 'auto' } }), []);
  assert.deepEqual(validate({ mode: 'offline', monitor: { port: 4380 } }), []);
});

test('loadConfigOrThrow reports every error at once', () => {
  const r = repo();
  writeFileSync(join(r.root, '.orchestra', 'config.json'), JSON.stringify({ gates: [{}] }));
  assert.throws(() => loadConfigOrThrow(r.root), (e) =>
    e.message.includes('"mode" is required') && e.message.includes('gates[0]'));
});

test('an unparseable config is an error, never a silent off switch', () => {
  const r = repo();
  writeFileSync(join(r.root, '.orchestra', 'config.json'), '{ not json');
  assert.throws(() => loadConfig(r.root), /config\.json.*(JSON|parse)/i);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/config.test.mjs`
Expected: FAIL — `Cannot find module '../lib/config.mjs'`.

- [ ] **Step 3: Write the implementation**

`lib/config.mjs`:

```js
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
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/config.mjs test/config.test.mjs
git commit -m "feat(config): defaults, validation and the absent-config off switch"
```

---

### Task 4: `bin/orchestra` — the dispatcher and `doctor`

**Files:**
- Create: `bin/orchestra`, `lib/cli/doctor.mjs`
- Test: `test/cli.test.mjs`

**Interfaces:**
- Consumes: `loadConfigOrThrow` from `lib/config.mjs`.
- Produces:
  - an executable `bin/orchestra` that dispatches `process.argv[2]`;
  - `MACHINE_LEVEL = new Set(['init', 'doctor', 'instances', 'help'])` exported from `bin/orchestra`'s sibling `lib/cli/registry.mjs`, so later tasks add subcommands in one place;
  - `doctor(cfg) -> string` — the resolved configuration as text, naming every defaulted key and, for `mode: "offline"`, the sentence about single-machine visibility.

- [ ] **Step 1: Write the failing test**

`test/cli.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers/fixture.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orchestra');
const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

const run = (cwd, ...args) => {
  const r = execFileSync('node', [BIN, ...args], { cwd, encoding: 'utf8' });
  return r;
};

test('a subcommand in a project with no config exits 0 and prints nothing', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  assert.equal(run(r.root, 'roadmap', 'board'), '');
});

test('doctor answers even with no config', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  assert.match(run(r.root, 'doctor'), /no \.orchestra\/config\.json/);
});

test('doctor names the mode, the id and every defaulted key', () => {
  const r = repo({ mode: 'offline', name: 'demo' });
  const out = run(r.root, 'doctor');
  assert.match(out, /mode\s+offline/);
  assert.match(out, /name\s+demo/);
  assert.match(out, /[0-9a-f]{6}/);
  assert.match(out, /mainBranch.*\(default\)/);
});

test('doctor says what offline cannot answer', () => {
  const r = repo({ mode: 'offline' });
  assert.match(run(r.root, 'doctor'), /this machine only/i);
});

test('doctor does not say it in online mode', () => {
  const r = repo({ mode: 'online' });
  assert.doesNotMatch(run(r.root, 'doctor'), /this machine only/i);
});

test('an unknown subcommand exits non-zero and lists what exists', () => {
  const r = repo();
  assert.throws(
    () => execFileSync('node', [BIN, 'wat'], { cwd: r.root, encoding: 'utf8', stdio: 'pipe' }),
    (e) => e.status === 2 && /unknown subcommand "wat"/.test(e.stderr),
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/cli.test.mjs`
Expected: FAIL — `bin/orchestra` does not exist.

- [ ] **Step 3: Write the registry and `doctor`**

`lib/cli/registry.mjs`:

```js
// Every subcommand, in one table. `machine` marks the ones that answer without a project config —
// they are the exception to the off switch, and there are exactly three of them.
export const COMMANDS = new Map();

export const register = (name, { machine = false, run }) => COMMANDS.set(name, { machine, run });
```

`lib/cli/doctor.mjs`:

```js
import { DEFAULTS } from '../config.mjs';

const pad = (s, n) => String(s).padEnd(n);

export function doctorText(cfg) {
  if (!cfg) return 'orchestra: no .orchestra/config.json here — this project has not opted in.\nRun `orchestra init` to set it up.\n';
  const rows = [
    ['name', cfg.name], ['id', cfg.id], ['mode', cfg.mode], ['root', cfg.root],
    ['language', cfg.language], ['mainBranch', cfg.mainBranch], ['worktrees', cfg.worktrees],
    ['roadmaps.drafts', cfg.roadmaps.drafts], ['roadmaps.published', cfg.roadmaps.published],
    ['branchTests', cfg.branchTests ?? '—'], ['gates', cfg.gates.map((g) => g.name).join(', ') || '—'],
    ['ledgers', cfg.ledgers.join(', ') || '—'], ['queue', cfg.queue ?? '—'],
    ['monitor.port', cfg.monitor.port], ['tickets.file', cfg.tickets.file],
  ];
  const top = (k) => k.split('.')[0];
  const lines = rows.map(([k, v]) =>
    `  ${pad(k, 20)} ${v}${cfg.defaulted.includes(top(k)) ? '   (default)' : ''}`);
  const note = cfg.mode === 'offline'
    ? '\n  Offline mode: "is somebody already working on this" is answered for this machine only.\n  That question is the whole reason the online mode exists.\n'
    : '';
  return `orchestra — ${cfg.name}\n${lines.join('\n')}\n${note}`;
}

export const doctor = (cfg) => { process.stdout.write(doctorText(cfg)); };

export const DEFAULT_KEYS = Object.keys(DEFAULTS);
```

- [ ] **Step 4: Write the dispatcher**

`bin/orchestra`:

```js
#!/usr/bin/env node
// The plugin's one entry point. Everything a skill, a hook or a human runs comes through here.
import { loadConfigOrThrow } from '../lib/config.mjs';
import { COMMANDS, register } from '../lib/cli/registry.mjs';
import { doctor } from '../lib/cli/doctor.mjs';

register('doctor', { machine: true, run: ({ cfg }) => doctor(cfg) });

const [name, ...rest] = process.argv.slice(2);

if (!name || name === 'help' || name === '--help' || name === '-h') {
  process.stdout.write(`orchestra <subcommand>\n\n${[...COMMANDS.keys()].sort().map((k) => `  ${k}`).join('\n')}\n`);
  process.exit(0);
}

const cmd = COMMANDS.get(name);
if (!cmd) {
  process.stderr.write(`orchestra: unknown subcommand "${name}"\nknown: ${[...COMMANDS.keys()].sort().join(', ')}\n`);
  process.exit(2);
}

let cfg = null;
try {
  cfg = loadConfigOrThrow(process.cwd());
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exit(2);
}

// The off switch: outside the three machine-level commands, no config means no behaviour at all.
if (!cfg && !cmd.machine) process.exit(0);

try {
  await cmd.run({ cfg, args: rest });
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
}
```

Make it executable and, so the dispatcher is testable before any roadmap command exists, register a
placeholder that later tasks replace:

```bash
chmod +x bin/orchestra
```

Add to `bin/orchestra`, directly under the `doctor` registration:

```js
// Replaced in task 14 by the real roadmap command; present now so the off-switch test has a
// non-machine subcommand to prove itself against.
register('roadmap', { run: () => { process.stdout.write('roadmap: not implemented yet\n'); } });
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add bin/orchestra lib/cli/ test/cli.test.mjs
git commit -m "feat(cli): dispatcher, the off switch and doctor"
```

---

### Task 5: `lib/roadmap/parse.mjs` — the grammar (verbatim port)

**Files:**
- Create: `lib/roadmap/parse.mjs`
- Test: `test/parse.test.mjs`

**Interfaces:**
- Consumes: nothing. This module is pure: text in, rows out — no git, no gh, no fs.
- Produces: `FIELD_NAMES`, `EMPTY` (U+2014), `parseRoadmap(text, { source }) -> { roadmap, tasks, errors }`. A task row carries `id, title, line, roadmap, key, order, deps, touches, branch, design, lane, why, acceptance, fields`.

- [ ] **Step 1: Copy the source verbatim**

```bash
cp /Users/nicolasrabault/Projects/planetCraft/tools/roadmap/parse.mjs lib/roadmap/parse.mjs
```

Then make exactly one edit: in the header comment, change `docs/roadmap-format.md is the
human-facing contract this file implements` to name this repository's copy,
`docs/roadmap-format.md` (create that file in task 14 from `planetCraft`'s). Change nothing else —
the file imports nothing and touches no path.

- [ ] **Step 2: Write the test**

`test/parse.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoadmap, EMPTY, FIELD_NAMES } from '../lib/roadmap/parse.mjs';
import { ROADMAP } from './helpers/fixture.mjs';

test('a well-formed roadmap parses into one qualified task', () => {
  const { roadmap, tasks, errors } = parseRoadmap(ROADMAP, { source: 'demo.md' });
  assert.deepEqual(errors, []);
  assert.equal(roadmap, 'demo');
  assert.equal(tasks.length, 1);
  const t = tasks[0];
  assert.equal(t.id, 'D1');
  assert.equal(t.key, 'demo/D1');
  assert.equal(t.title, 'First thing');
  assert.equal(t.order, 1);
  assert.deepEqual(t.deps, []);
  assert.deepEqual(t.touches, ['README.md']);
  assert.equal(t.branch, 'demo/d1-first-thing');
  assert.equal(t.design, false);
  assert.equal(t.lane, null);
  assert.match(t.why, /^The player sees/);
  assert.match(t.acceptance, /^A test asserts/);
});

test('the em dash is the only way to say "none"', () => {
  const { tasks } = parseRoadmap(ROADMAP.replace('- **Deps** —', '- **Deps** D0, demo/D9'));
  assert.deepEqual(tasks[0].deps, ['D0', 'demo/D9']);
  assert.equal(EMPTY, '—');
});

test('an unknown field is a shape error carrying the field and the task', () => {
  const { errors } = parseRoadmap(ROADMAP.replace('- **Lane** —', '- **Status** landed'));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, 'Status');
  assert.equal(errors[0].task, 'D1');
});

test('a field written twice is an error', () => {
  const { errors } = parseRoadmap(ROADMAP.replace('- **Lane** —', '- **Order** 2'));
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /appears twice/);
});

test('unclosed frontmatter is reported', () => {
  const { errors } = parseRoadmap('---\nroadmap: demo\n\n### A1 — x\n');
  assert.match(errors[0].message, /never closed/);
});

test('FIELD_NAMES is the whole grammar and holds no status field', () => {
  assert.deepEqual(FIELD_NAMES, ['Roadmap', 'Order', 'Deps', 'Touches', 'Branch', 'Design', 'Lane']);
});
```

- [ ] **Step 3: Run the tests**

Run: `npm test`
Expected: PASS. If the "unknown field" test fails with two errors instead of one, the fixture's
task is missing a required field — fix the fixture, not the parser.

- [ ] **Step 4: Commit**

```bash
git add lib/roadmap/parse.mjs test/parse.test.mjs
git commit -m "feat(roadmap): port the grammar parser verbatim"
```

---

### Task 6: `lib/roadmap/lint.mjs` — the rules (verbatim port)

**Files:**
- Create: `lib/roadmap/lint.mjs`
- Test: `test/lint.test.mjs`

**Interfaces:**
- Consumes: `FIELD_NAMES`, `EMPTY` from `lib/roadmap/parse.mjs`.
- Produces: `STATUS_FIELDS`, `lintRoadmap(parsed, { source, fileExists, knownKeys }) -> Violation[]` where a `Violation` is `{ level: 'error' | 'warning', source, line, message }`, and `formatViolations(v) -> string[]`.

- [ ] **Step 1: Copy the source verbatim**

```bash
cp /Users/nicolasrabault/Projects/planetCraft/tools/roadmap/lint.mjs lib/roadmap/lint.mjs
```

No edits at all: its only import is `./parse.mjs`, which now sits beside it. Its comments name
`publish.mjs`'s `planPublish` and `cmdPublish`; those exist here too (tasks 10 and 14), so the
sentences stay true.

- [ ] **Step 2: Write the test**

`test/lint.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoadmap } from '../lib/roadmap/parse.mjs';
import { lintRoadmap, STATUS_FIELDS } from '../lib/roadmap/lint.mjs';
import { ROADMAP } from './helpers/fixture.mjs';

const lint = (text, opts = {}) =>
  lintRoadmap(parseRoadmap(text, { source: 'demo.md' }), { source: 'demo.md', ...opts });

test('the fixture roadmap is clean', () => {
  assert.deepEqual(lint(ROADMAP), []);
});

test('a status field is refused by name, with the reason', () => {
  const v = lint(ROADMAP.replace('- **Lane** —', '- **Landed** yes'));
  assert.equal(v.length, 2); // the status field itself, plus the now-missing Lane
  assert.ok(v.some((x) => /"Landed" is a status field, and status is derived/.test(x.message)));
  assert.ok(STATUS_FIELDS.includes('Landed'));
});

test('a missing roadmap: frontmatter is refused, because publish cannot survive it', () => {
  const v = lint(ROADMAP.replace('---\nroadmap: demo\n---\n', ''));
  assert.ok(v.some((x) => /no `roadmap:` in the frontmatter/.test(x.message)));
});

test('a branch whose last segment does not name its task is refused', () => {
  const v = lint(ROADMAP.replace('demo/d1-first-thing', 'demo/something-else'));
  assert.ok(v.some((x) => /must start with "d1-"/.test(x.message)));
});

test('a bare dep that resolves to nothing is an error; a qualified one is only a warning', () => {
  const bare = lint(ROADMAP.replace('- **Deps** —', '- **Deps** D9'));
  assert.equal(bare.find((x) => /dep "D9"/.test(x.message)).level, 'error');
  const qualified = lint(ROADMAP.replace('- **Deps** —', '- **Deps** other/D9'));
  assert.equal(qualified.find((x) => /dep "other\/D9"/.test(x.message)).level, 'warning');
});

test('Touches naming a file that does not exist is refused', () => {
  const v = lint(ROADMAP, { fileExists: () => false });
  assert.ok(v.some((x) => /Touches "README.md" does not exist/.test(x.message)));
});

test('a key already taken by ANOTHER file is refused', () => {
  const v = lint(ROADMAP, { knownKeys: new Set(['demo/D1']) });
  assert.ok(v.some((x) => /key "demo\/D1" is already taken/.test(x.message)));
});

test('a task with no Why or no Acceptance is refused', () => {
  const v = lint(ROADMAP.replace('**Why.** The player sees the first thing.\n\n', ''));
  assert.ok(v.some((x) => /no paragraph beginning "\*\*Why/.test(x.message)));
});
```

- [ ] **Step 3: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/roadmap/lint.mjs test/lint.test.mjs
git commit -m "feat(roadmap): port the grammar rules verbatim"
```

---

### Task 7: `lib/register/state.mjs` — the register's file, row shape and root guard

**Files:**
- Create: `lib/register/state.mjs`
- Test: `test/state.test.mjs`

**Interfaces:**
- Consumes: `orchestraDir`, `assertRoot` from `lib/paths.mjs`.
- Produces:
  - `STATE_REL = '.orchestra/state.json'`
  - `statePath(root) -> string`
  - `emptyState(root) -> State` — `{ version: 1, root, adopted: false, conductor: { session: null, language: null, inboxSeen: null }, tasks: [] }`
  - `readState(root) -> State | null` — `null` when the file does not exist; throws on unparseable JSON.
  - `writeState(root, state) -> void` — calls `assertRoot(state.root, root)`, stamps `root` when absent, writes through a temp file and `renameSync`.
  - `qualifyDep(roadmapSlug, dep) -> string`
  - `registerRow(task, { roadmapSlug, status, note }) -> Row`
  - `FOREIGN = 'dropped'`

- [ ] **Step 1: Write the failing test**

`test/state.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, existsSync } from 'node:fs';
import { makeRepo } from './helpers/fixture.mjs';
import {
  statePath, emptyState, readState, writeState, registerRow, qualifyDep, FOREIGN,
} from '../lib/register/state.mjs';

const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

test('readState is null before anything is written', () => {
  assert.equal(readState(repo().root), null);
});

test('writeState then readState round-trips and stamps the root', () => {
  const r = repo();
  writeState(r.root, emptyState(r.root));
  const s = readState(r.root);
  assert.equal(s.root, r.root);
  assert.equal(s.adopted, false);
  assert.deepEqual(s.tasks, []);
  assert.ok(existsSync(statePath(r.root)));
});

test('writeState REFUSES a state recorded for another project, naming both paths', () => {
  const a = repo();
  const b = repo();
  const foreign = emptyState(b.root);
  assert.throws(
    () => writeState(a.root, foreign),
    (e) => e.message.includes(a.root) && e.message.includes(b.root),
  );
});

test('an unparseable register is an error, not an empty one', () => {
  const r = repo();
  writeFileSync(statePath(r.root), '{ broken');
  assert.throws(() => readState(r.root), /state\.json/);
});

test('qualifyDep is idempotent on an already-qualified dep', () => {
  assert.equal(qualifyDep('demo', 'D2'), 'demo/D2');
  assert.equal(qualifyDep('demo', 'other/D2'), 'other/D2');
});

test('registerRow carries the SLUG, qualified deps, and every runtime field as null or empty', () => {
  const task = {
    key: 'demo/D1', id: 'D1', title: 'First thing', order: 1, roadmap: 'demo',
    deps: ['D0', 'other/X1'], touches: ['README.md'], lane: null,
    branch: 'demo/d1-first-thing', design: false,
  };
  const row = registerRow(task, { roadmapSlug: 'demo', note: 'hello' });
  assert.equal(row.id, 'demo/D1');
  assert.equal(row.roadmap, 'demo');
  assert.deepEqual(row.deps, ['demo/D0', 'other/X1']);
  assert.equal(row.status, 'todo');
  assert.deepEqual(row.subjects, []);
  assert.deepEqual(row.pending, []);
  assert.equal(row.session, null);
  assert.equal(row.port, null);
  assert.equal(row.note, 'hello');
});

test('FOREIGN is terminal so nothing schedules another developer\'s task here', () => {
  assert.equal(FOREIGN, 'dropped');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/state.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`lib/register/state.mjs`:

```js
// The register: what THIS MACHINE is doing about the roadmap's tasks. The roadmap says what the
// work is; git says what landed; this says which session is on it, what it is waiting for and what
// it was told. Nothing here is a source of truth about status — that is derived (lib/roadmap/board).
import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { orchestraDir, assertRoot } from '../paths.mjs';

export const STATE_REL = '.orchestra/state.json';
export const statePath = (root) => join(orchestraDir(root), 'state.json');

export const emptyState = (root) => ({
  version: 1,
  root,
  adopted: false,
  conductor: { session: null, language: null, inboxSeen: null },
  tasks: [],
});

export function readState(root) {
  const p = statePath(root);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`orchestra: ${p} did not parse (${e.message}) — most likely a read mid-write; try again`);
  }
}

// Written through a temp file and a rename so a reader can never see half of it: the register is
// re-read by a page, a heartbeat and a conductor at once, and a torn read reads as a lost run.
export function writeState(root, state) {
  assertRoot(state.root, root);
  const p = statePath(root);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ ...state, root }, null, 2)}\n`);
  renameSync(tmp, p);
}

// A row's `deps` must be byte-for-byte comparable with another row's `id`, both qualified: the
// scheduler matches them with `===` and throws rather than resolve anything at read time.
export const qualifyDep = (roadmap, d) => (d.includes('/') ? d : `${roadmap}/${d}`);

// A task this machine may not take is enroled terminal, so nothing schedules it and the heartbeat
// does not stay awake for another developer's programme.
export const FOREIGN = 'dropped';

// The row shape, in one place. Every runtime field is written as null or empty rather than omitted:
// the page, the inbox and the archiver all read them, and an absent `pending` is one `?? []` away
// from crashing a request handler.
//
// `roadmap` is the SLUG. planetCraft stored a file path here and had to carry a rule about not
// confusing the two; the slug is what both stores already key on, and it is what a page derives a
// frame name from.
export function registerRow(task, { roadmapSlug, status = 'todo', note = '' }) {
  return {
    id: task.key,
    order: task.order ?? null,
    title: task.title,
    roadmap: roadmapSlug,
    deps: (task.deps ?? []).map((d) => qualifyDep(task.roadmap, d)),
    touches: task.touches ?? [],
    lane: task.lane ?? null,
    branch: task.branch,
    subjects: [],
    status,
    design: Boolean(task.design),
    model: null,
    session: null,
    sessionName: null,
    port: null,
    note,
    pending: [],
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/register/state.mjs test/state.test.mjs
git commit -m "feat(register): state file, row shape and the cross-project write guard"
```

---

### Task 8: `lib/roadmap/policy.mjs` — who may take what (verbatim extract)

**Files:**
- Create: `lib/roadmap/policy.mjs`
- Test: `test/policy.test.mjs`

**Interfaces:**
- Consumes: nothing. Pure.
- Produces:
  - `mayTake(x) -> boolean` — `!x || x.mine !== false || x.open === true`.
  - `startVerdict(row, { stale }) -> { ok: true } | { ok: false, reason: 'foreign' | 'stale' | 'unclaimed' }`.

These are lifted unchanged from `planetCraft`'s `tools/roadmap/ownership.mjs`; they are policy over
`{ mine, open, status, claimedByMe }` and name nothing GitHub-specific, which is why they live here
and not in the GitHub store. The P5 worktree hook is their third reader.

- [ ] **Step 1: Write the failing test**

`test/policy.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mayTake, startVerdict } from '../lib/roadmap/policy.mjs';

test('an unknown ownership reads as mine — the offline board gets the answer it always got', () => {
  assert.equal(mayTake(null), true);
  assert.equal(mayTake(undefined), true);
  assert.equal(mayTake({}), true);
});

test('someone else\'s roadmap is refused unless they opened it', () => {
  assert.equal(mayTake({ mine: false, open: false }), false);
  assert.equal(mayTake({ mine: false, open: true }), true);
});

test('landed is checked first, so a finished row never blocks its own branch name', () => {
  assert.deepEqual(startVerdict({ status: 'landed', mine: false, open: false }), { ok: true });
});

test('foreign beats stale — waiting for the network never makes a nominative roadmap mine', () => {
  assert.deepEqual(
    startVerdict({ status: 'todo', mine: false, open: false }, { stale: 'cached' }),
    { ok: false, reason: 'foreign' },
  );
});

test('a stale board refuses even my own task', () => {
  assert.deepEqual(
    startVerdict({ status: 'claimed', claimedByMe: true }, { stale: 'cached' }),
    { ok: false, reason: 'stale' },
  );
});

test('claimed by me passes; anything else is unclaimed', () => {
  assert.deepEqual(startVerdict({ status: 'claimed', claimedByMe: true }), { ok: true });
  assert.deepEqual(startVerdict({ status: 'todo' }), { ok: false, reason: 'unclaimed' });
  assert.deepEqual(startVerdict({ status: 'claimed', claimedByMe: false }), { ok: false, reason: 'unclaimed' });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/policy.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`lib/roadmap/policy.mjs`: copy the `mayTake` and `startVerdict` functions, **with their comment
blocks verbatim**, out of
`/Users/nicolasrabault/Projects/planetCraft/tools/roadmap/ownership.mjs`. Add this header:

```js
// May this machine take this task, and may work start on it here and now?
//
// ONE predicate with three readers — the board's `schedulable`, the worktree guard, and `claim` —
// so a hook, a ready set and a CLI cannot each grow their own slightly different version of the
// same permission. It reads an ownership record or a board row alike: both carry `mine` and `open`,
// and `mine !== false` means a caller that knows no ownership (an OFFLINE board, where there is
// exactly one owner) gets the permissive answer, which is the correct one there.
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/roadmap/policy.mjs test/policy.test.mjs
git commit -m "feat(roadmap): extract the take/start policy, shared by board, hook and claim"
```

---

### Task 9: `lib/store/files.mjs` and `lib/store/index.mjs` — the offline backend

**Files:**
- Create: `lib/store/index.mjs`, `lib/store/files.mjs`
- Test: `test/store-files.test.mjs`

**Interfaces:**
- Consumes: `parseRoadmap` (task 5), `lintRoadmap` (task 6), config (task 3).
- Produces:
  - `makeStore(cfg, deps = {}) -> Store` from `lib/store/index.mjs`, dispatching on `cfg.mode` and
    passing `deps` straight through. The file store takes none; the GitHub store takes `{ gh }` or
    `{ run }` (task 11).
  - A `Store`, with exactly these methods:
    - `whoami() -> string`
    - `drafts() -> [{ slug, path }]` — files under `roadmaps.drafts`
    - `programmes() -> [{ slug, owner, open, state, ref }]`
    - `list() -> Task[]` — every published roadmap's tasks, each with `ref` added
    - `publish(draftPath) -> { slug, keys, ref }`
    - `claim(key, who) -> { ok: true } | { ok: false, holder }`
    - `release(key, { force }) -> { ok: true }`
    - `setStatus(key, status) -> { noop: boolean }`
    - `close(key, { subject }) -> { noop: boolean }`
    - `openRoadmap(slug) -> { noop: boolean, why?: string }`
    - `reserve(slug) -> { noop: boolean, why?: string }`
    - `overlay() -> Map<key, { status, ref, owner, open, mine, programme, programmeState }>`
  - `FileStore.overlay()` returns an **empty Map**, which is the whole offline derivation: with no
    overlay entry, the board falls through to git plus the register.

- [ ] **Step 1: Write the failing test**

`test/store-files.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { makeRepo, ROADMAP } from './helpers/fixture.mjs';
import { loadConfig } from '../lib/config.mjs';
import { makeStore } from '../lib/store/index.mjs';

const repos = [];
function offline() {
  const r = makeRepo({ mode: 'offline' });
  repos.push(r);
  const cfg = loadConfig(r.root);
  return { r, cfg, store: makeStore(cfg) };
}
after(() => repos.forEach((x) => x.cleanup()));

const draft = ({ r, cfg }, text = ROADMAP, slug = 'demo') => {
  const dir = join(r.root, cfg.roadmaps.drafts);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${slug}.md`);
  writeFileSync(p, text);
  return p;
};

test('with nothing published, list and programmes are empty', () => {
  const { store } = offline();
  assert.deepEqual(store.list(), []);
  assert.deepEqual(store.programmes(), []);
});

test('drafts are visible and are NOT tasks', () => {
  const ctx = offline();
  draft(ctx);
  assert.deepEqual(ctx.store.drafts().map((d) => d.slug), ['demo']);
  assert.deepEqual(ctx.store.list(), []);
});

test('publish moves the draft, commits it, and makes its tasks visible', () => {
  const ctx = offline();
  const p = draft(ctx);
  const res = ctx.store.publish(p);
  assert.equal(res.slug, 'demo');
  assert.deepEqual(res.keys, ['demo/D1']);

  const published = join(ctx.r.root, ctx.cfg.roadmaps.published, 'demo.md');
  assert.ok(existsSync(published));
  assert.equal(readFileSync(published, 'utf8'), ROADMAP);
  assert.ok(!existsSync(p), 'the draft is gone');

  const log = execFileSync('git', ['log', '--oneline', '-1'], { cwd: ctx.r.root, encoding: 'utf8' });
  assert.match(log, /roadmap: publish demo/);

  const tracked = execFileSync('git', ['ls-files', ctx.cfg.roadmaps.published], { cwd: ctx.r.root, encoding: 'utf8' });
  assert.match(tracked, /demo\.md/);

  assert.deepEqual(ctx.store.list().map((t) => t.key), ['demo/D1']);
  assert.deepEqual(ctx.store.programmes().map((p2) => p2.slug), ['demo']);
});

test('publish refuses a draft that does not lint, and moves nothing', () => {
  const ctx = offline();
  const p = draft(ctx, ROADMAP.replace('- **Lane** —', '- **Landed** yes'));
  assert.throws(() => ctx.store.publish(p), /status field|missing required field/);
  assert.ok(existsSync(p), 'the draft is still there');
  assert.ok(!existsSync(join(ctx.r.root, ctx.cfg.roadmaps.published, 'demo.md')));
});

test('republishing the same slug updates the file in place', () => {
  const ctx = offline();
  ctx.store.publish(draft(ctx));
  const second = ROADMAP.replace('First thing', 'First thing, revised');
  ctx.store.publish(draft(ctx, second));
  assert.equal(ctx.store.list()[0].title, 'First thing, revised');
});

test('everything is mine, everything is open, and the commands that cannot apply say why', () => {
  const ctx = offline();
  ctx.store.publish(draft(ctx));
  const [p] = ctx.store.programmes();
  assert.equal(p.open, true);
  assert.equal(p.owner, ctx.store.whoami());
  assert.equal(ctx.store.openRoadmap('demo').noop, true);
  assert.match(ctx.store.reserve('demo').why, /one machine/i);
  assert.equal(ctx.store.setStatus('demo/D1', 'landed').noop, true);
  assert.equal(ctx.store.close('demo/D1', { subject: 'x' }).noop, true);
  assert.equal(ctx.store.claim('demo/D1', 'me').ok, true);
});

test('the overlay is EMPTY offline — the board derives from git and the register alone', () => {
  const ctx = offline();
  ctx.store.publish(draft(ctx));
  assert.equal(ctx.store.overlay().size, 0);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/store-files.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `lib/store/files.mjs`**

```js
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
```

- [ ] **Step 4: Write `lib/store/index.mjs`**

```js
// One interface, two backends. Every roadmap command is written against this and against nothing
// else, which is what keeps the two modes from drifting into two behaviours.
import { makeFileStore } from './files.mjs';
import { makeGithubStore } from './github/index.mjs';

export function makeStore(cfg, deps = {}) {
  if (cfg.mode === 'offline') return makeFileStore(cfg, deps);
  if (cfg.mode === 'online') return makeGithubStore(cfg, deps);
  throw new Error(`orchestra: unknown mode "${cfg.mode}"`);
}
```

Task 11 creates `lib/store/github/index.mjs`. Until it does, this import fails — so for this task,
temporarily create `lib/store/github/index.mjs` containing only:

```js
export const makeGithubStore = () => { throw new Error('online mode: not implemented yet'); };
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/store/ test/store-files.test.mjs
git commit -m "feat(store): the offline backend — committed markdown, an empty overlay"
```

---

### Task 10: `lib/store/github/gh.mjs` and `issues.mjs` — the adapter and the issue rendering

**Files:**
- Create: `lib/store/github/gh.mjs`, `lib/store/github/issues.mjs`
- Test: `test/store-github-issues.test.mjs`

**Interfaces:**
- Consumes: `EMPTY` from `lib/roadmap/parse.mjs`.
- Produces:
  - `makeGh({ run }) -> Gh` — the only place in the plugin that spawns `gh`; `run` is injectable so
    everything above it is testable with a recorder and no network.
  - `LABELS`, `renderTaskBlock(t)`, `taskTitle(t)`, `keyFromTitle(title)`, `renderTaskIssue(t, programmeNumber)`,
    `renderProgrammeIssue({ roadmap, title, prose, tasks, numbers })`, `planPublish({ roadmap, tasks, existing })`,
    `publishIssues(gh, { roadmap, title, prose, tasks })`.

- [ ] **Step 1: Copy both sources**

```bash
mkdir -p lib/store/github
cp /Users/nicolasrabault/Projects/planetCraft/tools/roadmap/github.mjs lib/store/github/gh.mjs
cp /Users/nicolasrabault/Projects/planetCraft/tools/roadmap/publish.mjs lib/store/github/issues.mjs
```

Then make exactly these edits, and no others:

1. In `issues.mjs`, change the import to `import { EMPTY } from '../../roadmap/parse.mjs';`
2. In `issues.mjs`, rename the exported `publish` function to `publishIssues` (the store's own
   `publish` takes a draft path, and two functions called `publish` one import apart is the kind of
   collision that costs an afternoon). Update its own doc comment to say `publishIssues`.
3. Keep every comment. `gh.mjs`'s warning about `gh issue list` silently truncating at the `--limit`
   cap is load-bearing and must survive.

- [ ] **Step 2: Write the test**

`test/store-github-issues.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoadmap } from '../lib/roadmap/parse.mjs';
import { ROADMAP } from './helpers/fixture.mjs';
import {
  LABELS, renderTaskBlock, taskTitle, keyFromTitle, renderTaskIssue,
  renderProgrammeIssue, planPublish, publishIssues,
} from '../lib/store/github/issues.mjs';

const task = parseRoadmap(ROADMAP).tasks[0];

test('a rendered task block re-parses to the same task — one grammar, two channels', () => {
  const round = parseRoadmap(`---\nroadmap: demo\n---\n\n${renderTaskBlock(task)}`);
  assert.deepEqual(round.errors, []);
  const t = round.tasks[0];
  assert.equal(t.key, task.key);
  assert.equal(t.title, task.title);
  assert.equal(t.branch, task.branch);
  assert.deepEqual(t.touches, task.touches);
  assert.equal(t.why, task.why);
  assert.equal(t.acceptance, task.acceptance);
});

test('the title is the idempotence key and round-trips', () => {
  assert.equal(taskTitle(task), 'demo/D1 — First thing');
  assert.equal(keyFromTitle(taskTitle(task)), 'demo/D1');
});

test('a new task issue is born labelled status:todo, and there is no status:done', () => {
  const i = renderTaskIssue(task, 7);
  assert.deepEqual(i.labels, [LABELS.task, LABELS.todo]);
  assert.match(i.body, /^Programme: #7$/m);
  assert.equal(LABELS.done, undefined);
});

test('planPublish matches on the title, so publishing twice updates', () => {
  const existing = [{ number: 12, title: taskTitle(task), labels: [LABELS.task] }];
  const plan = planPublish({ roadmap: 'demo', tasks: [task], existing });
  assert.deepEqual(plan.create, []);
  assert.deepEqual(plan.update.map((u) => u.number), [12]);
});

test('planPublish ignores a task belonging to another roadmap', () => {
  const foreign = { ...task, roadmap: 'other', key: 'other/D1' };
  const plan = planPublish({ roadmap: 'demo', tasks: [foreign], existing: [] });
  assert.deepEqual(plan.create, []);
  assert.deepEqual(plan.update, []);
});

test('publishIssues creates the programme first, then rewrites it with the task numbers', () => {
  const calls = [];
  let next = 100;
  const gh = {
    ensureLabels: (n) => calls.push(['ensureLabels', n]),
    listIssues: () => [],
    createIssue: (i) => { calls.push(['createIssue', i.title]); return next++; },
    updateIssue: (n, i) => calls.push(['updateIssue', n, i.title]),
    reopenIssue: (n) => calls.push(['reopenIssue', n]),
  };
  const res = publishIssues(gh, { roadmap: 'demo', title: 'Demo', prose: 'Prose.', tasks: [task] });
  assert.equal(res.programme, 100);
  assert.deepEqual(res.created, ['demo/D1']);
  assert.equal(calls[1][1], 'demo — Demo');            // the programme is created first
  assert.equal(calls[2][1], 'demo/D1 — First thing');  // then the task
  assert.equal(calls[3][0], 'updateIssue');            // then the programme is rewritten
  assert.equal(calls[3][1], 100);
});
```

Note: `publishIssues` is `async` in the source. If the test above fails because it returns a
promise, `await` it and mark the test callback `async` — do not change the source's signature.

- [ ] **Step 3: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/store/github/gh.mjs lib/store/github/issues.mjs test/store-github-issues.test.mjs
git commit -m "feat(store): port the gh adapter and the issue rendering"
```

---

### Task 11: `lib/store/github/index.mjs` — the online backend

**Files:**
- Create: `lib/store/github/ownership.mjs`, `lib/store/github/index.mjs` (replacing the stub from task 9)
- Test: `test/store-github.test.mjs`

**Interfaces:**
- Consumes: `makeGh`, `LABELS`, `keyFromTitle`, `publishIssues` (task 10); `parseRoadmap` (task 5); `lintRoadmap` (task 6).
- Produces:
  - `ownership.mjs`: `OPEN_LABEL`, `programmeOf(body)`, `ownershipIndex({ taskIssues, programmeIssues, me })`, `programmeForRoadmap(programmeIssues, roadmap)` — ported verbatim from `planetCraft`'s `tools/roadmap/ownership.mjs` **minus** `mayTake` and `startVerdict`, which task 8 already owns; its `keyFromTitle` import becomes `./issues.mjs`.
  - `makeGithubStore(cfg, { run }) -> Store` with the same method set as `makeFileStore`, plus a non-empty `overlay()`.
  - `deriveSharedStatus(issue) -> 'todo' | 'claimed' | 'landed'` — ported from `planetCraft`'s `board.mjs`, and living here because it reads an issue.

- [ ] **Step 1: Port ownership**

```bash
cp /Users/nicolasrabault/Projects/planetCraft/tools/roadmap/ownership.mjs lib/store/github/ownership.mjs
```

Edits: change the import to `import { keyFromTitle } from './issues.mjs';`, and delete `mayTake`
and `startVerdict` together with their comment blocks (they are in `lib/roadmap/policy.mjs`). Leave
everything else byte for byte.

- [ ] **Step 2: Write the failing test**

`test/store-github.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, ROADMAP } from './helpers/fixture.mjs';
import { loadConfig } from '../lib/config.mjs';
import { makeStore } from '../lib/store/index.mjs';
import { LABELS, taskTitle } from '../lib/store/github/issues.mjs';
import { parseRoadmap } from '../lib/roadmap/parse.mjs';

const repos = [];
const task = parseRoadmap(ROADMAP).tasks[0];

// A recorder in place of the `gh` CLI: every store method is exercised with no network.
function fakeGh({ issues = [], me = 'nico' } = {}) {
  const calls = [];
  const state = issues.map((i) => ({ labels: [], assignees: [], state: 'open', body: '', ...i }));
  let next = 200;
  return {
    calls,
    state,
    gh: {
      me: () => me,
      ensureLabels: () => calls.push(['ensureLabels']),
      listIssues: ({ labels = [] } = {}) =>
        state.filter((i) => labels.every((l) => i.labels.includes(l))),
      createIssue: (i) => { const n = next++; state.push({ number: n, ...i, state: 'open', assignees: [] }); calls.push(['create', i.title]); return n; },
      updateIssue: (n, i) => { calls.push(['update', n]); Object.assign(state.find((x) => x.number === n), i); },
      reopenIssue: (n) => { calls.push(['reopen', n]); state.find((x) => x.number === n).state = 'open'; },
      closeIssue: (n) => { calls.push(['close', n]); state.find((x) => x.number === n).state = 'closed'; },
      addLabel: (n, l) => state.find((x) => x.number === n).labels.push(l),
      removeLabel: () => {},
      assign: (n, who) => state.find((x) => x.number === n).assignees.push(who),
      listComments: () => [],
      addComment: () => {},
    },
  };
}

function online(fake) {
  const r = makeRepo({ mode: 'online' });
  repos.push(r);
  const cfg = loadConfig(r.root);
  return { r, cfg, store: makeStore(cfg, { gh: fake.gh }) };
}
after(() => repos.forEach((x) => x.cleanup()));

test('list reads task issues back through the SAME parser', () => {
  const f = fakeGh({
    issues: [{
      number: 5, title: taskTitle(task), labels: [LABELS.task],
      body: `### D1 — First thing\n\n- **Roadmap** demo\n- **Order** 1\n- **Deps** —\n- **Touches** \`README.md\`\n- **Branch** \`demo/d1-first-thing\`\n- **Design** no\n- **Lane** —\n\n**Why.** w\n\n**Acceptance.** a\n\nProgramme: #1\n`,
    }],
  });
  const { store } = online(f);
  const rows = store.list();
  assert.deepEqual(rows.map((t) => t.key), ['demo/D1']);
  assert.equal(rows[0].ref, 5);
});

test('the overlay reports status, owner and openness — and it is NOT empty', () => {
  const f = fakeGh({
    me: 'nico',
    issues: [
      { number: 1, title: 'demo — Demo', labels: [LABELS.programme], author: 'nico', body: '- **Roadmap** demo\n' },
      { number: 5, title: taskTitle(task), labels: [LABELS.task, LABELS.wip], assignees: ['nico'], body: 'Programme: #1\n' },
    ],
  });
  const { store } = online(f);
  const o = store.overlay();
  assert.equal(o.size, 1);
  assert.deepEqual(o.get('demo/D1'), {
    status: 'claimed', ref: 5, owner: 'nico', open: false, mine: true,
    programme: 1, programmeState: 'open',
  });
});

test('a closed issue reads landed whoever owns it', () => {
  const f = fakeGh({
    me: 'nico',
    issues: [
      { number: 1, title: 'demo — Demo', labels: [LABELS.programme], author: 'someone', body: '- **Roadmap** demo\n' },
      { number: 5, title: taskTitle(task), labels: [LABELS.task], state: 'closed', body: 'Programme: #1\n' },
    ],
  });
  assert.equal(online(f).store.overlay().get('demo/D1').status, 'landed');
});

test("another developer's roadmap is not mine, and openRoadmap adds exactly one label", () => {
  const f = fakeGh({
    me: 'nico',
    issues: [
      { number: 1, title: 'demo — Demo', labels: [LABELS.programme], author: 'someone', body: '- **Roadmap** demo\n' },
      { number: 5, title: taskTitle(task), labels: [LABELS.task], body: 'Programme: #1\n' },
    ],
  });
  const { store } = online(f);
  assert.equal(store.overlay().get('demo/D1').mine, false);
  store.openRoadmap('demo');
  assert.ok(f.state.find((i) => i.number === 1).labels.includes('open'));
});

test('publish lints the draft, refuses a bad one, and never calls gh for it', () => {
  const f = fakeGh();
  const ctx = online(f);
  const dir = join(ctx.r.root, ctx.cfg.roadmaps.drafts);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'demo.md');
  writeFileSync(p, ROADMAP.replace('- **Lane** —', '- **Landed** yes'));
  assert.throws(() => ctx.store.publish(p), /status field|missing required field/);
  assert.deepEqual(f.calls, []);
});

test('publish creates the issues and deletes the draft', () => {
  const f = fakeGh();
  const ctx = online(f);
  const dir = join(ctx.r.root, ctx.cfg.roadmaps.drafts);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'demo.md');
  writeFileSync(p, ROADMAP);
  const res = ctx.store.publish(p);
  assert.deepEqual(res.keys, ['demo/D1']);
  assert.deepEqual(ctx.store.drafts(), []);
  assert.ok(f.calls.some((c) => c[0] === 'create' && c[1] === 'demo/D1 — First thing'));
});
```

- [ ] **Step 3: Write `lib/store/github/index.mjs`**

```js
// Roadmaps as GitHub issues: one programme issue, one task issue each. The issue bodies are
// rendered so that the SAME parser reads them back — one grammar, two channels, rather than a
// second format to keep in step.
import { readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { makeGh } from './gh.mjs';
import { LABELS, keyFromTitle, publishIssues } from './issues.mjs';
import { ownershipIndex, programmeForRoadmap, OPEN_LABEL } from './ownership.mjs';
import { parseRoadmap } from '../../roadmap/parse.mjs';
import { lintRoadmap, formatViolations } from '../../roadmap/lint.mjs';

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
    mode: 'online',

    whoami: () => gh.me(),

    drafts: () => (existsSync(draftsDir) ? readdirSync(draftsDir) : [])
      .filter((f) => f.endsWith('.md'))
      .map((f) => ({ slug: basename(f, '.md'), path: join(draftsDir, f) })),

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
      const own = ownershipIndex({ taskIssues: tasks, programmeIssues: programmeIssues(), me: gh.me() });
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
          programme: o.programme ?? null,
          programmeState: o.programmeState ?? null,
        });
      }
      return out;
    },

    publish(draftPath) {
      const text = readFileSync(draftPath, 'utf8');
      const parsed = parseRoadmap(text, { source: draftPath });
      const slug = parsed.roadmap ?? basename(draftPath, '.md');
      const known = new Set(taskIssues().map((i) => keyFromTitle(i.title))
        .filter((k) => k.split('/')[0] !== slug));
      const violations = lintRoadmap(parsed, {
        source: draftPath,
        fileExists: (p) => existsSync(join(cfg.root, p)),
        knownKeys: known,
      }).filter((v) => v.level === 'error');
      if (violations.length) throw new Error(formatViolations(violations).join('\n'));

      const title = /^#\s+(.+)$/m.exec(text)?.[1] ?? slug;
      const prose = text.split(/^### /m)[0].replace(/^---[\s\S]*?---\n/, '').trim();
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

    release(key) {
      const issue = taskIssues().find((i) => keyFromTitle(i.title) === key);
      if (issue) gh.removeLabel(issue.number, LABELS.wip);
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
```

- [ ] **Step 4: Check `gh.mjs` exposes every method used above**

Run: `grep -n 'me:\|ensureLabels:\|listIssues:\|createIssue:\|updateIssue:\|reopenIssue:\|closeIssue:\|addLabel:\|removeLabel:\|assign:' lib/store/github/gh.mjs`

Any method the store calls and `gh.mjs` does not define must be added there, following the shape of
its neighbours — never by reaching for `execFileSync` from the store, which would put a second
`gh` caller in the tree and defeat the injectable seam.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/store/github/ test/store-github.test.mjs
git commit -m "feat(store): the online backend — issues behind the same interface"
```

---

### Task 12: `lib/roadmap/board.mjs` — reconciliation over the overlay

**Files:**
- Create: `lib/roadmap/board.mjs`
- Test: `test/board.test.mjs`

**Interfaces:**
- Consumes: `mayTake` from `lib/roadmap/policy.mjs`.
- Produces:
  - `UNVERIFIED = 'landed?'`, `isLanded(status)`, `deriveLocalStatus(task, git, subjects)`
  - `reconcile({ tasks, git, register, overlay }) -> { rows, corrections, unverified, notMine, orphans }`
    where `git` is `{ refs: Set<string>, mainSubjects: Set<string> }` and `overlay` is the Map the
    store returned.
  - `gatherGit(root) -> { refs, mainSubjects }`
  - `renderBoard(rows) -> string`

The port from `planetCraft`'s `board.mjs` makes exactly one substitution: the `issues` Map and the
`ownership` Map become one `overlay` Map, and `deriveSharedStatus` is read from the overlay entry's
`status` rather than recomputed. `visibility === 'shared'` becomes `overlay.has(key)`.

- [ ] **Step 1: Write the failing test**

`test/board.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoadmap } from '../lib/roadmap/parse.mjs';
import { reconcile, UNVERIFIED, isLanded } from '../lib/roadmap/board.mjs';
import { ROADMAP } from './helpers/fixture.mjs';

const tasks = parseRoadmap(ROADMAP).tasks;
const noGit = { refs: new Set(), mainSubjects: new Set() };
const row = (over = {}) => ({
  id: 'demo/D1', status: 'todo', subjects: [], deps: [], branch: 'demo/d1-first-thing', ...over,
});

test('with no overlay and no branch, a task is todo and schedulable', () => {
  const b = reconcile({ tasks, git: noGit, register: [], overlay: new Map() });
  assert.equal(b.rows[0].status, 'todo');
  assert.equal(b.rows[0].mine, true);
  assert.equal(b.rows[0].schedulable, true);
  assert.deepEqual(b.corrections, []);
});

test('an existing branch ref makes it claimed', () => {
  const git = { refs: new Set(['demo/d1-first-thing']), mainSubjects: new Set() };
  assert.equal(reconcile({ tasks, git, register: [], overlay: new Map() }).rows[0].status, 'claimed');
});

test('a recorded subject on main makes it landed', () => {
  const git = { refs: new Set(), mainSubjects: new Set(['feat: the first thing']) };
  const register = [row({ status: 'landed', subjects: ['feat: the first thing'] })];
  assert.equal(reconcile({ tasks, git, register, overlay: new Map() }).rows[0].status, 'landed');
});

test('landed with NO recorded subject is "landed?", listed separately, never todo', () => {
  const register = [row({ status: 'landed', subjects: [] })];
  const b = reconcile({ tasks, git: noGit, register, overlay: new Map() });
  assert.equal(b.rows[0].status, UNVERIFIED);
  assert.equal(b.unverified.length, 1);
  assert.deepEqual(b.corrections, []);
  assert.equal(isLanded(UNVERIFIED), true);
});

test('a real disagreement between register and derivation is a correction', () => {
  const register = [row({ status: 'claimed', subjects: [] })];
  const b = reconcile({ tasks, git: noGit, register, overlay: new Map() });
  assert.equal(b.corrections.length, 1);
  assert.match(b.corrections[0], /register says claimed, derived todo/);
});

test('an overlay entry that is not mine derives from the overlay, not from git', () => {
  const overlay = new Map([['demo/D1', {
    status: 'claimed', ref: 5, owner: 'someone', open: false, mine: false,
    programme: 1, programmeState: 'open',
  }]]);
  const b = reconcile({ tasks, git: noGit, register: [], overlay });
  assert.equal(b.rows[0].status, 'claimed');
  assert.equal(b.rows[0].mine, false);
  assert.equal(b.rows[0].schedulable, false);
  assert.equal(b.rows[0].issue, 5);
});

test('a roadmap someone opened is schedulable although it is not mine', () => {
  const overlay = new Map([['demo/D1', { status: 'todo', ref: 5, owner: 'someone', open: true, mine: false }]]);
  assert.equal(reconcile({ tasks, git: noGit, register: [], overlay }).rows[0].schedulable, true);
});

test('a shared task the register dropped is "not ours", never a correction', () => {
  const overlay = new Map([['demo/D1', { status: 'claimed', ref: 5, owner: 'someone', open: false, mine: false }]]);
  const register = [row({ status: 'dropped' })];
  const b = reconcile({ tasks, git: noGit, register, overlay });
  assert.equal(b.notMine.length, 1);
  assert.deepEqual(b.corrections, []);
});

test('offline can never produce a "not ours" line, because the overlay is empty', () => {
  const register = [row({ status: 'dropped' })];
  const b = reconcile({ tasks, git: noGit, register, overlay: new Map() });
  assert.deepEqual(b.notMine, []);
});

test('deps are OVERWRITTEN with the qualified form and drive depsMet', () => {
  const two = parseRoadmap(ROADMAP.replace('- **Deps** —', '- **Deps** D0')).tasks;
  const b = reconcile({ tasks: two, git: noGit, register: [], overlay: new Map() });
  assert.deepEqual(b.rows[0].deps, ['demo/D0']);
  assert.equal(b.rows[0].depsMet, false);
  assert.deepEqual(b.rows[0].blockedBy, ['demo/D0']);
});

test('orphans are reported in both directions', () => {
  const register = [row({ id: 'demo/ZZ', status: 'todo' })];
  const b = reconcile({ tasks, git: noGit, register, overlay: new Map() });
  assert.deepEqual(b.orphans.inRegisterOnly, ['demo/ZZ']);
  assert.deepEqual(b.orphans.inRoadmapOnly, ['demo/D1']);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/board.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Port the reconciler**

```bash
cp /Users/nicolasrabault/Projects/planetCraft/tools/roadmap/board.mjs lib/roadmap/board.mjs
```

Then make exactly these edits, keeping every comment:

1. Replace the two imports with `import { mayTake } from './policy.mjs';`
2. Delete `deriveSharedStatus` (it moved into the GitHub store in task 11) and add, in its place,
   this comment: `// deriveSharedStatus lives in lib/store/github/index.mjs — it reads an ISSUE, so
   it belongs to the store that has one. The overlay hands us its answer already computed.`
3. Change `reconcile`'s signature to
   `reconcile({ tasks, git, register = [], overlay = new Map() })` and, at the top of the map,
   replace the `issue`/`own` pair with:

```js
    const over = overlay.get(t.key) ?? null;
    // No overlay entry means this key exists only here: the offline case, and the online case of a
    // task not yet published. Both derive locally, which is the answer this function gave before
    // ownership existed.
    const derived = over?.status === 'landed'
      ? 'landed'
      : (!over || over.mine || t.claimedByMe)
        ? deriveLocalStatus(t, git, reg?.subjects ?? [])
        : over.status;
```

4. Replace every `task.visibility === 'shared'` with `overlay.has(t.key)` — that is, change
   `notOurs(reg, task)` to `notOurs(reg, shared)` and `staleIssue(reg, task, derived)` to
   `staleIssue(reg, shared, derived)`, passing `overlay.has(t.key)` at the call sites.
5. In the returned row, replace the ownership reads with the overlay's:
   `issue: over?.ref ?? null`, `owner: over?.owner ?? null`, `open: over?.open ?? false`,
   `mine: over ? over.mine : true`, `schedulable: mayTake(over)`,
   `programme: over?.programme ?? null`, `programmeState: over?.programmeState ?? null`.
6. Rename the parameter `roadmapTasks` to `tasks` throughout the function, including the
   `roadmapKeys` line at the end.

- [ ] **Step 4: Add `gatherGit`**

Append to `lib/roadmap/board.mjs`:

```js
// The two things git is asked, once per board: which branches exist, and what main's subjects are.
// Both are sets because every consumer only ever asks "does it contain".
export function gatherGit(root, { run } = {}) {
  const git = run ?? ((...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const refs = new Set(
    git('for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').map((s) => s.trim()).filter(Boolean),
  );
  const mainSubjects = new Set(
    git('log', '--format=%s', '-n', '500').split('\n').map((s) => s.trim()).filter(Boolean),
  );
  return { refs, mainSubjects };
}
```

and add `import { execFileSync } from 'node:child_process';` at the top.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/roadmap/board.mjs test/board.test.mjs
git commit -m "feat(roadmap): reconcile over one overlay map instead of issues plus ownership"
```

---

### Task 13: `lib/roadmap/enrol.mjs` — a task with no register row is a task nothing will schedule

**Files:**
- Create: `lib/roadmap/enrol.mjs`
- Test: `test/enrol.test.mjs`

**Interfaces:**
- Consumes: `registerRow`, `FOREIGN` from `lib/register/state.mjs`; `mayTake` from `lib/roadmap/policy.mjs`.
- Produces: `enrol(state, tasks, { at, host, foreign }) -> { state, added }` — **append-only**: an
  existing row is returned untouched, by identity, so re-publishing can never overwrite a note, a
  session or a recorded subject.

- [ ] **Step 1: Write the failing test**

`test/enrol.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoadmap } from '../lib/roadmap/parse.mjs';
import { enrol } from '../lib/roadmap/enrol.mjs';
import { FOREIGN } from '../lib/register/state.mjs';
import { ROADMAP } from './helpers/fixture.mjs';

const tasks = parseRoadmap(ROADMAP).tasks;
const at = '2026-09-02T10:00:00Z';
const host = 'testbox';

test('a fresh task becomes a todo row carrying its slug and its qualified deps', () => {
  const { state, added } = enrol({ tasks: [] }, tasks, { at, host });
  assert.deepEqual(added, ['demo/D1']);
  assert.equal(state.tasks[0].id, 'demo/D1');
  assert.equal(state.tasks[0].roadmap, 'demo');
  assert.equal(state.tasks[0].status, 'todo');
  assert.match(state.tasks[0].note, /ENROLLED 2026-09-02T10:00:00Z testbox/);
});

test('an existing row is returned by IDENTITY — a note can never be overwritten', () => {
  const existing = { id: 'demo/D1', note: 'a conductor wrote this', status: 'claimed' };
  const { state, added } = enrol({ tasks: [existing] }, tasks, { at, host });
  assert.deepEqual(added, []);
  assert.equal(state.tasks[0], existing);
});

test('a task this machine may not take is enroled terminal, so nothing schedules it', () => {
  const { state } = enrol({ tasks: [] }, tasks, { at, host, foreign: () => true });
  assert.equal(state.tasks[0].status, FOREIGN);
  assert.match(state.tasks[0].note, /dropped here on purpose/);
});

test('a task with no key is skipped rather than written as a null identity', () => {
  const broken = [{ ...tasks[0], key: null }];
  const { state, added } = enrol({ tasks: [] }, broken, { at, host });
  assert.deepEqual(added, []);
  assert.deepEqual(state.tasks, []);
});

test('enrolling twice adds nothing the second time', () => {
  const first = enrol({ tasks: [] }, tasks, { at, host });
  const second = enrol(first.state, tasks, { at, host });
  assert.deepEqual(second.added, []);
  assert.equal(second.state.tasks.length, 1);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/enrol.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Port it**

```bash
cp /Users/nicolasrabault/Projects/planetCraft/tools/roadmap/enrol.mjs lib/roadmap/enrol.mjs
```

Edits, keeping every comment — its header records the three occasions (22, 15 and 28 tasks) when a
published roadmap reached the board and reached nothing else, which is the reason this module
exists:

1. Delete `qualifyDep`, `registerRow` and `FOREIGN` from this file; import them instead:
   `import { registerRow, FOREIGN } from '../register/state.mjs';`
2. Change `enrol`'s options from `{ roadmapPath, at, host, foreign }` to `{ at, host, foreign = () => false }`,
   and its `registerRow` call to `registerRow(task, { roadmapSlug: task.roadmap, status, note })`.
3. Update the comment about `roadmap` being a FILE PATH to say it is the SLUG, and why (task 7's
   header has the argument).

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/roadmap/enrol.mjs test/enrol.test.mjs
git commit -m "feat(roadmap): append-only enrolment into the register"
```

---

### Task 14: `lib/cli/roadmap.mjs` and the two-mode equivalence suite

**Files:**
- Create: `lib/cli/roadmap.mjs`, `docs/roadmap-format.md`
- Modify: `bin/orchestra` (replace the placeholder registration from task 4)
- Test: `test/both-modes.test.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: `orchestra roadmap <lint|board|publish|claim|release|open|reserve|enrol>`, and the suite
  that is P1's acceptance: **the same assertions run against both modes.**

- [ ] **Step 1: Copy the human-facing grammar contract**

```bash
cp /Users/nicolasrabault/Projects/planetCraft/docs/roadmap-format.md docs/roadmap-format.md
```

Then read it through and rewrite any sentence that names `planetCraft`, `docs/local/` or
`npm run roadmap` — the drafts directory is now `roadmaps.drafts` from the config, the published
one `roadmaps.published`, and the command is `orchestra roadmap`. Change nothing about the grammar
itself: the seven fields, the em dash, `**Why.**`, `**Acceptance.**`, the key shape.

- [ ] **Step 2: Write the failing acceptance suite**

`test/both-modes.test.mjs`:

```js
// P1's acceptance. Every assertion here runs against BOTH modes, which is the sharpest available
// statement of what "two modes" means: same grammar, same lint, same board, same enrolment. Where
// the two genuinely differ — a status written to an issue, an owner who is somebody else — the
// difference is asserted explicitly at the bottom rather than left to be discovered.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, ROADMAP } from './helpers/fixture.mjs';
import { loadConfig } from '../lib/config.mjs';
import { makeStore } from '../lib/store/index.mjs';
import { reconcile, gatherGit } from '../lib/roadmap/board.mjs';
import { enrol } from '../lib/roadmap/enrol.mjs';
import { LABELS, taskTitle } from '../lib/store/github/issues.mjs';
import { parseRoadmap } from '../lib/roadmap/parse.mjs';

const repos = [];
after(() => repos.forEach((r) => r.cleanup()));

// A `gh` recorder that keeps issues in memory, so the online store is exercised with no network.
function fakeGh(me = 'nico') {
  const state = [];
  let next = 100;
  const find = (n) => state.find((i) => i.number === n);
  return {
    state,
    me: () => me,
    ensureLabels: () => {},
    listIssues: ({ labels = [] } = {}) => state.filter((i) => labels.every((l) => i.labels.includes(l))),
    createIssue: (i) => { const n = next++; state.push({ number: n, state: 'open', assignees: [], author: me, ...i }); return n; },
    updateIssue: (n, i) => Object.assign(find(n), i),
    reopenIssue: (n) => { find(n).state = 'open'; },
    closeIssue: (n) => { find(n).state = 'closed'; },
    addLabel: (n, l) => { if (!find(n).labels.includes(l)) find(n).labels.push(l); },
    removeLabel: (n, l) => { find(n).labels = find(n).labels.filter((x) => x !== l); },
    assign: (n, who) => find(n).assignees.push(who),
  };
}

function project(mode) {
  const r = makeRepo({ mode });
  repos.push(r);
  const cfg = loadConfig(r.root);
  const gh = mode === 'online' ? fakeGh() : null;
  const store = makeStore(cfg, gh ? { gh } : {});
  const dir = join(r.root, cfg.roadmaps.drafts);
  mkdirSync(dir, { recursive: true });
  const draftPath = join(dir, 'demo.md');
  writeFileSync(draftPath, ROADMAP);
  return { r, cfg, store, gh, draftPath };
}

for (const mode of ['offline', 'online']) {
  test(`[${mode}] a draft is invisible until it is published`, () => {
    const p = project(mode);
    assert.deepEqual(p.store.list(), []);
    assert.deepEqual(p.store.drafts().map((d) => d.slug), ['demo']);
  });

  test(`[${mode}] publish makes exactly one task visible, keyed the same way`, () => {
    const p = project(mode);
    const res = p.store.publish(p.draftPath);
    assert.equal(res.slug, 'demo');
    assert.deepEqual(res.keys, ['demo/D1']);
    assert.deepEqual(p.store.list().map((t) => t.key), ['demo/D1']);
    assert.deepEqual(p.store.drafts(), []);
  });

  test(`[${mode}] a published task round-trips the whole grammar`, () => {
    const p = project(mode);
    p.store.publish(p.draftPath);
    const t = p.store.list()[0];
    const src = parseRoadmap(ROADMAP).tasks[0];
    for (const field of ['id', 'title', 'key', 'order', 'branch', 'design', 'lane', 'why', 'acceptance']) {
      assert.deepEqual(t[field], src[field], `${field} differs in ${mode}`);
    }
    assert.deepEqual(t.deps, src.deps);
    assert.deepEqual(t.touches, src.touches);
  });

  test(`[${mode}] publish refuses a draft that does not lint and changes nothing`, () => {
    const p = project(mode);
    writeFileSync(p.draftPath, ROADMAP.replace('- **Lane** —', '- **Landed** yes'));
    assert.throws(() => p.store.publish(p.draftPath), /status field/);
    assert.deepEqual(p.store.list(), []);
    assert.deepEqual(p.store.drafts().map((d) => d.slug), ['demo']);
  });

  test(`[${mode}] the board derives todo for a fresh task and reports no correction`, () => {
    const p = project(mode);
    p.store.publish(p.draftPath);
    const b = reconcile({
      tasks: p.store.list(), git: gatherGit(p.r.root), register: [], overlay: p.store.overlay(),
    });
    assert.equal(b.rows.length, 1);
    assert.equal(b.rows[0].status, 'todo');
    assert.equal(b.rows[0].schedulable, true);
    assert.deepEqual(b.corrections, []);
  });

  test(`[${mode}] a published task with no register row is an orphan the board names`, () => {
    const p = project(mode);
    p.store.publish(p.draftPath);
    const b = reconcile({
      tasks: p.store.list(), git: gatherGit(p.r.root), register: [], overlay: p.store.overlay(),
    });
    assert.deepEqual(b.orphans.inRoadmapOnly, ['demo/D1']);
  });

  test(`[${mode}] enrolment closes that orphan, and is append-only`, () => {
    const p = project(mode);
    p.store.publish(p.draftPath);
    const { state } = enrol({ tasks: [] }, p.store.list(), { at: '2026-09-02T10:00:00Z', host: 'testbox' });
    const b = reconcile({
      tasks: p.store.list(), git: gatherGit(p.r.root), register: state.tasks, overlay: p.store.overlay(),
    });
    assert.deepEqual(b.orphans.inRoadmapOnly, []);
    assert.deepEqual(b.orphans.inRegisterOnly, []);
  });
}

test('[offline] the overlay is empty and every command that cannot apply says so', () => {
  const p = project('offline');
  p.store.publish(p.draftPath);
  assert.equal(p.store.overlay().size, 0);
  assert.equal(p.store.openRoadmap('demo').noop, true);
  assert.equal(p.store.setStatus('demo/D1', 'claimed').noop, true);
});

test('[online] the overlay carries the issue, and claim turns it wip for everyone', () => {
  const p = project('online');
  p.store.publish(p.draftPath);
  assert.equal(p.store.claim('demo/D1', 'nico').ok, true);
  const entry = p.store.overlay().get('demo/D1');
  assert.equal(entry.status, 'claimed');
  assert.ok(p.gh.state.find((i) => i.labels.includes(LABELS.wip)));
  assert.ok(p.gh.state.some((i) => i.title === taskTitle(parseRoadmap(ROADMAP).tasks[0])));
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test test/both-modes.test.mjs`
Expected: FAIL — `lib/cli/roadmap.mjs` does not exist yet, and any behavioural gap between the two
stores shows up here as an asymmetric failure. Fix the store, never the assertion.

- [ ] **Step 4: Write the CLI command**

`lib/cli/roadmap.mjs`:

```js
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
    git: gatherGit(cfg.root),
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
  const { state: next, added } = enrol(state, store.list(), {
    at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    host: hostname(),
    foreign: (t) => {
      const o = store.overlay().get(t.key);
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
```

- [ ] **Step 5: Wire it into the dispatcher**

In `bin/orchestra`, delete the placeholder registration added in task 4 and put in its place:

```js
import { roadmapCommand } from '../lib/cli/roadmap.mjs';
register('roadmap', { run: roadmapCommand });
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS, every test in every file.

- [ ] **Step 7: Prove it end to end by hand, in both modes**

```bash
O=~/Projects/orchestra
cd "$(mktemp -d)" && git init -q -b main && git config user.email t@e.st && git config user.name Tester
mkdir -p .orchestra/drafts && printf '{ "mode": "offline" }\n' > .orchestra/config.json
echo '# hi' > README.md && git add -A && git commit -qm init
cat > .orchestra/drafts/demo.md <<'MD'
---
roadmap: demo
---

Demo roadmap prose.

### D1 — First thing

- **Roadmap** demo
- **Order** 1
- **Deps** —
- **Touches** `README.md`
- **Branch** `demo/d1-first-thing`
- **Design** no
- **Lane** —

**Why.** The player sees the first thing.

**Acceptance.** A test asserts it.
MD
node "$O/bin/orchestra" doctor
node "$O/bin/orchestra" roadmap lint
node "$O/bin/orchestra" roadmap publish
node "$O/bin/orchestra" roadmap board
```

Then repeat the same four commands with `{ "mode": "online" }` in a repository with a GitHub
remote, if one is at hand. It is not required to close this task — the equivalence suite already
covers the online path with a recorder — but it is the first moment `gh` is really called, and
finding out here is cheaper than finding out inside P2's first tick.

Expected: `doctor` names the mode and the offline caveat; `lint` is silent; `publish` prints
`published demo` and `enroled demo/D1`; `board` prints one row at status `todo` with no
`correction:` and no `orphan:` line.

- [ ] **Step 8: Commit**

```bash
git add lib/cli/roadmap.mjs bin/orchestra docs/roadmap-format.md test/both-modes.test.mjs
git commit -m "feat(cli): the roadmap command, and the suite that holds both modes to one behaviour"
```

---

## What P1 does not do

Recorded here so the next plan starts from the right place, and so nobody looks for these and
concludes they are broken:

- **No conductor.** No register tick, no journal, no inbox, no lock, no beat, no launch. `state.json`
  exists and is written by enrolment only. That is P2.
- **No `sync`.** Closing an issue from a recorded landing needs the register's `subjects`, which
  only a landing writes. P2 brings the register; P3 brings the landing.
- **No `init`.** A project's `.orchestra/config.json` is written by hand until P5. `doctor` already
  says what is missing.
- **No machine registry, no port allocation, no worker budget.** Spec §8's shared file arrives with
  P2 (the budget) and P4 (the ports); P1 only lays the ground for it by making `projectId` derive
  from the absolute path.
- **`gh` is never really called.** Both the online store's tests and the equivalence suite inject a
  recorder. The first real `gh` call happens the first time a human runs `orchestra roadmap publish`
  in an online project; `doctor` should be extended in P5 to check that `gh auth status` passes.
