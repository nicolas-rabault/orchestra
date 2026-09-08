# Offline leaves no trace — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In offline mode, nothing orchestra produces may enter a commit — a developer cloning the repository must not be able to tell that orchestra is used.

**Architecture:** Six changes, five of them removals of a trace at its source and one a new refusal in the merge gate. The exclusion moves from a committed `.orchestra/.gitignore` to the per-clone `info/exclude`; the ticket ledger stops being a committed ledger offline; the ledger commit message goes neutral; the rules reach agents through the worker brief instead of `CLAUDE.md`; the gate refuses a landing whose commits or added lines carry a trace; `doctor` reports whether the invariant holds. The gate's refusal follows the module's own split — the matcher is pure in `lib/gate/state.mjs`, the git calls stay in `lib/gate/land.mjs`.

**Tech Stack:** Node.js ESM, zero runtime dependencies (`test/no-dependencies.test.mjs` enforces this), `node:test` + `node:assert/strict`, real temporary git repositories via `test/helpers/fixture.mjs`.

**Spec:** [`docs/specs/2026-09-08-offline-leaves-no-trace-design.md`](../specs/2026-09-08-offline-leaves-no-trace-design.md)

## Global Constraints

- **Offline only.** Every behaviour in this plan is gated on `cfg.mode === 'offline'` (or `mode` passed to `detect`). Online mode must behave exactly as it does today; several tasks assert that explicitly.
- **No new dependencies.** `test/no-dependencies.test.mjs` fails the suite if any appear.
- **Everything committed is English** — code, comments, commit messages, docs.
- **The whole suite is 767 tests today.** It must stay green; run `npm test` before every commit.
- **Never work on the main branch.** This plan is executed on `offline-leaves-no-trace`, in the worktree `.worktrees/offline-no-trace`.
- **The trace pattern is one constant**, `TRACE = /orchestra|merge_agent/i`, exported from `lib/gate/state.mjs` and imported everywhere else it is needed. Never re-spelled.
- **Orchestra never writes a commit to fix a trace.** Where a fix requires a commit (untracking a file, deleting a block from a committed `CLAUDE.md`), the tool reports the exact command and stops.

---

### Task 1: The exclusion leaves the repository

`init --mode offline` stops writing the committed `.orchestra/.gitignore` — which sits inside `.orchestra/` and cannot ignore its own parent — and appends `/.orchestra/` to the per-clone exclude file instead.

**Files:**
- Modify: `lib/paths.mjs` — add `gitCommonDir`, make `mainCheckout` its caller
- Modify: `lib/cli/init.mjs` — `writeExclude`, `initProject`, `successMessage`, `usageText`
- Modify: `lib/cli/doctor.mjs:19` — the `NO_CONFIG` blurb says "gitignored"
- Test: `test/paths.test.mjs`, `test/init.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `gitCommonDir(cwd) → string` (absolute path to the git common dir; throws like `mainCheckout` outside a working tree). `initProject`'s report gains `exclude: { path, action }` where `action` is `'appended' | 'unchanged' | 'skipped'`.

- [ ] **Step 1: Write the failing test for `gitCommonDir`**

In `test/paths.test.mjs`, add:

```js
test('gitCommonDir: the main checkout answers with its own .git', () => {
  const r = repo();
  assert.equal(gitCommonDir(r.root), join(r.root, '.git'));
});

test('gitCommonDir: a linked worktree answers with the MAIN checkout .git, not its own', () => {
  const r = repo();
  r.git('worktree', 'add', '-q', join(r.root, 'wt'), '-b', 'wt', 'main');
  // $GIT_DIR there is .git/worktrees/wt — the exclude file lives in the common dir, so this is
  // the distinction the whole exclusion depends on.
  assert.equal(gitCommonDir(join(r.root, 'wt')), join(r.root, '.git'));
});

test('gitCommonDir: outside a working tree it throws, like mainCheckout', () => {
  assert.throws(() => gitCommonDir(tmpdir()), /not a working tree/);
});
```

Add `gitCommonDir` to the import from `../lib/paths.mjs`, and `repo`/`join`/`tmpdir` if the file does not already have them (follow the helper pattern at the top of `test/init.test.mjs`).

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/paths.test.mjs`
Expected: FAIL — `gitCommonDir is not a function`.

- [ ] **Step 3: Implement `gitCommonDir`**

In `lib/paths.mjs`, replace the body of `mainCheckout` with a call to a new exported function above it:

```js
// The git COMMON directory — the one `.git` shared by the main checkout and every linked worktree.
// Two callers need it and they need different things from it: `mainCheckout` wants its parent, and
// `orchestra init` wants the `info/exclude` inside it, which a linked worktree's own $GIT_DIR
// (`.git/worktrees/<name>`) does not have and does not read from.
//
// --path-format=absolute (git 2.31) removes the only ambiguity here: --git-common-dir answers
// relatively from the main checkout and absolutely from a linked worktree, and a caller that
// resolved the relative form against its own cwd would be right by accident.
export function gitCommonDir(cwd = process.cwd()) {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv(),
  }).trim();
  if (!/[/\\]\.git$/.test(common))
    throw new Error(`orchestra: ${cwd} is not a working tree with a .git directory (git-common-dir = ${common})`);
  return common;
}

export const mainCheckout = (cwd = process.cwd()) => dirname(gitCommonDir(cwd));
```

Delete the old `mainCheckout` body and the comment that moved up with `gitCommonDir`.

- [ ] **Step 4: Run the paths tests**

Run: `node --test test/paths.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for the exclusion**

In `test/init.test.mjs`, add:

```js
const excludePath = (root) => join(root, '.git', 'info', 'exclude');

test('initProject offline: excludes .orchestra/ in the clone, writes no .orchestra/.gitignore', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  const rep = initProject(r.root, { mode: 'offline' });
  assert.equal(rep.ok, true);
  assert.equal(rep.exclude.action, 'appended');
  assert.match(readFileSync(excludePath(r.root), 'utf8'), /^\/\.orchestra\/$/m);
  assert.equal(existsSync(join(r.root, '.orchestra', '.gitignore')), false);
  // The point of the whole task: git no longer sees the directory at all.
  assert.equal(r.git('status', '--porcelain').trim(), '');
  assert.equal(r.git('add', '-A', '-n').trim(), '');
});

test('initProject offline: appending twice adds one line', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  initProject(r.root, { mode: 'offline' });
  const second = initProject(r.root, { mode: 'offline', force: true });
  assert.equal(second.exclude.action, 'unchanged');
  const lines = readFileSync(excludePath(r.root), 'utf8').split('\n').filter((l) => l === '/.orchestra/');
  assert.equal(lines.length, 1);
});

test('initProject online: unchanged — .orchestra/.gitignore, no exclude line', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  const rep = initProject(r.root, { mode: 'online' });
  assert.equal(readFileSync(join(r.root, '.orchestra', '.gitignore'), 'utf8'), GITIGNORE);
  assert.equal(rep.exclude, undefined);
  assert.doesNotMatch(readFileSync(excludePath(r.root), 'utf8'), /\.orchestra/);
});

test('initProject offline in a plain directory: the exclusion is skipped, not an error', () => {
  const d = tmpDir();
  const rep = initProject(d, { mode: 'offline' });
  assert.equal(rep.ok, true);
  assert.equal(rep.exclude.action, 'skipped');
});
```

`makeRepo` creates `.git/info/exclude`; if a git build does not, `readFileSync` in the online test will throw — use `existsSync(...) ? readFileSync(...) : ''` there.

- [ ] **Step 6: Run them to verify they fail**

Run: `node --test test/init.test.mjs`
Expected: FAIL — `rep.exclude` is undefined and `.orchestra/.gitignore` is written in both modes.

- [ ] **Step 7: Implement the exclusion**

In `lib/cli/init.mjs`, import `appendFileSync` from `node:fs` and `gitCommonDir` from `../paths.mjs`, then add above `initProject`:

```js
// The line, and where it goes. `.orchestra/.gitignore` is committed and lives INSIDE the directory
// it would have to ignore, so it never could: git reads a .gitignore for the paths BELOW it. The
// per-clone exclude file has neither problem — git does not commit it and does not transmit it on
// clone, so offline mode's own state is invisible to git here and does not exist anywhere else.
//
// It goes in the COMMON dir, not in $GIT_DIR: verified on a throwaway repository, a linked worktree
// (whose $GIT_DIR is `.git/worktrees/<name>`) reads the common dir's exclude, which is what makes
// `git worktree add .orchestra/worktrees/<slug>` land inside an excluded directory and stay quiet.
//
// Anchored with a leading slash — a bare `.orchestra/` would also exclude a directory of that name
// nested anywhere in the project, which is not this line's business.
const EXCLUDE_LINE = '/.orchestra/';

function writeExclude(root) {
  let dir;
  // The one caller that reaches here without a repository is `initProject` under test, against a
  // plain temporary directory. A directory that is not a working tree has no commits, so the
  // invariant this line serves is vacuous there — skipped, never an error.
  try { dir = join(gitCommonDir(root), 'info'); } catch { return { path: null, action: 'skipped' }; }
  const path = join(dir, 'exclude');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (existing.split('\n').includes(EXCLUDE_LINE)) return { path, action: 'unchanged' };
  mkdirSync(dir, { recursive: true });
  appendFileSync(path, existing && !existing.endsWith('\n') ? `\n${EXCLUDE_LINE}\n` : `${EXCLUDE_LINE}\n`);
  return { path, action: 'appended' };
}
```

In `initProject`, replace the unconditional `.gitignore` write:

```js
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const offline = config.mode === 'offline';
  const exclude = offline ? writeExclude(root) : undefined;
  if (!offline) writeFileSync(join(dir, '.gitignore'), GITIGNORE);
  const claude = writeClaudeRules(root);

  return {
    ok: true,
    action: existed ? 'reinitialized' : 'initialized',
    root,
    configPath,
    config,
    detected: det,
    claude,
    exclude,
    message: successMessage({ configPath, config, det, claude, exclude, existed }),
  };
```

- [ ] **Step 8: Make `init`'s own prose stop lying**

In `successMessage`, replace the `wrote` row with one that reports what actually happened:

```js
    exclude
      ? `  excluded    ${exclude.action === 'skipped'
        ? '(not a git working tree — nothing to exclude)'
        : `${EXCLUDE_LINE} in ${exclude.path} (${exclude.action}) — this clone only, never committed`}`
      : `  wrote        ${join(dirname(configPath), '.gitignore')}`,
```

In `usageText`, the `--mode offline` blurb:

```
              offline  roadmaps are markdown under .orchestra/roadmaps, excluded from this clone
                       and never committed
```

In `lib/cli/doctor.mjs`'s `NO_CONFIG`, the same correction:

```
  offline   roadmaps are markdown under .orchestra/roadmaps — excluded from this clone, never
            committed — and "is somebody already working on this" is answered for this
            machine only
```

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS. Existing `init` tests that assert the `.gitignore` write must be reading an online report or be updated to pass `mode: 'online'`; fix any that fail, do not weaken the assertion.

- [ ] **Step 10: Commit**

```bash
git add lib/paths.mjs lib/cli/init.mjs lib/cli/doctor.mjs test/paths.test.mjs test/init.test.mjs
git commit -m "feat(init): offline hides its directory in the clone, not in a committed file"
```

---

### Task 2: The ticket ledger is not a ledger offline

`detect()` proposes `.orchestra/tickets.jsonl` as a `ledgers` entry unconditionally, which is what makes the merge gate commit that file to the main branch at every landing.

**Files:**
- Modify: `lib/cli/init.mjs` — `detect`, `initProject`'s call, `initCommand`'s `--detect` branch
- Test: `test/init.test.mjs`

**Interfaces:**
- Consumes: Task 1's `initProject`.
- Produces: `detect(root, { mode } = {})` — `ledgers: []` when `mode === 'offline'`, `[DEFAULTS.tickets.file]` otherwise (including when no mode is given).

- [ ] **Step 1: Write the failing test**

```js
test('detect offline: no ledger — the ticket file is local state, not something main carries', () => {
  const d = tmpDir();
  assert.deepEqual(detect(d, { mode: 'offline' }).ledgers, []);
});

test('detect: online and mode-less both keep the ticket ledger', () => {
  const d = tmpDir();
  assert.deepEqual(detect(d, { mode: 'online' }).ledgers, [DEFAULTS.tickets.file]);
  assert.deepEqual(detect(d).ledgers, [DEFAULTS.tickets.file]);
});

test('initProject offline: the written config carries no ledgers', () => {
  const d = tmpDir();
  const rep = initProject(d, { mode: 'offline' });
  assert.deepEqual(rep.config.ledgers, []);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/init.test.mjs`
Expected: FAIL — `detect` ignores its second argument and returns the ticket path.

- [ ] **Step 3: Implement**

In `lib/cli/init.mjs`, change the signature and the `ledgers` line, replacing the existing comment block above it:

```js
export function detect(root, { mode } = {}) {
```

```js
  // Not detected from the project's own files — proposed at its default path, because every
  // ONLINE project gets the ticket queue committed (`lib/tickets/`). Offline it is not a ledger at
  // all: the file lives under `.orchestra/`, which Task 1's exclusion hides from git, so committing
  // it is exactly the trace this mode forbids. The two halves agree — with the path out of
  // `ledgers`, `commitLedgers` (`lib/gate/land.mjs`) commits nothing, and the clash check that
  // would otherwise refuse the first branch touching it can never fire on a path git cannot see.
  //
  // No mode given — `--detect` before one is chosen — keeps the online answer, the conservative one.
  const ledgers = mode === 'offline' ? [] : [DEFAULTS.tickets.file];
```

In `initProject`, pass the mode through: `const det = detect(root, { mode });`

In `initCommand`'s `--detect` branch, pass the mode when one was given on the same line, so `--detect --mode offline` reports the offline proposal:

```js
  const modeIdx = args.indexOf('--mode');
  const mode = modeIdx === -1 ? undefined : args[modeIdx + 1];

  if (args.includes('--detect')) {
    const det = detect(root, { mode });
    process.stdout.write(args.includes('--json') ? `${JSON.stringify(det, null, 2)}\n` : `${formatDetect(det)}\n`);
    return;
  }

  if (modeIdx === -1) {
```

and delete the now-duplicated `const modeIdx`/`const mode` lines further down. `usageText(root)` calls `detect(root)` with no mode, which is correct — it describes both modes.

- [ ] **Step 4: Run the tests**

Run: `node --test test/init.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/cli/init.mjs test/init.test.mjs
git commit -m "feat(init): offline proposes no ledger — the ticket file is this clone's own"
```

---

### Task 3: `offlineTraces` — the pure matcher

The gate's own header says "Nothing here decides anything. Every decision worth a test is in ./state.mjs." The matcher goes there, with no git and no filesystem, so it is tested against fixed strings.

**Files:**
- Modify: `lib/gate/state.mjs` — add `TRACE` and `offlineTraces` beside `clashingPaths`
- Test: `test/gate-state.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `TRACE: RegExp` — `/orchestra|merge_agent/i`, the one spelling of the pattern.
  - `offlineTraces({ paths = [], commits = [], diff = '' }) → [{ where: string, text: string }]` where `commits` is `[{ sha, body }]`, `where` is `path <p>`, `commit <sha7>` or `<file>:<line>`, and `text` is the matching text, trimmed.

- [ ] **Step 1: Write the failing tests**

In `test/gate-state.test.mjs`:

```js
test('offlineTraces: a clean branch has nothing', () => {
  assert.deepEqual(S.offlineTraces({
    paths: ['src/a.js'],
    commits: [{ sha: 'abc1234def', body: 'feat: a thing\n\nA body.\n' }],
    diff: '+++ b/src/a.js\n@@ -1,0 +1,1 @@\n+const a = 1;\n',
  }), []);
});

test('offlineTraces: a commit message names the tool', () => {
  const found = S.offlineTraces({ commits: [{ sha: 'abc1234def', body: 'chore: run orchestra land\n' }] });
  assert.equal(found.length, 1);
  assert.equal(found[0].where, 'commit abc1234');
});

test('offlineTraces: an added line names the tool, located in the new file', () => {
  const diff = [
    '+++ b/docs/plan.md',
    '@@ -1,2 +1,4 @@',
    ' context one',
    ' context two',
    '+a plain line',
    '+scheduled by orchestra',
    '',
  ].join('\n');
  const found = S.offlineTraces({ diff });
  assert.deepEqual(found, [{ where: 'docs/plan.md:4', text: 'scheduled by orchestra' }]);
});

test('offlineTraces: a REMOVED line is not a trace — deleting the block is the fix, not the crime', () => {
  const diff = '+++ b/CLAUDE.md\n@@ -1,2 +1,1 @@\n context\n-## Working with orchestra\n';
  assert.deepEqual(S.offlineTraces({ diff }), []);
});

test('offlineTraces: a force-added path under the excluded directory', () => {
  const found = S.offlineTraces({ paths: ['.orchestra/tickets.jsonl'] });
  assert.deepEqual(found, [{ where: 'path .orchestra/tickets.jsonl', text: '.orchestra/tickets.jsonl' }]);
});

test('offlineTraces: merge_agent counts, and the match is case-insensitive', () => {
  assert.equal(S.offlineTraces({ commits: [{ sha: 'f00ba12345', body: 'hand to Merge_Agent' }] }).length, 1);
});

test('offlineTraces: the +++ header itself is not an added line', () => {
  // Otherwise every file under the excluded directory would be reported twice, once as a path and
  // once as its own diff header.
  assert.deepEqual(S.offlineTraces({ diff: '+++ b/.orchestra/x\n@@ -0,0 +1 @@\n+ok\n' }), []);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/gate-state.test.mjs`
Expected: FAIL — `S.offlineTraces is not a function`.

- [ ] **Step 3: Implement**

In `lib/gate/state.mjs`, after `clashingPaths`:

```js
// ---------------------------------------------------------------------------------
// THE OFFLINE TRACE CHECK (docs/specs/2026-09-08-offline-leaves-no-trace-design.md).
//
// Offline mode's repository is shared with developers who must not learn the tool exists, and the
// main branch is the only branch that is ever pushed. `orchestra land` is the only way into it, so
// this is where the invariant can be made true rather than hoped for — a PreToolUse hook sees only
// the text an agent typed and misses `git commit -a`, an alias, a script, or any commit made
// outside the Bash tool.
//
// Pure, like everything else here: the gate hands over three facts and this decides.
// ---------------------------------------------------------------------------------
export const TRACE = /orchestra|merge_agent/i;

export function offlineTraces({ paths = [], commits = [], diff = '' }) {
  const found = [];
  for (const p of paths) if (TRACE.test(p)) found.push({ where: `path ${p}`, text: p });
  for (const c of commits) if (TRACE.test(c.body)) found.push({ where: `commit ${c.sha.slice(0, 7)}`, text: firstMatchingLine(c.body) });

  // Only ADDED lines, located by the new file's own line numbering — a removed line that names the
  // tool is the fix (Task 7 deletes the CLAUDE.md block), never the offence.
  let file = null;
  let line = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) { file = raw.slice(4).replace(/^b\//, ''); continue; }
    if (raw.startsWith('---') || raw.startsWith('diff ') || raw.startsWith('index ')) continue;
    if (raw.startsWith('@@')) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
      line = m ? Number(m[1]) : 0;
      continue;
    }
    if (raw.startsWith('\\')) continue;            // "\ No newline at end of file"
    if (raw.startsWith('-')) continue;             // removed — consumes no line of the new file
    if (raw.startsWith('+')) {
      const text = raw.slice(1);
      if (TRACE.test(text)) found.push({ where: `${file}:${line}`, text: text.trim() });
      line += 1;
      continue;
    }
    line += 1;                                      // context
  }
  return found;
}

const firstMatchingLine = (text) => (text.split('\n').find((l) => TRACE.test(l)) ?? text).trim();
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/gate-state.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/gate/state.mjs test/gate-state.test.mjs
git commit -m "feat(gate): the pure matcher for a trace in a branch's commits and added lines"
```

---

### Task 4: The ledger commit message stops naming the gate

Only reachable offline if a project configures a `ledgers` entry by hand, but `Committed by the merge gate, which is the only actor allowed to write the main branch` in shared history is precisely the leak being forbidden.

**Files:**
- Modify: `lib/gate/land.mjs:331-357` — `commitLedgers`
- Test: `test/gate-state.test.mjs` or the suite that covers `commitLedgers` today (find it with `grep -rln commitLedgers test/`)

**Interfaces:**
- Consumes: `TRACE` from Task 3.
- Produces: no signature change — `commitLedgers(cfg, { waitMs })` chooses its message body on `cfg.mode`.

- [ ] **Step 1: Write the failing test**

In whichever suite covers `commitLedgers` (create the case beside the existing ones):

```js
test('commitLedgers offline: the message names no tool', () => {
  const r = repo({ mode: 'offline', config: { ledgers: ['ledger.jsonl'] } });
  writeFileSync(join(r.root, 'ledger.jsonl'), '{"a":1}\n');
  r.git('add', 'ledger.jsonl'); r.git('commit', '-q', '-m', 'ledger');
  writeFileSync(join(r.root, 'ledger.jsonl'), '{"a":2}\n');
  assert.equal(commitLedgers(loadConfigOrThrow(r.root)), true);
  const body = r.git('log', '-1', '--format=%B');
  assert.doesNotMatch(body, TRACE);
});

test('commitLedgers online: keeps the prose that explains the gate', () => {
  const r = repo({ mode: 'online', config: { ledgers: ['ledger.jsonl'] } });
  writeFileSync(join(r.root, 'ledger.jsonl'), '{"a":1}\n');
  r.git('add', 'ledger.jsonl'); r.git('commit', '-q', '-m', 'ledger');
  writeFileSync(join(r.root, 'ledger.jsonl'), '{"a":2}\n');
  commitLedgers(loadConfigOrThrow(r.root));
  assert.match(r.git('log', '-1', '--format=%B'), /merge gate/);
});
```

`TRACE` comes from `../lib/gate/state.mjs`, added by Task 3.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/<that file>.mjs`
Expected: FAIL — the offline body contains "merge gate".

- [ ] **Step 3: Implement**

In `commitLedgers`, replace the second `-m` argument with a mode-chosen body:

```js
    // The body is chosen on the mode, and it is not decoration. Offline, nothing orchestra produces
    // may enter a commit (docs/specs/2026-09-08-offline-leaves-no-trace-design.md), and this
    // message goes into the shared history of a repository whose other developers must not learn
    // the tool exists. Online there is nothing to hide and the explanation is worth having.
    const body = cfg.mode === 'offline'
      ? `${ledgers.join('\n')}\n\nWritten in the main checkout since the last landing.`
      : `${ledgers.join('\n')}\n\nWritten in the main checkout by the tools that file them.`
        + ' Committed by the merge gate, which is the only actor allowed to write the main branch'
        + ' and the only one holding a lock against those writers.';
    const ok = gitWriteOk(cfg.root, ['add', '--', ...ledgers])
      && gitWriteOk(cfg.root, ['commit', '--no-verify', '--only',
        '-m', `chore(ledger): record ${ledgers.length} ledger file(s) written since the last landing`,
        '-m', body,
        '--', ...ledgers]);
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/<that file>.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/gate/land.mjs test/<that file>.mjs
git commit -m "fix(gate): an offline ledger commit names no tool in shared history"
```

---

### Task 5: The gate refuses a landing that carries a trace

**Files:**
- Modify: `lib/gate/land.mjs` — immediately after the rebase, where `changed` is read, before `gatesFor`
- Test: `test/p3-acceptance.test.mjs`

**Interfaces:**
- Consumes: `S.offlineTraces`, `S.TRACE`, `S.EXIT.refused` from Task 3.
- Produces: no new export. A landing refused this way exits `S.EXIT.refused` and marks the entry `held` with a note starting `offline-trace`.

- [ ] **Step 1: Write the failing acceptance test**

In `test/p3-acceptance.test.mjs`, following that file's existing landing helpers:

```js
test('land offline: a branch whose commit message names the tool is refused before any gate runs', () => {
  const r = repo({ mode: 'offline', config: { gates: [{ name: 'suite', cmd: 'touch gate-ran' }] } });
  r.git('worktree', 'add', '-q', join(r.root, 'wt'), '-b', 'feat', 'main');
  writeFileSync(join(r.root, 'wt', 'a.txt'), 'a\n');
  execFileSync('git', ['-C', join(r.root, 'wt'), 'add', 'a.txt']);
  execFileSync('git', ['-C', join(r.root, 'wt'), 'commit', '-q', '-m', 'chore: land via orchestra']);

  const res = spawnSync(BIN, ['land', 'feat'], { cwd: r.root, encoding: 'utf8' });
  assert.equal(res.status, 11);                                   // S.EXIT.refused
  assert.match(res.stderr, /offline-trace/);
  assert.match(res.stderr, /commit [0-9a-f]{7}/);
  assert.equal(existsSync(join(r.root, 'wt', 'gate-ran')), false); // refused BEFORE the gate
  assert.equal(r.git('rev-parse', 'main').trim(), r.git('rev-parse', 'main@{1}').trim() || r.git('rev-parse', 'main').trim());
});

test('land offline: an added line that names the tool is refused, naming file and line', () => {
  const r = repo({ mode: 'offline', config: { gates: [] } });
  r.git('worktree', 'add', '-q', join(r.root, 'wt'), '-b', 'feat', 'main');
  writeFileSync(join(r.root, 'wt', 'notes.md'), 'one\ntwo\nrun orchestra land\n');
  execFileSync('git', ['-C', join(r.root, 'wt'), 'add', 'notes.md']);
  execFileSync('git', ['-C', join(r.root, 'wt'), 'commit', '-q', '-m', 'docs: notes']);

  const res = spawnSync(BIN, ['land', 'feat'], { cwd: r.root, encoding: 'utf8' });
  assert.equal(res.status, 11);
  assert.match(res.stderr, /notes\.md:3/);
});

test('land offline: the same branch lands once reworded', () => {
  const r = repo({ mode: 'offline', config: { gates: [] } });
  r.git('worktree', 'add', '-q', join(r.root, 'wt'), '-b', 'feat', 'main');
  writeFileSync(join(r.root, 'wt', 'a.txt'), 'a\n');
  execFileSync('git', ['-C', join(r.root, 'wt'), 'add', 'a.txt']);
  execFileSync('git', ['-C', join(r.root, 'wt'), 'commit', '-q', '-m', 'feat: a thing']);
  assert.equal(spawnSync(BIN, ['land', 'feat'], { cwd: r.root, encoding: 'utf8' }).status, 0);
});

test('land online: the same offending branch lands — online has nothing to hide', () => {
  const r = repo({ mode: 'online', config: { gates: [] } });
  r.git('worktree', 'add', '-q', join(r.root, 'wt'), '-b', 'feat', 'main');
  writeFileSync(join(r.root, 'wt', 'a.txt'), 'a\n');
  execFileSync('git', ['-C', join(r.root, 'wt'), 'add', 'a.txt']);
  execFileSync('git', ['-C', join(r.root, 'wt'), 'commit', '-q', '-m', 'chore: land via orchestra']);
  assert.equal(spawnSync(BIN, ['land', 'feat'], { cwd: r.root, encoding: 'utf8' }).status, 0);
});
```

Match this file's existing conventions for `BIN`, `repo` and worktree setup rather than the sketch above where they differ — read the neighbouring tests first.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/p3-acceptance.test.mjs`
Expected: FAIL — the offending branches land with status 0.

- [ ] **Step 3: Implement the refusal**

In `lib/gate/land.mjs`, directly after the `changed` block that reads the diff post-rebase and before `const { gates, from, error } = gatesFor(cfg, wt.path);`:

```js
  // Offline, nothing orchestra produces may enter a commit, and this is the last place that can
  // still be true: the main branch is the only branch pushed and this function is the only way in.
  // AFTER the rebase, so the commits and the diff are what the fast-forward will actually replay;
  // BEFORE the gates, because refusing costs nothing and a suite costs minutes.
  if (cfg.mode === 'offline') {
    const log = git(wt.path, ['log', '-z', '--format=%H%x00%B', `${cfg.mainBranch}..${branch}`]);
    const fields = log.split('\0');
    const commits = [];
    for (let i = 0; i + 1 < fields.length; i += 2) commits.push({ sha: fields[i], body: fields[i + 1] });
    const traces = S.offlineTraces({
      paths: changed ?? [],
      commits,
      diff: git(wt.path, ['diff', `${cfg.mainBranch}...${branch}`]),
    });
    if (traces.length) {
      const note = `offline-trace: ${traces.length} place(s) name the tool`;
      mark(p, branch, 'held', note);
      err(`'${branch}' would put ${traces.length} trace(s) of orchestra into ${cfg.mainBranch} —`
        + ` held, ${cfg.mainBranch} untouched. Offline mode's repository is shared with developers`
        + ' who must not learn the tool exists; reword and land again:');
      for (const t of traces.slice(0, 10)) err(`  ${t.where}  ${t.text}`);
      if (traces.length > 10) err(`  … and ${traces.length - 10} more`);
      return S.EXIT.refused;
    }
  }
```

`changed` is `null` when git could not answer, hence `changed ?? []` — the commits and the diff still carry the check.

- [ ] **Step 4: Run the acceptance tests**

Run: `node --test test/p3-acceptance.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/gate/land.mjs test/p3-acceptance.test.mjs
git commit -m "feat(gate): offline refuses a landing that would name the tool on main"
```

---

### Task 6: The rules reach agents through the brief

`init --mode offline` stops appending to the committed `CLAUDE.md` and writes the same content inside the excluded directory instead; the conductor's brief carries it.

**Files:**
- Modify: `templates/CLAUDE-rules.md` — add the rule the gate refuses on
- Modify: `lib/cli/init.mjs` — `writeClaudeRules` gains an offline path
- Modify: `skills/orchestra/SKILL.md` — the brief substitution table and the Execution/Design briefs
- Test: `test/init.test.mjs`

**Interfaces:**
- Consumes: Task 1's `initProject`.
- Produces: `initProject`'s report `claude` gains `action: 'rules-file'` with `path` pointing at `.orchestra/CLAUDE-rules.md` in offline mode. `CLAUDE.md` is not touched.

- [ ] **Step 1: Add the rule to the template**

In `templates/CLAUDE-rules.md`, after the "What is committed is in English" bullet:

```markdown
- **Nothing that is committed names orchestra** — not a commit message, not a spec, not a plan, not
  a comment. The work is the project's; the tool that scheduled it is not part of the record. In
  offline mode the merge gate refuses a landing that breaks this, naming the file and line.
```

- [ ] **Step 2: Write the failing test**

```js
test('initProject offline: the rules go beside the config, not into CLAUDE.md', () => {
  const d = tmpDir();
  const rep = initProject(d, { mode: 'offline' });
  assert.equal(rep.claude.action, 'rules-file');
  assert.equal(existsSync(join(d, 'CLAUDE.md')), false);
  assert.match(readFileSync(join(d, '.orchestra', 'CLAUDE-rules.md'), 'utf8'), /orchestra:claude-rules/);
});

test('initProject offline: an existing CLAUDE.md is left alone', () => {
  const d = tmpDir();
  writeFileSync(join(d, 'CLAUDE.md'), '# Project\n\nRules of our own.\n');
  initProject(d, { mode: 'offline' });
  assert.equal(readFileSync(join(d, 'CLAUDE.md'), 'utf8'), '# Project\n\nRules of our own.\n');
});

test('initProject online: unchanged — the block is appended to CLAUDE.md', () => {
  const d = tmpDir();
  writeFileSync(join(d, 'CLAUDE.md'), '# Project\n');
  const rep = initProject(d, { mode: 'online' });
  assert.equal(rep.claude.action, 'appended');
  assert.match(readFileSync(join(d, 'CLAUDE.md'), 'utf8'), /Working with orchestra/);
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --test test/init.test.mjs`
Expected: FAIL — `CLAUDE.md` is created in both modes.

- [ ] **Step 4: Implement**

In `lib/cli/init.mjs`, give `writeClaudeRules` the mode. Replace its signature and add the offline branch at the top:

```js
function writeClaudeRules(root, mode) {
  const block = readTemplate('CLAUDE-rules.md');
  // Offline, CLAUDE.md is committed and the block names the tool — so the rules go under
  // `.orchestra/`, which Task 1's exclusion hides from git, and reach agents through the worker
  // brief instead (`skills/orchestra/SKILL.md`, "Worker briefs"). One template, two deliveries.
  if (mode === 'offline') {
    const path = join(orchestraDir(root), 'CLAUDE-rules.md');
    writeFileSync(path, block);
    return { path, action: 'rules-file' };
  }
  const path = join(root, 'CLAUDE.md');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
  …unchanged…
}
```

`initProject` calls `writeClaudeRules(root, config.mode)` — after `mkdirSync(dir, …)`, which the offline path depends on. Update `successMessage`'s `CLAUDE.md` row label to read `rules` rather than `CLAUDE.md`, since it now names either file.

- [ ] **Step 5: Carry the rules into the brief**

In `skills/orchestra/SKILL.md`, add a tenth row to the substitution table:

```markdown
| `{projectRules}` | the contents of `.orchestra/CLAUDE-rules.md` when that file exists (offline mode — `init` writes it there instead of into the committed `CLAUDE.md`), pasted verbatim. Absent means the paragraph is omitted entirely: online, the same rules are already in the project's `CLAUDE.md`, which every session reads |
```

Change "the same nine substitutions" to "the same ten substitutions" in the paragraph above the table, and "Fill the nine placeholders" to "Fill the ten placeholders" below it. In the Execution brief, put the placeholder on its own line directly after the `Hard rules:` line and before `{briefExtra}`:

```
{projectRules}
{briefExtra}
```

The Design brief says "the same header and rules as above", so it inherits this with no edit.

- [ ] **Step 6: Run the tests**

Run: `node --test test/init.test.mjs`
Expected: PASS. `test/p2b-acceptance.test.mjs` asserts against the brief text — if it counts substitutions or matches the Hard rules paragraph, update it to the new shape.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add templates/CLAUDE-rules.md lib/cli/init.mjs skills/orchestra/SKILL.md test/init.test.mjs
git commit -m "feat(init): offline rules reach agents through the brief, not a committed file"
```

---

### Task 7: The online → offline flip

A project that ran `init --mode online` already has the block in `CLAUDE.md` and `.orchestra/` tracked. `init --force --mode offline` cleans what it can and reports exactly what it cannot.

**Files:**
- Modify: `lib/cli/init.mjs` — block removal in `writeClaudeRules`'s offline path, a `tracked` report from `initProject`
- Test: `test/init.test.mjs`

**Interfaces:**
- Consumes: Tasks 1 and 6.
- Produces: `initProject`'s report gains `tracked: string[]` — paths under `.orchestra/` that git still tracks, empty when clean or outside a repository. `claude.action` becomes `'rules-file+removed'` when a block was deleted from `CLAUDE.md`.

- [ ] **Step 1: Write the failing test**

```js
test('flip online → offline: the block leaves CLAUDE.md, and what must be committed is named', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  initProject(r.root, { mode: 'online' });
  r.git('add', '-A'); r.git('commit', '-q', '-m', 'opt in');

  const rep = initProject(r.root, { mode: 'offline', force: true });
  assert.equal(rep.claude.action, 'rules-file+removed');
  assert.doesNotMatch(readFileSync(join(r.root, 'CLAUDE.md'), 'utf8'), /Working with orchestra/);
  assert.deepEqual(rep.tracked.sort(), ['.orchestra/.gitignore', '.orchestra/config.json']);
  assert.match(rep.message, /git rm --cached/);
  // Orchestra never writes the commit that finishes this.
  assert.notEqual(r.git('status', '--porcelain').trim(), '');
});

test('flip: a CLAUDE.md that only ever held the block is emptied, not deleted', () => {
  const d = tmpDir();
  initProject(d, { mode: 'online' });
  initProject(d, { mode: 'offline', force: true });
  assert.equal(readFileSync(join(d, 'CLAUDE.md'), 'utf8').trim(), '');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/init.test.mjs`
Expected: FAIL — the block stays and `rep.tracked` is undefined.

- [ ] **Step 3: Implement the block removal**

In `writeClaudeRules`'s offline branch, after writing the rules file:

```js
  if (mode === 'offline') {
    const path = join(orchestraDir(root), 'CLAUDE-rules.md');
    writeFileSync(path, block);
    // A project flipped from online carries the block in a COMMITTED CLAUDE.md. Removing it from
    // the working tree is all this can do: the deletion is a change someone has to commit, and
    // orchestra writing that commit is the very thing this mode forbids.
    const claudePath = join(root, 'CLAUDE.md');
    const existing = existsSync(claudePath) ? readFileSync(claudePath, 'utf8') : null;
    if (existing?.includes(block)) {
      writeFileSync(claudePath, existing.replace(block, '').replace(/\n{3,}$/, '\n'));
      return { path, claudePath, action: 'rules-file+removed' };
    }
    return { path, action: 'rules-file' };
  }
```

- [ ] **Step 4: Implement the tracked report**

Add above `initProject`:

```js
// What git still TRACKS under `.orchestra/` — a project flipped from online, where the config and
// its .gitignore were committed. The exclusion Task 1 writes does not untrack a file; only a commit
// does, and that commit is the user's to write.
function trackedOrchestraPaths(root) {
  try {
    return execFileSync('git', ['-C', root, 'ls-files', '--', '.orchestra'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv(),
    }).split('\n').filter(Boolean);
  } catch { return []; }
}
```

importing `execFileSync` from `node:child_process` and `gitEnv` from `../paths.mjs`. In `initProject`, after the writes:

```js
  const tracked = config.mode === 'offline' ? trackedOrchestraPaths(root) : [];
```

and add `tracked` to the returned object and to `successMessage`'s arguments. In `successMessage`, append when either applies:

```js
  if (claude.claudePath) {
    lines.push(`  removed the rules block from ${claude.claudePath} — commit that deletion by hand,`);
    lines.push('  with a message that names nothing. History still holds the block; this cannot change that.');
  }
  if (tracked.length) {
    lines.push(`  git still tracks ${tracked.length} path(s) under .orchestra/ — untrack them by hand:`);
    lines.push(`    git rm --cached -r -- ${tracked.join(' ')}`);
    lines.push('  then commit the deletion with a message that names nothing.');
  }
```

- [ ] **Step 5: Run the tests**

Run: `node --test test/init.test.mjs`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/cli/init.mjs test/init.test.mjs
git commit -m "feat(init): flipping to offline cleans what it can and names what it cannot"
```

---

### Task 8: `doctor` reports whether the invariant holds

**Files:**
- Modify: `lib/cli/doctor.mjs` — a `traceLine(cfg)`, following `rerereLine`'s shape
- Test: `test/doctor.test.mjs`

**Interfaces:**
- Consumes: `TRACE` from Task 3, `gitCommonDir` from Task 1.
- Produces: one extra line in `doctorText(cfg)` when `cfg.mode === 'offline'`, absent otherwise.

- [ ] **Step 1: Write the failing test**

```js
test('doctor offline: the trace row is clean once init has run', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  initProject(r.root, { mode: 'offline' });
  assert.match(doctorText(loadConfigOrThrow(r.root)), /trace\s+clean/);
});

test('doctor offline: a tracked path and a missing exclusion are both named', () => {
  const r = repo();                       // fixture commits .orchestra/config.json, excludes nothing
  const text = doctorText(loadConfigOrThrow(r.root));
  assert.match(text, /\/\.orchestra\/ is not excluded/);
  assert.match(text, /\.orchestra\/config\.json/);
});

test('doctor online: no trace row', () => {
  const r = repo({ mode: 'online' });
  assert.doesNotMatch(doctorText(loadConfigOrThrow(r.root)), /trace/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/doctor.test.mjs`
Expected: FAIL — no trace row exists.

- [ ] **Step 3: Implement**

In `lib/cli/doctor.mjs`, import `readFileSync`/`existsSync` from `node:fs`, `join` from `node:path`, `gitCommonDir` from `../paths.mjs`, and `TRACE` from `../gate/state.mjs`, then add beside `rerereLine`:

```js
// Offline mode's one promise, checked rather than believed: nothing orchestra produces has entered
// a commit (docs/specs/2026-09-08-offline-leaves-no-trace-design.md). Three facts, each with the
// action that fixes it. Never a refusal — `doctor` reports, it does not gate.
function traceLine(cfg) {
  if (cfg.mode !== 'offline') return null;
  const problems = [];

  let excluded = false;
  try {
    const path = join(gitCommonDir(cfg.root), 'info', 'exclude');
    excluded = existsSync(path) && readFileSync(path, 'utf8').split('\n').includes('/.orchestra/');
  } catch { /* not a working tree — nothing to exclude and nothing to leak */ }
  if (!excluded) problems.push('/.orchestra/ is not excluded in this clone — run `orchestra init --mode offline --force`');

  let tracked = [];
  try {
    tracked = execFileSync('git', ['-C', cfg.root, 'ls-files'], { encoding: 'utf8', env: gitEnv() })
      .split('\n').filter((p) => p && TRACE.test(p));
  } catch { /* unreadable — the row says what it could check */ }
  for (const p of tracked) problems.push(`git tracks ${p} — untrack it: git rm --cached -- ${p}`);

  const claudePath = join(cfg.root, 'CLAUDE.md');
  if (existsSync(claudePath) && /orchestra:claude-rules/.test(readFileSync(claudePath, 'utf8')))
    problems.push(`the rules block is still in ${claudePath} — remove it and commit the deletion`);

  return `  ${pad('trace', 20)} ${problems.length ? `${problems.length} problem(s)` : 'clean'}`
    + problems.map((p) => `\n    ${p}`).join('');
}
```

and fold it into the extras, dropping the null when online:

```js
  const extra = [heartbeatLine(cfg), rerereLine(cfg), traceLine(cfg), heartbeatAgentsLine()]
    .filter(Boolean).join('\n');
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/doctor.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/cli/doctor.mjs test/doctor.test.mjs
git commit -m "feat(doctor): offline reports whether its no-trace promise currently holds"
```

---

### Task 9: The whole promise, end to end

One test that takes an offline project through the real thing and asserts the invariant on the result, so a future change that reintroduces a trace fails here even if it passes every unit test above.

**Files:**
- Modify: `test/both-modes.test.mjs`
- Test: itself

**Interfaces:**
- Consumes: every task above.
- Produces: nothing.

- [ ] **Step 1: Write the test**

```js
test('offline, end to end: nothing orchestra produces reaches a commit', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  r.git('rm', '-q', '--cached', '-r', '--ignore-unmatch', '.orchestra');
  r.git('commit', '-q', '-m', 'clean start', '--allow-empty');
  execFileSync(BIN, ['init', '--mode', 'offline'], { cwd: r.root, encoding: 'utf8' });

  // A worker's branch, landed through the real gate.
  r.git('worktree', 'add', '-q', join(r.root, '.orchestra', 'worktrees', 'w1'), '-b', 'feat', 'main');
  const wt = join(r.root, '.orchestra', 'worktrees', 'w1');
  writeFileSync(join(wt, 'feature.txt'), 'the work itself\n');
  execFileSync('git', ['-C', wt, 'add', 'feature.txt']);
  execFileSync('git', ['-C', wt, 'commit', '-q', '-m', 'feat: the work itself']);
  assert.equal(spawnSync(BIN, ['land', 'feat'], { cwd: r.root, encoding: 'utf8' }).status, 0);

  // The three ways another developer could find out, all silent.
  assert.deepEqual(r.git('ls-files').split('\n').filter((p) => p && TRACE.test(p)), []);
  assert.doesNotMatch(r.git('log', '--format=%B', 'main'), TRACE);
  assert.equal(r.git('status', '--porcelain').trim(), '');
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/both-modes.test.mjs`
Expected: PASS. If it fails, the failure names which of the three channels leaked — fix the source, never the assertion.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS, with the count above 767.

- [ ] **Step 4: Update the spec's status and the README**

Check `README.md`'s description of offline mode for the word "gitignored" and correct it the way Task 1 corrected `usageText` — `grep -n gitignored README.md docs/`.

- [ ] **Step 5: Commit**

```bash
git add test/both-modes.test.mjs README.md docs/
git commit -m "test(offline): the whole promise, from init through a real landing"
```

---

## Self-review

**Spec coverage.** §2 → Task 1. §3 → Task 2. §4 → Task 4. §5 → Tasks 3 and 5. §6 → Tasks 6 and 7 (the flip is §6's last paragraph). §7 → Task 8. §9's six test bullets → Tasks 1, 2, 7, 3, 5, 9 in that order. §8 and §10 are statements of scope with nothing to build.

**Type consistency.** `TRACE` and `offlineTraces` are defined in Task 3 and used in Tasks 4, 5, 8 and 9 under those exact names. `gitCommonDir` is defined in Task 1 and used in Tasks 1 and 8. `initProject`'s report grows `exclude` (Task 1), `tracked` (Task 7) and a changed `claude.action` (Tasks 6, 7); each task states its own addition and no task reads a field an earlier task did not add.

**Ordering.** Linear: every task consumes only what an earlier one produced.
