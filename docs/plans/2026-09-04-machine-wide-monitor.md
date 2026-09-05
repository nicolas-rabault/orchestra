# One monitor for the machine — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** replace P4's page-per-project with a single machine-wide monitoring page on port 4380,
carrying a project tab strip above the developer tab strip that already exists.

**Architecture:** the handler stops holding one `cfg` and starts holding a **function** that resolves
the live project set per request. `buildModel` is unchanged and is called once per project; the model
becomes `{ machine, projects: [...] }`. Two routes gain a `project` id, resolved against the live set
and never against a client-supplied path. One new pure module (`lib/monitor/projects.mjs`) decides
the level-1 strip and is served to the browser like the five that already are. Per-project ports and
everything that computed them are deleted.

**Tech Stack:** ESM, node builtins only, `node:test` + `node:assert/strict`. No runtime dependencies.

**Spec:** `docs/specs/2026-09-04-machine-wide-monitor-design.md` (supersedes §7's port half and all of
§8.3 in `docs/specs/2026-09-02-orchestra-plugin-design.md`).

## Global Constraints

P1's through P4's, unchanged. Every task's requirements implicitly include this section.

- **Node ≥ 20**, **git ≥ 2.31**.
- **Zero runtime dependencies.** Nothing under `bin/`, `lib/` or `hooks/` may import anything but a
  `node:` builtin or a relative path. `test/no-dependencies.test.mjs` holds it.
- **ESM only**, `node:test` + `node:assert/strict`. Run the suite with `npm test`.
- **Every test runs under a temporary `HOME`** (spec §14), so `~/.orchestra/` under test is never the
  developer's own. Copy the `beforeEach`/`after` pair from `test/p4-acceptance.test.mjs`.
- **Kill a spawned server by the pid you captured**, never by a pattern over the process table.
- **English** for every identifier, comment, commit message and user-visible string.
- Work happens on `monitor/machine-wide-page`, in the worktree
  `~/Projects/orchestra/.worktrees/monitor-machine-wide`. Never commit to `main`.
- **The suite must be green at the end of every task.** Where a task deletes something another module
  imports, the deletion and its callers move in the same commit — the sequencing below is built
  around that.

## File Structure

| File | Responsibility |
|---|---|
| `lib/monitor/projects.mjs` | **New, pure, browser-served.** The level-1 strip: which projects are tabs, their order, counts and waiting badge. |
| `lib/monitor/discover.mjs` | **New.** Resolves the live project set per request: registry + the current directory's project. |
| `lib/machine.mjs` | Gains `~/.orchestra/monitor.json` (the one page's port and pid) and the `monitorPort` override. Loses the monitor's per-project `port`/`monitorPid` claim. |
| `lib/monitor/server.mjs` | Handler goes plural; two routes gain `project`; the `{{project}}` substitution goes. |
| `lib/monitor/port.mjs` | Loses `candidatePort`, `resolvePort`, `pinConflict`. Keeps `listenOnFreePort`. |
| `lib/cli/monitor.mjs` | `monitorCommand` becomes machine-wide; `instancesCommand` prints one URL. |
| `lib/cli/doctor.mjs` | Loses the pin-conflict error and the `monitor.port` row; gains a stale-key warning. |
| `lib/config.mjs` | `monitor` leaves `DEFAULTS`. |
| `bin/orchestra` | `monitor` registers `machine: true`. |
| `lib/monitor/public/{index.html,app.js,style.css}` | Two strips; per-project client state. |

---

### Task 1: `lib/monitor/projects.mjs` — the level-1 strip

**Files:**
- Create: `lib/monitor/projects.mjs`
- Create: `test/monitor-projects.test.mjs`

**Interfaces:**
- Consumes: `tally` from `./progress.mjs`, `openQuestions` from `./answers.mjs` (both unchanged).
- Produces: `projectTabsOf(models, sent = new Set()) -> [{ id, name, mode, counts, waiting }]` and
  `modelOf(models, id) -> model | null`. `models` is the `projects` array of `/api/model`; each
  element has `.project = { id, name, mode, ... }` and `.nodes`. `counts` is whatever `tally`
  returns; `waiting` is a number.

- [ ] **Step 1: Write the failing test**

Create `test/monitor-projects.test.mjs`:

```js
// The project strip, level 1. Pure, so it is asserted here rather than through a socket — and
// unlike `app.js`, this module IS loaded by a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectTabsOf, modelOf } from '../lib/monitor/projects.mjs';

const node = (key, status, pending = []) => ({ key, id: key, status, pending });
const model = (id, name, nodes, mode = 'offline') => ({ project: { id, name, mode }, nodes });

test('one tab per project, sorted by name, never by activity', () => {
  const tabs = projectTabsOf([
    model('bbbbbb', 'zulu', [node('z/1', 'claimed')]),
    model('aaaaaa', 'alpha', [node('a/1', 'todo')]),
  ]);
  assert.deepEqual(tabs.map((t) => t.name), ['alpha', 'zulu']);
  assert.deepEqual(tabs.map((t) => t.id), ['aaaaaa', 'bbbbbb']);
  assert.deepEqual(tabs.map((t) => t.mode), ['offline', 'offline']);
});

test('two projects with the same name still get two tabs, ordered by id', () => {
  const tabs = projectTabsOf([
    model('ffffff', 'app', [node('f/1', 'todo')]),
    model('111111', 'app', [node('o/1', 'todo')]),
  ]);
  assert.deepEqual(tabs.map((t) => t.id), ['111111', 'ffffff']);
});

test('counts cover the whole project, not one developer view', () => {
  const [tab] = projectTabsOf([model('aaaaaa', 'alpha', [
    node('a/1', 'landed'), node('a/2', 'claimed'), node('a/3', 'todo'),
  ])]);
  assert.equal(tab.counts.total, 3);
});

test('waiting counts the questions with no answer', () => {
  const [tab] = projectTabsOf([model('aaaaaa', 'alpha', [
    node('a/1', 'claimed', [{ id: 'q1', answer: null }, { id: 'q2', answer: 'yes' }]),
    node('a/2', 'claimed', [{ id: 'q3', answer: null }]),
  ])]);
  assert.equal(tab.waiting, 2);
});

test('a slot this tab already answered stops counting as waiting', () => {
  const models = [model('aaaaaa', 'alpha', [node('a/1', 'claimed', [{ id: 'q1', answer: null }])])];
  assert.equal(projectTabsOf(models, new Set(['a/1:q1']))[0].waiting, 0);
});

test('no projects at all is an empty strip, not a throw', () => {
  assert.deepEqual(projectTabsOf([]), []);
  assert.deepEqual(projectTabsOf(undefined), []);
});

test('modelOf finds a project by id, and answers null for one that left', () => {
  const models = [model('aaaaaa', 'alpha', []), model('bbbbbb', 'zulu', [])];
  assert.equal(modelOf(models, 'bbbbbb').project.name, 'zulu');
  assert.equal(modelOf(models, 'nope'), null);
  assert.equal(modelOf(undefined, 'aaaaaa'), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/monitor-projects.test.mjs`
Expected: FAIL — `Cannot find module '../lib/monitor/projects.mjs'`.

- [ ] **Step 3: Write the module**

Create `lib/monitor/projects.mjs`:

```js
// The project strip — level 1, above the developer strip `tabs.mjs` draws. One page serves every
// orchestra on this machine, so the first question a reader asks is "which project", and the
// second is "whose work inside it". These are the two strips, in that order, and this module owns
// only the first.
//
// A tab is a SELECTOR, not a filter: exactly one project's model reaches the canvas, the rail and
// the cards, and everything below this level behaves as it did when the page served one project.
// That is what keeps `tabs.mjs`, `layout.mjs` and every card unchanged by going plural.
//
// Pure, and served to the browser like `tabs.mjs` and `progress.mjs`, because the strip the page
// draws and the tests must group projects the same way.
import { tally } from './progress.mjs';
import { openQuestions } from './answers.mjs';

// Sorted by NAME, and by id where two projects share one — never by activity, the same rule
// `tabsOf` and the corner list already follow: a strip that reorders itself between two-second
// polls is unclickable. Two checkouts of one repository legitimately carry the same name (the id
// is a hash of the path, the name is a directory name), so the id is the tiebreak that makes the
// order total rather than merely stable-ish.
export function projectTabsOf(models, sent = new Set()) {
  return (models ?? [])
    .map((m) => ({
      id: m.project.id,
      name: m.project.name,
      mode: m.project.mode,
      // The WHOLE project, never the selected developer view: this figure answers "what is this
      // project doing", and a count that moved when you changed developer tab would be answering
      // a different question under the same pill.
      counts: tally(m.nodes),
      // `sent` is this tab's own optimistic set for the project concerned — the caller slices it,
      // because a slot key (`nodeKey:itemId`) is only unique WITHIN a project.
      waiting: openQuestions(m.nodes, sent).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// The selected project's model, or null when the project it names has left the machine between two
// polls — a checkout deleted, a config removed. The page falls back to the first tab rather than
// rendering nothing.
export const modelOf = (models, id) => (models ?? []).find((m) => m.project.id === id) ?? null;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/monitor-projects.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/monitor/projects.mjs test/monitor-projects.test.mjs
git commit -m "feat(monitor): the project strip, level 1, pure and tested"
```

---

### Task 2: `~/.orchestra/monitor.json` — the one page's record

**Files:**
- Modify: `lib/machine.mjs` (add below `instancesPath`)
- Create: `test/machine-monitor.test.mjs`

**Interfaces:**
- Consumes: `machineDir()` and the `readJsonOr` helper already in `lib/machine.mjs`.
- Produces, all exported from `lib/machine.mjs`:
  - `monitorPath() -> string`
  - `DEFAULT_MONITOR_PORT = 4380`
  - `machineMonitorPort() -> number` — `monitorPort` from `~/.orchestra/machine.json`, else 4380.
  - `readMonitor() -> { port, pid, startedAt } | null`
  - `recordMonitor({ port, pid, now? }) -> { version, port, pid, startedAt }`

Nothing is deleted in this task; `candidatePort` and friends stay until Task 7, so the suite stays
green.

- [ ] **Step 1: Write the failing test**

Create `test/machine-monitor.test.mjs`:

```js
// `~/.orchestra/monitor.json` — the one page on this machine, its port and its pid. Under a
// temporary HOME (spec §14), never the developer's own.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_MONITOR_PORT, machineMonitorPort, monitorPath, readMonitor, recordMonitor,
} from '../lib/machine.mjs';

const HOME = process.env.HOME;
const homes = [];
beforeEach(() => { const h = mkdtempSync(join(tmpdir(), 'orchestra-home-')); homes.push(h); process.env.HOME = h; });
after(() => { process.env.HOME = HOME; homes.forEach((h) => rmSync(h, { recursive: true, force: true })); });

const writeMachine = (obj) => {
  mkdirSync(join(process.env.HOME, '.orchestra'), { recursive: true });
  writeFileSync(join(process.env.HOME, '.orchestra', 'machine.json'), `${JSON.stringify(obj)}\n`);
};

test('no record at all reads as null, never as a throw', () => {
  assert.equal(readMonitor(), null);
});

test('a record round-trips, and carries the port, the pid and a stamp', () => {
  const written = recordMonitor({ port: 4380, pid: 4242, now: Date.parse('2026-09-04T20:00:00.000Z') });
  assert.equal(written.port, 4380);
  assert.equal(written.pid, 4242);
  assert.equal(written.startedAt, '2026-09-04T20:00:00.000Z');
  assert.deepEqual(readMonitor(), { version: 1, port: 4380, pid: 4242, startedAt: '2026-09-04T20:00:00.000Z' });
  assert.match(readFileSync(monitorPath(), 'utf8'), /\n$/);
});

test('an unreadable record reads as null rather than taking the caller down', () => {
  mkdirSync(join(process.env.HOME, '.orchestra'), { recursive: true });
  writeFileSync(monitorPath(), '{ half written');
  assert.equal(readMonitor(), null);
});

test('the port defaults to 4380 and is overridden by machine.json', () => {
  assert.equal(machineMonitorPort(), DEFAULT_MONITOR_PORT);
  assert.equal(DEFAULT_MONITOR_PORT, 4380);
  writeMachine({ monitorPort: 4500 });
  assert.equal(machineMonitorPort(), 4500);
});

test('a nonsense override falls back to the default rather than handing out NaN', () => {
  for (const bad of ['4500', 0, -1, 70000, 4380.5, null]) {
    writeMachine({ monitorPort: bad });
    assert.equal(machineMonitorPort(), DEFAULT_MONITOR_PORT, `override ${JSON.stringify(bad)}`);
  }
});

test('machine.json holding maxWorkers and monitorPort keeps both', async () => {
  writeMachine({ maxWorkers: 3, monitorPort: 4500 });
  const { maxWorkers } = await import('../lib/machine.mjs');
  assert.equal(maxWorkers(), 3);
  assert.equal(machineMonitorPort(), 4500);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/machine-monitor.test.mjs`
Expected: FAIL — `machineMonitorPort is not a function` (the import resolves; the names do not exist).

- [ ] **Step 3: Add the record to `lib/machine.mjs`**

Update the module header's first line, which currently reads "The one file this plugin writes
outside a project":

```js
// The two files this plugin writes outside a project, both under `~/.orchestra/`: `instances.json`,
// the advisory registry of every orchestra that has run here, and `monitor.json`, the one
// monitoring page this machine serves. They are separate files because they have separate
// lifetimes and separate writers — an entry belongs to a project, the page belongs to the machine —
// and because folding the page into the registry is what made P4 record a port per project in the
// first place.
```

Then, immediately after `const machinePath = () => join(machineDir(), 'machine.json');`:

```js
export const monitorPath = () => join(machineDir(), 'monitor.json');

// 4380 with no hashing and no probing rule: there is one page on this machine, so there is nothing
// to spread across a band. `lib/monitor/port.mjs`'s `listenOnFreePort` still steps upward when
// something else holds it — a page one port along beats a page that refused to start.
export const DEFAULT_MONITOR_PORT = 4380;

// `monitorPort` in `~/.orchestra/machine.json`, beside `maxWorkers`, for someone who wants a
// hand-chosen URL. Validated HERE rather than trusted, for the same reason `maxWorkers` is: this
// file is hand-edited, and a string or a float reaching `server.listen` is a failure far from its
// cause. Anything that is not a plausible port falls back to the default.
export function machineMonitorPort() {
  const n = readJsonOr(machinePath(), {})?.monitorPort;
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : DEFAULT_MONITOR_PORT;
}

// Written on bind and refreshed by the page's keepalive. No lock and no merge, unlike
// `recordInstance`: this file has exactly one writer at a time by construction — the one page — and
// the whole point of the refuse-and-point is that a second writer never gets that far.
export function recordMonitor({ port, pid, now = Date.now() }) {
  mkdirSync(machineDir(), { recursive: true });
  const record = { version: 1, port, pid, startedAt: new Date(now).toISOString() };
  const tmp = `${monitorPath()}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(tmp, monitorPath());
  return record;
}

// Null when there is no page, when the file is half-written, or when what is on file is not a
// record — three conditions with one honest answer, "nothing is claiming the port", which is the
// safe direction: the caller then binds, and the bind is the only thing that can be wrong about it.
export function readMonitor() {
  const raw = readJsonOr(monitorPath(), null);
  return Number.isInteger(raw?.port) && Number.isInteger(raw?.pid) ? raw : null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/machine-monitor.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole suite — nothing was removed yet**

Run: `npm test`
Expected: PASS, all previously green tests still green.

- [ ] **Step 6: Commit**

```bash
git add lib/machine.mjs test/machine-monitor.test.mjs
git commit -m "feat(machine): monitor.json, the one page's port and pid, and the 4380 override"
```

---

### Task 3: `lib/monitor/discover.mjs` — the project set

**Files:**
- Create: `lib/monitor/discover.mjs`
- Create: `test/monitor-discover.test.mjs`

**Interfaces:**
- Consumes: `liveInstances`, `recordInstance` from `../machine.mjs`; `loadConfigOrThrow` from
  `../config.mjs`; `makeRepo` from `test/helpers/fixture.mjs` in the test.
- Produces: `discoverProjects({ cwd = process.cwd(), now = Date.now() }) -> [{ id, name, root, mode, cfg }]`,
  sorted by name then id — the same total order `projectTabsOf` uses.

- [ ] **Step 1: Write the failing test**

Create `test/monitor-discover.test.mjs`:

```js
// Which projects reach the page (spec §2). Under a temporary HOME, with real throwaway repositories.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfigOrThrow } from '../lib/config.mjs';
import { readInstances, recordInstance } from '../lib/machine.mjs';
import { discoverProjects } from '../lib/monitor/discover.mjs';
import { makeRepo } from './helpers/fixture.mjs';

const HOME = process.env.HOME;
const homes = [];
const repos = [];
beforeEach(() => { const h = mkdtempSync(join(tmpdir(), 'orchestra-home-')); homes.push(h); process.env.HOME = h; });
after(() => {
  process.env.HOME = HOME;
  homes.forEach((h) => rmSync(h, { recursive: true, force: true }));
  repos.forEach((r) => r.cleanup());
});

const repo = (name) => { const r = makeRepo({ name }); repos.push(r); return { ...r, cfg: loadConfigOrThrow(r.root) }; };
// What `orchestra ready` writes: the project side of an entry, with a live pid so `isLive` holds.
const enrol = (p) => recordInstance({ id: p.cfg.id, name: p.cfg.name, root: p.root, mode: 'offline', conductorPid: process.pid });

test('a registered project reaches the page from anywhere', () => {
  const a = repo('alpha');
  enrol(a);
  const found = discoverProjects({ cwd: tmpdir() });
  assert.deepEqual(found.map((p) => p.name), ['alpha']);
  assert.equal(found[0].root, a.root);
  assert.equal(found[0].id, a.cfg.id);
  assert.equal(found[0].mode, 'offline');
  assert.equal(found[0].cfg.root, a.root);
});

test('the current directory joins the set even when it has never registered, and is recorded', () => {
  const a = repo('alpha');
  assert.deepEqual(readInstances(), []);
  const found = discoverProjects({ cwd: a.root });
  assert.deepEqual(found.map((p) => p.name), ['alpha']);
  assert.equal(readInstances().find((e) => e.id === a.cfg.id).root, a.root);
});

test('the current directory is not added twice when it is already registered', () => {
  const a = repo('alpha');
  enrol(a);
  assert.equal(discoverProjects({ cwd: a.root }).length, 1);
});

test('a current directory with no config adds nothing and throws nothing', () => {
  const bare = mkdtempSync(join(tmpdir(), 'orchestra-bare-'));
  try {
    assert.deepEqual(discoverProjects({ cwd: bare }), []);
    assert.deepEqual(readInstances(), []);
  } finally { rmSync(bare, { recursive: true, force: true }); }
});

test('a registered project whose config has gone is DROPPED, and does not take the set down', () => {
  const a = repo('alpha');
  const b = repo('beta');
  enrol(a);
  enrol(b);
  rmSync(join(b.root, '.orchestra', 'config.json'));
  assert.deepEqual(discoverProjects({ cwd: tmpdir() }).map((p) => p.name), ['alpha']);
});

test('a registered project whose config is unparseable is dropped too', () => {
  const a = repo('alpha');
  const b = repo('beta');
  enrol(a);
  enrol(b);
  writeFileSync(join(b.root, '.orchestra', 'config.json'), '{ half written');
  assert.deepEqual(discoverProjects({ cwd: tmpdir() }).map((p) => p.name), ['alpha']);
});

test('the set is sorted by name, then by id', () => {
  const z = repo('zulu');
  const a = repo('alpha');
  enrol(z);
  enrol(a);
  assert.deepEqual(discoverProjects({ cwd: tmpdir() }).map((p) => p.name), ['alpha', 'zulu']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/monitor-discover.test.mjs`
Expected: FAIL — `Cannot find module '../lib/monitor/discover.mjs'`.

- [ ] **Step 3: Write the module**

Create `lib/monitor/discover.mjs`:

```js
// Which projects the one page shows (spec §2): every live entry of the machine registry, plus the
// project the page was started from if it has a config and has not registered itself yet.
//
// Resolved PER REQUEST, never once at startup. A project that opts in, opts out or is deleted while
// the page is open must follow within one poll, and a server left running for a day must not be
// serving a set that was true yesterday. It is cheap: one JSON read plus one config read per
// project, no child process.
import { loadConfigOrThrow } from '../config.mjs';
import { liveInstances, recordInstance } from '../machine.mjs';

// The current directory's project, registered on the way. This is the one write this module does,
// and it is what makes a freshly `init`ed project appear on the page immediately — which is
// exactly when someone wants to look at it. Only the four fields every writer sends identically:
// `recordInstance` merges, so a project that later runs `orchestra ready` keeps its worker side.
function here(cwd) {
  let cfg = null;
  try { cfg = loadConfigOrThrow(cwd); } catch { return null; }
  return cfg;
}

export function discoverProjects({ cwd = process.cwd(), now = Date.now() } = {}) {
  const roots = new Map();
  for (const e of liveInstances({ now })) roots.set(e.root, e.id);

  const own = here(cwd);
  if (own && !roots.has(own.root)) {
    recordInstance({ id: own.id, name: own.name, root: own.root, mode: own.mode }, { now });
    roots.set(own.root, own.id);
  }

  const found = [];
  for (const root of roots.keys()) {
    // A registered project whose config has been removed or corrupted since it registered is
    // DROPPED, never thrown: one deleted checkout may not take the page down for every other
    // project on the machine. It leaves the registry on its own, on the next write, when `isLive`
    // stops holding.
    let cfg = null;
    try { cfg = loadConfigOrThrow(root); } catch { continue; }
    if (!cfg) continue;
    found.push({ id: cfg.id, name: cfg.name, root: cfg.root, mode: cfg.mode, cfg });
  }
  // The same total order `projectTabsOf` applies to the strip, so the model's array and the tabs
  // drawn from it can never disagree about which project is first.
  return found.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/monitor-discover.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/monitor/discover.mjs test/monitor-discover.test.mjs
git commit -m "feat(monitor): the project set, resolved per request from the registry and the cwd"
```

---

### Task 4: the handler goes plural

**Files:**
- Modify: `lib/monitor/server.mjs`
- Modify: `test/monitor-server.test.mjs` (the existing route suite; adapt every `createHandler` call)
- Modify: `test/p4-acceptance.test.mjs:handlerFor` only — leave its rows for Task 8

**Interfaces:**
- Consumes: `discoverProjects` (Task 3), `projectTabsOf` is NOT used server-side.
- Produces: `createHandler({ projects, port, publicDir })` where `projects` is
  `() -> [{ id, name, root, mode, cfg }]`. `GET /api/model` answers
  `{ machine: { port }, projects: [ <today's model>, ... ] }`. `SHARED_MODULES` gains `/projects.mjs`.

- [ ] **Step 1: Write the failing test**

Add to `test/monitor-server.test.mjs` (and change its existing `createHandler({ cfg, ... })` calls to
the new shape — a small helper at the top of that file, `handlerFor(...projects)`, keeps the diff
short):

```js
test('the model carries the machine port and one entry per project, in name order', async () => {
  const a = project('alpha');
  const b = project('beta');
  const res = fakeRes();
  await handlerFor(b, a)(fakeReq('GET', '/api/model'), res);
  assert.equal(res.code, 200);
  const m = JSON.parse(res.body);
  assert.equal(m.machine.port, FAKE_PORT);
  assert.deepEqual(m.projects.map((p) => p.project.name), ['alpha', 'beta']);
  // Each entry is exactly today's model, unchanged.
  assert.equal(m.projects[0].project.root, a.root);
  assert.equal(m.projects[0].project.mode, 'offline');
  assert.equal(m.projects[0].project.branch, 'main');
  assert.ok(Array.isArray(m.projects[0].nodes));
  assert.ok(Array.isArray(m.projects[0].rail));
  // The per-project `port` field is gone: there is one page and it is named once, above.
  assert.equal(m.projects[0].project.port, undefined);
});

test('the etag covers every project, so one project changing busts it', async () => {
  const a = project('alpha');
  const b = project('beta');
  const handler = handlerFor(a, b);

  const first = fakeRes();
  await handler(fakeReq('GET', '/api/model'), first);
  const etag = first.headers.etag;

  const again = fakeRes();
  await handler(fakeReq('GET', '/api/model', { headers: { 'if-none-match': etag } }), again);
  assert.equal(again.code, 304);

  writeFileSync(join(b.root, '.orchestra', 'journal.jsonl'),
    `${JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', kind: 'note', task: null, text: 'moved' })}\n`);
  const third = fakeRes();
  await handler(fakeReq('GET', '/api/model', { headers: { 'if-none-match': etag } }), third);
  assert.equal(third.code, 200);
});

test('a project that leaves between two requests drops out without a 500', async () => {
  const a = project('alpha');
  const b = project('beta');
  let set = [a, b];
  const handler = createHandler({ projects: () => set.map(ctx), port: FAKE_PORT, publicDir: PUBLIC_DIR });

  const before = fakeRes();
  await handler(fakeReq('GET', '/api/model'), before);
  assert.equal(JSON.parse(before.body).projects.length, 2);

  set = [a];
  const after = fakeRes();
  await handler(fakeReq('GET', '/api/model'), after);
  assert.equal(after.code, 200);
  assert.deepEqual(JSON.parse(after.body).projects.map((p) => p.project.name), ['alpha']);
});

test('no projects at all is an empty array and a 200, not an error', async () => {
  const res = fakeRes();
  await createHandler({ projects: () => [], port: FAKE_PORT, publicDir: PUBLIC_DIR })(fakeReq('GET', '/api/model'), res);
  assert.equal(res.code, 200);
  assert.deepEqual(JSON.parse(res.body), { machine: { port: FAKE_PORT }, projects: [] });
});

test('the served page no longer substitutes a project name, and names the tool alone', async () => {
  const res = fakeRes();
  await handlerFor(project('alpha'))(fakeReq('GET', '/'), res);
  assert.equal(res.code, 200);
  assert.match(String(res.body), /<title>orchestra<\/title>/);
  assert.doesNotMatch(String(res.body), /\{\{project\}\}/);
});

test('/projects.mjs is served, and a module that is not on the list is not', async () => {
  const handler = handlerFor(project('alpha'));
  for (const path of SHARED_MODULES) {
    const res = fakeRes();
    await handler(fakeReq('GET', path), res);
    assert.equal(res.code, 200, `${path} should be served`);
  }
  assert.ok(SHARED_MODULES.includes('/projects.mjs'));
  const nope = fakeRes();
  await handler(fakeReq('GET', '/discover.mjs'), nope);
  assert.equal(nope.code, 404);
});
```

Add at the top of that file, beside its existing helpers:

```js
const ctx = (p) => ({ id: p.cfg().id, name: p.cfg().name, root: p.root, mode: p.cfg().mode, cfg: p.cfg() });
const handlerFor = (...ps) => createHandler({ projects: () => ps.map(ctx), port: FAKE_PORT, publicDir: PUBLIC_DIR });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/monitor-server.test.mjs`
Expected: FAIL — the model has no `machine`/`projects` keys and `/` still carries `{{project}}`.

- [ ] **Step 3: Make the handler plural**

In `lib/monitor/server.mjs`:

1. Add `/projects.mjs` to `SHARED_MODULES`, keeping the list's comment accurate (it says "five
   modules" — make it six):

```js
export const SHARED_MODULES = ['/layout.mjs', '/answers.mjs', '/clock.mjs', '/progress.mjs', '/tabs.mjs', '/projects.mjs'];
```

2. Change the signature and lift the per-project readers into a loop. Replace
   `export function createHandler({ cfg, port, publicDir }) {` and its `model()` with:

```js
export function createHandler({ projects, port, publicDir }) {
  // The dev-server cache, now ONE probe for the whole machine rather than one per project. This is
  // the single place where going plural makes the page cheaper than N copies of it were: an `lsof`
  // costs a child process, and `listServers` already takes a list of ports, so N projects ask it
  // exactly one question instead of N.
  let cached = { at: 0, key: null, value: { ok: true, list: [] } };
  const devServers = (ports) => {
    const key = [...new Set(ports)].sort((a, b) => a - b).join(',');
    if (key !== cached.key || Date.now() - cached.at > SERVERS_TTL_MS)
      cached = { at: Date.now(), key, value: listServers(ports) };
    return cached.value;
  };

  // One project's model — exactly what P4 built, with the page's own port removed from it: there is
  // one page now and `machine.port` names it once, so repeating it per project would be the same
  // fact stated N times and free to drift.
  const modelFor = ({ cfg }, found) => {
    const state = readState(cfg.root);
    const register = state.tasks ?? [];
    const trees = worktreePaths(cfg.root);
    return buildModel({
      project: { name: cfg.name, root: cfg.root, mode: cfg.mode, branch: currentBranch(cfg.root), id: cfg.id },
      cfg,
      board: readBoard(cfg.root),
      register,
      conductor: state.conductor ?? null,
      journal: readJournal(cfg.root),
      inbox: readInbox(cfg.root),
      servers: found.list.filter((s) => portsOf(register).includes(s.port)),
      serversKnown: found.ok,
      worktrees: trees,
      findImage: imageFinder(cfg.root, trees),
    });
  };

  // The ports one register names — its rows' own and any a pending item points at. Hoisted out of
  // the model builder because the machine-wide probe needs the union of them before any project's
  // model is built, and the per-project slice needs them again afterwards.
  const portsOf = (register) => [
    ...register.map((r) => r?.port),
    ...register.flatMap((r) => (r?.pending ?? []).map((item) => item?.port)),
  ].filter((p) => Number.isInteger(p));

  const model = () => {
    const set = projects();
    const found = devServers(set.flatMap((p) => portsOf(readState(p.cfg.root).tasks ?? [])));
    return { machine: { port }, projects: set.map((p) => modelFor(p, found)) };
  };
```

3. The served page loses its substitution. Replace `page()` and delete `ESCAPES`/`escapeHtml`:

```js
  // No substitution: with one page and N projects there is no single name to write in, and the
  // server cannot know which project the reader was last looking at. `app.js` writes
  // `<project> — orchestra` on its first poll, from the project remembered in localStorage. What
  // this gives up is P4's promise that a tab was named before a byte of JavaScript had run — and
  // the reason that promise existed, telling four tabs apart, is gone with the four tabs.
  //
  // A project name now reaches the browser only inside JSON, rendered by `el()`, which sets
  // textContent — so the escaping this function used to need has no remaining caller and is gone
  // rather than left standing as a defence of nothing.
  const page = () => readFileSync(join(publicDir, 'index.html'), 'utf8');
```

4. The etag covers every project:

```js
      if (req.method === 'GET' && url.pathname === '/api/model') {
        // Every project's stamp, in the set's own order. A project appearing or leaving changes the
        // stamp's shape, which is itself a change worth busting the etag for.
        const etag = `"${Buffer.from(projects().map((p) => sourceStamp(p.cfg)).join('|')).toString('base64url')}"`;
        if (req.headers['if-none-match'] === etag) return send(res, 304, '');
        return json(res, 200, model(), { etag, 'cache-control': 'no-cache' });
      }
```

5. `serve(cfg)` becomes `serve()`; do it in Task 7 with the CLI, but leave the export compiling by
   changing its body now:

```js
export async function serve({ cwd = process.cwd() } = {}) {
  let handle = null;
  const server = createServer((req, res) => (handle
    ? handle(req, res)
    : send(res, 503, 'the monitor is still starting — reload in a moment')));
  const bound = await listenOnFreePort(server, { port: machineMonitorPort(), pinned: false });
  handle = createHandler({ projects: () => discoverProjects({ cwd }), port: bound, publicDir: PUBLIC_DIR });
  server.on('error', (e) => process.stderr.write(`the monitor's socket reported an error: ${e.message}\n`));
  return { server, port: bound, url: `http://127.0.0.1:${bound}` };
}
```

Update the imports at the top: drop `resolvePort`, add `machineMonitorPort` from `../machine.mjs`
and `discoverProjects` from `./discover.mjs`. Update `index.html`'s `<title>{{project}} — orchestra</title>`
to `<title>orchestra</title>` and delete the `{{project}}` div's placeholder, leaving `<div id="project"></div>`.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/monitor-server.test.mjs`
Expected: PASS.

- [ ] **Step 5: Fix `p4-acceptance.test.mjs`'s handler helper only**

Its `handlerFor` becomes the plural shape so the file still imports; its rows are Task 8's.

```js
const handlerFor = (p) => createHandler({
  projects: () => [{ id: p.cfg().id, name: p.cfg().name, root: p.root, mode: p.cfg().mode, cfg: p.cfg() }],
  port: FAKE_PORT, publicDir: PUBLIC_DIR,
});
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: the rows Task 8 rewrites may fail (row 2's `<title>` assertion, row 5's answer shape).
Everything else PASSES. Note which fail; Task 8 fixes exactly those.

- [ ] **Step 7: Commit**

```bash
git add lib/monitor/server.mjs lib/monitor/public/index.html test/monitor-server.test.mjs test/p4-acceptance.test.mjs
git commit -m "feat(monitor): the model goes plural, one lsof for the machine, and the title stops naming a project"
```

---

### Task 5: `project` on the answer and image routes

**Files:**
- Modify: `lib/monitor/server.mjs` (the two routes)
- Modify: `test/monitor-server.test.mjs`

**Interfaces:**
- Consumes: the `projects` function from Task 4.
- Produces: `POST /api/answer` body `{ project, task, pending, answer }`; `GET /api/image?project=<id>&p=<path>`.
  Both resolve the id against the live set and answer 400 for one that is not in it.

- [ ] **Step 1: Write the failing test**

```js
test('an answer goes to the project it names, and to no other', async () => {
  const a = project('alpha');
  const b = project('beta');
  const res = fakeRes();
  await handlerFor(a, b)(fakeReq('POST', '/api/answer', {
    body: JSON.stringify({ project: a.cfg().id, task: 'demo/D1', pending: 'q1', answer: 'ship at 0.75' }),
  }), res);
  assert.equal(res.code, 200);
  assert.equal(JSON.parse(res.body).ok, true);

  const line = JSON.parse(readFileSync(join(a.root, '.orchestra', 'inbox.jsonl'), 'utf8').trim());
  assert.equal(line.answer, 'ship at 0.75');
  assert.equal(line.from, 'monitor');
  assert.equal(existsSync(join(b.root, '.orchestra', 'inbox.jsonl')), false);
});

test('an answer naming a project that is not in the set is refused and writes nothing', async () => {
  const a = project('alpha');
  const res = fakeRes();
  await handlerFor(a)(fakeReq('POST', '/api/answer', {
    body: JSON.stringify({ project: 'ffffff', task: null, pending: null, answer: 'hello' }),
  }), res);
  assert.equal(res.code, 400);
  assert.match(JSON.parse(res.body).error, /project/);
  assert.equal(existsSync(join(a.root, '.orchestra', 'inbox.jsonl')), false);
});

test('an answer with no project at all is refused — there is no default project any more', async () => {
  const res = fakeRes();
  await handlerFor(project('alpha'))(fakeReq('POST', '/api/answer', {
    body: JSON.stringify({ task: null, pending: null, answer: 'hello' }),
  }), res);
  assert.equal(res.code, 400);
});

test('an image is resolved against the project that names it', async () => {
  const a = project('alpha');
  mkdirSync(join(a.root, '.orchestra', 'images'), { recursive: true });
  writeFileSync(join(a.root, '.orchestra', 'images', 'shot.png'), Buffer.from([137, 80, 78, 71]));
  const res = fakeRes();
  await handlerFor(a)(fakeReq('GET', `/api/image?project=${a.cfg().id}&p=.orchestra/images/shot.png`), res);
  assert.equal(res.code, 200);
  assert.equal(res.headers['content-type'], 'image/png');
});

test('an image path inside ANOTHER project is refused, not served', async () => {
  const a = project('alpha');
  const b = project('beta');
  mkdirSync(join(b.root, '.orchestra', 'images'), { recursive: true });
  const secret = join(b.root, '.orchestra', 'images', 'secret.png');
  writeFileSync(secret, Buffer.from([137, 80, 78, 71]));
  const res = fakeRes();
  await handlerFor(a, b)(fakeReq('GET', `/api/image?project=${a.cfg().id}&p=${secret}`), res);
  assert.equal(res.code, 400);
});

test('an image naming an unknown project is refused', async () => {
  const res = fakeRes();
  await handlerFor(project('alpha'))(fakeReq('GET', '/api/image?project=ffffff&p=.orchestra/images/shot.png'), res);
  assert.equal(res.code, 400);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/monitor-server.test.mjs`
Expected: FAIL — the answer route writes to whichever project it used to hold, and the image route
ignores `project`.

- [ ] **Step 3: Scope the two routes**

In `createHandler`, above the returned handler:

```js
  // A project id from the client, resolved against the LIVE SET and never against a path the
  // request supplied. This is the whole of the multi-project guard: `resolveImageRequest`'s
  // containment check is only as good as the root it is given, and a request carrying only `p`
  // would be checked against whichever root the handler happened to reach for first.
  const projectById = (id) => (typeof id === 'string' && id ? projects().find((p) => p.id === id) ?? null : null);
```

The image route:

```js
      if (req.method === 'GET' && url.pathname === '/api/image') {
        const owner = projectById(url.searchParams.get('project'));
        if (!owner) return send(res, 400, 'no such project on this machine');
        const found = resolveImageRequest(owner.root, url.searchParams.get('p'));
        if (!found.ok) return send(res, found.code, found.error);
        if (req.headers['if-none-match'] === found.stamp) return send(res, 304, '');
        return send(res, 200, readFileSync(found.path), { 'content-type': found.type, etag: found.stamp, 'cache-control': 'no-cache' });
      }
```

The answer route, after the existing body checks and before `appendAnswer`:

```js
        const owner = projectById(body.project);
        if (!owner) return json(res, 400, { ok: false, error: 'answer must name a project on this machine' });
        appendAnswer(inboxPath(owner.root), { task, pending, answer });
        return json(res, 200, { ok: true, conductor: liveConductor(owner.root) ? 'awake' : 'no-conductor' });
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/monitor-server.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/monitor/server.mjs test/monitor-server.test.mjs
git commit -m "feat(monitor): an answer and an image name their project, resolved against the live set"
```

---

### Task 6: the page — two strips, and state that does not collide

**Files:**
- Modify: `lib/monitor/public/index.html`
- Modify: `lib/monitor/public/app.js`
- Modify: `lib/monitor/public/style.css`

**Interfaces:**
- Consumes: `projectTabsOf`, `modelOf` from `/projects.mjs`; `/api/model`'s `{ machine, projects }`;
  `project` on both scoped routes.
- Produces: nothing another task consumes. Verified by hand (Step 6), because nothing in this
  repository loads `app.js`.

- [ ] **Step 1: Add the strip to `index.html`**

Above `<nav id="tabs"></nav>` in `#top`:

```html
    <!-- Level 1: one tab per orchestra on this machine. It sits ABOVE the developer strip because
         that is the order the two questions are asked in — which project, then whose work inside
         it. Always drawn, even alone: it names the project you are looking at, which is the job
         the served <title> used to do before one page served them all. -->
    <nav id="projects"></nav>
```

- [ ] **Step 2: Make the client state per-project**

In `app.js`, replace the `PLACED_KEY`/`loadPlaced`/`savePlaced`/`state` block (currently
`app.js:128-147`) with:

```js
const PLACED_KEY = 'orchestra.monitor.frames';
const PROJECT_KEY = 'orchestra.monitor.project';

// Keyed `<projectId>/<roadmap>`, never by the roadmap slug alone: one page now serves every
// orchestra on this machine, and two projects with a roadmap called `lighting` would otherwise
// share one stored position — the frame you dragged in one moving in the other.
const loadPlaced = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(PLACED_KEY) ?? '{}');
    return new Map(Object.entries(raw)
      .filter(([, v]) => Number.isFinite(v?.x) && Number.isFinite(v?.y))
      .map(([k, v]) => [k, { x: v.x, y: v.y }]));
  } catch { return new Map(); }
};

const savePlaced = () => {
  try { localStorage.setItem(PLACED_KEY, JSON.stringify(Object.fromEntries(placed))); }
  catch { /* no storage (private window, quota): the arrangement holds for this session only */ }
};

// Every frame position for every project, in one store; the layout is handed the slice for the
// project on screen, with the prefix stripped so `layout.mjs` keeps taking plain roadmap slugs and
// does not learn what a project is.
const placed = loadPlaced();
const placedFor = (id) => new Map([...placed]
  .filter(([k]) => k.startsWith(`${id}/`))
  .map(([k, v]) => [k.slice(id.length + 1), v]));

// What the reader was last looking at. Without it every reload lands on whichever project sorts
// first, which on a machine with four of them is a different project most mornings.
const loadProject = () => { try { return localStorage.getItem(PROJECT_KEY); } catch { return null; } };
const saveProject = (id) => { try { localStorage.setItem(PROJECT_KEY, id); } catch { /* no storage */ } };

// One view per project, made on first sight. Moving between project tabs must not lose the frame
// you collapsed or the corner you panned to — the whole reason to have tabs rather than four pages.
const views = new Map();
const viewFor = (id) => {
  if (!views.has(id)) views.set(id, { collapsed: new Set(), selected: null, view: { x: 24, y: 24, k: 1 }, tab: LOCAL });
  return views.get(id);
};

const state = { model: null, etag: null, project: loadProject(), filter: '' };

// The project on screen, and its model. `state.project` can name a project that has left the
// machine since the last poll, so this falls back to the first tab rather than rendering nothing.
const current = () => modelOf(state.model?.projects, state.project) ?? state.model?.projects?.[0] ?? null;
```

Every later read of `state.collapsed`, `state.selected`, `state.view`, `state.tab` and
`state.placed` becomes a read of `viewFor(current().project.id)` and `placedFor(...)`; every read of
`state.model.nodes`, `state.model.rail`, `state.model.servers`, `state.model.serversKnown`,
`state.model.source`, `state.model.ambiguous`, `state.model.duplicates` and `state.model.project`
becomes a read of `current()`. `visible()` and `graph()` become:

```js
const visible = () => nodesOf(current().nodes, viewFor(current().project.id).tab);
const graph = () => {
  const id = current().project.id;
  return layout(visible(), { collapsed: viewFor(id).collapsed, placed: placedFor(id) });
};
```

And the drag handler's `state.placed.set(f.roadmap, …)` becomes
`placed.set(`${current().project.id}/${f.roadmap}`, …)`.

- [ ] **Step 3: Make `answered` and `drafts` per-project**

Replace the two module-level `Map`s with maps of maps. This is spec §8's requirement, implemented
by nesting rather than by widening the slot key — `slotOf` lives in `answers.mjs`, which is a pure
module three other things already depend on, and a project id has no business in a function whose
subject is one register's items.

```js
// Per project, because a slot key (`nodeKey:itemId`) is only unique WITHIN a project: two projects
// both holding a `lighting/L2` with a question `q1` would otherwise share one entry, and answering
// in one would print a "sent" line under the other's untouched question and disable its reply box.
const answered = new Map();
const drafts = new Map();
const cacheFor = (store, id) => { if (!store.has(id)) store.set(id, new Map()); return store.get(id); };
const sentSlots = () => new Set(cacheFor(answered, current().project.id).keys());
```

Every `answered.get/set/has(slot)` becomes `cacheFor(answered, current().project.id).…(slot)`, and
the same for `drafts`. In `poll()`, `dropClosed` runs once per project:

```js
      for (const m of state.model.projects) {
        dropClosed(cacheFor(answered, m.project.id), m.nodes);
        dropClosed(cacheFor(drafts, m.project.id), m.nodes);
      }
```

- [ ] **Step 4: Draw the strip, and name the tab**

Add beside `renderTabs`:

```js
function renderProjects(tabs) {
  const host = $('projects');
  host.replaceChildren();
  for (const t of tabs) {
    const b = el('button', t.id === current().project.id ? 'on' : null, t.name);
    // The one figure that makes a project tab worth glancing at: how many of its questions are
    // waiting on you. Active counts live in the strip below, for the project you are in.
    if (t.waiting) b.append(el('b', 'attention', String(t.waiting)));
    b.title = `${t.name} · ${t.mode} · ${barWords(t.counts)}`;
    b.onclick = () => {
      if (state.project === t.id) return;
      state.project = t.id;
      saveProject(t.id);
      render();
      fit();
    };
    host.append(b);
  }
}
```

`nameProject` now reads the SELECTED project rather than the model's single one:

```js
function nameProject(project) {
  const name = project?.name ?? 'orchestra';
  document.title = `${name} — orchestra`;
  $('project').textContent = name;
}
```

`render()` calls, before everything else:

```js
  const here = current();
  if (!here) { $('empty').hidden = false; $('projects').replaceChildren(); return; }
  if (state.project !== here.project.id) { state.project = here.project.id; saveProject(state.project); }
  nameProject(here.project);
  renderProjects(projectTabsOf(state.model.projects, sentSlots()));
```

Import at the top: `import { projectTabsOf, modelOf } from '/projects.mjs';`

- [ ] **Step 5: Send the project on both scoped calls**

`postAnswer`'s body gains `project: current().project.id`, and `imageUrl` becomes:

```js
const imageUrl = (im) => `/api/image?project=${encodeURIComponent(current().project.id)}&p=${encodeURIComponent(im.rel)}`;
```

Style `#projects` in `style.css` beside `#tabs`: same pill shape, one step larger, with the
`attention` badge in the red the corner list already uses.

- [ ] **Step 6: Verify it by hand — two real projects on one page**

Nothing in this repository loads `app.js`, so this step is a person looking. Build two throwaway
projects the way `test/helpers/fixture.mjs` does, put a pending question in each register, start the
page, and check all six:

```bash
node bin/orchestra monitor --no-open   # capture the pid; kill THAT pid when done
```

1. Two project pills, sorted by name; the selected one is marked.
2. The tab title and the header read the selected project's name, and follow when you switch.
3. Switching projects and back keeps the frame you collapsed and the corner you panned to.
4. A question answered in project A leaves project B's identical question untouched and still red.
5. A thumbnail loads in both projects.
6. The browser console is clean, and the network panel shows no 404.

- [ ] **Step 7: Commit**

```bash
git add lib/monitor/public/
git commit -m "feat(monitor): the project strip above the developer strip, and per-project view state"
```

---

### Task 7: the CLI — a machine command, one URL, and the deletions

**Files:**
- Modify: `bin/orchestra`, `lib/cli/monitor.mjs`, `lib/cli/doctor.mjs`, `lib/config.mjs`,
  `lib/monitor/port.mjs`
- Modify: `test/monitor-port.test.mjs`, `test/cli.test.mjs`, `test/config.test.mjs`,
  `test/doctor.test.mjs`

**Interfaces:**
- Consumes: `machineMonitorPort`, `readMonitor`, `recordMonitor` (Task 2); `serve()` (Task 4).
- Produces: `orchestra monitor` registered `machine: true`; `orchestra instances` printing one URL.
  `candidatePort`, `resolvePort` and `pinConflict` no longer exist.

All of this lands in ONE commit: `pinConflict` has a caller in `doctor.mjs` and `monitor.port` has a
reader in both, so splitting them would leave the suite red between two tasks.

- [ ] **Step 1: Write the failing tests**

In `test/cli.test.mjs`:

```js
test('`orchestra monitor` answers from a directory with no config — it is a machine command', () => {
  const bare = mkdtempSync(join(tmpdir(), 'orchestra-bare-'));
  try {
    const r = spawnSync(process.execPath, [BIN, 'monitor', '--no-open'],
      { cwd: bare, encoding: 'utf8', env: { ...process.env, HOME: process.env.HOME }, timeout: 20_000 });
    // It binds and keeps serving, so it is killed by the timeout rather than exiting — what matters
    // is that it printed a URL instead of exiting 0 in silence the way the off switch used to make it.
    assert.match(r.stdout, /http:\/\/127\.0\.0\.1:\d+/);
  } finally { rmSync(bare, { recursive: true, force: true }); }
});

test('`orchestra monitor --port 5000` is still refused — the port has one source of truth', () => {
  const r = spawnSync(process.execPath, [BIN, 'monitor', '--port', '5000'],
    { cwd: tmpdir(), encoding: 'utf8', env: { ...process.env, HOME: process.env.HOME } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown argument --port/);
  assert.match(r.stderr, /monitorPort in ~\/\.orchestra\/machine\.json/);
});
```

In `test/doctor.test.mjs`:

```js
test('doctor warns about a monitor.port left in a config, because nothing reads it any more', () => {
  const r = makeRepo({ name: 'legacy', config: { monitor: { port: 4500 } } });
  try {
    const out = doctorText(loadConfigOrThrow(r.root));
    assert.doesNotMatch(out, /^monitor\.port\s/m);
    assert.match(out, /monitor\.port .*no longer/i);
    assert.match(out, /monitorPort/);
  } finally { r.cleanup(); }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/cli.test.mjs test/doctor.test.mjs`
Expected: FAIL — monitor exits 0 in silence without a config, and doctor still prints a
`monitor.port` row with no warning.

- [ ] **Step 3: Delete the per-project port**

In `lib/monitor/port.mjs`, delete `candidatePort`, `resolvePort` and `pinConflict` with their
comments, keeping only `listenOnFreePort`, and rewrite the module header:

```js
// Binding the monitor's port. One page serves this machine, so there is no allocation question left
// here — `lib/machine.mjs` decides WHICH port (4380, or `monitorPort` in machine.json) and this
// module only binds it, stepping upward when something else already holds it.
```

Delete the now-unreachable cases in `test/monitor-port.test.mjs`, keeping its `listenOnFreePort`
ones.

In `lib/config.mjs`, delete the `monitor: { port: 'auto' }` line from `DEFAULTS` and the
`const port = raw?.monitor?.port;` block from `validate` with its `okPort` error. Update
`test/config.test.mjs` accordingly.

- [ ] **Step 4: Rewrite the two commands**

`lib/cli/monitor.mjs` — `claim` and `pageAlreadyUp` go; in their place:

```js
// One page per MACHINE, which is what replaced P4's one page per project. Both legs and neither
// alone, unchanged in reasoning from that rule: a recycled pid names some other process entirely,
// and an unrelated process can be sitting on the recorded port. `lsof` answers "is a page there";
// it is never asked "is this port free", which only a real bind can answer. When lsof cannot answer
// at all, nothing is known, so nothing is refused and the bind decides — and unlike P4, a second
// page then binding one port along is harmless, because there is one record to overwrite rather
// than a per-project port left flapping between two numbers.
function pageAlreadyUp() {
  const rec = readMonitor();
  if (!rec || !pidAlive(rec.pid)) return null;
  const probe = listServers([rec.port]);
  if (!probe.ok || !probe.list.some((s) => s.port === rec.port)) return null;
  return rec;
}

export async function monitorCommand({ args }) {
  const unknown = args.filter((a) => a !== '--no-open');
  if (unknown.length)
    throw new Error(`orchestra monitor: unknown argument ${unknown[0]} — the only flag is --no-open, and the port is monitorPort in ~/.orchestra/machine.json`);

  const already = pageAlreadyUp();
  if (already) {
    out(`the orchestra page is already open at http://127.0.0.1:${already.port} (pid ${already.monitorPid ?? already.pid})`);
    out('one page for this machine — open that one, or stop it first');
    return;
  }

  const { port, url } = await serve({ cwd: process.cwd() });
  recordMonitor({ port, pid: process.pid });
  const keepalive = setInterval(() => recordMonitor({ port, pid: process.pid }), REFRESH_MS);
  keepalive.unref();

  const set = discoverProjects({ cwd: process.cwd() });
  out('orchestra monitor');
  out(`  ${url}`);
  out(`  ${set.length} project${set.length === 1 ? '' : 's'}: ${set.map((p) => p.name).join(', ') || 'none yet'}`);
  if (!args.includes('--no-open')) openBrowser(url);
}
```

`instancesCommand` prints the page once, then the table without its URL and state columns:

```js
export function instancesCommand() {
  const now = Date.now();
  const rec = readMonitor();
  const probe = listServers(rec ? [rec.port] : []);
  const page = !rec ? 'no page is open — run `orchestra monitor`'
    : !probe.ok ? `http://127.0.0.1:${rec.port} (cannot tell whether it is listening)`
    : probe.list.some((s) => s.port === rec.port) ? `http://127.0.0.1:${rec.port}`
    : `http://127.0.0.1:${rec.port} — recorded, but nothing is listening there`;
  out(`page: ${page}`);

  const live = liveInstances({ now });
  if (!live.length) {
    out('no orchestra project has reported itself on this machine — run `orchestra ready` or `orchestra monitor` in one');
    return;
  }
  for (const e of live) {
    out(`${pad(e.name, 16)} ${pad(e.id, 7)} ${pad(e.mode, 8)} ${pad(workerWords(e), 15)} ${pad(sessionWords(e), 10)} ${pad(beatWords(e.beatAt, now), 10)} ${pad(sinceWords(e.updatedAt, now), 15)} ${e.root}`);
  }
}
```

In `bin/orchestra`, `register('monitor', { machine: true, run: monitorCommand });` and drop the
`cfg` argument from its call — `cmd.run({ cfg, args: rest })` already passes both, and
`monitorCommand` simply stops reading `cfg`.

`lib/cli/doctor.mjs` — delete the `pinConflict` import and its error block, and delete the
`['monitor.port', cfg.monitor.port]` row from `rows`. In its place, a warning appended to the
returned string beside the existing `note`:

```js
  // `mergeInto` copies every key the file sets, including ones DEFAULTS no longer has, so a
  // leftover `monitor.port` is still readable here — and `validate` only checks keys that ARE in
  // DEFAULTS, so it is not an error, it is silently inert. Which is worse, hence this line. No
  // `raw` on `cfg` and no second read of the file: the merged object already carries it.
  const stale = cfg.monitor?.port !== undefined
    ? '\n  monitor.port no longer does anything — the page is machine-wide.\n  Set monitorPort in ~/.orchestra/machine.json instead, and delete this key.\n'
    : '';
  return `orchestra — ${cfg.name}\n${lines.join('\n')}\n${note}${stale}`;
```

Note for the executor: `doctorText` builds a `rows` array and maps it to `lines` — the warning is
NOT a row (it has no key/value shape and must not be padded into the table), it is appended after
`note`, which is the existing precedent for a sentence rather than a row.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS except the `p4-acceptance.test.mjs` rows Task 8 rewrites.

- [ ] **Step 6: Commit**

```bash
git add bin/orchestra lib/cli/monitor.mjs lib/cli/doctor.mjs lib/config.mjs lib/monitor/port.mjs test/
git commit -m "feat(cli): monitor becomes a machine command, and the per-project port is deleted"
```

---

### Task 8: the acceptance, the spec it retires, and the version

**Files:**
- Modify: `test/p4-acceptance.test.mjs`
- Modify: `docs/specs/2026-09-02-orchestra-plugin-design.md` (§7, §8.2, §8.3)
- Modify: `.claude-plugin/plugin.json` (version)

- [ ] **Step 1: Rewrite the acceptance rows**

Each row asserts the same thing in its new shape. Rewrite, never delete:

| Row | Now asserts |
|---|---|
| 1 | Two projects reach ONE page: one `orchestra monitor` child, and `/api/model` names both, each with its own root, mode and branch |
| 2 | Each project names itself in the model; `<title>` is `orchestra` and carries no project |
| 3 | Kill the monitor and restart it: the same port (4380), and `monitor.json` records it |
| 4 | 4380 held by an obstacle: the monitor probes upward, and `monitor.json` records what it BOUND |
| 5 | An answer posted with `project: A` lands in A's inbox, `orchestra inbox` in A prints it, and B's inbox does not exist |
| 6 | `orchestra instances` prints the one page URL and lists both projects |
| 8 | `orchestra monitor` in a directory with no config still serves — the machine exception |
| scope 9 | A second `orchestra monitor` started in a DIFFERENT project points at the one page |

Rename the file to `test/monitor-acceptance.test.mjs` in the same commit (`git mv`), and update its
header comment: the split it explains — handler in-process, listeners out-of-process — is unchanged
and still correct.

Row 5 in full, because it is the invariant this change introduces:

```js
test('an answer posted for one project lands in that project alone', async () => {
  const [a, b] = twoProjects();
  const inboxA = join(a.root, '.orchestra', 'inbox.jsonl');
  const inboxB = join(b.root, '.orchestra', 'inbox.jsonl');

  const res = fakeRes();
  await handlerFor(a, b)(fakeReq('POST', '/api/answer', {
    body: JSON.stringify({ project: a.id, task: null, pending: null, answer: 'ship at 0.75' }),
  }), res);
  assert.equal(res.code, 200);
  assert.equal(JSON.parse(res.body).conductor, 'no-conductor');

  const lines = readFileSync(inboxA, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).answer, 'ship at 0.75');
  assert.equal(JSON.parse(lines[0]).from, 'monitor');
  assert.equal(existsSync(inboxB), false);

  assert.match(a.run('inbox'), /ship at 0\.75/);
  assert.equal(b.run('inbox'), '');
});
```

- [ ] **Step 2: Run the whole suite**

Run: `npm test`
Expected: PASS, everything.

- [ ] **Step 3: Retire what the old spec promises**

In `docs/specs/2026-09-02-orchestra-plugin-design.md`:

- §7, second paragraph: replace "and it serves on an **allocated** port rather than a fixed one"
  with a pointer — "The page is machine-wide and serves every project on it; see
  `2026-09-04-machine-wide-monitor-design.md`."
- §8.2: strike `port` and `monitorPid` from the example entry, and add one sentence naming
  `monitor.json` as where the page's own port lives.
- §8.3: replace the section body with a one-paragraph note that it is superseded, naming the new
  document. Do not delete the heading — §-numbers are referenced from three plans.

- [ ] **Step 4: Bump the plugin**

`.claude-plugin/plugin.json` to `0.7.0`. It is a breaking change: a per-project URL that someone
bookmarked no longer answers. **0.7.0, not the `0.6.0` this plan was written against**: phase 5
landed on main as `0.6.0` while this branch was being built, and the plugin cache is indexed by
version — two changes sharing one number ships one of them invisible.

- [ ] **Step 5: Commit**

```bash
git add test/ docs/specs/ .claude-plugin/plugin.json
git commit -m "test(monitor): the acceptance for one page, and the spec sections it retires"
```

- [ ] **Step 6: Land it**

Hand the branch to `merge_agent`. Do not merge from here.

---

## Self-review

**Spec coverage.** §1 → Tasks 4, 6, 7. §2 → Task 3. §3 → Tasks 2 and 7. §4 → Task 4 (the single
`lsof` is Step 3's `devServers`). §5 → Tasks 4 and 5. §6 → Task 4 Step 3 (the title, `escapeHtml`).
§7 → Tasks 1 and 6. §8 → Task 6 Steps 2 and 3. §9 → Tasks 2 and 7. §10 → Tasks 1, 3, 4, 5, 8. §11 is
a non-goal and has no task, correctly.

**Names used consistently across tasks.** `projectTabsOf(models, sent)`, `modelOf(models, id)`,
`discoverProjects({ cwd, now })`, `machineMonitorPort()`, `readMonitor()`, `recordMonitor({port,pid,now})`,
`monitorPath()`, `DEFAULT_MONITOR_PORT`, `createHandler({ projects, port, publicDir })`,
`serve({ cwd })`, `projectById(id)`, `current()`, `viewFor(id)`, `placedFor(id)`,
`cacheFor(store, id)`. A project context object is `{ id, name, root, mode, cfg }` in Tasks 3, 4 and
5 alike.

**Known soft spot.** Task 6 is the only task with no automated gate, because nothing in this
repository loads `app.js` — the same limit `p4-acceptance.test.mjs`'s own header records. Its Step 6
is six numbered checks a person performs, and item 4 (answering in A leaves B untouched) is the one
that must not be skipped: it is the visible half of the collision §8 describes, and the invariant
its server-side half is pinned by in Task 8 Row 5.
