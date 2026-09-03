# P2a — The register, the machine registry and the worker budget

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project that has run `orchestra roadmap publish` can journal, take an answer off its
inbox, hold a lock, prove a conductor is alive, plan its launches under a machine-wide worker
budget, decide whether a heartbeat should tick, and archive what it finished — with nothing yet
written that tells a human or a session how to drive it.

**Architecture:** `lib/register/` is a port of `planetCraft`'s `tools/orchestra/`, section by section
and comment by comment. Three things change and nothing is re-derived: path constants come from
`lib/paths.mjs` instead of a `.claude/orchestra` literal, the root arrives as an argument instead of
being walked up from `import.meta.url`, and each module's `main()` moves out into `lib/cli/` so the
one entry point stays `bin/orchestra`. Beside it, `lib/machine.mjs` is the only file in the plugin
that writes outside a project: `~/.orchestra/instances.json` and `~/.orchestra/machine.json`, which
exist so that four conductors on one machine do not launch thirty-two worker sessions between them.

**Tech Stack:** Node ≥ 20, ESM only, `node:test` + `node:assert/strict`, `git` CLI. No runtime
dependencies of any kind.

**Spec:** `docs/specs/2026-09-02-orchestra-plugin-design.md` — §6 (the register), §8 (several
projects on one machine), §14 (testing), §15 (the phase table).

**Port source:** `~/Projects/planetCraft`, at `86bf8412`, the commit the README records the
extraction from. Verified 2026-09-03: `git diff --stat 86bf8412..HEAD -- tools/orchestra/` touches
only `monitor/` (`model.mjs`, `server.mjs`, `tabs.mjs`, `README.md`, `public/*`). **Every file this
plan ports is byte-identical at `86bf8412` and at today's main**, so the working tree may be read
directly and the README's extraction claim stays true.

## Global Constraints

These are P1's, unchanged, and every task's requirements implicitly include them.

- **Node ≥ 20**, **git ≥ 2.31**.
- **Zero runtime dependencies.** Nothing under `bin/`, `lib/` or `hooks/` may import anything but a
  `node:` builtin or a relative path. `test/no-dependencies.test.mjs` holds it.
- **ESM only.** `package.json` carries `"type": "module"` and has no `dependencies` and no
  `devDependencies`.
- **Everything committed is in English** — code, comments, docs, commit messages, test names. What
  the plugin *says to a user at runtime* follows the project's `language` config, which is P2b's
  concern, not P2a's.
- **A ported file keeps its original comments verbatim.** They carry the measurements that justify
  each rule, and a rule stripped of its evidence gets deleted by the next reader. Follow P1's
  practice for attribution: name `planetCraft` where the sentence recounts a specific dated event in
  that repository (`lib/roadmap/board.mjs` does), and say "the project this protocol comes from"
  where the sentence states a general rule (`lib/register/state.mjs` does). Do not churn one into
  the other.
- **A change that carries a comment can make it false.** Every substitution in the port table below
  falsifies at least one sentence in the file it touches. Rewriting the path and keeping the
  sentence is the required action; deleting the sentence is not.
- **Every subcommand except `init`, `doctor` and `instances` exits 0 and silent when
  `.orchestra/config.json` is absent.** This is the plugin's off switch (spec §3.1).
- **No dead code, no just-in-case code, test files included.** A ported export that no caller in
  this phase reaches is not ported; the phase that needs it ports it.
- Commit after every task. Run `npm test` before every commit.

## The port substitution table

Applies to every file this plan ports out of `~/Projects/planetCraft/tools/orchestra/`. Each row is
a mechanical change; each also falsifies prose in the file, which must be rewritten, not deleted.

| In the source | In the plugin |
|---|---|
| `'.claude/orchestra/state.json'` and its siblings, as module constants | `join(orchestraDir(root), 'state.json')` etc., from `../paths.mjs` |
| `process.env.ORCHESTRA_MONITOR_REPO ?? dirname(dirname(dirname(fileURLToPath(import.meta.url))))` | the `root` argument, which `bin/orchestra` fills from `cfg.root` |
| the shebang, `function main()`, and the `pathToFileURL(process.argv[1])` self-invocation | deleted here; the CLI half is rewritten under `lib/cli/` |
| a comment naming `tools/orchestra/x.mjs` | the plugin path (`lib/register/x.mjs`), sentence kept |
| a comment naming `node tools/orchestra/x.mjs …` | `orchestra x …`, sentence kept |
| a comment naming `.claude/orchestra/` as a directory | `.orchestra/` |
| a comment naming `monitor/server.mjs`, `monitor/model.mjs`, `cron-tick.sh`, `answer-watch.sh`, `tools/retex.mjs` | see the per-task note; each names something this plugin does not have yet or will never have, and each needs a decision, not a rename |

## Scope, decided here because §14 does not

Four questions, and the fourth is one the handoff did not have.

1. **`archive-images.mjs` is part of "archive" and is in scope.** §6's checklist names "the
   stand-down tick with its ticket sweep and **its archiving**", and the photographs are what the
   archiving is actually for: on 2026-09-02 they were 68 MB of `.claude/orchestra/`'s 70.2 MB. It
   ports with one necessary divergence, in Task 11 — it sweeps `.orchestra/images/`, never
   `.orchestra/`, because in this plugin `.orchestra/` also holds `worktrees/` and a sweep that
   walked it would remove the project's own source files out of a live worktree.
2. **`watch-answers.mjs` and `yield-check.mjs` are in scope.** Neither is named in §14, and the
   protocol depends on both: the beat that makes a conductor reachable is written by
   `watch-answers`, and `yield-check` is step 0 of the interactive tick.
3. **`retex` stays out** (spec §13). Nothing in this phase mentions it. `archive.mjs`'s header names
   `tools/retex.mjs` as the second reader of `archive.jsonl`; that sentence is rewritten to name the
   archive's own purpose without promising a tool this plugin does not ship.
4. **`answer-watch.mjs` and `wake.mjs`'s `unreadAnswers` are OUT.** They are the level-triggered net
   under the beat, driven by `answer-watch.sh` — and that script's own header records that the
   crontab line it proposes *cannot work on this machine and is installed on no timer*. The spec's
   subcommand list (§2) does not name it. Porting it would ship an export nothing calls, which the
   no-dead-code rule forbids. `wake.mjs`'s other half, `yieldVerdict`, is ported in Task 9. If a
   heartbeat ever wants the level-triggered net, P5 is where it is wired and where it is paid for.

## What P2a does not do

- **No `skills/orchestra/SKILL.md` and no worker briefs.** That is P2b, and it is the reason this
  phase was split: `lock.mjs` and a thousand lines of protocol are two different jobs.
- **No launch.** Nothing here spawns a `claude` session. `ready` produces a *plan*; who executes it
  is P2b's document and the human reading it.
- **No `orchestra instances` command, no port allocation, no `monitorPid`.** §15 puts them in P4.
  `lib/machine.mjs` writes only the fields this phase reads — a registry entry with a `port` column
  nothing fills would be exactly the just-in-case code the rules forbid.
- **§8.4's worker session names (`orchestra-<project id>-<task id>`) are P2b's**, and this is the one
  §8 rule the phase table leaves unassigned. Nothing here spawns a session, so there is nothing here
  to name; the rule belongs to the document that tells a conductor how to launch, beside the two
  rules §8.4 says are now load-bearing for isolation as well — a worker is matched by cwd equal to
  its worktree path, and the worktrees directory is per project. `cfg.id` (P1) is what it will use,
  and it is already there.
- **No `sync`, no gate, no monitor, no hooks, no tickets, no heartbeat.** P3, P4 and P5.

---

### Task 1: `lib/paths.mjs` — a root compared through `realpath`, and one git environment

**Files:**
- Modify: `lib/paths.mjs`
- Modify: `lib/roadmap/board.mjs` (one call site)
- Test: `test/paths.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `assertRoot(recorded, actual)` unchanged in signature but comparing real paths;
  `gitEnv(env)` returning a copy of `env` with every `GIT_*` variable removed.

**Why now.** P1 shipped `assertRoot` comparing two `resolve()`d strings. Its only caller is
`writeState`, reached today by `roadmap publish` → `enrol` and, from this phase on, by every session
that adopts or ticks — so the number of ways a root reaches it only grows. On macOS `/tmp` is a
symlink to `/private/tmp`, which is exactly why `test/helpers/fixture.mjs` already calls
`realpathSync`: a root that arrives through the un-realpathed side is refused, and the refusal is a
hard error naming two paths a human reads as identical. `gitEnv` lands in the same task because
`lib/paths.mjs` is where this plugin asks git which repository it is standing in, and Task 8's port
needs that answer to have one definition rather than a copy per call site.

- [ ] **Step 1: Write the failing tests**

Append to `test/paths.test.mjs` (adding `mkdtempSync, realpathSync, symlinkSync` to its `node:fs`
import, `tmpdir` from `node:os`, `join` from `node:path`, and `gitEnv` to the `../lib/paths.mjs`
import):

```js
test('assertRoot accepts a root reached through a symlink', () => {
  const r = repo();
  const link = join(realpathSync(mkdtempSync(join(tmpdir(), 'orchestra-link-'))), 'via');
  symlinkSync(r.root, link);
  // Same tree, two spellings. Refusing this is the wrong-project guard firing on the right project.
  assert.doesNotThrow(() => assertRoot(r.root, link));
  assert.doesNotThrow(() => assertRoot(link, r.root));
});

test('assertRoot still refuses two genuinely different trees, naming both', () => {
  const a = repo();
  const b = repo();
  assert.throws(() => assertRoot(a.root, b.root), (e) =>
    e.message.includes(a.root) && e.message.includes(b.root));
});

test('assertRoot compares a path that does not exist without throwing on the stat', () => {
  // A register recorded for a checkout since deleted must still be REFUSED, not crash the caller
  // with ENOENT — the guard's job is to name the mismatch.
  const r = repo();
  assert.throws(() => assertRoot(join(r.root, 'gone-since'), r.root), /refusing to write across projects/);
});

test('gitEnv strips every GIT_ variable', () => {
  const env = gitEnv({ PATH: '/bin', GIT_DIR: '/elsewhere/.git', GIT_WORK_TREE: '/elsewhere', GIT_INDEX_FILE: '/x' });
  assert.equal(env.PATH, '/bin');
  assert.deepEqual(Object.keys(env).filter((k) => k.startsWith('GIT_')), []);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/paths.test.mjs`
Expected: FAIL — the symlink case throws "refusing to write across projects", and `gitEnv` is not a
function.

- [ ] **Step 3: Implement**

In `lib/paths.mjs`, add `realpathSync` to a `node:fs` import, replace `assertRoot`, and add
`gitEnv`:

```js
// `realpath` and not `resolve` alone. `resolve` normalises `..` and makes a path absolute; it does
// not resolve a symlink, and one tree reached by two spellings is the ordinary case rather than an
// exotic one — on macOS `/tmp` IS a symlink to `/private/tmp`, which is why the test fixture
// realpaths the temp directory it hands out. Comparing the unresolved forms makes the wrong-project
// guard fire on the right project, with a message naming two paths a human reads as the same one.
//
// A path that does not exist cannot be realpathed, and that is not an error here: the guard's job is
// to compare, so an unresolvable side falls back to its resolved form and a genuine mismatch is
// still refused. Silently passing would be the only wrong answer.
const realOf = (p) => { try { return realpathSync(resolve(p)); } catch { return resolve(p); } };

// `cd` persists between an agent's shell calls, and a conductor that has just launched a worker is
// one relative path away from writing another project's state. A mismatch is an error naming both
// paths — never a warning, and never a silent write.
export function assertRoot(recorded, actual) {
  if (!recorded) return;
  if (realOf(recorded) !== realOf(actual))
    throw new Error(
      `orchestra: this state belongs to ${resolve(recorded)}, but the working tree resolved to ${resolve(actual)} — refusing to write across projects`,
    );
}

// The environment every `git` call in this plugin runs under. A git hook exports GIT_DIR and
// GIT_WORK_TREE pointing at the repository that invoked it, and under one of those git ignores `cwd`
// entirely — so a call meant for one checkout silently retargets another. Stripped here, once, so
// there is one answer to "which repository is this" rather than one per call site.
export const gitEnv = (env = process.env) =>
  Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('GIT_')));
```

- [ ] **Step 4: Use it at the one call site that already asks git a question**

In `lib/roadmap/board.mjs`, `gatherGit`'s default runner passes no `env`. Give it the scrubbed one,
so the board cannot be answered by the wrong repository either, and import `gitEnv` from
`../paths.mjs`:

```js
  const git = run ?? ((...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv() }));
```

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, and the four new tests among them.

- [ ] **Step 6: Commit**

```
git add lib/paths.mjs lib/roadmap/board.mjs test/paths.test.mjs
git commit -m 'fix(paths): compare roots through realpath, and give git one scrubbed environment'
```

---

### Task 2: the two other P1 defects — a colliding slug, and a masked `landed?`

**Files:**
- Modify: `lib/store/files.mjs`
- Modify: `lib/roadmap/board.mjs`
- Test: `test/store-files.test.mjs`, `test/board.test.mjs`

**Interfaces:**
- Consumes: nothing (ordering after Task 1 only).
- Produces: no new export. `reconcile`'s `unverified` list gains rows it was dropping.

**Both defects were shipped knowingly in P1 and are P2a's to own.** Fix them before the register
lands on top: the second one blocks dependent tasks, and Task 8's scheduler is what reads the
blocking.

- [ ] **Step 1: Write the failing tests**

In `test/store-files.test.mjs`, using that suite's own `offline()` context and `draft(ctx, text,
slug)` helper, and adding `readdirSync` to its `node:fs` import:

```js
test('publish targets the existing file of a slug when exactly one file declares it', () => {
  const ctx = offline();
  const dir = join(ctx.r.root, ctx.cfg.roadmaps.published);
  const lighting = ROADMAP.replace('roadmap: demo', 'roadmap: lighting');
  mkdirSync(dir, { recursive: true });
  // A hand-written file whose NAME is not its slug — a date-named file is an ordinary convention.
  // Offline, two files can declare one slug because nothing but this rule stops them; online, the
  // issue number is the identity and cannot collide.
  writeFileSync(join(dir, '2026-09-lighting.md'), lighting);
  const res = ctx.store.publish(draft(ctx, lighting, 'whatever'));
  assert.equal(res.slug, 'lighting');
  // The existing file was rewritten; no second file appeared under a different name.
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('lighting')), ['2026-09-lighting.md']);
});

test('publish REFUSES when two published files declare the same slug, naming both', () => {
  const ctx = offline();
  const dir = join(ctx.r.root, ctx.cfg.roadmaps.published);
  const lighting = ROADMAP.replace('roadmap: demo', 'roadmap: lighting');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'a-lighting.md'), lighting);
  writeFileSync(join(dir, 'b-lighting.md'), lighting);
  assert.throws(() => ctx.store.publish(draft(ctx, lighting, 'whatever')), (e) =>
    e.message.includes('a-lighting.md') && e.message.includes('b-lighting.md'));
});
```

In `test/board.test.mjs`:

```js
test('an overlay claim does not mask an unrecorded landing', () => {
  // The register says landed and recorded no subject. Git sees no branch and no subject, so the
  // LOCAL derivation is `todo` — the recording gap. The shared entry, still open and mine, says
  // `claimed`. Reading the gap off the overlay-aware status hides it: the row prints `claimed`,
  // `isLanded` is false, and every task depending on it is blocked by a landing that happened.
  const tasks = [{ key: 'demo/D1', branch: 'demo/d1', deps: [] },
                 { key: 'demo/D2', branch: 'demo/d2', deps: ['demo/D1'] }];
  const git = { refs: new Set(), mainSubjects: new Set() };
  const register = [{ id: 'demo/D1', status: 'landed', subjects: [] }];
  const overlay = new Map([['demo/D1', { status: 'claimed', mine: true, open: true, ref: 7 }]]);
  const b = reconcile({ tasks, git, register, overlay });
  assert.equal(b.rows[0].status, UNVERIFIED);
  assert.equal(b.unverified.length, 1);
  assert.deepEqual(b.rows[1].blockedBy, []);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/store-files.test.mjs test/board.test.mjs`
Expected: FAIL — publish writes `lighting.md` beside the existing file and does not refuse the pair;
the board row reads `claimed` and `demo/D2` is blocked by `demo/D1`.

- [ ] **Step 3: Fix the slug collision**

In `lib/store/files.mjs`, `publish` — the loop that builds `known` already reads and parses every
published file, so reuse that read rather than adding a second pass over the directory:

```js
      // Every published file, read once: `known` needs the ones that are NOT this slug, and the
      // target needs the ones that ARE.
      const publishedFiles = mdIn(publishedDir).map(readRoadmap);
      const known = new Set(
        publishedFiles.filter((r) => r.slug !== slug).flatMap((r) => r.parsed.tasks.map((t) => t.key)),
      );
      // WHERE this slug already lives, if anywhere. Offline a slug is declared in frontmatter and
      // the filename is only a convention, so two hand-written files can claim one slug — `publish`
      // used to refuse that and no longer can, since P1 made the slug rather than the filename the
      // identity. One file is unambiguous and is rewritten in place, which is what keeps a
      // date-named `2026-09-lighting.md` the lighting roadmap instead of growing a `lighting.md`
      // beside it. Two files have no honest answer to "which one is the roadmap", so the refusal IS
      // the answer, and it names them rather than picking.
      const holding = publishedFiles.filter((r) => r.slug === slug).map((r) => r.ref);
      if (holding.length > 1)
        throw new Error(`orchestra: ${holding.length} published files declare the roadmap "${slug}" — ${holding.join(', ')}\n`
          + 'delete or re-slug all but one; publishing cannot choose which of them is the roadmap');
```

Then target it, remembering that `readRoadmap` returns `ref` as a repo-relative path:

```js
      mkdirSync(publishedDir, { recursive: true });
      const target = holding.length === 1 ? join(cfg.root, holding[0]) : join(publishedDir, `${slug}.md`);
```

and report the file actually written rather than the assumed name (importing `relative` from
`node:path`):

```js
      return { slug, keys: parsed.tasks.map((t) => t.key), ref: relative(cfg.root, target) };
```

- [ ] **Step 4: Fix the masked recording gap**

In `lib/roadmap/board.mjs`, inside `reconcile`'s `map`, replace `const gap = recordingGap(reg, derived);`
with:

```js
    // Off the LOCAL derivation, never the overlay-aware one. The recording gap is a fact about THIS
    // machine — "the register says I landed it and recorded nothing to prove it" — and an overlay
    // entry cannot answer it: an issue that is still open and still assigned to me says `claimed`,
    // `deriveStatus` prefers that over a local `todo`, and the gap silently stops firing. The row
    // then prints `claimed`, `isLanded` is false, and every dependent task is blocked by a landing
    // that already happened. This file's own comment above `gatherGit` already reasons about the gap
    // in terms of the local derivation; reading it off `derived` contradicted it.
    const gap = recordingGap(reg, deriveLocalStatus(t, git, reg?.subjects ?? []));
```

and widen `recordingGap`'s own comment to name which status it is given:

```js
// … Keeping the two in one list is what made the corrections unreadable: ten lines, of which one was
// real. `derived` here is the LOCAL derivation — see the call site for why it may not be the
// overlay-aware one.
```

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add lib/store/files.mjs lib/roadmap/board.mjs test/store-files.test.mjs test/board.test.mjs
git commit -m 'fix(roadmap): aim publish at a slug own file, and read the recording gap locally'
```

---

### Task 3: the journal

**Files:**
- Create: `lib/register/journal.mjs`, `lib/cli/register.mjs`
- Modify: `bin/orchestra`
- Test: `test/journal.test.mjs`

**Interfaces:**
- Consumes: `orchestraDir` from `../paths.mjs`.
- Produces: `KINDS` (array of eight strings), `line({ kind, task, text, now })` returning a JSON
  string, `append(root, entry)` returning the path written, `journalPath(root)`.
  `lib/cli/register.mjs` exports `journalCommand({ cfg, args })`.

- [ ] **Step 1: Write the failing test**

`test/journal.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { makeRepo } from './helpers/fixture.mjs';
import { append, journalPath, line, KINDS } from '../lib/register/journal.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

test('a line carries exactly four keys, in order, with a measured clock', () => {
  const now = new Date('2026-09-03T11:22:33.444Z');
  assert.equal(line({ kind: 'tick', task: null, text: 'started', now }),
    '{"ts":"2026-09-03T11:22:33.444Z","kind":"tick","task":null,"text":"started"}');
});

test('an unknown kind is refused, and the eight known ones are not', () => {
  assert.throws(() => line({ kind: 'gossip', task: null, text: 'x' }), /unknown kind "gossip"/);
  for (const kind of KINDS) assert.doesNotThrow(() => line({ kind, task: null, text: 'x' }));
  assert.equal(KINDS.length, 8);
});

test('empty text is refused', () => {
  assert.throws(() => line({ kind: 'note', task: null, text: '   ' }), /needs text/);
});

test('a file not ending in a newline gets one before the next line, never a glued line', () => {
  const r = repo();
  const p = journalPath(r.root);
  writeFileSync(p, '{"ts":"2026-09-03T00:00:00.000Z","kind":"note","task":null,"text":"trunc"');
  append(r.root, { kind: 'note', task: 'demo/D1', text: 'after' });
  const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).task, 'demo/D1');
});

test('append creates the journal under .orchestra of the MAIN checkout', () => {
  const r = repo();
  assert.equal(append(r.root, { kind: 'launch', task: 'demo/D1', text: 'go' }), journalPath(r.root));
  assert.match(journalPath(r.root), /\.orchestra\/journal\.jsonl$/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/journal.test.mjs`
Expected: FAIL — `Cannot find module '../lib/register/journal.mjs'`.

- [ ] **Step 3: Port the module**

Create `lib/register/journal.mjs` as a copy of
`~/Projects/planetCraft/tools/orchestra/journal.mjs` with the substitution table applied. The header
comment — the 2026-08-12/14 measurement of 165 hand-typed timestamps, 75% of them ending in :00 or
:30, the 29 out-of-order lines and the four truncated ones — is kept **verbatim**; it is the entire
justification for a tool that only writes one line. Concretely:

- replace `export const JOURNAL_REL = '.claude/orchestra/journal.jsonl'` with
  `export const journalPath = (root) => join(orchestraDir(root), 'journal.jsonl');`
- `append(repo, entry)` becomes `append(root, entry)` and uses `journalPath(root)`; keep
  `needsLeadingNewline` exactly as written, one byte read and all;
- `append` must `mkdirSync(dirname(path), { recursive: true })` before the first append — say it in
  one line rather than rely on the config's directory already existing;
- the sentence "which C2's tick gate now prevents" names another project's task id: keep the fact,
  name the file — "which `lib/register/tick.mjs`'s gate now prevents".

- [ ] **Step 4: Write the CLI half**

Create `lib/cli/register.mjs` — this file gathers the register's small verbs as later tasks add
them; for now, one:

```js
// The register's small verbs. Each one is the `main()` its module used to carry, with the root
// arriving from the config instead of being walked up from `import.meta.url`.
import { append, KINDS } from '../register/journal.mjs';

// `-` for "about the tick itself, not about a task": an empty shell argument is too easy to pass by
// accident, so the absence has to be typed.
export function journalCommand({ cfg, args }) {
  const [kind, task, ...rest] = args;
  const text = rest.join(' ');
  if (!kind || !task || !text)
    throw new Error(`usage: orchestra journal <${KINDS.join('|')}> <task|-> "<text>"`);
  process.stdout.write(`${append(cfg.root, { kind, task: task === '-' ? null : task, text })}\n`);
}
```

In `bin/orchestra`, beside the two existing registrations:

```js
import { journalCommand } from '../lib/cli/register.mjs';
register('journal', { run: journalCommand });
```

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add lib/register/journal.mjs lib/cli/register.mjs bin/orchestra test/journal.test.mjs
git commit -m 'feat(register): the journal, and a clock nobody types by hand'
```

---

### Task 4: the inbox, the pending key, and the relay

**Files:**
- Create: `lib/register/inbox.mjs`, `lib/register/pending.mjs`, `lib/register/relay.mjs`
- Modify: `lib/cli/register.mjs`, `bin/orchestra`
- Test: `test/inbox.test.mjs`, `test/relay.test.mjs`

**Interfaces:**
- Consumes: `orchestraDir` from `../paths.mjs`; `readState` from `./state.mjs`.
- Produces:
  - `lib/register/inbox.mjs`: `inboxPath(root)`, `readJsonl(path) -> { entries, skipped }`,
    `at(ts) -> number|null`, `after(ts, seen) -> boolean`, `openPendingIds(state) -> Set`,
    `unconsumed(entries, state, now) -> entries[]`, `PENDING_GRACE_MS`.
  - `lib/register/pending.mjs`: `pendingId(rowId, item) -> string`.
  - `lib/register/relay.mjs`: `relay(root, now) -> string` (`''` when there is nothing to say).
  - `lib/cli/register.mjs`: `inboxCommand({ cfg })`.

**`appendAnswer` is deliberately not ported.** Its only caller is the monitor's request handler,
which is P4.

**`registerKey`, `parseOptions`, `splitAsk` and `itemOptions` are deliberately not ported** from
`monitor/keys.mjs`. They render a question on a page; P4 brings them with the page. `pendingId` is
the only one of the six the register itself needs, and it gets its own file so P4 does not have to
choose between importing a page module from the register or copying the function.

- [ ] **Step 1: Write the failing tests**

`test/inbox.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at, after, unconsumed, openPendingIds, PENDING_GRACE_MS } from '../lib/register/inbox.mjs';
import { pendingId } from '../lib/register/pending.mjs';

const state = (seen, pending = []) => ({ conductor: { inboxSeen: seen }, tasks: [{ id: 'demo/D1', pending }] });

test('timestamps compare as instants, not as strings', () => {
  // '…:30Z' > '…:30.500Z' in string order, which would drop an answer written in the same second
  // as the stamp.
  assert.equal(after('2026-09-03T10:00:30.500Z', '2026-09-03T10:00:30Z'), true);
  assert.equal(at('soon'), null);
});

test('a never-stamped cursor falls back to string order and keeps everything', () => {
  assert.equal(after('2026-09-03T10:00:00.000Z', ''), true);
});

test('an answer past the cursor is unconsumed', () => {
  const entries = [{ ts: '2026-09-03T10:00:00.000Z', task: 'demo/D1' }];
  assert.equal(unconsumed(entries, state('2026-09-03T09:00:00.000Z')).length, 1);
  assert.equal(unconsumed(entries, state('2026-09-03T11:00:00.000Z')).length, 0);
});

test('an answer BEHIND the cursor comes back while its item is open and recent, and not after', () => {
  const item = { kind: 'question', ask: 'A or B?' };
  const id = pendingId('demo/D1', item);
  const now = Date.parse('2026-09-03T12:00:00.000Z');
  const entry = { ts: '2026-09-03T10:00:00.000Z', task: 'demo/D1', pending: id };
  const s = state('2026-09-03T11:00:00.000Z', [item]);
  assert.equal(unconsumed([entry], s, now).length, 1);
  assert.equal(unconsumed([entry], s, now + PENDING_GRACE_MS).length, 0);
});

test('openPendingIds keys on the row id the register carries', () => {
  const item = { kind: 'question', ask: 'A or B?' };
  assert.deepEqual([...openPendingIds(state('', [item]))], [pendingId('demo/D1', item)]);
});

test('an explicit item id wins over the hash', () => {
  assert.equal(pendingId('demo/D1', { id: 'chosen', kind: 'question', ask: 'x' }), 'chosen');
});
```

`test/relay.test.mjs`:

```js
import { test, after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { makeRepo } from './helpers/fixture.mjs';
import { writeState, emptyState } from '../lib/register/state.mjs';
import { inboxPath } from '../lib/register/inbox.mjs';
import { pendingId } from '../lib/register/pending.mjs';
import { relay } from '../lib/register/relay.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
afterAll(() => repos.forEach((r) => r.cleanup()));

const seed = (r, { pending = [], answer }) => {
  writeState(r.root, { ...emptyState(r.root),
    tasks: [{ id: 'demo/D1', branch: 'demo/d1', session: 'abcdef12-0000', sessionName: 'orchestra-a1-D1', pending }] });
  appendFileSync(inboxPath(r.root), `${JSON.stringify(answer)}\n`);
};

test('nothing to say is the empty string, not a header', () => {
  assert.equal(relay(repo().root), '');
});

test('an answer names the question, the session that asked it, and the answer verbatim', () => {
  const r = repo();
  const item = { kind: 'question', ask: 'Ship at 0.75 or 1.0?' };
  seed(r, { pending: [item], answer: { ts: '2026-09-03T10:00:00.000Z', task: 'demo/D1', pending: pendingId('demo/D1', item), answer: '0.75' } });
  const out = relay(r.root);
  assert.match(out, /Ship at 0\.75 or 1\.0\?/);
  assert.match(out, /orchestra-a1-D1 \(abcdef12\)/);
  assert.match(out, /the user's answer: "0\.75"/);
  assert.match(out, /conductor\.inboxSeen/);
});

test('an answer to an item no longer in pending says so instead of inventing one', () => {
  const r = repo();
  seed(r, { pending: [], answer: { ts: '2026-09-03T10:00:00.000Z', task: 'demo/D1', pending: 'demo-d1-deadbeef', answer: 'yes' } });
  assert.match(relay(r.root), /NO LONGER in this row's pending\[\]/);
});

test('the batch is the OLDEST unconsumed answers and it says how many are behind', () => {
  const r = repo();
  writeState(r.root, { ...emptyState(r.root), tasks: [{ id: 'demo/D1', branch: 'demo/d1', pending: [] }] });
  for (let i = 0; i < 25; i += 1)
    appendFileSync(inboxPath(r.root), `${JSON.stringify({ ts: `2026-09-03T10:${String(i).padStart(2, '0')}:00.000Z`, task: 'demo/D1', answer: `a${i}` })}\n`);
  const out = relay(r.root);
  assert.match(out, /count="20"/);
  assert.match(out, /"a0"/);
  assert.doesNotMatch(out, /"a20"/);
  assert.match(out, /5 further answers are waiting/);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/inbox.test.mjs test/relay.test.mjs`
Expected: FAIL — the three modules do not exist.

- [ ] **Step 3: Port the three modules**

`lib/register/inbox.mjs` from `tools/orchestra/monitor/inbox.mjs`, minus `appendAnswer`, plus
`inboxPath`. Keep verbatim: the `PENDING_GRACE_MS` paragraph (a playtest gate asked twice in the same
words carries the SAME hashed id, so last round's reply would be delivered as the answer to this
round's question), the instants-not-strings paragraph, and the OR-is-a-deliberate-asymmetry
paragraph.

`lib/register/pending.mjs` from `monitor/keys.mjs`'s `pendingId` and the `UNNAMED` constant it needs.
Keep the two paragraphs above it verbatim — that it is keyed on the register row's own id and never
on the joined board key, and that it is not protection against adoption re-opening answered
questions. Rewrite "the hook reads state.json and nothing else" to name this plugin's two readers
(the relay here, and P4's page), since the hook it names is P5's.

`lib/register/relay.mjs` from `monitor/relay.mjs`. Its header's two entry points become "the
`orchestra inbox` subcommand, and (from P4) the hook that injects it into a live session".
`readState` comes from `./state.mjs` instead of a second local `JSON.parse` of a hardcoded path —
**that is the one change with teeth**: the source reads `state.json` a second way, and this plugin
already has exactly one reader. Keep `RELAY_CAP`, `ONE_LINE_CAP`, the oldest-first argument (it is
why the stamp cannot jump an unshown answer) and every branch of `about()` verbatim.

Two notes for the implementer:

- `readState` throws on an unparseable register where the source's local `try/catch` returned `''`.
  The relay must stay silent on a mid-write register — a conductor asking for its inbox during a
  rewrite must not crash. Wrap it: `let state; try { state = readState(root); } catch { return ''; }
  if (!state) return '';`
- `sessionOf` reads `row.sessionName` and `row.session`, which `registerRow` already writes as null.

- [ ] **Step 4: Write the CLI half**

Add to `lib/cli/register.mjs`:

```js
// A conductor that came to fetch its answers rather than wait to be handed them. Prints nothing at
// all when there is nothing unconsumed, so a routine tick stays quiet.
export const inboxCommand = ({ cfg }) => process.stdout.write(relay(cfg.root));
```

and in `bin/orchestra`: `register('inbox', { run: inboxCommand });`

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add lib/register/inbox.mjs lib/register/pending.mjs lib/register/relay.mjs lib/cli/register.mjs bin/orchestra test/inbox.test.mjs test/relay.test.mjs
git commit -m 'feat(register): the answer channel - the inbox rule, the pending key and the relay'
```

---

### Task 5: the beat, and the loop that writes it

**Files:**
- Create: `lib/register/beat.mjs`, `lib/register/watch.mjs`
- Modify: `lib/cli/register.mjs`, `bin/orchestra`
- Test: `test/beat.test.mjs`, `test/watch.test.mjs`

**Interfaces:**
- Consumes: `orchestraDir` from `../paths.mjs`; `inboxPath`, `readJsonl`, `unconsumed` from
  `./inbox.mjs`; `statePath` from `./state.mjs`.
- Produces:
  - `lib/register/beat.mjs`: `beatPath(root)`, `BEAT_EVERY_MS` (2000), `BEAT_STALE_MS` (60000),
    `CONDUCT_STALE_MS` (5400000), `writeBeat(root, { session, pid, now })`, `readBeat(root)`,
    `pidAlive(pid)`, `liveConductor(root, { now, alive })`,
    `conductorState(root, { now, alive, staleMs })`.
  - `lib/register/watch.mjs`: `keyOf(e)`, `MAX_PER_ROUND` (10), `lineFor(e)`,
    `newAnnouncements(entries, state, announced, now)`, `round(root, announced, { now, emit })`,
    `seed(root, announced, now)`, `watch(root, session, { emit })` starting the interval.
  - `lib/cli/register.mjs`: `beatCommand({ cfg })`, `watchAnswersCommand({ cfg, args })`.

- [ ] **Step 1: Write the failing tests**

`test/beat.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { utimesSync, writeFileSync } from 'node:fs';
import { makeRepo } from './helpers/fixture.mjs';
import { writeState, emptyState, statePath } from '../lib/register/state.mjs';
import { writeBeat, readBeat, beatPath, liveConductor, conductorState, BEAT_STALE_MS, CONDUCT_STALE_MS }
  from '../lib/register/beat.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

const ALIVE = () => true;
const DEAD = () => false;

test('a beat round-trips', () => {
  const r = repo();
  writeBeat(r.root, { session: 'abcdef12-1111', pid: 4242, now: Date.parse('2026-09-03T10:00:00.000Z') });
  assert.equal(readBeat(r.root).session, 'abcdef12-1111');
  assert.equal(readBeat(r.root).pid, 4242);
});

test('BOTH tests, and neither alone: a stale stamp and a dead pid each mean no conductor', () => {
  const r = repo();
  const now = Date.parse('2026-09-03T10:00:00.000Z');
  writeBeat(r.root, { session: 's1', pid: 1, now });
  assert.ok(liveConductor(r.root, { now, alive: ALIVE }));
  assert.equal(liveConductor(r.root, { now: now + BEAT_STALE_MS + 1, alive: ALIVE }), null);
  assert.equal(liveConductor(r.root, { now, alive: DEAD }), null);
});

test('an unparsable stamp reports no conductor rather than one', () => {
  const r = repo();
  writeFileSync(beatPath(r.root), '{"session":"s1","pid":1,"ts":"soon"}\n');
  assert.equal(liveConductor(r.root, { alive: ALIVE }), null);
});

test('alive is not the same fact as conducting', () => {
  const r = repo();
  const now = Date.parse('2026-09-03T10:00:00.000Z');
  writeState(r.root, emptyState(r.root));
  writeBeat(r.root, { session: 's1', pid: 1, now });
  const touched = (now - CONDUCT_STALE_MS - 60_000) / 1000;
  utimesSync(statePath(r.root), touched, touched);
  const s = conductorState(r.root, { now, alive: ALIVE });
  assert.equal(s.session, 's1');
  assert.equal(s.conducting, false);
  assert.ok(s.silentFor > CONDUCT_STALE_MS);
});

test('a checkout with no register keeps the baton', () => {
  const r = repo();
  writeBeat(r.root, { session: 's1', pid: 1, now: Date.now() });
  assert.equal(conductorState(r.root, { alive: ALIVE }).conducting, true);
});
```

`test/watch.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { makeRepo } from './helpers/fixture.mjs';
import { writeState, emptyState, statePath } from '../lib/register/state.mjs';
import { inboxPath } from '../lib/register/inbox.mjs';
import { round, seed, MAX_PER_ROUND } from '../lib/register/watch.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

const answer = (r, i) => appendFileSync(inboxPath(r.root),
  `${JSON.stringify({ ts: `2026-09-03T10:${String(i).padStart(2, '0')}:00.000Z`, task: 'demo/D1', answer: `a${i}` })}\n`);

test('the first round announces nothing and remembers what is already there', () => {
  const r = repo();
  writeState(r.root, emptyState(r.root));
  answer(r, 0);
  const announced = new Set();
  const said = [];
  seed(r.root, announced);
  assert.equal(round(r.root, announced, { emit: (s) => said.push(s) }), 0);
  assert.deepEqual(said, []);
});

test('a new answer is announced once and only once', () => {
  const r = repo();
  writeState(r.root, emptyState(r.root));
  const announced = new Set();
  const said = [];
  seed(r.root, announced);
  answer(r, 1);
  assert.equal(round(r.root, announced, { emit: (s) => said.push(s) }), 1);
  assert.equal(round(r.root, announced, { emit: (s) => said.push(s) }), 0);
  assert.equal(said.length, 1);
  assert.match(said[0], /^ANSWER demo\/D1 · a free remark · 2026-09-03T10:01:00\.000Z — "a1"$/);
});

test('a round that cannot read the register announces NOTHING and forgets nothing', () => {
  const r = repo();
  writeFileSync(statePath(r.root), '{"tasks":');   // caught mid-write
  for (let i = 0; i < 5; i += 1) answer(r, i);
  const announced = new Set();
  const said = [];
  assert.equal(round(r.root, announced, { emit: (s) => said.push(s) }), 0);
  assert.deepEqual(said, []);
  assert.equal(announced.size, 0);
});

test('the overflow past the cap is remembered without being announced', () => {
  const r = repo();
  writeState(r.root, emptyState(r.root));
  const announced = new Set();
  const said = [];
  seed(r.root, announced);
  for (let i = 1; i <= MAX_PER_ROUND + 3; i += 1) answer(r, i);
  assert.equal(round(r.root, announced, { emit: (s) => said.push(s) }), MAX_PER_ROUND);
  assert.equal(round(r.root, announced, { emit: (s) => said.push(s) }), 0);
  assert.equal(said.length, MAX_PER_ROUND);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/beat.test.mjs test/watch.test.mjs`
Expected: FAIL — neither module exists.

- [ ] **Step 3: Port `beat.mjs`**

From `tools/orchestra/beat.mjs`, whole. Everything in that file is measurement and every paragraph
stays: the six session identities of 2026-08-13 and the register naming a conductor that was not
running at all, the 2.2 s cost of `claude agents --json` and why it cannot answer the question
anyway, the thirty-missed-periods window with the two-second sleep sliver it leaves *named rather
than hidden*, the whole "alive is not the same fact as conducting" section with its four stood-down
heartbeat slots and thirteen uncollected hours, and the paragraph explaining why `CONDUCT_STALE_MS`
reads the register's **mtime** and not the journal's typed stamps.

Substitutions beyond the table: `watch-answers.mjs` becomes `lib/register/watch.mjs`;
`monitor/server.mjs`'s "says in its own first line that it never writes this file" becomes a
statement about this plugin's own single writer (`lib/register/state.mjs`), since the monitor arrives
in P4 and the sentence must not promise a file that is not there; `yield-check (orchestra/W1)`
becomes `lib/register/wake.mjs`, which Task 9 brings.

- [ ] **Step 4: Port `watch-answers.mjs` as `lib/register/watch.mjs`**

Same file, split so the loop can be tested without a process: keep `keyOf`, `MAX_PER_ROUND`,
`lineFor`, `newAnnouncements`, `round` and `seed` exactly as written, and turn its `main()` into an
exported `watch(root, session, { emit = console.log } = {})` holding the `tick`/`setInterval` pair —
including the ordering the source is explicit about, the beat first and unconditionally, so a
register this loop cannot read does not also cost the machine its only evidence that a conductor is
alive.

The header's entire "WHY THIS FILE EXISTS AT ALL" paragraph is kept: delivering an answer was wired
to CREATE a conductor rather than to REACH the live one, and six identities did that in half an hour.
The sentence naming `answer-watch.sh` as the level-triggered net under `seed()` must be **rewritten
rather than kept**: this plugin does not ship it (scope ruling 4), so the honest sentence names what
is left uncovered — a tick that dies before relaying the answers it was armed for — and says that
nothing here catches it.

- [ ] **Step 5: Write the CLI halves**

Add to `lib/cli/register.mjs`:

```js
// Who is holding the baton, as a fact rather than as an inference. The read half; the write half is
// `watch-answers`, which is the only thing that ever stamps this file.
export function beatCommand({ cfg }) {
  const s = conductorState(cfg.root);
  if (!s) { process.stdout.write('nobody is holding the baton\n'); return; }
  process.stdout.write(`${s.session} (pid ${s.pid}) — ${s.conducting
    ? 'conducting'
    : `beating but silent for ${Math.round(s.silentFor / 60000)} min: the baton is loose`}\n`);
}

// Armed by the conductor itself as a persistent watch at the top of its first tick. It never
// returns: the interval is the point.
export function watchAnswersCommand({ cfg, args }) {
  const [session] = args;
  if (!session) throw new Error('usage: orchestra watch-answers <conductor session id>');
  watch(cfg.root, session);
}
```

In `bin/orchestra`, register `beat` and `watch-answers`.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test`
Expected: PASS.

```
git add lib/register/beat.mjs lib/register/watch.mjs lib/cli/register.mjs bin/orchestra test/beat.test.mjs test/watch.test.mjs
git commit -m 'feat(register): the beat, and the loop whose life is the conductor own'
```

---

### Task 6: the conductor lock

**Files:**
- Create: `lib/register/lock.mjs`
- Modify: `lib/cli/register.mjs`, `bin/orchestra`
- Test: `test/lock.test.mjs`

**Interfaces:**
- Consumes: `liveConductor`, `pidAlive` from `./beat.mjs`; `orchestraDir` from `../paths.mjs`.
- Produces: `lockDir(root)`, `MAX_AGE_MS` (4 h), `readHolder(root)`,
  `holderIsDead(root, holder, { now, alive, live })`,
  `acquire(root, { kind, session, pid, now, deps })` returning `{ ok, holder }`,
  `release(root, { kind, session, pid })` returning a boolean.

- [ ] **Step 1: Write the failing test**

`test/lock.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { makeRepo } from './helpers/fixture.mjs';
import { writeBeat } from '../lib/register/beat.mjs';
import { acquire, release, readHolder, lockDir, MAX_AGE_MS } from '../lib/register/lock.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

const ALIVE = { alive: () => true };
const DEAD = { alive: () => false };

test('one holder at a time', () => {
  const r = repo();
  assert.equal(acquire(r.root, { kind: 'tick', pid: 111, deps: ALIVE }).ok, true);
  const second = acquire(r.root, { kind: 'tick', pid: 222, deps: ALIVE });
  assert.equal(second.ok, false);
  assert.equal(second.holder.pid, 111);
});

test('a tick holder whose pid is gone is broken and taken', () => {
  const r = repo();
  acquire(r.root, { kind: 'tick', pid: 111 });
  const taken = acquire(r.root, { kind: 'tick', pid: 222, deps: DEAD });
  assert.equal(taken.ok, true);
  assert.equal(readHolder(r.root).pid, 222);
});

test('a conductor holder is alive only while the beat names THAT session', () => {
  const r = repo();
  const now = Date.parse('2026-09-03T10:00:00.000Z');
  acquire(r.root, { kind: 'conductor', session: 's1', now });
  // `process.pid`, deliberately: `holderIsDead`'s `live` default is NOT reached by `deps.alive`, so
  // `liveConductor` runs the REAL `pidAlive` against whatever pid the beat carries. A made-up pid
  // like 9 is a kernel process on macOS and answers EPERM, so this test would pass by accident here
  // and flake anywhere else. The beat must name a process that is genuinely alive.
  writeBeat(r.root, { session: 's1', pid: process.pid, now });
  assert.equal(acquire(r.root, { kind: 'conductor', session: 's2', now, deps: ALIVE }).ok, false);
  // Somebody else has the baton: the holder is gone.
  writeBeat(r.root, { session: 's2', pid: process.pid, now });
  assert.equal(acquire(r.root, { kind: 'conductor', session: 's2', now, deps: ALIVE }).ok, true);
});

test('a holder older than MAX_AGE is broken whatever it claims', () => {
  const r = repo();
  const now = Date.parse('2026-09-03T10:00:00.000Z');
  acquire(r.root, { kind: 'tick', pid: 111, now });
  assert.equal(acquire(r.root, { kind: 'tick', pid: 222, now: now + MAX_AGE_MS + 1, deps: ALIVE }).ok, true);
});

test('a lock directory with no holder record is judged by age alone', () => {
  const r = repo();
  mkdirSync(lockDir(r.root), { recursive: true });
  assert.equal(acquire(r.root, { kind: 'tick', pid: 1, now: Date.now(), deps: ALIVE }).ok, false);
  assert.equal(acquire(r.root, { kind: 'tick', pid: 1, now: Date.now() + MAX_AGE_MS + 1, deps: ALIVE }).ok, true);
});

test('release is identity-checked: it never deletes a successor lock', () => {
  const r = repo();
  acquire(r.root, { kind: 'conductor', session: 's1' });
  assert.equal(release(r.root, { kind: 'conductor', session: 's2' }), false);
  assert.ok(existsSync(lockDir(r.root)));
  assert.equal(release(r.root, { kind: 'conductor', session: 's1' }), true);
  assert.equal(existsSync(lockDir(r.root)), false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/lock.test.mjs`
Expected: FAIL — no `lib/register/lock.mjs`.

- [ ] **Step 3: Port the module**

From `tools/orchestra/lock.mjs`, whole, minus the CLI. Everything above the code is measurement and
stays: that `tick.lock` guarded cron against cron and nothing else, the three side-by-side ticks of
2026-08-12/14 with one double-running the merge agent on the same branch and 21 landings recorded
for 16 rows, the two kinds of holder and why a conductor's liveness is the beat rather than a pid
(`acquire` exits immediately, so its own pid would mark the lock dead on the spot), and the
`MAX_AGE_MS` paragraph with its 4.5-minute longest real tick.

Substitutions beyond the table: `monitor/server.mjs already tests for existence (lockHeld)` becomes a
forward statement — the mutex stays a `mkdir` because that is what an atomic directory creation is
worth, and because P4's page will test the same directory. `cron-tick.sh` becomes "the heartbeat
(P5)".

- [ ] **Step 4: Write the CLI half**

Add to `lib/cli/register.mjs`:

```js
const sayHolder = (h) => (h
  ? `${h.kind}${h.session ? ` ${h.session}` : ''}${h.pid ? ` (pid ${h.pid})` : ''} since ${h.startedAt}`
  : 'an unnamed holder');

// orchestra lock acquire|release|holder [--kind conductor|tick] [--session <id>] [--pid <n>]
// Exit 1 when the lock is held by somebody else, so a shell reads the answer in a code rather than
// by grepping a string.
export function lockCommand({ cfg, args }) {
  const [verb, ...rest] = args;
  const opt = (n, d = null) => { const i = rest.indexOf(n); return i > -1 ? rest[i + 1] : d; };
  const kind = opt('--kind', 'conductor');
  const session = opt('--session');
  const pid = Number(opt('--pid', String(process.pid)));
  if (verb === 'holder') {
    process.stdout.write(existsSync(lockDir(cfg.root)) ? `held by ${sayHolder(readHolder(cfg.root))}\n` : 'free\n');
    return;
  }
  if (verb === 'release') {
    process.stdout.write(release(cfg.root, { kind, session, pid }) ? 'released\n' : 'not yours — left alone\n');
    return;
  }
  if (verb !== 'acquire')
    throw new Error('usage: orchestra lock <acquire|release|holder> [--kind conductor|tick] [--session <id>]');
  const { ok, holder } = acquire(cfg.root, { kind, session, pid });
  process.stdout.write(ok ? 'acquired\n' : `held by ${sayHolder(holder)}\n`);
  if (!ok) process.exitCode = 1;
}
```

In `bin/orchestra`, register `lock`.

- [ ] **Step 5: Run the suite and commit**

Run: `npm test`
Expected: PASS.

```
git add lib/register/lock.mjs lib/cli/register.mjs bin/orchestra test/lock.test.mjs
git commit -m 'feat(register): one conductor at a time, including the interactive one'
```

---

### Task 7: the machine registry

**Files:**
- Create: `lib/machine.mjs`
- Test: `test/machine.test.mjs`

**Interfaces:**
- Consumes: `homedir` from `node:os`; nothing from a project.
- Produces: `machineDir()`, `instancesPath()`, `machinePath()`, `DEFAULT_MAX_WORKERS` (8),
  `maxWorkers()`, `readInstances()`, `recordInstance(entry, { now, alive })`,
  `otherWorkers(id, { now, alive })`.

**This is the only file in the plugin that writes outside a project.** §8.2: it is **advisory, never
authority** — the truth about a project stays inside that project.

**No `port` and no `monitorPid` column.** §15 puts port allocation in P4; a column nothing fills is
just-in-case code, and the file is rewritten whole on every write, so P4 adds them without a
migration.

- [ ] **Step 1: Write the failing test**

`test/machine.test.mjs`:

```js
// The machine registry, under a temporary HOME so the file under test is never the developer's own.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const HOME = process.env.HOME;
const homes = [];
beforeEach(() => {
  const h = mkdtempSync(join(tmpdir(), 'orchestra-home-'));
  homes.push(h);
  process.env.HOME = h;
});
after(() => { process.env.HOME = HOME; homes.forEach((h) => rmSync(h, { recursive: true, force: true })); });

const { machineDir, instancesPath, maxWorkers, readInstances, recordInstance, otherWorkers, DEFAULT_MAX_WORKERS } =
  await import('../lib/machine.mjs');

test('os.homedir follows HOME, which is what makes this suite safe', () => {
  assert.equal(homedir(), process.env.HOME);
  assert.equal(machineDir(), join(process.env.HOME, '.orchestra'));
});

test('an empty machine is an empty list and the default budget', () => {
  assert.deepEqual(readInstances(), []);
  assert.equal(maxWorkers(), DEFAULT_MAX_WORKERS);
});

test('maxWorkers comes from machine.json when it is there', () => {
  mkdirSync(machineDir(), { recursive: true });
  writeFileSync(join(machineDir(), 'machine.json'), '{"maxWorkers":3}\n');
  assert.equal(maxWorkers(), 3);
});

test('an unreadable machine.json falls back to the default rather than throwing', () => {
  mkdirSync(machineDir(), { recursive: true });
  writeFileSync(join(machineDir(), 'machine.json'), '{oops');
  assert.equal(maxWorkers(), DEFAULT_MAX_WORKERS);
});

test('an entry round-trips and is keyed on id', () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestra-proj-'));
  recordInstance({ id: 'aaa111', name: 'A', root, mode: 'offline', workers: 2 });
  recordInstance({ id: 'aaa111', name: 'A', root, mode: 'offline', workers: 4 });
  const all = readInstances();
  assert.equal(all.length, 1);
  assert.equal(all[0].workers, 4);
  assert.ok(all[0].updatedAt);
  assert.ok(existsSync(instancesPath()));
});

test('an entry whose root no longer exists is reaped on the next write', () => {
  const gone = mkdtempSync(join(tmpdir(), 'orchestra-proj-'));
  const here = mkdtempSync(join(tmpdir(), 'orchestra-proj-'));
  const now = Date.now();
  // A FRESH beat on the entry that is about to be reaped, so the missing root is the ONLY reason it
  // can go. Without it the entry is dead twice over — no beat and no pid — and the test would pass
  // with the root still there, proving nothing about the check it is named after.
  recordInstance({ id: 'gone11', name: 'G', root: gone, mode: 'offline', workers: 3,
    beatAt: new Date(now).toISOString() }, { now });
  assert.deepEqual(readInstances().map((i) => i.id), ['gone11']);   // alive while its root stands
  rmSync(gone, { recursive: true, force: true });
  recordInstance({ id: 'here11', name: 'H', root: here, mode: 'offline', workers: 1 }, { now });
  assert.deepEqual(readInstances().map((i) => i.id), ['here11']);
});

test('an entry whose beat is stale AND whose pid is dead is reaped', () => {
  const a = mkdtempSync(join(tmpdir(), 'orchestra-proj-'));
  const b = mkdtempSync(join(tmpdir(), 'orchestra-proj-'));
  const now = Date.parse('2026-09-03T10:00:00.000Z');
  recordInstance({ id: 'stale1', name: 'S', root: a, mode: 'offline', workers: 5,
    conductorSession: 's1', conductorPid: 4242, beatAt: '2026-08-01T00:00:00.000Z' }, { now });
  recordInstance({ id: 'fresh1', name: 'F', root: b, mode: 'offline', workers: 1 },
    { now, alive: () => false });
  assert.deepEqual(readInstances().map((i) => i.id), ['fresh1']);
});

test('otherWorkers counts every instance but mine', () => {
  const a = mkdtempSync(join(tmpdir(), 'orchestra-proj-'));
  const b = mkdtempSync(join(tmpdir(), 'orchestra-proj-'));
  const now = Date.now();
  recordInstance({ id: 'aaa111', name: 'A', root: a, mode: 'offline', workers: 2, beatAt: new Date(now).toISOString() }, { now });
  recordInstance({ id: 'bbb222', name: 'B', root: b, mode: 'offline', workers: 3, beatAt: new Date(now).toISOString() }, { now });
  assert.equal(otherWorkers('aaa111', { now }), 3);
  assert.equal(otherWorkers('ccc333', { now }), 5);
});

test('a corrupt instances.json is replaced, not fatal', () => {
  const a = mkdtempSync(join(tmpdir(), 'orchestra-proj-'));
  mkdirSync(machineDir(), { recursive: true });
  writeFileSync(instancesPath(), 'not json at all');
  assert.deepEqual(readInstances(), []);
  recordInstance({ id: 'aaa111', name: 'A', root: a, mode: 'offline', workers: 1 });
  assert.deepEqual(readInstances().map((i) => i.id), ['aaa111']);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/machine.test.mjs`
Expected: FAIL — `Cannot find module '../lib/machine.mjs'`.

- [ ] **Step 3: Implement**

`lib/machine.mjs`:

```js
// The one file this plugin writes outside a project: `~/.orchestra/`, which exists because one
// conductor per project is the point of a portable plugin, so several run side by side and each of
// them caps its own launches at a width of eight. Four conductors is thirty-two worker sessions and
// a machine that stops answering (spec §8.6).
//
// IT IS ADVISORY, NEVER AUTHORITY. The truth about a project stays inside that project — its
// register, its git — exactly as `state.json` and git are the truth today. Nothing here may be read
// as a statement about what a project's own register says; it answers one question only, "how many
// worker sessions do the OTHER projects on this machine believe they are holding", and it answers it
// in the safe direction: a conductor killed with -9 leaves its count behind until its entry is
// reaped, which under-budgets everybody else for a few minutes. Too few launches, never too many.
//
// `homedir()` and not a configurable directory: the whole point is that every project on this
// machine reads the same file, so making the location a per-project setting would let a project opt
// itself out of the budget by accident. Node resolves `homedir()` from HOME on POSIX, which is what
// lets the suite run against a temporary one instead of the developer's own.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const machineDir = () => join(homedir(), '.orchestra');
export const instancesPath = () => join(machineDir(), 'instances.json');
export const machinePath = () => join(machineDir(), 'machine.json');

// Eight, which is the width a single conductor already used. The budget's job is to stop four
// projects reaching thirty-two between them, not to make one project slower than it was alone.
export const DEFAULT_MAX_WORKERS = 8;

const readJsonOr = (path, fallback) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
};

// A machine.json nobody can read must not stop every project on the machine from launching. Falling
// back is the only safe direction, and it is the same reasoning `decideTick` applies to an
// unreadable register.
export function maxWorkers() {
  const n = readJsonOr(machinePath(), {})?.maxWorkers;
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_WORKERS;
}

export function readInstances() {
  const raw = readJsonOr(instancesPath(), null);
  return Array.isArray(raw?.instances) ? raw.instances : [];
}

// EPERM means the pid exists and belongs to somebody else, which is alive for our purposes. The same
// test `lib/register/beat.mjs` makes, and it is duplicated here on purpose rather than imported:
// importing the register into the machine registry would make the one file that must know nothing
// about a project depend on a project's own module.
const pidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

// How stale a recorded beat may be before its instance stops counting. Generous next to the beat's
// own 60-second window, because this file is written once per tick rather than every two seconds: a
// project that ticks hourly is alive and its entry must not be reaped between two ticks.
const BEAT_STALE_MS = 6 * 60 * 60 * 1000;

// An entry is reaped when its project is gone, or when nothing about it is alive any more. Both
// tests, and neither alone: a checkout deleted while its conductor still runs is gone, and a
// conductor killed while its checkout stands is dead.
function isLive(e, now, alive) {
  if (typeof e?.id !== 'string' || !e.id) return false;
  if (typeof e.root !== 'string' || !existsSync(e.root)) return false;
  if (alive(e.conductorPid)) return true;
  const beat = Date.parse(e.beatAt ?? '');
  // `!(… > …)` so an unreadable stamp reads as stale rather than as fresh.
  return Number.isFinite(beat) && !(now - beat > BEAT_STALE_MS);
}

// Whole-file rewrite through a temp file and a rename, behind one lock directory. Contention is a
// handful of writes an hour, so nothing more is warranted — and the lock is broken on age rather
// than waited on, because a crashed writer must not freeze every other project's budget for ever.
const LOCK_STALE_MS = 30_000;

function withLock(fn) {
  const lock = join(machineDir(), 'instances.lock');
  mkdirSync(machineDir(), { recursive: true });
  for (let i = 0; i < 2; i += 1) {
    try { mkdirSync(lock); } catch {
      const age = (() => { try { return Date.now() - Number(readFileSync(join(lock, 'at'), 'utf8')); } catch { return Infinity; } })();
      if (age < LOCK_STALE_MS) { if (i === 0) continue; return fn(); }
      rmSync(lock, { recursive: true, force: true });
      continue;
    }
    try {
      writeFileSync(join(lock, 'at'), String(Date.now()));
      return fn();
    } finally { rmSync(lock, { recursive: true, force: true }); }
  }
  // Lost the race twice against a live writer. Doing the work anyway is the right failure here: this
  // file is advisory, a lost write costs one tick's accuracy, and refusing would cost a launch.
  return fn();
}

// The caller's own entry, merged in, and every dead entry reaped in the same pass — §8.2's "reaped
// on the next write". `updatedAt` is stamped here rather than by the caller so two projects cannot
// disagree about the clock.
export function recordInstance(entry, { now = Date.now(), alive = pidAlive } = {}) {
  return withLock(() => {
    const kept = readInstances().filter((e) => e.id !== entry.id && isLive(e, now, alive));
    const next = [...kept, { ...entry, updatedAt: new Date(now).toISOString() }]
      .sort((a, b) => a.id.localeCompare(b.id));
    const tmp = `${instancesPath()}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, instances: next }, null, 2)}\n`);
    renameSync(tmp, instancesPath());
    return next;
  });
}

// What everybody ELSE believes they are holding. Read-only: reaping happens on write, so a stale
// entry is counted here for as long as it survives, which is the safe direction (§16).
export const otherWorkers = (id, { now = Date.now(), alive = pidAlive } = {}) =>
  readInstances()
    .filter((e) => e.id !== id && isLive(e, now, alive))
    .reduce((n, e) => n + (Number.isInteger(e.workers) && e.workers > 0 ? e.workers : 0), 0);
```

- [ ] **Step 4: Run the suite, and prove it left the real home alone**

Run: `npm test`, then `ls ~/.orchestra` — it must say exactly what it said before the run.
Expected: PASS, and no new directory in the developer's home.

- [ ] **Step 5: Commit**

```
git add lib/machine.mjs test/machine.test.mjs
git commit -m 'feat(machine): the instance registry, advisory by construction'
```

---

### Task 8: the scheduler, and the worker budget

**Files:**
- Create: `lib/register/ready.mjs`, `lib/cli/tick.mjs`
- Modify: `lib/register/state.mjs`, `lib/roadmap/enrol.mjs`, `lib/cli/roadmap.mjs`, `bin/orchestra`
- Test: `test/ready.test.mjs`, `test/enrol.test.mjs`

**Interfaces:**
- Consumes: `gitEnv` from `../paths.mjs`; `readState` from `./state.mjs`; `conductorState` from
  `./beat.mjs`; `maxWorkers`, `otherWorkers`, `recordInstance` from `../machine.mjs`.
- Produces:
  - `lib/register/ready.mjs`: `reconcileTasks(tasks, git) -> { tasks, corrections }`,
    `computeReadySet(tasks, git) -> { ready, blocked }`,
    `planLaunches(ready, inFlightCount, width) -> tasks[]`,
    `undeliveredRelays(tasks, { now })`, `pendingWaiting(tasks, { now, minAgeMs })`,
    `gatherGit(root)`.
  - `lib/cli/tick.mjs`: `readyCommand({ cfg, args })`.
  - `registerRow` gains a `mine` boolean; `enrol` gains a `mine` option.

**Why `mine` has to arrive with this task.** `planLaunches` partitions `ready` on `t.mine !== false`
so a stranger's OPEN task never displaces one of mine. P1's `registerRow` writes no such field, so
the partition would be a permanently dead branch — and deleting it instead would silently drop a
rule that was argued for: a developer who opened their roadmap offered spare capacity, not priority.
`enrol` already computes the fact (its `foreign` callback reads the overlay's `mine`); it never wrote
it down, because it only needed the harsher half — a foreign task that is NOT open is enroled
terminal. Offline there is no overlay, so every row is mine and the partition is a no-op costing one
array pass.

- [ ] **Step 1: Write the failing tests**

Add to `test/enrol.test.mjs`, using that suite's own `tasks`, `at` and `host` bindings (`ROADMAP`
defines a single task, so the second one is cloned from it):

```js
test('a row records whether the task is mine, and offline every row is', () => {
  const stranger = { ...tasks[0], key: 'demo/D2' };
  const { state } = enrol({ tasks: [] }, [tasks[0], stranger], {
    at, host, mine: (t) => t.key !== 'demo/D2',
  });
  assert.equal(state.tasks[0].mine, true);
  assert.equal(state.tasks[1].mine, false);
  // Offline there is no overlay at all, so the default applies and every row is mine.
  assert.equal(enrol({ tasks: [] }, tasks, { at, host }).state.tasks[0].mine, true);
});
```

`test/ready.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo } from './helpers/fixture.mjs';
import { reconcileTasks, computeReadySet, planLaunches, undeliveredRelays, pendingWaiting, gatherGit }
  from '../lib/register/ready.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

const row = (id, over = {}) => ({ id, order: 1, title: id, branch: `b/${id.split('/')[1].toLowerCase()}`,
  deps: [], lane: null, subjects: [], status: 'todo', design: false, mine: true, pending: [], ...over });

test('an existing ref claims a todo row, and a vanished ref returns a claimed one', () => {
  const git = { branches: ['b/d1'], mainSubjects: [] };
  const { tasks, corrections } = reconcileTasks([row('demo/D1'), row('demo/D2', { status: 'claimed' })], git);
  assert.equal(tasks[0].status, 'claimed');
  assert.equal(tasks[1].status, 'todo');
  assert.equal(tasks[1].note, 'ref gone; check worktree before relaunch');
  assert.equal(corrections.length, 2);
});

test('a subject on main lands a row whatever its ref says', () => {
  const git = { branches: [], mainSubjects: ['feat: the thing'] };
  const { tasks } = reconcileTasks([row('demo/D1', { subjects: ['feat: the thing'] })], git);
  assert.equal(tasks[0].status, 'landed');
});

test('an unqualified id or dep is an error, not a task to schedule cautiously', () => {
  const git = { branches: [], mainSubjects: [] };
  assert.throws(() => computeReadySet([row('D1')], git), /unqualified id/);
  assert.throws(() => computeReadySet([row('demo/D1', { deps: ['D0'] })], git), /unqualified dep/);
});

test('a dep that has not landed and a busy lane each block, and nothing else does', () => {
  const git = { branches: [], mainSubjects: [] };
  const tasks = [
    row('demo/D1', { status: 'landed' }),
    row('demo/D2', { deps: ['demo/D1'] }),
    row('demo/D3', { deps: ['demo/D9'] }),
    row('demo/D4', { lane: 'ui' }),
    row('demo/D5', { lane: 'ui', status: 'claimed' }),
  ];
  const { ready, blocked } = computeReadySet(tasks, git);
  assert.deepEqual(ready.map((t) => t.id), ['demo/D2']);
  assert.deepEqual(blocked.map((b) => b.id), ['demo/D3', 'demo/D4']);
});

test('mine goes first; a stranger fills a spare slot and never displaces me', () => {
  const ready = [row('x/A', { order: 1, mine: false }), row('x/B', { order: 2 })];
  assert.deepEqual(planLaunches(ready, 0, 1).map((t) => t.id), ['x/B']);
  assert.deepEqual(planLaunches(ready, 0, 2).map((t) => t.id), ['x/B', 'x/A']);
});

test('a row with no mine field at all is not demoted behind a stranger', () => {
  const ready = [{ ...row('x/A'), mine: undefined }, row('x/B', { mine: false })];
  assert.deepEqual(planLaunches(ready, 0, 1).map((t) => t.id), ['x/A']);
});

test('a design task is planned on the design model', () => {
  assert.equal(planLaunches([row('x/A', { design: true })], 0, 1)[0].model, 'fable');
  assert.equal(planLaunches([row('x/A')], 0, 1)[0].model, 'opus');
});

test('an undelivered relay is reported whatever the row status, and never for a terminal row', () => {
  const now = Date.parse('2026-09-03T12:00:00.000Z');
  const tasks = [
    row('demo/D1', { status: 'review', relay: { text: 'blocking defect', writtenAt: '2026-09-03T10:00:00.000Z' } }),
    row('demo/D2', { status: 'landed', relay: { text: 'old news', writtenAt: '2026-09-01T10:00:00.000Z' } }),
    row('demo/D3', { status: 'claimed', relay: { text: 'done', writtenAt: '2026-09-03T10:00:00.000Z', deliveredAt: '2026-09-03T10:01:00.000Z' } }),
  ];
  const out = undeliveredRelays(tasks, { now });
  assert.deepEqual(out.map((u) => u.id), ['demo/D1']);
  assert.equal(out[0].ageMin, 120);
});

test('a question older than the floor is reported, oldest first, unknown age last', () => {
  const now = Date.parse('2026-09-03T12:00:00.000Z');
  const tasks = [
    row('demo/D1', { pending: [{ kind: 'question', ask: 'old', askedAt: '2026-09-03T09:00:00.000Z' }] }),
    row('demo/D2', { pending: [{ kind: 'question', ask: 'fresh', askedAt: '2026-09-03T11:59:00.000Z' }] }),
    row('demo/D3', { pending: [{ kind: 'question', ask: 'undated' }] }),
    row('demo/D4', { pending: [{ kind: 'question', ask: 'answered', askedAt: '2026-09-03T09:00:00.000Z', answer: 'yes' }] }),
  ];
  assert.deepEqual(pendingWaiting(tasks, { now }).map((p) => p.ask), ['old', 'undated']);
});

test('gatherGit answers about THIS checkout and excludes main', () => {
  const r = repo();
  r.git('branch', 'demo/d1');
  const git = gatherGit(r.root);
  assert.deepEqual(git.branches, ['demo/d1']);
  assert.ok(git.mainSubjects.includes('initial'));
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/ready.test.mjs test/enrol.test.mjs`
Expected: FAIL — no `lib/register/ready.mjs`; `mine` is undefined on an enroled row.

- [ ] **Step 3: Carry `mine` onto the row**

In `lib/register/state.mjs`, `registerRow`'s options gain `mine`, defaulting to `true`, and the row
gains the field with a comment naming what reads it:

```js
export function registerRow(task, { roadmapSlug, status = 'todo', note = '', mine = true }) {
```

```js
    // Whether this task is MINE to prioritise. Read by `planLaunches` (./ready.mjs), which puts my
    // own roadmaps first and gives a stranger's OPEN task a slot only once my queue has nothing left
    // to run: a developer who opened their roadmap offered spare capacity, not priority. Offline
    // there is no other developer, so it is always true.
    mine,
```

In `lib/roadmap/enrol.mjs`, take a second predicate and pass it through:

```js
export function enrol(state, tasks, { at, host, foreign = () => false, mine = () => true }) {
```

```js
    appendRow(registerRow(task, { roadmapSlug: task.roadmap, status, note, mine: mine(task) }));
```

In `lib/cli/roadmap.mjs`'s `enrolInto`, fill it from the overlay that is already taken once:

```js
    // `!== false`, not `=== true`: a task with no overlay entry at all — offline, or one not yet
    // published — is mine.
    mine: (t) => overlay.get(t.key)?.mine !== false,
```

- [ ] **Step 4: Port `ready.mjs`**

From `tools/orchestra/ready.mjs`, whole, minus the CLI. The header paragraph explaining that
`Touches` stopped blocking on 2026-09-01 — that the declared field never predicted what a task would
edit, that widening it to every in-flight branch's actual diff made it worse because a branch's diff
grows as the work proceeds, and that conflicts are the merge gate's job — is kept **verbatim**. It is
spec §6's third change and it is already true in the source, so this is a copy and not an edit.

Substitutions: `gatherGit(repo)` becomes `gatherGit(root)` and uses `gitEnv()` from `../paths.mjs`
rather than deleting the three variables by hand — the scrub now has one definition (Task 1). The
`docs/superpowers/specs/2026-08-10-orchestra-conductor-design.md` reference becomes this plugin's
spec path.

- [ ] **Step 5: Write the CLI half, with the budget**

Create `lib/cli/tick.mjs`:

```js
// The launch plan, and the one place the machine-wide budget narrows it.
import { readState } from '../register/state.mjs';
import { reconcileTasks, computeReadySet, planLaunches, undeliveredRelays, pendingWaiting, gatherGit }
  from '../register/ready.mjs';
import { maxWorkers, otherWorkers, recordInstance } from '../machine.mjs';
import { conductorState } from '../register/beat.mjs';

const out = (s) => process.stdout.write(`${s}\n`);

export function readyCommand({ cfg, args }) {
  const state = readState(cfg.root);
  if (!state) { out('no register — publish a roadmap first, then `orchestra roadmap enrol`'); return; }
  const arg = (n, d) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : d; };
  const width = Number(arg('--width', '8'));

  const git = gatherGit(cfg.root);
  const { tasks, corrections } = reconcileTasks(state.tasks ?? [], git);
  const { ready, blocked } = computeReadySet(tasks, git);
  const inFlight = tasks.filter((t) => t.status === 'claimed' || t.status === 'review').length;

  // This project's live worker count, published for every other conductor on this machine to budget
  // against — and the same call reaps whatever died since the last tick. `ready` is the ONE command
  // that writes the registry, so the machine file has exactly one writer per project, the way the
  // register does.
  const beat = conductorState(cfg.root);
  recordInstance({
    id: cfg.id, name: cfg.name, root: cfg.root, mode: cfg.mode, workers: inFlight,
    conductorSession: beat?.session ?? null, conductorPid: beat?.pid ?? null, beatAt: beat?.ts ?? null,
  });

  // §8.6: this tick may plan at most `maxWorkers` minus what the OTHER live projects hold. It budgets
  // SESSIONS, not CPU: four projects each running one full test suite is within budget and can still
  // saturate the machine. A project that needs that ordering configures `queue`.
  const cap = maxWorkers();
  const others = otherWorkers(cfg.id);
  const effective = Math.min(width, Math.max(0, cap - others));

  const launches = planLaunches(ready, inFlight, effective);
  const undelivered = undeliveredRelays(tasks);
  const waiting = pendingWaiting(tasks);

  if (args.includes('--json')) {
    out(JSON.stringify({ corrections, tasks, blocked, ready, launches, undelivered, waiting,
      budget: { width, maxWorkers: cap, others, effective, inFlight } }, null, 2));
    return;
  }
  for (const c of corrections) out(`fix: ${c}`);
  // First, above everything else: an UNDELIVERED line is an obligation for this tick, not a status.
  for (const u of undelivered)
    out(`UNDELIVERED: ${u.id} [${u.status}] — relay written ${u.writtenAt ?? 'at an unreadable time'}${u.ageMin === null ? '' : `, ${u.ageMin} min ago`}`);
  if (waiting.length) {
    const oldest = waiting[0];
    out(`WAITING: ${waiting.length} item(s), oldest ${oldest.id} (${oldest.ageMin === null ? 'age unknown' : `${oldest.ageMin} min`}) — ${oldest.ask.slice(0, 80)}`);
  }
  out(`in flight: ${inFlight}/${effective}${effective < width
    ? ` (width ${width}, held down to ${effective}: ${others} of ${cap} worker(s) belong to other project(s) on this machine)` : ''}`);
  // A conductor held to zero says so rather than launching anyway.
  if (!launches.length && ready.length && effective <= inFlight)
    out(`HELD: ${ready.length} task(s) are ready and this machine has no slot for them — ${others} of ${cap} are held elsewhere`);
  for (const t of launches) out(`launch: ${t.id} — ${t.title} [${t.model}] on ${t.branch}`);
  for (const b of blocked) out(`blocked: ${b.id} — ${b.reasons.join('; ')}`);
}
```

In `bin/orchestra`, register `ready`.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test`
Expected: PASS.

```
git add lib/register/ready.mjs lib/cli/tick.mjs lib/register/state.mjs lib/roadmap/enrol.mjs lib/cli/roadmap.mjs bin/orchestra test/ready.test.mjs test/enrol.test.mjs
git commit -m 'feat(register): the scheduling brain, budgeted against the rest of the machine'
```

---

### Task 9: the tick gate and the yield check

**Files:**
- Create: `lib/register/tick.mjs`, `lib/register/wake.mjs`
- Modify: `lib/cli/tick.mjs`, `bin/orchestra`, `lib/register/state.mjs` (`budgetResetAt`, Step 3)
- Test: `test/tick.test.mjs`

**Interfaces:**
- Consumes: `conductorState` from `./beat.mjs`; `readJsonl`, `unconsumed`, `inboxPath` from
  `./inbox.mjs`; `append` from `./journal.mjs`; `statePath` from `./state.mjs`.
- Produces:
  - `lib/register/tick.mjs`: `decideTick({ conductor, register, unconsumedAnswers, now }) -> string`,
    `gateLine(root, { now })` gathering the three inputs and returning that string.
  - `lib/register/wake.mjs`: `FOUND_EXIT` (10), `yieldVerdict({ root, selfSession, now, alive })`
    returning `{ yield, why, held }`.
  - `lib/cli/tick.mjs`: `tickGateCommand({ cfg })`, `yieldCheckCommand({ cfg })`.

- [ ] **Step 1: Write the failing test**

`test/tick.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { makeRepo } from './helpers/fixture.mjs';
import { writeState, emptyState, statePath } from '../lib/register/state.mjs';
import { writeBeat } from '../lib/register/beat.mjs';
import { inboxPath } from '../lib/register/inbox.mjs';
import { journalPath } from '../lib/register/journal.mjs';
import { decideTick, gateLine } from '../lib/register/tick.mjs';
import { yieldVerdict } from '../lib/register/wake.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

const reg = (over = {}) => ({ tasks: [], ...over });

test('a live CONDUCTING conductor stands the tick down; a silent one hands the baton back', () => {
  assert.match(decideTick({ conductor: { conducting: true, session: 's1', pid: 7 } }), /^skip a conductor is live/);
  const line = decideTick({ conductor: { conducting: false, session: 's1', pid: 7, silentFor: 7_200_000 },
    register: reg({ tasks: [{ status: 'todo' }] }) });
  assert.match(line, /^run hold-awake/);
  assert.match(line, /took the baton back from s1 \(pid 7\), beating but silent for 120 min/);
});

test('absent and unreadable are not the same case', () => {
  assert.match(decideTick({ register: 'absent' }), /^skip no register/);
  assert.equal(decideTick({ register: 'unreadable' }), 'run');
});

test('a budget that has not reset stands the tick down; one nobody can parse does not', () => {
  const now = Date.parse('2026-09-03T10:00:00.000Z');
  assert.match(decideTick({ register: reg({ budgetResetAt: '2026-09-03T12:00:00.000Z' }), now }), /^skip budget resets/);
  assert.match(decideTick({ register: reg({ budgetResetAt: 'soon', tasks: [{ status: 'todo' }] }), now }), /^run/);
});

test('every reason the tick still has something to do', () => {
  assert.match(decideTick({ register: reg(), unconsumedAnswers: 1 }), /^run$/);
  assert.match(decideTick({ register: reg({ tasks: [{ status: 'claimed' }] }) }), /^run hold-awake$/);
  assert.match(decideTick({ register: reg({ tasks: [{ status: 'landed', pending: [{ answer: null }] }] }) }), /^run$/);
  assert.match(decideTick({ register: reg({ tasks: [{ status: 'review', relay: { text: 'x' } }] }) }), /^run hold-awake$/);
});

test('nothing in flight, nothing asked, nothing owed: stand down', () => {
  assert.match(decideTick({ register: reg({ tasks: [{ status: 'landed' }, { status: 'dropped' }] }) }),
    /^skip nothing to do — 2 row\(s\), all landed or dropped/);
});

test('gateLine reads the same unconsumed rule the relay does', () => {
  const r = repo();
  writeState(r.root, { ...emptyState(r.root), tasks: [] });
  assert.match(gateLine(r.root), /^skip nothing to do/);
  appendFileSync(inboxPath(r.root), `${JSON.stringify({ ts: new Date().toISOString(), task: null, answer: 'yes' })}\n`);
  assert.match(gateLine(r.root), /^run$/);
});

test('an unreadable register cannot tell whether an answer is waiting, so it assumes one is', () => {
  const r = repo();
  writeFileSync(statePath(r.root), '{"tasks":');
  assert.equal(gateLine(r.root), 'run');
});

test('yieldVerdict hands back to a live conductor, once, and journals it once', () => {
  const r = repo();
  const now = Date.parse('2026-09-03T10:00:00.000Z');
  writeState(r.root, emptyState(r.root));
  writeBeat(r.root, { session: 'abcdef12-1111', pid: 9, now });
  const v = yieldVerdict({ root: r.root, selfSession: 'other', now, alive: () => true });
  assert.equal(v.yield, true);
  yieldVerdict({ root: r.root, selfSession: 'other', now, alive: () => true });
  const lines = readFileSync(journalPath(r.root), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).kind, 'tick');
});

test('my own beat is not somebody else holding the baton', () => {
  const r = repo();
  const now = Date.parse('2026-09-03T10:00:00.000Z');
  writeState(r.root, emptyState(r.root));
  writeBeat(r.root, { session: 'abcdef12', pid: 9, now });
  assert.equal(yieldVerdict({ root: r.root, selfSession: 'abcdef12-1111-2222', now, alive: () => true }).yield, false);
});

test('a beat shorter than eight characters is not an identity', () => {
  const r = repo();
  const now = Date.parse('2026-09-03T10:00:00.000Z');
  writeState(r.root, emptyState(r.root));
  writeBeat(r.root, { session: 'abc', pid: 9, now });
  // `selfSession.startsWith('abc')` would read a garbled beat as MY OWN and conduct beside it.
  assert.equal(yieldVerdict({ root: r.root, selfSession: 'abcdef12-1111', now, alive: () => true }).yield, true);
});

test('no beat is no baton, and the register is never consulted as a fallback', () => {
  const r = repo();
  writeState(r.root, { ...emptyState(r.root), conductor: { session: 'ghost', language: null, inboxSeen: null } });
  assert.equal(yieldVerdict({ root: r.root, selfSession: 'me', alive: () => true }).yield, false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/tick.test.mjs`
Expected: FAIL — neither module exists.

- [ ] **Step 3: Port `tick-gate.mjs` as `lib/register/tick.mjs`**

`decideTick` is copied whole and untouched; its body is a decision table whose ordering is the
measurement. Keep the header's three measured failures (two conductors side by side and 21 landings
for 16 rows; a slot burned on a refusal the session limit had already made certain, three hours
before the reset; eight heartbeat slots of 1h23 to 3h26 lost to sleep, ~6h in a 46h roadmap), and
keep the paragraph listing every reason the tick still has something to do — including the sentence
that the conductor rule "only lifts a VETO … taking the baton back is not a reason to invent work".

The `main()` becomes an exported `gateLine(root, { now })` doing exactly what it did: read the beat;
tell `absent` from `unreadable` by the error code and not by guessing; and count unconsumed answers
with the **same** `unconsumed` the relay and the watch use — that is the source's own stated reason,
and it is why `lib/register/inbox.mjs` is imported rather than the rule re-derived. Keep the
`catch { unconsumedAnswers = 1 }` and its comment: standing down there is the only failure mode of
this gate that loses something a user typed. The source's dynamic `await import(...)` becomes a
static import — it existed to survive a missing sibling in a repository where these tools arrived
incrementally, which is not this repository's situation.

**Add `budgetResetAt` to `emptyState` in this task, not in Task 10** — a field arrives with its
reader, and `decideTick` is its reader. In `lib/register/state.mjs`:

```js
  conductor: { session: null, language: null, inboxSeen: null },
  // When the account's usage budget frees up again. Read by `decideTick` (./tick.mjs), which stands
  // the heartbeat down until then rather than spending a session on a refusal that is already
  // certain — a slot was burned on exactly that, three hours before a reset, on 2026-08-13.
  budgetResetAt: null,
```

Task 10 then derives `STRUCTURAL` from `emptyState`, which is what makes the key survive an archive
pass; the two halves are checked against each other by that task's own test.

- [ ] **Step 4: Port `wake.mjs`'s yield half as `lib/register/wake.mjs`**

Take `FOUND_EXIT`, `journalOnce`, `handback`, `act`, `SHORT_ID_LEN`, `isSelf` and `yieldVerdict`.
**Do not port `unreadAnswers`, `quiet`, or the `INBOX_REL` import** — scope ruling 4. The header is
rewritten to describe one question rather than two; the paragraphs that survive verbatim are the ones
at `yieldVerdict` itself: why the evidence is the beat and there is deliberately no second opinion,
why there is NO FALLBACK TO THE REGISTER (`conductor.session` named a dead conductor for half an hour
on 2026-08-13 while three answers rotted in it), and why the residual "beats but does not act" gap is
closed by `conductorState` rather than by a rule of this file's own — thirteen hours and four
uncollected workers on 2026-08-17/18.

`journalOnce` must use `append`/`journalPath` from `./journal.mjs` rather than writing the line
itself. Two consequences to honour: the source writes second-precision stamps here while
`journal.line` writes milliseconds — take the journal's, since one clock is that module's whole
point; and `journalOnce`'s "never the same line twice in a row" check reads the last line of the
file, which is unchanged.

- [ ] **Step 5: Write the CLI halves**

Add to `lib/cli/tick.mjs`:

```js
// Exit code is deliberately NOT the channel here: a gate that cannot answer must not be able to stop
// the heartbeat, and `set -e` in some future caller would turn a non-zero exit into exactly that. The
// shell reads the first word of the line and nothing else.
export const tickGateCommand = ({ cfg }) => process.stdout.write(`${gateLine(cfg.root)}\n`);

// Run FIRST by both tick entry points, before either arms a watch or records itself as conductor —
// the two writes a session about to hand back must not make. Exit 10 means hand back; the journal
// line is already written, so the caller only has to stop.
export function yieldCheckCommand({ cfg }) {
  const v = yieldVerdict({ root: cfg.root });
  process.stdout.write(`${v.why}\n`);
  if (v.yield) process.exitCode = FOUND_EXIT;
}
```

In `bin/orchestra`, register `tick-gate` and `yield-check`.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test`
Expected: PASS.

```
git add lib/register/tick.mjs lib/register/wake.mjs lib/cli/tick.mjs bin/orchestra test/tick.test.mjs
git commit -m 'feat(register): whether to tick at all, and whether to hand the baton back'
```

---

### Task 10: the archive — moving finished prose out of the register

**Files:**
- Create: `lib/register/archive.mjs`, `lib/cli/archive.mjs`
- Modify: `lib/register/state.mjs`, `bin/orchestra`
- Test: `test/archive.test.mjs`, `test/state.test.mjs`

**Interfaces:**
- Consumes: `liveConductor` from `./beat.mjs`; `readState`, `statePath`, `STRUCTURAL` from
  `./state.mjs`; `orchestraDir` from `../paths.mjs`.
- Produces: `archivePath(root)`, `TERMINAL` (Set), `PROSE_FIELDS`, `isStripped(row)`,
  `partition(state, { at }) -> { next, archived }`, `sizeOf(value)`,
  `archive(root, { at }) -> { archived, before, after }`, `loadArchive(root)`.
  `lib/register/state.mjs` gains `STRUCTURAL` and a `budgetResetAt` key on `emptyState`.
  `lib/cli/archive.mjs` exports `archiveCommand({ cfg, args })`.

**`STRUCTURAL` is derived from `emptyState`, not written twice.** In the source it is a hand-kept
list, and porting it as one would ship a live bug here: `planetCraft`'s list contains neither
`version` nor `root`, which are exactly the two keys P1's `emptyState` added — so the first archive
pass would file `root` away as prose, and `assertRoot` returns early when the recorded root is
absent. The wrong-project guard would be silently switched off by the tidy-up pass. One list derived
from the shape cannot drift, and the loud failure the source's comment wants — a new structural key
turning up named in the archive — is preserved, because a key a conductor *invents* is still not in
`emptyState`.

`budgetResetAt` is added to `emptyState` for the same reason: `decideTick` reads it (Task 9), and in
the source it is structural in fact and absent from `STRUCTURAL` in code.

**Not ported:** `mainCheckoutOf` — `lib/paths.mjs`'s `mainCheckout` is that function, with Task 1's
scrub, and a second copy is the "two sources for one fact" failure this repository has already paid
for five times.

- [ ] **Step 1: Write the failing tests**

Add to `test/state.test.mjs`:

```js
test('every key of an empty state is structural, so the archive can never file one as prose', () => {
  for (const k of Object.keys(emptyState('/tmp/x'))) assert.ok(STRUCTURAL.has(k), `${k} is not structural`);
});
```

`test/archive.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo } from './helpers/fixture.mjs';
import { writeState, readState, emptyState } from '../lib/register/state.mjs';
import { partition, archive, loadArchive, isStripped, archivePath, PROSE_FIELDS } from '../lib/register/archive.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

const row = (id, over = {}) => ({ id, status: 'landed', deps: [], note: 'a long post-mortem',
  subjects: ['feat: x'], touches: ['a.js'], decisions: ['chose b'], pending: [], ...over });

test('a finished row nothing depends on leaves the register entirely', () => {
  const { next, archived } = partition({ tasks: [row('demo/D1')] }, { at: 'T' });
  assert.deepEqual(next.tasks, []);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].kind, 'task');
  assert.equal(archived[0].note, 'a long post-mortem');
});

test('a finished row a LIVE row still depends on stays, stripped of its prose only', () => {
  const { next } = partition({ tasks: [row('demo/D1'), row('demo/D2', { status: 'todo', deps: ['demo/D1'] })] }, { at: 'T' });
  assert.deepEqual(next.tasks.map((t) => t.id), ['demo/D1', 'demo/D2']);
  const kept = next.tasks[0];
  for (const f of PROSE_FIELDS) assert.equal(kept[f], undefined);
  // Every field a reader touches is still there.
  assert.equal(kept.status, 'landed');
  assert.deepEqual(kept.deps, []);
  assert.ok(isStripped(kept));
});

test('a second pass does not archive a stripped row again', () => {
  const first = partition({ tasks: [row('demo/D1'), row('demo/D2', { status: 'todo', deps: ['demo/D1'] })] }, { at: 'T' });
  const second = partition(first.next, { at: 'T' });
  assert.deepEqual(second.archived, []);
  assert.equal(second.next, first.next);
});

test('pending is never prose: a question already put survives archiving', () => {
  const { next } = partition({ tasks: [row('demo/D1', { pending: [{ ask: 'A or B?' }] }),
                                       row('demo/D2', { status: 'todo', deps: ['demo/D1'] })] }, { at: 'T' });
  assert.deepEqual(next.tasks[0].pending, [{ ask: 'A or B?' }]);
});

test('nothing finished means nothing moves, INCLUDING the conductor prose', () => {
  const state = { tasks: [row('demo/D1', { status: 'claimed' })], lesson: 'never do that again' };
  const { next, archived } = partition(state, { at: 'T' });
  assert.equal(next, state);
  assert.deepEqual(archived, []);
});

test('structural keys stay and everything else at the top is archived as lessons', () => {
  const root = '/tmp/x';
  const state = { ...emptyState(root), tasks: [row('demo/D1')], lesson: 'never do that again' };
  const { next, archived } = partition(state, { at: 'T' });
  assert.equal(next.root, root);
  assert.equal(next.version, 1);
  assert.equal(next.budgetResetAt, null);
  assert.equal(next.lesson, undefined);
  const lessons = archived.find((a) => a.kind === 'lessons');
  assert.deepEqual(lessons.keys, ['lesson']);
});

test('archive writes the line before it rewrites the register, and round-trips', () => {
  const r = repo();
  writeState(r.root, { ...emptyState(r.root), tasks: [row('demo/D1')] });
  const res = archive(r.root, { at: 'T' });
  assert.equal(res.archived, 1);
  assert.ok(res.after < res.before);
  assert.deepEqual(readState(r.root).tasks, []);
  assert.equal(readState(r.root).root, r.root);       // the wrong-project guard survives the pass
  assert.equal(loadArchive(r.root)[0].note, 'a long post-mortem');
});

test('a torn tail line in the archive is skipped, not fatal', () => {
  const r = repo();
  writeState(r.root, { ...emptyState(r.root), tasks: [row('demo/D1')] });
  archive(r.root, { at: 'T' });
  appendFileSync(archivePath(r.root), '{"kind":"tas');
  assert.equal(loadArchive(r.root).length, 1);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/archive.test.mjs test/state.test.mjs`
Expected: FAIL — no `lib/register/archive.mjs`; `STRUCTURAL` is not exported.

- [ ] **Step 3: Add `STRUCTURAL` to the state module**

`budgetResetAt` is already there — Task 9 added it with the `decideTick` that reads it. What this
task adds, below `emptyState`, is the one list:

```js
// The top-level keys the machinery reads. EVERYTHING ELSE at the top of the register is prose a
// conductor wrote to itself — 43 523 bytes of it on the run this was measured from, some of it
// actively wrong and contradicted by the skill that read it — and `lib/register/archive.mjs` moves
// it out with the rows.
//
// DERIVED from `emptyState`, not written out a second time. The project this is ported from keeps a
// hand-maintained list, and copying it would have shipped a live bug here: that list has no
// `version` and no `root`, which are exactly the two keys this plugin's register added, so the first
// archive pass would have filed `root` away as prose — and `assertRoot` returns early when the
// recorded root is absent, so the wrong-project guard would have been silently switched off by the
// tidy-up pass. A key a conductor INVENTS is still not in `emptyState`, so the loud failure the
// original wanted — the new key turning up named in the archive — is unchanged.
export const STRUCTURAL = new Set(Object.keys(emptyState(null)));
```

- [ ] **Step 4: Port `archive.mjs`**

From `tools/orchestra/archive.mjs`, minus `STRUCTURAL` (now imported), minus `mainCheckoutOf`, minus
the CLI. Keep verbatim: the 2026-08-30 measurement (202 KB, 87 of 87 rows terminal, 136 663 bytes of
them, 67.7% of the file, 6 100 bytes of note for one row), the TWO OUTCOMES paragraph and why the
test is "does anything surviving still point at it" rather than "is its roadmap finished", the
measured weight table (`note 48.8% | subjects 12.4% | decisions 8.7% | touches 6.6%`), the three
readers that keep working for free, and the `pending`-is-not-prose paragraph.

Two sentences need a decision rather than a rename: `tools/retex.mjs` as the second reader of
`archive.jsonl` — the plugin does not ship retex (§13), so say what is true, that the archive is the
register's own history and that a project which configures a retrospective tool reads it there; and
`monitor/progress.mjs` / `monitor/model.mjs` in the three-readers list — those arrive in P4, so name
them as the page's readers *with the phase*, rather than as files that exist.

`archive(repo, …)` becomes `archive(root, …)` and reads through `readState` — one reader — while the
write stays exactly as it is: append the whole lines first, then replace the register in one rename,
because dying between the two must leave a duplicate a reader can see rather than rows that exist
nowhere.

- [ ] **Step 5: Write the CLI half**

Create `lib/cli/archive.mjs` with `archiveCommand`, which is the source's `main()`: print what would
move and what it would save, and do nothing without `--write`. Keep the refusal in effect — never
while a tick is running, because the register is rewritten in place and a conductor holds it in
memory across its whole tick, so a write underneath one silently loses everything that tick decided:

```js
  if (!args.includes('--write')) { out('\nnothing written — pass --write to move it'); return; }
  const live = liveConductor(cfg.root);
  if (live) throw new Error(`refused: a conductor is live (${live.session}, pid ${live.pid}) — it would overwrite this`);
```

In `bin/orchestra`, register `archive`.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test`
Expected: PASS.

```
git add lib/register/archive.mjs lib/cli/archive.mjs lib/register/state.mjs bin/orchestra test/archive.test.mjs test/state.test.mjs
git commit -m 'feat(register): move finished prose to an archive, with one list of what is structural'
```

---

### Task 11: the photographs

**Files:**
- Create: `lib/register/images.mjs`, `lib/register/archiveImages.mjs`
- Modify: `lib/cli/archive.mjs`, `bin/orchestra`
- Test: `test/archive-images.test.mjs`

**Interfaces:**
- Consumes: `TERMINAL`, `archivePath` from `./archive.mjs`; `STRUCTURAL`, `readState` from
  `./state.mjs`; `readJsonl`, `inboxPath` from `./inbox.mjs`; `journalPath` from `./journal.mjs`;
  `orchestraDir` from `../paths.mjs`.
- Produces:
  - `lib/register/images.mjs`: `IMAGE_EXTENSIONS`, `scanImagePaths(text, exts)`.
  - `lib/register/archiveImages.mjs`: `imagesDir(root)`, `PHOTO_EXTENSIONS`, `FRESH_MS`,
    `sweep(root, { now, freshMs }) -> { kept, dropped, bytes, unreadable }`,
    `archivePhotos(root, { now, freshMs }) -> { removed, bytes, pruned }`.
  - `lib/cli/archive.mjs`: `archiveImagesCommand({ cfg, args })`.

**THE SWEEP ROOT IS `.orchestra/images/`, NEVER `.orchestra/`, and this is the one place this port
diverges from its source on purpose.** In `planetCraft` the swept directory is `.claude/orchestra/`,
which holds nothing but runtime state. In this plugin `.orchestra/` is also where `config.json` lives
and where `worktrees/` defaults to (spec §3.1) — so a sweep that walked it would descend into every
live worktree, find the project's own `.png` assets, decide that no register line names them, and
remove them. Spec §7 already names `.orchestra/images/` as where the page resolves an orchestra
picture; that directory is the sweep's whole world. A photograph a worker took inside its worktree is
the project's file, and this command must never be able to touch it.

- [ ] **Step 1: Write the failing test**

`test/archive-images.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, utimesSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeRepo } from './helpers/fixture.mjs';
import { writeState, emptyState } from '../lib/register/state.mjs';
import { journalPath } from '../lib/register/journal.mjs';
import { loadArchive } from '../lib/register/archive.mjs';
import { scanImagePaths } from '../lib/register/images.mjs';
import { imagesDir, sweep, archivePhotos, FRESH_MS } from '../lib/register/archiveImages.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

const NOW = Date.parse('2026-09-03T10:00:00.000Z');
const OLD = (NOW - FRESH_MS - 86_400_000) / 1000;

const photo = (r, name, bytes = 32) => {
  const p = join(imagesDir(r.root), name);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, Buffer.alloc(bytes));
  utimesSync(p, OLD, OLD);
  return p;
};

test('the scanner takes a path out of prose and leaves the sentence behind', () => {
  assert.deepEqual(scanImagePaths('compare .orchestra/images/a.png with b.png, not the .png file'),
    ['.orchestra/images/a.png', 'b.png']);
  assert.deepEqual(scanImagePaths('see https://host/x.png'), []);
});

test('a photograph an OPEN ask names is kept, whatever the row status', () => {
  const r = repo();
  photo(r, 'ask.png');
  writeState(r.root, { ...emptyState(r.root),
    tasks: [{ id: 'demo/D1', status: 'landed', pending: [{ ask: 'look at ask.png' }] }] });
  const s = sweep(r.root, { now: NOW });
  assert.deepEqual(s.dropped, []);
  assert.match(s.kept[0].why[0], /open ask on demo\/D1/);
});

test('a photograph only a TERMINAL row names goes, and the archive line says which row', () => {
  const r = repo();
  photo(r, 'done.png', 64);
  writeState(r.root, { ...emptyState(r.root),
    tasks: [{ id: 'demo/D1', status: 'landed', note: 'the fix, done.png', pending: [] }] });
  const s = sweep(r.root, { now: NOW });
  assert.deepEqual(s.dropped.map((p) => p.rel), ['.orchestra/images/done.png']);
  assert.equal(s.bytes.dropped, 64);
  const res = archivePhotos(r.root, { now: NOW });
  assert.equal(res.removed, 1);
  assert.equal(existsSync(join(imagesDir(r.root), 'done.png')), false);
  const line = loadArchive(r.root).find((a) => a.kind === 'photo');
  assert.equal(line.path, '.orchestra/images/done.png');
  assert.equal(line.bytes, 64);
  assert.match(line.citedBy[0], /landed row demo\/D1/);
});

test('nothing younger than the freshness floor is ever taken', () => {
  const r = repo();
  const p = photo(r, 'fresh.png');
  utimesSync(p, NOW / 1000, NOW / 1000);
  writeState(r.root, { ...emptyState(r.root), tasks: [] });
  assert.deepEqual(sweep(r.root, { now: NOW }).dropped, []);
});

test('a journal line about a task the register cannot show keeps its pictures', () => {
  const r = repo();
  photo(r, 'unknown.png');
  writeState(r.root, { ...emptyState(r.root), tasks: [] });
  appendFileSync(journalPath(r.root),
    `${JSON.stringify({ ts: '2026-08-01T00:00:00.000Z', kind: 'note', task: 'gone/G1', text: 'unknown.png' })}\n`);
  assert.deepEqual(sweep(r.root, { now: NOW }).dropped, []);
});

test('a register with no task list throws rather than read the silence as "nothing is cited"', () => {
  const r = repo();
  photo(r, 'x.png');
  writeState(r.root, { ...emptyState(r.root), tasks: 'not a list' });
  assert.throws(() => sweep(r.root, { now: NOW }), /refusing to read an unparsed register/);
});

test('a surviving board keeps the montages it names', () => {
  const r = repo();
  photo(r, 'ab/left.png');
  photo(r, 'ab/right.png');
  const board = join(imagesDir(r.root), 'ab/board.html');
  writeFileSync(board, '<img src="left.png"><img src="right.png">');
  utimesSync(board, OLD, OLD);
  writeState(r.root, { ...emptyState(r.root),
    tasks: [{ id: 'demo/D1', status: 'todo', note: 'see .orchestra/images/ab/board.html', pending: [] }] });
  assert.deepEqual(sweep(r.root, { now: NOW }).dropped, []);
});

test('the sweep never leaves its own directory', () => {
  const r = repo();
  // A CONTROL photograph under images/, named by the same finished row: it must be swept, which is
  // what proves the sweep ran at all. Without it `dropped: []` below is true whatever the sweep did.
  photo(r, 'control.png');
  // And a file in the project's own tree, named the way a worker names a screenshot, named by that
  // same finished row. It is not orchestra's to remove.
  mkdirSync(join(r.root, 'docs'), { recursive: true });
  writeFileSync(join(r.root, 'docs/screenshot.png'), Buffer.alloc(16));
  writeState(r.root, { ...emptyState(r.root),
    tasks: [{ id: 'demo/D1', status: 'landed', note: 'control.png and docs/screenshot.png', pending: [] }] });
  const s = sweep(r.root, { now: NOW });
  assert.deepEqual(s.dropped.map((p) => p.rel), ['.orchestra/images/control.png']);
  archivePhotos(r.root, { now: NOW });
  assert.equal(existsSync(join(imagesDir(r.root), 'control.png')), false);
  assert.ok(existsSync(join(r.root, 'docs/screenshot.png')));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/archive-images.test.mjs`
Expected: FAIL — neither module exists.

- [ ] **Step 3: Port the scanner**

`lib/register/images.mjs` takes `IMAGE_EXTENSIONS`, the cached `PATTERNS`/`patternFor` pair and
`scanImagePaths` from `monitor/images.mjs`. **`imagesIn` is not ported** — it resolves for the page,
and P4 brings it. Keep the character-class paragraph verbatim (why `:` and whitespace are outside the
class, why the character before the dot must be a name character, why `//host/x.png` is the one shape
that is never a path) and the "one pattern, two vocabularies" paragraph — that paragraph is the
reason the archiver does not grow a second definition of "a path in the prose".

- [ ] **Step 4: Port the sweep**

`lib/register/archiveImages.mjs` from `archive-images.mjs`. Keep verbatim: the 2026-09-02 census
(70.2 MB in 199 files, 68 MB of it photographs, 33 MB for one A/B board), the three live surfaces and
why they are the ones the page scans, the freshness-floor paragraph with its measurement (at most 1.2
hours between a file being written and the first line citing it, negative for three of them; seven
days is 140x the worst measured gap) together with the statement that this is why the command carries
no `liveConductor` refusal while the prose pass correctly does, the two places it refuses to guess,
and `FOLLOW_MAX_BYTES` with its quadratic-backtracking measurement (a path pattern whose character
class contains base64's own alphabet sat on a 10.2 MB inlined page for two minutes).

Changes, each carrying its comment:

- `ORCHESTRA_REL` becomes `imagesDir(root) = join(orchestraDir(root), 'images')`, with the divergence
  written down where a reader will hit it — that `.orchestra/` here also holds the config and the
  worktrees, and that a sweep of it would delete the project's own files out of a live worktree.
- the five helpers taken from `monitor/sources.mjs` are NOT ported. `readState` comes from
  `./state.mjs`; `readJournal`/`readInbox` become `readJsonl(journalPath(root))` and
  `readJsonl(inboxPath(root))`. The plugin already has one reader for each of those three files, and
  a second set under a `sources.mjs` would be the "two sources for one fact" failure by construction.
- `imageFinder(repo, worktreePaths(repo))` is replaced by a resolver over the swept set alone,
  because the question here is narrower than the page's, and answering the page's question would make
  this command able to delete a file outside its directory:

```js
// Which SWEPT photograph a string in the prose names — and nothing else. The page's own resolver
// (P4) answers a wider question, "which file should I serve", and searches the checkout and the
// worktrees to do it; that answer is exactly what this command must not have, because everything it
// resolves is a file it may remove. Here a path resolves only if it lands inside `.orchestra/images/`,
// so a `docs/screenshot.png` in the project's tree is unresolvable by construction rather than by
// care. Tried as written (relative to the checkout), then relative to the images directory, so both
// `.orchestra/images/a.png` and a bare `a.png` name the same file.
const resolver = (root, byRel) => (raw) => {
  for (const base of [root, imagesDir(root)]) {
    const rel = relative(root, resolve(base, raw));
    if (byRel.has(rel)) return rel;
  }
  return null;
};
```

- `pruneEmpty`'s root becomes `imagesDir(root)`, and it still never removes that directory itself.
- the `citedBy` wording is unchanged; the test asserts `landed row demo/D1`, which is what the
  source's `scan(done ? dead : live, t?.note, …)` already produces.

- [ ] **Step 5: Write the CLI half**

Add `archiveImagesCommand` to `lib/cli/archive.mjs` — the source's `main()`, grouped by directory,
largest first, with `--write` gating the removal and **no conductor refusal**, for the reason the
header gives. Register `archive-images` in `bin/orchestra`.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test`
Expected: PASS.

```
git add lib/register/images.mjs lib/register/archiveImages.mjs lib/cli/archive.mjs bin/orchestra test/archive-images.test.mjs
git commit -m 'feat(register): sweep the photographs of finished runs, and only ever its own'
```

---

### Task 12: P2a's acceptance

**Files:**
- Create: `test/p2a-acceptance.test.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above, through `bin/orchestra` wherever a subcommand exists, so the acceptance
  measures what a user can actually type.
- Produces: nothing importable.

§14's acceptance for this phase, in two testable sentences: *the fixture adopts, ticks and round-trips
its register*, and *two fixtures ticking together never exceed `maxWorkers` between them*. The third
— *the section checklist of §6 is present* — belongs to P2b, which writes the document that checklist
is about, and is not asserted here.

**Check what this suite imports, not what its title promises.** A file called `p2a-acceptance` that
imports two modules accepts two modules. Every assertion below either spawns `bin/orchestra` or reads
a file a spawned subcommand wrote.

- [ ] **Step 1: Write the test**

`test/p2a-acceptance.test.mjs`:

```js
// P2a's acceptance (spec §14). Driven through `bin/orchestra` wherever a subcommand exists, so what
// is asserted is what a user can type — not a set of functions that happen to compose in a test.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo, ROADMAP } from './helpers/fixture.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orchestra');

const HOME = process.env.HOME;
const homes = [];
const repos = [];
beforeEach(() => { const h = mkdtempSync(join(tmpdir(), 'orchestra-home-')); homes.push(h); process.env.HOME = h; });
after(() => {
  process.env.HOME = HOME;
  homes.forEach((h) => rmSync(h, { recursive: true, force: true }));
  repos.forEach((r) => r.cleanup());
});

// A fixture with a published, enroled roadmap: the state P1 leaves and P2a starts from.
function project(name) {
  const r = makeRepo({ name });
  repos.push(r);
  mkdirSync(join(r.root, '.orchestra', 'drafts'), { recursive: true });
  writeFileSync(join(r.root, '.orchestra', 'drafts', 'demo.md'), ROADMAP);
  const run = (...args) => execFileSync(process.execPath, [BIN, ...args],
    { cwd: r.root, encoding: 'utf8', env: { ...process.env, HOME: process.env.HOME } });
  const statePath = join(r.root, '.orchestra', 'state.json');
  run('roadmap', 'publish');
  return {
    ...r,
    run,
    state: () => JSON.parse(readFileSync(statePath, 'utf8')),
    setState: (s) => writeFileSync(statePath, `${JSON.stringify(s, null, 2)}\n`),
  };
}

test('the fixture adopts, ticks and round-trips its register', () => {
  const p = project('acceptance');

  // Adopted: publishing enroled the roadmap's one task as a todo row that is mine.
  assert.deepEqual(p.state().tasks.map((t) => t.id), ['demo/D1']);
  assert.equal(p.state().tasks[0].mine, true);

  // The gate says there is work, and the plan names the launch.
  assert.match(p.run('tick-gate'), /^run hold-awake/);
  assert.match(p.run('ready'), /launch: demo\/D1 — First thing \[opus\] on demo\/d1-first-thing/);

  // Nobody holds the baton, so nothing hands back and the lock is free.
  assert.match(p.run('beat'), /nobody is holding the baton/);
  assert.match(p.run('yield-check'), /no live conductor beat/);
  assert.match(p.run('lock', 'acquire', '--kind', 'conductor', '--session', 's1'), /acquired/);
  assert.match(p.run('lock', 'holder'), /held by conductor s1/);

  // A tick writes to the journal, and the answer channel round-trips: nothing to say until an answer
  // is posted, then the question, the answer, and the instruction to stamp the cursor.
  p.run('journal', 'launch', 'demo/D1', 'started demo/D1');
  assert.match(readFileSync(join(p.root, '.orchestra', 'journal.jsonl'), 'utf8'), /"kind":"launch"/);
  assert.equal(p.run('inbox'), '');

  // Unambiguously PAST stamps. `pendingWaiting` compares `askedAt` against the real `Date.now()`
  // with a 30-minute floor, so a stamp dated today makes the WAITING assertion below depend on the
  // hour the suite happens to run — green after 09:30Z, red before it.
  const s = p.state();
  Object.assign(s.tasks[0], {
    status: 'claimed', session: 'abcdef12-0000', sessionName: 'orchestra-demo-D1',
    pending: [{ id: 'q1', kind: 'question', ask: 'Ship at 0.75 or 1.0?', askedAt: '2026-01-01T00:00:00.000Z' }],
  });
  p.setState(s);
  writeFileSync(join(p.root, '.orchestra', 'inbox.jsonl'),
    `${JSON.stringify({ ts: '2026-01-01T00:30:00.000Z', task: 'demo/D1', pending: 'q1', answer: '0.75' })}\n`);

  const relayed = p.run('inbox');
  assert.match(relayed, /Ship at 0\.75 or 1\.0\?/);
  assert.match(relayed, /the user's answer: "0\.75"/);
  assert.match(p.run('ready'), /WAITING: 1 item/);
  assert.match(p.run('tick-gate'), /^run/);

  // Stamping the cursor consumes it, and the same commands go quiet.
  const stamped = p.state();
  stamped.conductor.inboxSeen = '2026-01-01T00:30:00.000Z';
  stamped.tasks[0].pending = [];
  p.setState(stamped);
  assert.equal(p.run('inbox'), '');

  // The work lands, and the register empties into the archive while keeping what the guard needs.
  const landed = p.state();
  landed.tasks[0].status = 'landed';
  landed.tasks[0].subjects = ['feat: first thing'];
  p.setState(landed);
  assert.match(p.run('tick-gate'), /^skip nothing to do — 1 row\(s\)/);
  p.run('lock', 'release', '--kind', 'conductor', '--session', 's1');
  assert.match(p.run('archive', '--write'), /moved 1 line\(s\)/);
  assert.deepEqual(p.state().tasks, []);
  assert.equal(p.state().root, p.root);
  assert.match(readFileSync(join(p.root, '.orchestra', 'archive.jsonl'), 'utf8'), /"kind":"task"/);
});

test('two fixtures ticking together never exceed maxWorkers between them', () => {
  mkdirSync(join(process.env.HOME, '.orchestra'), { recursive: true });
  writeFileSync(join(process.env.HOME, '.orchestra', 'machine.json'), '{"maxWorkers":3}\n');

  const a = project('alpha');
  const b = project('beta');

  // A holds two workers: two claimed rows, written here because a claim is a register fact.
  const sa = a.state();
  const seed = sa.tasks[0];
  sa.tasks = [
    { ...seed, id: 'demo/A1', branch: 'a/1', status: 'claimed' },
    { ...seed, id: 'demo/A2', branch: 'a/2', status: 'claimed' },
    { ...seed, id: 'demo/A3', branch: 'a/3', status: 'todo' },
  ];
  a.setState(sa);
  a.run('ready');                      // publishes workers: 2 into the machine registry

  // B, alone, would plan its one task at a width of eight. With A holding two of three, it may not.
  const line = b.run('ready', '--width', '8');
  assert.match(line, /in flight: 0\/1 \(width 8, held down to 1: 2 of 3 worker\(s\) belong to other project\(s\)/);
  assert.match(line, /launch: demo\/D1/);

  // A third worker on A leaves B nothing, and B says so instead of launching anyway.
  const sa2 = a.state();
  sa2.tasks[2].status = 'claimed';
  a.setState(sa2);
  a.run('ready');
  const held = b.run('ready', '--width', '8');
  assert.doesNotMatch(held, /launch:/);
  assert.match(held, /HELD: 1 task\(s\) are ready and this machine has no slot for them — 3 of 3 are held elsewhere/);

  // The registry knows exactly two projects and never more than maxWorkers between them.
  const reg = JSON.parse(readFileSync(join(process.env.HOME, '.orchestra', 'instances.json'), 'utf8'));
  assert.equal(reg.instances.length, 2);
  assert.ok(reg.instances.reduce((n, i) => n + i.workers, 0) <= 3);
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/p2a-acceptance.test.mjs`
Expected: PASS, or a failure naming a real gap.

**Say this in the review rather than letting it pass as a proof:** this suite is written after the
code it exercises, so it is a **pin, not a proof**. Going green on the first run is the expected
outcome and is evidence of composition only. The proofs are the per-task tests, each of which was
watched failing against the code before it existed.

- [ ] **Step 3: Fix whatever it names, then update the README**

Replace `README.md`'s "What works today" section:

```markdown
## What works today

Phase 1 shipped the roadmap layer; phase 2a shipped the register and the machine budget:

- **`/roadmap`** — the skill: the grammar, the board, and the eight roadmap subcommands.
- **`orchestra doctor`** — the resolved configuration, and the only command that answers in a
  project with no config.
- **`orchestra roadmap <lint|board|publish|enrol|claim|release|open|reserve>`**.
- **`orchestra journal|inbox|beat|lock|watch-answers`** — the register: one line with a measured
  clock, the answers a user posted on the page, who holds the baton, and one conductor at a time.
- **`orchestra ready|tick-gate|yield-check`** — the launch plan, whether a heartbeat should tick at
  all, and whether this session should hand the baton back. `ready` budgets its launches against
  every other orchestra on this machine (`~/.orchestra/machine.json`, `maxWorkers`, default 8).
- **`orchestra archive|archive-images`** — move a finished run's prose out of the register, and
  sweep the photographs under `.orchestra/images/` that nothing live still names.

Not yet: the conductor's protocol document and the worker briefs (2b), the merge gate (3), the
monitoring page and `orchestra instances` (4), the guard hooks, `orchestra init`, the ticket queue
and the heartbeat (5), and `roadmap sync`. There is **no launcher**: `ready` produces a plan, and
nothing here spawns a session to execute it. See the spec's phase table (§15).
```

- [ ] **Step 4: Run everything, twice, and check the real home**

Run: `npm test && npm test`, then `ls ~/.orchestra`.
Expected: PASS both times, and the developer's own home unchanged — two suites override `HOME` and
neither may leak.

- [ ] **Step 5: Commit**

```
git add test/p2a-acceptance.test.mjs README.md
git commit -m 'test(p2a): the phase acceptance - one fixture round-trips, two share a budget'
```

---

## Review checklist for the branch review

Beyond the per-task reviews, the branch review answers these, because P1 paid for each of them.

1. **Does any ported comment now say something false?** Every substitution falsifies prose. Grep the
   branch for `tools/orchestra`, `.claude/orchestra`, `monitor/server.mjs`, `monitor/model.mjs`,
   `cron-tick.sh`, `answer-watch.sh`, `ORCHESTRA_MONITOR_REPO` and `retex`, and check each survivor is
   a deliberate historical attribution rather than a leftover.
2. **Is any fact now stated in two places?** The known candidates, all routed here to one source:
   `readState` (state.mjs, never a second local `JSON.parse`), the unconsumed rule (inbox.mjs, read by
   the relay, the watch and the tick gate), `pidAlive` (deliberately duplicated in machine.mjs, with
   the reason written down), `STRUCTURAL` (derived from `emptyState`), the GIT_* scrub (paths.mjs),
   the image path pattern (images.mjs). Look for a sixth — P1 reintroduced one *the commit after* the
   one that closed it.
3. **Was every test watched failing against the old code?** Task 12's was not, and says so. If any
   other was written after its implementation, say so in the review rather than presenting it as a
   proof.
4. **Does the acceptance suite import what its name claims?** Task 12 drives `bin/orchestra`; check
   nothing was quietly swapped for a direct module call to make an assertion pass.
5. **Is anything exported that nothing calls?** Grep each new export for a caller. The deliberate
   absences are `appendAnswer`, `imagesIn`, `registerKey`, `parseOptions`, `splitAsk`, `itemOptions`,
   `unreadAnswers`, `mainCheckoutOf` — none of them should have arrived.
6. **Does `npm test` leave `~/.orchestra` alone?** Two suites override `HOME`. Confirm from a clean
   home that neither leaks.
7. **Is a reviewer's claim verified before it is paid for?** A central P1 finding was refuted by a
   thirty-second measurement. Reproduce before fixing.
