# P3 — The merge gate, driven by `gates`, and the agent that runs it

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A branch lands on a project's main branch through one process that holds a lock from the
rebase to the fast-forward, runs whatever gates the project configured, and leaves its outcome on
disk — so the session that reads the verdict need not be the session that asked for it. And
`agents/merge_agent.md`, the one actor allowed to run it.

**Architecture:** The same split every other subsystem here keeps. `lib/gate/state.mjs` is pure —
the queue record, the lock's turn-taking, the run record, and every decision a landing makes about
paths and cleanup — with no filesystem, no git and no clock in it. `lib/gate/land.mjs` gathers the
facts, runs the effects and decides nothing. `lib/gate/run.mjs` is the `--detach`/`await` pair that
lets a landing outlive its caller. `lib/cli/gate.mjs` wires the three subcommands. The gates
themselves are `cfg.gates` entries, run in the declared order in the rebased worktree; the plugin
never reorders them and never invents one.

**Tech Stack:** ESM, node builtins only (`node:child_process`, `node:fs`, `node:path`, `node:url`),
`node:test` + `node:assert/strict`. No runtime dependencies, as in every phase before this.

**Spec:** `docs/specs/2026-09-02-orchestra-plugin-design.md` — **§5** is this phase (the landing's
shape, `gates`, `skipWhenAllPathsMatch`, the exit-code table), with §2 (the subcommand list and the
`lib/gate/` slot), §3.1 (`gates`, `ledgers`, `queue`, `mainBranch`), §3.2 (runtime state resolves to
the main checkout; the config resolves from the tree you stand in), §4.1 (what `sync` does in each
mode), §10 (the two environment markers the hooks will read), §13 (what is explicitly not portable)
and §15 (the phase table, which sets the acceptance).

**Port source:** `~/Projects/planetCraft/tools/merge-queue.mjs`, `tools/merge-queue-state.mjs`,
`tools/roadmap/sync.mjs`, `tools/roadmap/register.mjs` and `.claude/agents/merge_agent.md`, at
`86bf8412`, the commit the README records the extraction from. **Never write anything under
`~/Projects/planetCraft`** — it is the source, not a workspace.

**Repository state at planning time:** `main` at `afd5246` (`chore(plugin): 0.3.1 — ship the branch
review's corrections`), 261 tests green, no remote, plugin installed at 0.3.1.

## Global Constraints

P1's, P2a's and P2b's, unchanged. Every task's requirements implicitly include this section.

- **Node ≥ 20**, **git ≥ 2.31**.
- **Zero runtime dependencies.** Nothing under `bin/`, `lib/` or `hooks/` may import anything but a
  `node:` builtin or a relative path. `test/no-dependencies.test.mjs` holds it, and this phase adds
  four modules under `lib/`, so it is at real risk here for the first time since P1.
- **ESM only**, `node:test` + `node:assert/strict`.
- **Everything committed is in English** — code, comments, docs, skills, agent definitions, commit
  messages, test names and every string this code prints (spec §2). The deliberate inversion of the
  source project's rule: the plugin is shared, so its own text is English; what it *says to a user
  at runtime* follows `language`, and nothing in this phase says anything to a user in that sense.
- **A rule keeps the measurement that paid for it, with its date.** Never drop a date, a count or a
  duration to shorten a sentence.
- **A measurement is attributed, never implied of the reader.** Name `planetCraft` where the sentence
  recounts a dated event in that repository ("measured 2026-08-13 in planetCraft"); say "the project
  this was extracted from" where the sentence states a general rule.
- **No dead code, no just-in-case code**, and its prose equivalent: no instruction nobody can follow.
  **This repository has no dead-code gate and no linter over prose — the per-task review and the
  branch review are the only filter.**
- **Every subcommand except `doctor` exits 0 and silent when `.orchestra/config.json` is absent**
  (spec §3.1). `land`, `await` and `queue-list` are registered without `machine: true`, so `bin/orchestra`
  gives them that for free — do not re-implement it inside them.
- **Runtime state resolves to the main checkout** (`lib/paths.mjs`), never to the worktree the caller
  is standing in. The gate's own directory is `.orchestra/gate/` under `cfg.root`.
- Commit after every task. Run `npm test` before every commit.

---

## The five scope questions, answered

These were put to this plan explicitly. Each answer is binding; an implementer who thinks one is
wrong should say so in their report rather than quietly do the other thing — five times in P2b an
implementer found the brief wrong and was right to override it, and that is worth more than
obedience. **What is not allowed is doing the other thing silently.**

### 1. `--detach` and `await`, with no daemon

`spawn` with `detached: true` and `child.unref()` is the whole mechanism. There is no daemon, no
supervisor and nothing to install.

**Where the output goes:** the parent opens `.orchestra/gate/logs/<slug>.log` with mode `w`
(truncated, never appended — an agent reading a conflict out of the *previous* attempt would resolve
a conflict that is no longer there) and hands the child that one file descriptor as both stdout and
stderr. The child's own gates inherit it, so a gate's output is in the log without any capture code.

**How `await` collects it:** `.orchestra/gate/runs/<slug>.json` is the run record. The parent writes
it **before** the fork, so an `await` racing the spawn by a millisecond still finds one; the child
stamps its pid, and an `exit` handler stamps the code and the end time. `await` reads the record,
asks `process.kill(pid, 0)` for liveness, and returns one of four verdicts (§ the exit table). On a
finished run it prints the exit code, the queue entry's note — which is where the refusing gate's
name is — and the last 40 lines of the log, because a session that polls a landing has no scrollback
for it.

**Why not simply background the call:** a subagent has no tool with which to wait on a background
job, so its only move is to end its turn, and a subagent that ends its turn is over. The landing then
outlives the only process that knew its exit code. That is not a risk, it is what the source's
`merge_agent` brief carried a section about. `--detach` answers a 600-second tool-call ceiling that
exists in every project, which is why spec §5 keeps the shape rather than treating it as a quirk.

### 2. `ledgers` is empty by default, and the loop that reads it is not dead code

`DEFAULTS.ledgers` is `[]` (`lib/config.mjs:17`) and will stay empty in every project until P5 ships
the ticket queue, which is the first thing that writes a tracked file in the main checkout as a side
effect of *reviewing* rather than of *authoring*.

**So say it, in the code, at the loop:** a project configures `ledgers` when it has a tracked file
the main branch owns and a branch may not carry — and P5's ticket ledger is the first one this
plugin ships. Without that comment the next reader deletes a loop that never runs, and the day P5
lands there is nothing to commit those files and every branch that touches one is refused by the
clash check. That is not hypothetical: it is `t-06gjd4s`, measured 2026-08-19 in planetCraft, where
every branch the fix queue produced was refused for exactly that reason.

**What P3 does NOT do here:** take a cross-process lock around the commit. The source takes the
ticket queue's own lock, because those files have several writers. This plugin has no ticket queue
yet, so there is no lock to take and a lock-shaped no-op would be the just-in-case code the rules
forbid. The comment names it as P5's to add.

### 3. `ORCHESTRA_GATE=1` — set it, and name the phase that reads it

**Set it.** Spec §5 says the gate does, and P2a set the precedent: `lib/store/files.mjs` already
stamps `ORCHESTRA_WRITES_MAIN=1` on its two git write calls, for P5's guard, with no reader today.

Set it, together with `ORCHESTRA_FULL_SUITE=1` (spec §10's override for `guard-full-suite`), in the
environment of the landing process's children — the git calls it makes, and every configured gate.

**And write the honest half beside it, because it is not obvious and P5 will need it:** a PreToolUse
hook fires on the *agent's* Bash command and reads that command's text; it does not inherit this
process's environment. So P5 must decide whether its `guard-main-commit` matches an
`ORCHESTRA_GATE=1` prefix on a command line, reads its own environment, or recognises `orchestra
land` directly — and it must reconcile **two markers for one fact**: `ORCHESTRA_GATE` here and
`ORCHESTRA_WRITES_MAIN` in `lib/store/files.mjs`. Two ways to spell the same fact is how they start
disagreeing. P3 does not rename either — that is P2a's file and P5's decision — it records the
collision where P5 will read it (Task 10's hand-over section).

### 4. `orchestra roadmap sync` is P3's, and it is coherent with §2

Spec §2 lists `sync` among `orchestra roadmap`'s subcommands. Spec §4.1's mode table gives it two
behaviours: online it "closes issues, moves `status:` labels, ticks the programme checklist";
offline it "**does nothing, and that is correct**: there is nowhere to write a status". §15's phase
table assigns it to no phase at all, and `skills/orchestra/SKILL.md` — written by P2b, which had to
name a phase for everything absent — files it under phase 3, online only. Nothing contradicts
anything. **P3 ships it**, in both modes, and the gate calls it after a fast-forward in online mode
only.

It is P3's for a reason beyond bookkeeping: the gate is its primary caller. `sync` closes a task's
issue off the commit subjects the register recorded, and the landing is the one moment both halves
of that fact exist in one process.

### 5. `mainBranch` in `lib/register/ready.mjs` — fixed here, in its own task

`lib/roadmap/board.mjs`'s `gatherGit` takes `cfg.mainBranch`; `lib/register/ready.mjs`'s hardcodes
the literal `main`, in both its branch filter and its `git log`. A project whose main branch is
`master` therefore gets a `ready` set that reconciles nothing, in silence. P2b named the limitation
and deliberately left it: fixing another phase's code inside a documentation phase was the wrong
trade.

**P3 fixes it** (Task 7), and the reason is specific to this phase rather than general tidiness:
until now the defect was latent, because nothing in the plugin could land a branch. P3 ships a gate
that rebases onto `cfg.mainBranch` and fast-forwards it correctly. From the moment it lands, a
project on `master` can land branches that `orchestra ready` will never see as landed — a working
half and a silently broken half, which is worse than two broken halves. **The phase that makes a
latent defect load-bearing is the phase that owes the fix.**

The fix mirrors `board.mjs`'s already-correct shape and is about eight lines. It does **not** touch
`ready.mjs`'s `-200` log window: `board.mjs` deliberately has no window and says why, `ready.mjs`
has one, and reconciling those two is a separate decision with its own reasoning, not a rider on
this one.

---

## What P3 does not do, and why — read this before you "restore" something

Each of these is in the source and is deliberately left behind. Every one of them will look like an
omission to a reader who knows the source, so each is named here with the argument, and the argument
goes into the code as a comment where a reader would otherwise reach for it.

1. **The remote ref deletion.** The source deletes `origin/<branch>` after a landing, under a
   `--force-with-lease` identity check. Spec §5's landing ends at "delete the worktree and the ref",
   singular and local. A push to origin is an outward-facing action that no key in
   `.orchestra/config.json` authorises, and in a shared repository that ref may be another
   developer's only copy. Not ported. A project that wants its remote refs tidied does it itself.

2. **The `rerere.enabled` refusal.** git's rerere cache lives in the common git dir and is shared by
   every worktree, so a trial resolution made in one tree replays silently in another — a real
   hazard for a queue that rebases branches all day, measured 2026-09-01 in planetCraft (73 cached
   entries; `t-11j0zry` nearly landed an unmade merge decision). It is not ported as a **refusal**,
   because refusing every landing in a project whose owner deliberately enabled rerere is enforcing
   somebody else's ruling. The hazard belongs in P5's `templates/CLAUDE-rules.md` and in `doctor`,
   not in a gate that stops work. Recorded in the hand-over.

3. **The `node_modules` precondition.** The source refuses to run the suite in a worktree with no
   dependencies installed, because the failure that follows is not the branch's. The check is `npm`'s
   shape and this plugin does not know what "equipped" means in a Rust, Python or Go project. Not
   ported. What replaces it is honesty about the verdict: exit 11 names **which gate** refused, so a
   reader is not left to guess whether the suite failed on the code or on the tree.

4. **`drop`.** Spec §2's subcommand list has `land`, `await` and `queue-list` and no fourth verb.
   Instead, `queue-list` **reaps every entry whose branch ref no longer exists** — the same liveness
   argument the pid-held lock already makes, one git call, and no verb for a human to remember. An
   entry for a branch that still exists is never reaped: that is the durable record's whole job.

5. **The visual gate.** Spec §13: a project instrument. `skipWhenAllPathsMatch` is the portable form
   of its `touchesRender` predicate, and the visual gate survives only as an example `gates` entry in
   the README.

6. **`PC_MERGE_QUEUE_DIR`.** The source needs an environment override to point the queue at a scratch
   directory under test. Here every suite builds a whole throwaway repository, so `.orchestra/gate/`
   inside it is already isolated. An override with one caller — the tests — is one more code path to
   keep honest for nothing.

7. **The stale-claim sweep in `sync`.** The source's `planSync` also reports claims older than 24
   hours, off issue comment stamps. `skills/orchestra/SKILL.md` promises `sync` four things and that
   is not one of them; `lib/store/github/gh.mjs`'s `listComments` has no caller and gains none here.
   Not ported.

---

## Known divergences you will meet, and what to write

**Describe the code. Where the spec and the code disagree, the code is what a person will run.**

1. **The gate list is read from the REBASED WORKTREE's own config; everything else comes from the
   invoking config.** Spec §3.2 states the consequence as a feature — "a branch can change a gate and
   have that gate apply to its own landing" — and it is the same reasoning that makes the gates run
   in the worktree at all: the rules that ship with the code are the rules that judge it. The split
   is deliberate and one-directional: `mainBranch`, `ledgers`, `queue` and `mode` are read from the
   invoking config, because they are facts about the project rather than about the branch, and
   because a branch that could add a path to `ledgers` could make the gate commit that path onto main.

2. **`EXIT` has no 14.** Spec §5 folds "dead code" into "a gate refused", because `merge_agent`'s
   action is identical and the gate's name now travels in the outcome. The hole is left unfilled on
   purpose: a reader holding the source's brief must not meet 14 here meaning something else.

3. **A refusal's evidence is the log, not a captured buffer.** The source captures knip's output and
   inherits the suite's. Here every gate inherits, because a detached landing's stdio is already the
   log file and `await` tails it. What must never be lost is the gate's **name**, and that travels in
   three places: the line `land` prints, the queue entry's `note`, and `await`'s own report.

4. **The register's `roadmap` field is a slug, not a path** (spec §4.4). Nothing in this phase reads
   it, but `recordLanding` writes a row and a reviewer will look.

5. **`orchestra ready`'s `-200` log window stays.** See scope answer 5.

6. **`store.close(key, { subject })` and `store.setStatus(key, status)` still have no caller after
   this phase.** They are spec §4.1's declared interface, shipped by P1. `sync` does not use them:
   `setStatus` only ever *adds* a label and so cannot strip a stale one, which is half of what "move
   every `status:` label onto what the board derives" means. Do not delete them and do not route
   `sync` through them — raise it in the branch review instead, where the whole interface can be
   judged at once.

---

## The acceptance

Spec §15's P3 row: **"a branch lands in the fixture with two fake gates; the red one returns 11
naming itself."**

`test/p3-acceptance.test.mjs`, driven through `bin/orchestra` so that what is asserted is what a
person can type. It is written in Task 3, **before** `lib/gate/land.mjs` exists, and watched failing.
Task 4 adds the detached half to the same file.

| # | Assertion | Task |
|---|---|---|
| 1 | a branch with two green gates lands: exit 0, both gate names printed in order, the commit is on `mainBranch`, the worktree and the ref are gone | 3 |
| 2 | the red gate returns **11**, its **name** is in the output, `mainBranch` did not move, the branch and its worktree survive | 3 |
| 3 | a gate whose `skipWhenAllPathsMatch` covers every changed path is skipped and says so; one uncovered path runs it | 3 |
| 4 | a second `land` on a held branch is refused by the lock, not by running twice | 3 |
| 5 | `land --detach` returns **15** at once and `await` returns the real code plus the gate's name | 4 |
| 6 | `await` on a branch with no record returns **1** and names the command to start one | 4 |
| 7 | `queue-list` prints the held entry with its note, and reaps an entry whose branch is gone | 4 |

**Say this in the review rather than letting it pass for more than it is:** the suite proves the
landing composes and that the refusal is legible. It cannot prove the lock is correct under real
contention — two processes racing for a turn is not something a single-process test observes. The
turn-taking is proved instead by `mayTake`'s own unit tests (Task 1), where a process can be killed
on paper.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/gate/state.mjs` (new) | Every decision, pure: the queue record, the lock's turn-taking, `EXIT`, the run record and its verdict, path decisions (ledgers, clashes, skip globs), the cleanup decision |
| `lib/gate/land.mjs` (new) | The landing: lock, ledgers, rebase, gates, fast-forward, cleanup. Effects only |
| `lib/gate/run.mjs` (new) | `--detach` and `await`: the durable run record's two halves, and `queue-list` |
| `lib/cli/gate.mjs` (new) | `land`, `await`, `queue-list` — argument parsing and exit codes |
| `lib/store/github/sync.mjs` (new) | The sync plan, pure, and its application through `gh` |
| `bin/orchestra` (modify) | Register the three gate subcommands |
| `lib/store/github/index.mjs` (modify) | `sync(rows)` |
| `lib/store/files.mjs` (modify) | `sync()` — the honest no-op |
| `lib/cli/roadmap.mjs` (modify) | `case 'sync'` |
| `lib/roadmap/board.mjs` (modify) | Each row carries `subjects` and `landedHere` |
| `lib/register/state.mjs` (modify) | `recordLanding`, pure |
| `lib/register/ready.mjs` (modify) | `gatherGit` honours `mainBranch` |
| `lib/cli/tick.mjs` (modify) | Pass `cfg.mainBranch` to it |
| `agents/merge_agent.md` (new) | The agent, its exit table, and how it resolves a conflict |
| `skills/orchestra/SKILL.md` (modify) | Every "phase 3" it names is now here |
| `.claude-plugin/plugin.json`, `README.md` (modify) | 0.4.0, and what a user can type today |

---

### Task 1: `lib/gate/state.mjs` — the lock, the queue record, and the exit codes

**Files:**
- Create: `lib/gate/state.mjs`
- Create: `test/gate-state.test.mjs`
- Source: `~/Projects/planetCraft/tools/merge-queue-state.mjs` lines 1–110 and its `EXIT` block

**Interfaces:**
- Consumes: nothing. This module imports nothing at all — that is the point of it.
- Produces: `EMPTY`, `STATES`, `parseState(text)`, `formatState(state)`, `findEntry(state, branch)`,
  `upsertEntry(state, {branch, worktree, at}) -> {state, entry}`, `setEntryState(state, branch, next, note)`,
  `dropEntry(state, branch)`, `dropVanished(state, refExists)`,
  `parseWaiters(text)`, `formatWaiters(list)`, `parseHolder(text)`, `formatHolder(holder)`,
  `reapWaiters(list, isAlive)`, `reapHolder(holder, isAlive)`,
  `mayTake({holder, waiters, pid}) -> {ok, reason?, ahead}`, `EXIT`.

**Why this first.** Every later task branches on `EXIT` and every one of them writes or reads the
queue record. Nothing here touches a filesystem, so all of it is decidable in a test — including the
two things a live test can never observe, which are a dead process and a tie in the turn order.

- [ ] **Step 1: Write the failing tests**

Create `test/gate-state.test.mjs`:

```js
// The gate's decisions, tested where they are decidable: no repository, no processes, no clock.
// Liveness is injected, so a process can be killed on paper — which is the only way the turn order
// and the reaping are testable at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../lib/gate/state.mjs';

test('an unreadable queue record reads as empty, never as a crash', () => {
  // A truncated or hand-edited file must not wedge every landing on this machine: the record is a
  // convenience, the lock is what protects the main branch.
  assert.deepEqual(S.parseState('{ not json'), S.EMPTY);
  assert.deepEqual(S.parseState(''), S.EMPTY);
  assert.deepEqual(S.parseState('{"entries":"nope"}'), S.EMPTY);
  // An entry with no branch is not an entry.
  assert.equal(S.parseState('{"entries":[{"branch":"a"},{"note":"x"}]}').entries.length, 1);
});

test('upsert keeps enqueuedAt across a second land of the same branch', () => {
  // `land` runs more than once for one branch by design: exit 10 sends the agent away to resolve a
  // conflict and it comes back. `queue-list` shows how long a branch has really been trying.
  const one = S.upsertEntry(S.EMPTY, { branch: 'a', worktree: '/w/a', at: 100 }).state;
  const two = S.upsertEntry(one, { branch: 'a', worktree: '/w/a2', at: 900 }).state;
  assert.equal(two.entries.length, 1);
  assert.equal(two.entries[0].enqueuedAt, 100);
  assert.equal(two.entries[0].worktree, '/w/a2');
  assert.equal(two.entries[0].state, 'queued');
});

test('an unknown entry state throws instead of being written', () => {
  const s = S.upsertEntry(S.EMPTY, { branch: 'a', worktree: '/w', at: 1 }).state;
  assert.throws(() => S.setEntryState(s, 'a', 'wibble'), /unknown entry state/);
  assert.equal(S.setEntryState(s, 'a', 'held', 'gate "suite" refused').entries[0].note,
    'gate "suite" refused');
});

test('queue-list reaps an entry whose branch ref is gone, and keeps one that exists', () => {
  // The same liveness argument the pid-held lock makes, and the reason there is no `drop` verb.
  let s = S.upsertEntry(S.EMPTY, { branch: 'gone', worktree: '/w/1', at: 1 }).state;
  s = S.upsertEntry(s, { branch: 'here', worktree: '/w/2', at: 2 }).state;
  const reaped = S.dropVanished(s, (b) => b === 'here');
  assert.deepEqual(reaped.entries.map((e) => e.branch), ['here']);
});

test('a waiter line with pid 0 is dropped rather than read', () => {
  // `process.kill(0, 0)` targets the process GROUP and always succeeds, so a malformed line read as
  // pid 0 would be alive for ever and hold the queue shut.
  const list = S.parseWaiters('0|a|10\n7|b|11\nrubbish\n');
  assert.deepEqual(list, [{ pid: 7, branch: 'b', epoch: 11 }]);
  assert.equal(S.formatWaiters(list), '7|b|11\n');
  assert.equal(S.formatWaiters([]), '');
});

test('reaping is by injected liveness, in both directions', () => {
  const list = [{ pid: 1, branch: 'a', epoch: 1 }, { pid: 2, branch: 'b', epoch: 2 }];
  assert.deepEqual(S.reapWaiters(list, (p) => p === 2), [list[1]]);
  assert.equal(S.reapHolder(list[0], () => false), null);
  assert.equal(S.reapHolder(list[0], () => true), list[0]);
  assert.equal(S.reapHolder(null, () => true), null);
});

test('a holder blocks everyone, and the turn is decided among live waiters', () => {
  const holder = { pid: 9, branch: 'x', epoch: 1 };
  assert.deepEqual(S.mayTake({ holder, waiters: [], pid: 3 }),
    { ok: false, reason: 'landing x', ahead: 1 });
  const waiters = [{ pid: 3, branch: 'a', epoch: 20 }, { pid: 4, branch: 'b', epoch: 10 }];
  assert.equal(S.mayTake({ holder: null, waiters, pid: 4 }).ok, true);
  assert.deepEqual(S.mayTake({ holder: null, waiters, pid: 3 }),
    { ok: false, reason: '1 ahead', ahead: 1 });
  assert.equal(S.mayTake({ holder: null, waiters, pid: 99 }).reason, 'not registered as a waiter');
});

test('two land calls in the same second are broken by pid, never both at the head', () => {
  // Epochs are seconds, so a tie is ordinary. Without the tiebreak both read themselves as the head
  // and two landings run at once, which is the entire bug this queue exists to prevent.
  const waiters = [{ pid: 8, branch: 'a', epoch: 5 }, { pid: 3, branch: 'b', epoch: 5 }];
  assert.equal(S.mayTake({ holder: null, waiters, pid: 3 }).ok, true);
  assert.equal(S.mayTake({ holder: null, waiters, pid: 8 }).ok, false);
});

test('the exit table is the interface merge_agent branches on, and it has no 14', () => {
  assert.deepEqual(S.EXIT, {
    ok: 0, usage: 1, conflict: 10, refused: 11, busy: 12, precondition: 13, started: 15, vanished: 16,
  });
});
```

- [ ] **Step 2: Run them and watch every one fail**

Run: `node --test test/gate-state.test.mjs`
Expected: FAIL, `Cannot find module '../lib/gate/state.mjs'` on every test. **Paste the failing
output into your report.** A test written after the code passes on both sides and proves nothing.

- [ ] **Step 3: Write `lib/gate/state.mjs`**

```js
// The gate's decisions, with no filesystem, no git and no clock. `lib/gate/land.mjs` gathers the
// facts and this decides — the same split `lib/register/ready.mjs` keeps from `lib/cli/tick.mjs`,
// and for the same reason: a decision that needs a repository to be tested is a decision nobody
// tests.
//
// Ported from planetCraft's `tools/merge-queue-state.mjs` at 86bf8412. What was deliberately left
// behind, and the argument for each, is in `docs/plans/2026-09-03-p3-merge-gate.md`.

// The durable record. It remembers the one thing no process can: a branch left `blocked` by a
// conflict is waiting for its agent to come back, and that outlives every pid involved.
export const EMPTY = { version: 1, entries: [] };

// `landing` is what HOLDING the lock looks like; `queued` is asking for it. `blocked` and `held`
// are the two ways a landing stops without the main branch moving.
export const STATES = ['queued', 'landing', 'blocked', 'held'];

// Unreadable means "no record", never a crash. A truncated or hand-edited file must not wedge every
// landing on this machine — the record is a convenience, the lock is what protects the main branch.
export function parseState(text) {
  try {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.entries)) return { ...EMPTY };
    return { version: 1, entries: data.entries.filter((e) => e && typeof e.branch === 'string') };
  } catch {
    return { ...EMPTY };
  }
}

export const formatState = (state) => `${JSON.stringify(state, null, 2)}\n`;

export const findEntry = (state, branch) => state.entries.find((e) => e.branch === branch) ?? null;

// An upsert, not an append: `land` runs more than once for one branch by design — exit 10 sends the
// agent away to resolve a conflict and it comes back. `enqueuedAt` survives that round trip, which
// is what makes `queue-list` show how long a branch has really been trying to land.
export function upsertEntry(state, { branch, worktree, at }) {
  const existing = findEntry(state, branch);
  const entry = existing
    ? { ...existing, worktree, state: 'queued', note: '' }
    : { branch, worktree, enqueuedAt: at, state: 'queued', note: '' };
  return {
    state: {
      ...state,
      entries: existing
        ? state.entries.map((e) => (e.branch === branch ? entry : e))
        : [...state.entries, entry],
    },
    entry,
  };
}

export function setEntryState(state, branch, next, note = '') {
  // Throw rather than write a state no reader handles: the record is read back by `queue-list` and
  // by the next `land`, so an unknown value would surface far from here.
  if (!STATES.includes(next)) throw new Error(`orchestra gate: unknown entry state '${next}'`);
  return {
    ...state,
    entries: state.entries.map((e) => (e.branch === branch ? { ...e, state: next, note } : e)),
  };
}

export const dropEntry = (state, branch) => ({
  ...state,
  entries: state.entries.filter((e) => e.branch !== branch),
});

// An entry whose branch ref is gone is finished with, whatever it says: it landed, or somebody
// deleted the branch. This is what replaces the source's `drop` verb — spec §2's subcommand list has
// no fourth verb, and the same liveness argument the pid-held lock already makes answers it without
// one. An entry whose branch still EXISTS is never reaped: remembering a branch blocked by a
// conflict, across every process involved, is the durable record's whole job.
export const dropVanished = (state, refExists) => ({
  ...state,
  entries: state.entries.filter((e) => refExists(e.branch)),
});

// `pid|branch|epoch` per line. A pid on this host is a liveness answer that needs no timeout, and a
// lease's expiry would have to be longer than a project's slowest gate to be safe, which is far too
// long to unwedge a crashed landing.
export function parseWaiters(text) {
  return String(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid, branch, epoch] = line.split('|');
      return { pid: Number(pid), branch, epoch: Number(epoch) };
    })
    // pid 0 is why this filter is not cosmetic: `process.kill(0, 0)` targets the process GROUP and
    // always succeeds, so a malformed line read as pid 0 would be alive for ever and hold the queue
    // shut.
    .filter((x) => Number.isInteger(x.pid) && x.pid > 0 && x.branch && Number.isFinite(x.epoch));
}

export const formatWaiters = (list) =>
  list.map((x) => `${x.pid}|${x.branch}|${x.epoch}`).join('\n') + (list.length ? '\n' : '');

export const parseHolder = (text) => parseWaiters(text)[0] ?? null;
export const formatHolder = (holder) => (holder ? formatWaiters([holder]) : '');

// Liveness is INJECTED, which is what keeps this decidable in a test: a process can be killed on
// paper. The caller passes a predicate built on `process.kill(pid, 0)`.
export const reapWaiters = (list, isAlive) => list.filter((x) => isAlive(x.pid));
export const reapHolder = (holder, isAlive) => (holder && isAlive(holder.pid) ? holder : null);

// The turn is decided among LIVE waiters, never by the durable record's order. If the record gated
// it, an entry whose agent session died would sit at the head for ever and block every other branch
// — exactly the staleness a process-held lock exists to avoid.
//
// Both inputs must already be reaped; this function has no opinion about liveness.
export function mayTake({ holder, waiters, pid }) {
  if (holder) return { ok: false, reason: `landing ${holder.branch}`, ahead: 1 };
  // A total order, not just a sort by time: epochs are seconds, so two `land` calls in the same
  // second is ordinary. Without the pid tiebreak both read themselves as the head and two landings
  // run at once, which is the entire bug this queue exists to prevent.
  const queue = [...waiters].sort((a, b) => a.epoch - b.epoch || a.pid - b.pid);
  const at = queue.findIndex((x) => x.pid === pid);
  if (at === -1) return { ok: false, reason: 'not registered as a waiter', ahead: queue.length };
  if (at > 0) return { ok: false, reason: `${at} ahead`, ahead: at };
  return { ok: true, ahead: 0 };
}

// The gate's whole interface with `merge_agent`: a number, because the agent has to branch on it.
// Each one names an actor — 10 is the only outcome that needs a judgement a script cannot make,
// which is why it is the only one that hands control back.
//
// THERE IS NO 14, AND THE HOLE IS DELIBERATE. The project this was extracted from distinguishes
// "dead code" (14) from "a test failed" (11); spec §5 folds them, because `merge_agent`'s action is
// identical in both cases — stop and report — and the REFUSING GATE'S NAME now travels in the
// outcome, which is strictly more information than a second number was. The number is left unused
// rather than recycled: a reader holding the source's brief must not meet 14 here meaning something
// else.
export const EXIT = {
  ok: 0,
  usage: 1,
  conflict: 10,
  refused: 11,
  busy: 12,
  precondition: 13,
  // A detached landing was started and is now running without us — the caller's next move is
  // `await`, not a second `land`.
  started: 15,
  // The detached process is gone and recorded no outcome. Not the same as `busy` (still going) and
  // not the same as an exit code (it finished): nobody knows how far it got.
  vanished: 16,
};
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/gate-state.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS. Record the new total in your report.

- [ ] **Step 6: Commit**

Stage `lib/gate/state.mjs` and `test/gate-state.test.mjs`, message:
`feat(gate): the lock's turn order, the queue record, and an exit table with no 14`

---

### Task 2: `lib/gate/state.mjs` — the landing's own decisions

**Files:**
- Modify: `lib/gate/state.mjs` (append)
- Modify: `test/gate-state.test.mjs` (append)
- Source: `~/Projects/planetCraft/tools/merge-queue-state.mjs`: `ledgerPathsToCommit`,
  `clashingPaths`, `touchesRender`, `cleanupAfterLanding`, `parseRun`, `runVerdict`, `runSlug`

**Interfaces:**
- Consumes: Task 1's `EXIT`.
- Produces: `ledgerPathsToCommit(dirty, ledgers)`, `clashingPaths(dirty, changed)`,
  `globToRegExp(glob) -> RegExp`, `gateSkipped(gate, changed) -> boolean`,
  `cleanupAfterLanding({branch, worktree, hasUncommittedTracked, untrackedFiles, removeWorktree, deleteBranch, provenMerged, unsetUpstream}) -> string[]`,
  `parseRun(text)`, `formatRun(run)`, `runVerdict({run, alive, nowSec}) -> {state, exit, elapsed?}`,
  `runSlug(branch)`.

**Why now.** These are the four questions a landing asks that a test can answer without a
repository: which of the main checkout's dirty files the gate owns, which of them a fast-forward
could actually harm, whether a gate's diff makes it inert, and what a cleanup should attempt.
Getting them wrong is how the source lost two merged branches as dead refs on 2026-08-19.

- [ ] **Step 1: Write the failing tests**

Append to `test/gate-state.test.mjs`:

```js
test('only the configured ledger paths are committed, and they are sorted', () => {
  // An ALLOWLIST of exact paths, never a pattern: the exemption exists because these are files the
  // gate itself may commit, and "any .jsonl" would quietly extend that claim to a data file a
  // branch is genuinely authoring.
  const dirty = ['src/a.js', '.orchestra/tickets.jsonl', 'docs/notes.jsonl'];
  assert.deepEqual(S.ledgerPathsToCommit(dirty, ['.orchestra/tickets.jsonl', 'docs/notes.jsonl']),
    ['.orchestra/tickets.jsonl', 'docs/notes.jsonl']);
  assert.deepEqual(S.ledgerPathsToCommit(dirty, []), []);
});

test('only a dirty file the branch also changes can clash', () => {
  // The only thing a landing does to the main working tree is `merge --ff-only`, which writes
  // exactly the paths the branch changed. A dirty tracked file outside that set cannot be touched.
  assert.deepEqual(S.clashingPaths(['a', 'b', 'c'], ['c', 'a']), ['a', 'c']);
  assert.deepEqual(S.clashingPaths(['a'], ['b']), []);
});

test('a glob matches within a segment, and ** spans segments including none', () => {
  const m = (g, p) => S.globToRegExp(g).test(p);
  assert.equal(m('docs/**', 'docs/a.md'), true);
  assert.equal(m('docs/**', 'docs/x/y/z.md'), true);
  assert.equal(m('docs/**', 'src/a.md'), false);
  assert.equal(m('**/*.md', 'README.md'), true);           // ** matches ZERO directories
  assert.equal(m('**/*.md', 'docs/x/a.md'), true);
  assert.equal(m('**/*.md', 'docs/a.txt'), false);
  assert.equal(m('tests/*.js', 'tests/a.js'), true);
  assert.equal(m('tests/*.js', 'tests/deep/a.js'), false); // * never crosses a slash
  assert.equal(m('package.json', 'package.json'), true);
  assert.equal(m('package.json', 'packageXjson'), false);  // the dot is a literal, not "any char"
});

test('a gate is skipped only when EVERY changed path matches, and never on doubt', () => {
  const gate = { name: 'visual', cmd: 'x', skipWhenAllPathsMatch: ['docs/**', '**/*.md'] };
  assert.equal(S.gateSkipped(gate, ['docs/a.md', 'README.md']), true);
  assert.equal(S.gateSkipped(gate, ['docs/a.md', 'src/x.js']), false);
  // Deliberately wrong in one direction: an unreadable diff and an empty one both RUN the gate. A
  // needless run costs minutes; a missed run lets through the defect the gate exists to catch.
  assert.equal(S.gateSkipped(gate, null), false);
  assert.equal(S.gateSkipped(gate, []), false);
  // A gate that declares no globs is never skipped.
  assert.equal(S.gateSkipped({ name: 'suite', cmd: 'x' }, ['docs/a.md']), false);
});

test('the worktree and the branch are two independent cleanups', () => {
  // They used to be one if/else chain, so any failure on the worktree side meant `branch -d` was
  // never ATTEMPTED and the merged branch survived as a dead ref — twice in a row on 2026-08-19 in
  // planetCraft, both deleted by hand afterwards.
  const calls = [];
  const notes = S.cleanupAfterLanding({
    branch: 'b', worktree: '/w',
    hasUncommittedTracked: () => false,
    untrackedFiles: () => ['scratch.txt'],
    removeWorktree: () => { calls.push('rm'); return false; },
    deleteBranch: () => { calls.push('del'); return true; },
    provenMerged: () => true,
    unsetUpstream: () => true,
  });
  assert.deepEqual(calls, ['rm', 'del']);
  assert.match(notes[0], /worktree \/w kept .*scratch\.txt/);
});

test('a pinned upstream is proven past, never forced past', () => {
  // The gate rebases, which re-hashes every commit, so `git branch -d` refuses a branch that IS the
  // main branch, testing it against its UPSTREAM instead of HEAD. The answer is not -D: it is to
  // prove what -D would assume, then ask the same lowercase -d again.
  const calls = [];
  let unpinned = false;
  const notes = S.cleanupAfterLanding({
    branch: 'b', worktree: '/w',
    hasUncommittedTracked: () => false,
    untrackedFiles: () => [],
    removeWorktree: () => true,
    deleteBranch: () => { calls.push('del'); return unpinned; },
    provenMerged: () => true,
    unsetUpstream: () => { unpinned = true; calls.push('unpin'); return true; },
  });
  assert.deepEqual(calls, ['del', 'unpin', 'del']);
  assert.deepEqual(notes, []);
});

test('a branch that is not the main branch tip is reported, not forced', () => {
  const notes = S.cleanupAfterLanding({
    branch: 'b', worktree: '/w',
    hasUncommittedTracked: () => false,
    untrackedFiles: () => [],
    removeWorktree: () => true,
    deleteBranch: () => false,
    provenMerged: () => false,
    unsetUpstream: () => true,
  });
  assert.match(notes[0], /refused 'branch -d b' and it is not the main branch's tip/);
});

test('the recorded exit wins over liveness in both directions', () => {
  // A finished run whose pid has been recycled onto another process must not read as alive, and one
  // that recorded its code microseconds before dying must not read as vanished.
  const run = { branch: 'b', pid: 5, startedAt: 100, log: '/l', exit: 11, endedAt: 160 };
  assert.deepEqual(S.runVerdict({ run, alive: true, nowSec: 900 }),
    { state: 'finished', exit: 11, elapsed: 60 });
  assert.deepEqual(S.runVerdict({ run: { ...run, exit: null, endedAt: null }, alive: false, nowSec: 200 }),
    { state: 'vanished', exit: S.EXIT.vanished, elapsed: 100 });
  assert.deepEqual(S.runVerdict({ run: { ...run, exit: null, endedAt: null }, alive: true, nowSec: 200 }),
    { state: 'running', exit: S.EXIT.busy, elapsed: 100 });
  assert.deepEqual(S.runVerdict({ run: null, alive: false, nowSec: 1 }),
    { state: 'unknown', exit: S.EXIT.usage });
  assert.equal(S.parseRun('{ broken'), null);
  assert.equal(S.parseRun('{"pid":1}'), null);
});

test('a run file is named so a human can recognise the branch in an ls', () => {
  assert.equal(S.runSlug('feat/a b'), 'feat_a_b');
  assert.equal(S.runSlug('demo/d1-first'), 'demo_d1-first');
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/gate-state.test.mjs`
Expected: FAIL — `S.ledgerPathsToCommit is not a function` and the rest. Paste the output.

- [ ] **Step 3: Append the implementation to `lib/gate/state.mjs`**

```js
// Which of the main checkout's dirty tracked files the gate owns and commits itself, before it asks
// what would clash. `ledgers` is the project's own list from `.orchestra/config.json`.
//
// An ALLOWLIST of exact paths, never a pattern: the exemption exists because these are bookkeeping
// files the gate itself may commit, and "any .jsonl" or "anything under reports/" would quietly
// extend that claim to a data file a branch is genuinely authoring. Sorted, so the line a person
// reads is the same between two runs.
export const ledgerPathsToCommit = (dirty, ledgers) =>
  dirty.filter((p) => ledgers.includes(p)).sort();

// Which uncommitted files a landing could actually harm, in the main checkout.
//
// The only thing a landing does to the main working tree is `git merge --ff-only`, and a
// fast-forward writes exactly the paths the branch changed. So a dirty tracked file OUTSIDE that set
// cannot be touched, and one INSIDE it is refused by git itself, loudly, naming the file.
//
// Refusing on ANY dirty tracked file is not merely over-cautious, it is unworkable: a checkout that
// keeps a settings file or a ledger permanently modified would have EVERY landing refused, and the
// way past that is to mask them with `skip-worktree` and hope nothing kills the process between
// setting the flag and clearing it. A forgotten skip-worktree makes git ignore every later change to
// those files, in silence.
//
// Paths, not a count: "commit or stash them" sends a reader to files they are keeping dirty on
// purpose, while the names say which two actually collide.
export const clashingPaths = (dirty, changed) => {
  const set = new Set(changed);
  return dirty.filter((p) => set.has(p)).sort();
};

// One glob into one RegExp, segment by segment. `**`, `*` and literals — spec §5's whole grammar,
// implemented here because the plugin takes no dependency.
//
// Scanned rather than chained `String.replace`: a replacement's own output contains `*` and `/`, so
// a second pass would rewrite what the first pass just produced. That is the classic silent bug in a
// hand-written glob, and it produces a matcher that is wrong only on the patterns people write.
export function globToRegExp(glob) {
  const parts = String(glob).split('/');
  let out = '';
  parts.forEach((seg, i) => {
    if (seg === '**') {
      // `**` as a whole segment matches zero or more segments, so `docs/**` matches `docs/a.md` and
      // `**/*.md` matches `a.md` at the root. Consuming the separator HERE is what makes "zero"
      // possible: a `/` written between two segments could never be optional.
      out += i === parts.length - 1 ? '(?:.*)?' : '(?:[^/]*/)*';
      return;
    }
    out += seg.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '*' ? '[^/]*' : `\\${c}`));
    if (i < parts.length - 1) out += '/';
  });
  return new RegExp(`^${out}$`);
}

// The portable form of a project instrument's "could this branch have moved a pixel". A gate is
// skipped ONLY when every changed path matches one of its globs.
//
// DELIBERATELY WRONG IN ONE DIRECTION. An unreadable diff, an empty diff, or a path shape nobody has
// thought about runs the gate. A needless run costs minutes; a missed run lets through the defect
// the gate exists to catch — in the project this was extracted from, that stage is what found a
// scene photographing an entirely black frame, which every unit test had passed over for six days.
export function gateSkipped(gate, changed) {
  const globs = gate?.skipWhenAllPathsMatch;
  if (!Array.isArray(globs) || globs.length === 0) return false;
  if (!changed || changed.length === 0) return false;
  const res = globs.map(globToRegExp);
  return changed.every((p) => res.some((re) => re.test(p)));
}

// The last thing a landing does. The worktree and the branch are two INDEPENDENT cleanups and are
// asked as two: they used to be a single if/else-if chain, so any failure on the worktree side meant
// `branch -d` was never ATTEMPTED at all and the merged branch survived as a dead ref — observed
// twice in a row on 2026-08-19 in planetCraft, both deleted by hand afterwards. What gates deleting
// anything is the ancestry check the caller runs before this; the state of a directory is not. Every
// git call is injected for the same reason `reapWaiters` takes `isAlive`: the decision is WHICH
// CALLS HAPPEN, not just what gets printed.
//
// THE WORKTREE: TRACKED-DIRTY IS THE ONLY STATE THIS PRE-EMPTS, AND THE REMOVAL IS NEVER FORCED.
// What a landing can silently destroy is an uncommitted change to a file the main branch already
// has. Anything else git decides, and it decides loudly. Measured on git 2.52.0, 2026-08-31, in
// scratch repositories: an ignored directory does NOT make `git worktree remove` fail, and an
// untracked non-ignored file DOES — exit 128, with NOTHING removed, so there is no half-state left
// to repair either. The only thing forcing would destroy is a file that is untracked, not ignored,
// and by construction not on the main branch: far likelier to be work its author never committed
// than a stray artefact. The worktree is kept and the note NAMES the files.
//
// THE BRANCH: A PINNED UPSTREAM IS PROVEN PAST, NEVER FORCED PAST. When a branch was pushed,
// `branch.<name>.merge` is set and `git branch -d` tests "fully merged into its UPSTREAM", not into
// HEAD. The gate rebases, which re-hashes every commit, so git refuses a branch that IS the main
// branch. The answer is NOT -D: `provenMerged` is the caller's evidence that the branch tip is
// byte-identical to the main branch's AND an ancestor of it, and only then is the upstream unpinned
// and the SAME lowercase -d asked again. There is no force-delete in this function's interface at
// all, so it cannot escalate even by mistake.
export function cleanupAfterLanding({
  branch, worktree, hasUncommittedTracked, untrackedFiles,
  removeWorktree, deleteBranch, provenMerged, unsetUpstream,
}) {
  const notes = [];
  const kept = hasUncommittedTracked() ? 'it holds uncommitted changes to tracked files'
    : removeWorktree() ? null
      : `git will not delete its untracked files (${untrackedFiles().join(', ') || 'none reported'})`;
  if (kept) notes.push(`worktree ${worktree} kept — ${kept}, remove it by hand`);

  // A branch still checked out in a surviving worktree is refused for that reason and no other, so
  // name it instead of sending a reader to investigate what the line above just explained.
  if (deleteBranch()) return notes;
  if (kept) { notes.push(`branch '${branch}' kept — still checked out in ${worktree}`); return notes; }
  // A failing --unset-upstream here means there was none to unset: the branch exists (we just asked
  // git to delete it) and it is the main branch's tip, so no upstream is the only way left for -d to
  // have refused — and that is a genuine thing to look into.
  const why = !provenMerged() ? "and it is not the main branch's tip"
    : !unsetUpstream() ? 'and it has no upstream to unpin'
      : deleteBranch() ? null
        : 'even with its upstream unpinned';
  if (why) notes.push(`git refused 'branch -d ${branch}' ${why} — kept, investigate`);
  return notes;
}

// The record of ONE detached landing: written by the parent before it forks, completed by the
// child's exit handler. It exists because a landing outlives the agent that asked for it — a gate
// that runs a whole test suite is minutes, against the 600-second ceiling of an agent's Bash call —
// so the honest shape is a process the caller can leave and come back to. Anything unparseable reads
// as "no record", for `parseState`'s reason.
export function parseRun(text) {
  try {
    const run = JSON.parse(text);
    if (!run || typeof run.branch !== 'string') return null;
    return run;
  } catch {
    return null;
  }
}

export const formatRun = (run) => `${JSON.stringify(run, null, 2)}\n`;

// What `await` concludes, from the run record and one pid liveness check. The two can disagree, and
// each disagreement is a different instruction to the caller — which is the whole point of separating
// them: an agent that reads "still running" waits, one that reads "vanished" starts over, and before
// this existed both looked identical (a Bash call that returned nothing).
export function runVerdict({ run, alive, nowSec }) {
  if (!run) return { state: 'unknown', exit: EXIT.usage };
  // The recorded exit wins over liveness in BOTH directions: a finished run whose pid has been
  // recycled onto another process must not read as alive, and one that recorded its code
  // microseconds before dying must not read as vanished.
  if (typeof run.exit === 'number') {
    return { state: 'finished', exit: run.exit, elapsed: (run.endedAt ?? nowSec) - run.startedAt };
  }
  if (!alive) return { state: 'vanished', exit: EXIT.vanished, elapsed: nowSec - run.startedAt };
  return { state: 'running', exit: EXIT.busy, elapsed: nowSec - run.startedAt };
}

// Branches carry '/' and their records land in a flat directory. Not a hash: the whole value of these
// files is that a human debugging a stuck landing can `ls` them and recognise the branch.
export const runSlug = (branch) => branch.replace(/[^A-Za-z0-9._-]+/g, '_');
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/gate-state.test.mjs`
Expected: PASS, 18 tests.

- [ ] **Step 5: Run the whole suite, and the dependency invariant**

Run: `npm test`
Expected: PASS, and `test/no-dependencies.test.mjs` green — `lib/gate/state.mjs` imports nothing at
all, which is the strongest form of that invariant.

- [ ] **Step 6: Commit**

Stage `lib/gate/state.mjs` and `test/gate-state.test.mjs`, message:
`feat(gate): what a landing decides about paths, globs and cleanup`

---

### Task 3: `lib/gate/land.mjs` — the landing, and the phase's acceptance

**Files:**
- Create: `test/p3-acceptance.test.mjs`
- Create: `lib/gate/land.mjs`
- Create: `lib/cli/gate.mjs`
- Modify: `bin/orchestra` (register `land`)
- Source: `~/Projects/planetCraft/tools/merge-queue.mjs`, `land()`, `acquire()`, `precheck()`,
  `commitLedgers()`, `withMutex()`, `release()`

**Interfaces:**
- Consumes: everything Tasks 1 and 2 export; `lib/config.mjs`'s `loadConfigOrThrow`;
  `lib/paths.mjs`'s `gitEnv` and `orchestraDir`.
- Produces: `gatePaths(root) -> {d, state, waiters, holder, mutex, runFor(branch), logFor(branch)}`,
  `land(cfg, branch, waitSeconds) -> number` (an `EXIT` code), and `landCommand({cfg, args})`.

**Why now.** This is the phase's acceptance. Everything before it was decidable on paper; this is
the first thing that moves a branch onto a main branch, and it is written against a test that was
watched failing.

**The order of the landing, and why each step is where it is.** Do not reorder these.

| # | Step | Exit on failure |
|---|---|---|
| 0 | precheck: the branch ref exists; it has a worktree | 13 |
| 1 | upsert the queue entry, then acquire the lock (waiting up to `--wait`) | 12 |
| 2 | mark the entry `landing` | — |
| 3 | the main checkout is on `mainBranch`; the worktree has no uncommitted **tracked** change | 13 |
| 4 | commit the `ledgers` the main checkout keeps dirty | 13 |
| 5 | no dirty tracked file in the main checkout is also changed by the branch | 13 |
| 6 | rebase, **in the worktree** | 10 on a conflict, 13 on a rebase that failed with none |
| 7 | read the branch's own `gates`, then run each in order in the rebased worktree | 11, naming the gate |
| 8 | `merge --ff-only` in the main checkout | 13 |
| 9 | ancestry check, then the two independent cleanups | 13 if not an ancestor |
| 10 | drop the queue entry | 0 |

Steps 3–5 come **after** the lock, not before: a dirty main checkout or a dirty worktree is exactly
what the branch ahead of you was busy creating, so checking before the wait would check a state that
no longer holds. Step 4 comes before step 5 because the ledgers the gate itself owns must not be
counted as a clash — that is `t-06gjd4s`, 2026-08-19 in planetCraft, where every branch the fix queue
produced was refused over files nobody owned committing.

- [ ] **Step 1: Write the acceptance test**

Create `test/p3-acceptance.test.mjs`:

```js
// P3's acceptance (spec §15): "a branch lands in the fixture with two fake gates; the red one
// returns 11 naming itself." Driven through `bin/orchestra`, so what is asserted is what a person
// can type.
//
// WHAT IT CANNOT PROVE, said here rather than discovered later: it never observes two processes
// racing for a turn, so it does not test the lock under contention. That is `mayTake`'s own unit
// test (test/gate-state.test.mjs), where a process can be killed on paper.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers/fixture.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orchestra');
const repos = [];
after(() => repos.forEach((r) => r.cleanup()));

// `spawnSync`, not `execFileSync`: every assertion below is about an EXIT CODE, and execFileSync
// throws on a non-zero one, which would turn "the gate refused with 11" into a test error.
const run = (cwd, ...args) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

function project(gates, extra = {}) {
  const r = makeRepo({ name: 'gatefix', config: { gates, ...extra } });
  repos.push(r);
  return r;
}

// A branch with a worktree and one commit — the shape a worker leaves behind.
function branchWith(r, { branch = 'demo/d1', file = 'src/a.js', body = 'one\n' } = {}) {
  const wt = join(r.root, '.orchestra', 'worktrees', 'd1');
  r.git('worktree', 'add', '-q', '-b', branch, wt, 'main');
  mkdirSync(dirname(join(wt, file)), { recursive: true });
  writeFileSync(join(wt, file), body);
  execFileSync('git', ['-C', wt, 'add', '-A'], { encoding: 'utf8' });
  execFileSync('git', ['-C', wt, 'commit', '-q', '-m', 'feat: the branch does a thing'],
    { encoding: 'utf8' });
  return { wt, branch };
}

const log = (r, n = 5) => r.git('log', '--format=%s', `-${n}`, 'main').trim().split('\n');
const branches = (r) => r.git('for-each-ref', '--format=%(refname:short)', 'refs/heads')
  .trim().split('\n');

test('a branch lands through two green gates, in the order they are configured', () => {
  const r = project([
    { name: 'first', cmd: 'echo FIRST-RAN' },
    { name: 'second', cmd: 'echo SECOND-RAN' },
  ]);
  const { branch, wt } = branchWith(r);

  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 0, out);
  // The order is the project's call and the plugin never reorders it.
  assert.ok(out.indexOf('FIRST-RAN') < out.indexOf('SECOND-RAN'), out);
  assert.match(out, /landed 'demo\/d1' on main/);
  // The commit is on main, and both the worktree and the ref are gone.
  assert.ok(log(r).includes('feat: the branch does a thing'), log(r).join('|'));
  assert.deepEqual(branches(r), ['main']);
  assert.equal(r.git('worktree', 'list').includes(wt), false);
});

test('the red gate returns 11 naming itself, and the main branch does not move', () => {
  const r = project([
    { name: 'green', cmd: 'echo fine' },
    { name: 'suite', cmd: 'echo "3 tests failed" >&2; exit 1' },
  ]);
  const { branch, wt } = branchWith(r);
  const before = r.git('rev-parse', 'main').trim();

  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 11, out);
  // NAMING ITSELF is the acceptance: exit 11 folds the source's 14, and the gate's name is what
  // replaces the second number.
  assert.match(out, /gate 'suite' refused/);
  assert.match(out, /3 tests failed/);
  assert.equal(r.git('rev-parse', 'main').trim(), before);
  // Held, not lost: the branch and its worktree survive for its author.
  assert.ok(branches(r).includes(branch));
  assert.ok(r.git('worktree', 'list').includes(wt));
  // And the outcome is on disk, naming the gate, for a session that was not watching.
  const queue = JSON.parse(readFileSync(join(r.root, '.orchestra', 'gate', 'queue.json'), 'utf8'));
  assert.equal(queue.entries[0].state, 'held');
  assert.match(queue.entries[0].note, /gate "suite" refused/);
});

test('a gate whose globs cover every changed path is skipped, and says so', () => {
  const r = project([
    { name: 'visual', cmd: 'exit 1', skipWhenAllPathsMatch: ['docs/**', '**/*.md'] },
  ]);
  const { branch } = branchWith(r, { file: 'docs/notes.md', body: 'a note\n' });
  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 0, out);
  assert.match(out, /gate 'visual' skipped/);
});

test('one uncovered path runs the gate the others would have skipped', () => {
  const r = project([
    { name: 'visual', cmd: 'echo "the frames moved" >&2; exit 1',
      skipWhenAllPathsMatch: ['docs/**', '**/*.md'] },
  ]);
  const { branch } = branchWith(r, { file: 'src/a.js', body: 'code\n' });
  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 11, out);
  assert.match(out, /gate 'visual' refused/);
});

test('a branch that does not exist is a precondition, not a queue place', () => {
  const r = project([{ name: 'green', cmd: 'true' }]);
  const { code, out } = run(r.root, 'land', 'demo/never');
  assert.equal(code, 13, out);
  assert.match(out, /no such branch 'demo\/never'/);
});

test("the gates that judge a branch are the branch's own", () => {
  // Spec §3.2: the config is committed, so a branch that changes a gate has that gate applied to
  // its own landing. Everything else — mainBranch, ledgers, queue — comes from the invoking config,
  // because a branch that could add a path to `ledgers` could make the gate commit it onto main.
  const r = project([{ name: 'from-main', cmd: 'exit 1' }]);
  const { branch, wt } = branchWith(r);
  const cfg = JSON.parse(readFileSync(join(wt, '.orchestra', 'config.json'), 'utf8'));
  cfg.gates = [{ name: 'from-branch', cmd: 'echo BRANCH-GATE' }];
  writeFileSync(join(wt, '.orchestra', 'config.json'), `${JSON.stringify(cfg, null, 2)}\n`);
  execFileSync('git', ['-C', wt, 'commit', '-qam', 'chore: this branch brings its own gate'],
    { encoding: 'utf8' });

  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 0, out);
  assert.match(out, /BRANCH-GATE/);
  assert.doesNotMatch(out, /from-main/);
});

test('a landing with no gates configured still rebases, merges and cleans up', () => {
  // `gates` defaults to []. A project that has configured none is not a project whose landings are
  // refused; it is a project whose gate list is empty, and the fast-forward is still serialised.
  const r = project([]);
  const { branch } = branchWith(r);
  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 0, out);
  assert.match(out, /no gates configured/);
  assert.deepEqual(branches(r), ['main']);
});

test('an uncommitted tracked file in the worktree stops the landing before anything moves', () => {
  const r = project([{ name: 'green', cmd: 'true' }]);
  const { branch, wt } = branchWith(r);
  writeFileSync(join(wt, 'src', 'a.js'), 'uncommitted\n');
  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 13, out);
  assert.match(out, /uncommitted changes/);
  assert.ok(branches(r).includes(branch));
});
```

- [ ] **Step 2: Run it and watch every case fail**

Run: `node --test test/p3-acceptance.test.mjs`
Expected: FAIL — `orchestra: unknown subcommand "land"` on every case (the CLI exits 2, the
assertions expect 0/11/13). **Paste the output into your report.** This is the run that makes the
suite a proof rather than a pin.

- [ ] **Step 3: Write `lib/gate/land.mjs`**

```js
// One branch lands at a time, and the whole landing is ONE PROCESS from the lock to the
// fast-forward.
//
// WHY A PROCESS AND NOT AN AGENT FOLLOWING INSTRUCTIONS. Two landings at once is not merely
// wasteful: each rebases onto the main branch it saw and runs the gates against that base, and the
// first to merge invalidates the other's run — the second either merges a base it never gated, or
// pays for a second rebase and a second run of everything. The fix has to be a lock, and a lock
// needs an observable holder. An agent session is not observable: it is dozens of tool calls over
// minutes with nothing to `kill -0`. A lease with an expiry is the only alternative, and an expiry
// long enough to be safe for a real landing (a suite is minutes) is far too long to unwedge a
// crashed one. As a process, `land` frees its lock by dying.
//
// Nothing here decides anything. Every decision worth a test is in ./state.mjs.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitEnv, orchestraDir } from '../paths.mjs';
import { loadConfigOrThrow } from '../config.mjs';
import * as S from './state.mjs';

const err = (s) => process.stderr.write(`orchestra gate: ${s}\n`);

// GIT_DIR and GIT_WORK_TREE are exported inside a git hook, and under one of those git ignores
// `cwd` entirely — so a call meant for one checkout silently retargets another. `gitEnv()` strips
// them, once, for every git call this file makes.
const git = (dir, args) =>
  execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv(),
  }).trim();

const gitOk = (dir, args) => { try { git(dir, args); return true; } catch { return false; } };
const readFile = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

// A pid on this host is the authoritative answer, which is the whole reason the lock is held by a
// process. `process.kill(pid, 0)` sends no signal; it only asks.
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// Atomics.wait, not a busy loop: `land` blocks for minutes at a time waiting for its turn, and a
// spin would take a core away from the very gates it is queueing behind.
const sleepMs = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

// Under the main checkout, never under the worktree the caller is standing in: the queue is shared
// by every worktree of this project, and `lib/paths.mjs` is the one place that resolves that.
//
// `runs` outlives every process involved and is the only witness a detached landing leaves; `logs`
// is what an agent reads instead of a scrollback it no longer has.
export function gatePaths(root) {
  const d = join(orchestraDir(root), 'gate');
  mkdirSync(join(d, 'runs'), { recursive: true });
  mkdirSync(join(d, 'logs'), { recursive: true });
  return {
    d,
    state: join(d, 'queue.json'),
    waiters: join(d, 'waiters'),
    holder: join(d, 'holder'),
    mutex: join(d, 'mutex'),
    runFor: (branch) => join(d, 'runs', `${S.runSlug(branch)}.json`),
    logFor: (branch) => join(d, 'logs', `${S.runSlug(branch)}.log`),
  };
}

// mkdir is atomic on every filesystem that matters, which is the whole reason it is the mutex. It
// guards a few file writes and is NEVER held across a landing — the landing is guarded by `holder`,
// which is a pid.
function withMutex(p, fn) {
  for (let i = 0; ; i++) {
    try { mkdirSync(p.mutex); break; } catch { /* held */ }
    // Past 10 s the holder died between its mkdir and its cleanup. Break it rather than deadlock
    // the machine: this mutex spans three file writes, never seconds.
    if (i > 100) { rmSync(p.mutex, { recursive: true, force: true }); continue; }
    sleepMs(100);
  }
  try { return fn(); } finally { rmSync(p.mutex, { recursive: true, force: true }); }
}

// Liveness, not a timeout. Call with the mutex held.
function reap(p) {
  const holder = S.reapHolder(S.parseHolder(readFile(p.holder)), alive);
  const waiters = S.reapWaiters(S.parseWaiters(readFile(p.waiters)), alive);
  writeFileSync(p.holder, S.formatHolder(holder));
  writeFileSync(p.waiters, S.formatWaiters(waiters));
  return { holder, waiters };
}

const mark = (p, branch, next, note = '') => withMutex(p, () => {
  writeFileSync(p.state,
    S.formatState(S.setEntryState(S.parseState(readFile(p.state)), branch, next, note)));
});

// The lock is released by handlers, never by the caller remembering to: a landing ends in nine
// different places and each one would be a chance to forget.
let holding = null;
function release() {
  if (!holding) return;
  const p = holding;
  holding = null;
  withMutex(p, () => {
    const holder = S.parseHolder(readFile(p.holder));
    if (holder && holder.pid === process.pid) writeFileSync(p.holder, '');
    writeFileSync(p.waiters, S.formatWaiters(
      S.parseWaiters(readFile(p.waiters)).filter((x) => x.pid !== process.pid)));
  });
}

function armRelease(p) {
  holding = p;
  // 'exit' covers every ordinary return path, including a throw. The signals cover the two ways an
  // agent session ends a command it is tired of waiting for.
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { release(); process.exit(130); });
  }
}

// Register as a waiter, then take the lock when we are the oldest live one. Returns false when the
// wait budget is spent — the caller exits `busy` and is expected to run `land` again, which is
// cheaper than one process blocking past its tool timeout.
function acquire(p, branch, waitSeconds) {
  const me = { pid: process.pid, branch, epoch: Math.floor(Date.now() / 1000) };
  const deadline = Date.now() + waitSeconds * 1000;
  let said = '';
  for (;;) {
    const verdict = withMutex(p, () => {
      const { holder, waiters } = reap(p);
      if (!waiters.some((x) => x.pid === me.pid)) {
        waiters.push(me);
        writeFileSync(p.waiters, S.formatWaiters(waiters));
      }
      const v = S.mayTake({ holder, waiters, pid: me.pid });
      if (v.ok) {
        writeFileSync(p.holder, S.formatHolder(me));
        // Waiters are the processes NOT holding, so leaving ourselves in both would make the next
        // reader count us twice.
        writeFileSync(p.waiters, S.formatWaiters(waiters.filter((x) => x.pid !== me.pid)));
      }
      return v;
    });
    if (verdict.ok) { armRelease(p); return true; }
    if (Date.now() >= deadline) return false;
    if (verdict.reason !== said) { err(`waiting — ${verdict.reason}`); said = verdict.reason; }
    sleepMs(2000);
  }
}

// --porcelain, not the human form: the plain output is `<path> <sha> [branch]`, which a path
// containing a space silently splits in the wrong place.
function worktrees(root) {
  const list = [];
  let cur = null;
  for (const line of git(root, ['worktree', 'list', '--porcelain']).split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9), branch: null }; list.push(cur); }
    else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
  }
  return list;
}

// Cheap and lock-free: a branch that does not exist must not occupy a place in the queue while it
// waits to be told so. `detach` (./run.mjs) runs this too, so a typo is refused by the command the
// agent actually watched rather than surfacing one poll later, out of a log.
export function precheck(cfg, branch) {
  if (!gitOk(cfg.root, ['rev-parse', '--verify', `refs/heads/${branch}`])) {
    err(`no such branch '${branch}'`);
    return { exit: S.EXIT.precondition };
  }
  const wt = worktrees(cfg.root).find((w) => w.branch === branch) ?? null;
  if (!wt) {
    err(`'${branch}' has no worktree — land it from the tree it was developed in`);
    return { exit: S.EXIT.precondition };
  }
  return { wt };
}

// The environment every child of a landing runs under.
//
// ORCHESTRA_GATE marks this process's writes to the main branch as the gate's own (spec §5), and
// ORCHESTRA_FULL_SUITE is spec §10's override for `guard-full-suite` — the gate IS the deliberate
// whole-suite run that hook exists to make deliberate.
//
// NEITHER HAS A READER YET, and the honest reason is worth writing down for P5, which will add one:
// a PreToolUse hook fires on the AGENT's Bash command and reads that command's text; it does not
// inherit this process's environment. So P5 must decide whether `guard-main-commit` matches an
// `ORCHESTRA_GATE=1` prefix on a command line, reads its own environment, or recognises `orchestra
// land` directly — and it must reconcile TWO MARKERS FOR ONE FACT: this one, and
// `ORCHESTRA_WRITES_MAIN` which `lib/store/files.mjs` already stamps on its two git writes. Two ways
// to spell the same fact is how they start disagreeing. Not renamed here: that is P2a's file and
// P5's decision.
const gateEnv = () => ({ ...gitEnv(), ORCHESTRA_GATE: '1', ORCHESTRA_FULL_SUITE: '1' });

// The gates that judge a branch are the BRANCH'S OWN (spec §3.2): the config is committed, so the
// worktree carries the rules that ship with the code being landed. Everything else — `mainBranch`,
// `ledgers`, `queue`, `mode` — stays the invoking config's, because those are facts about the
// project rather than about the branch, and because a branch that could add a path to `ledgers`
// could make the gate commit that path onto the main branch.
function gatesFor(cfg, worktreePath) {
  let branchCfg = null;
  try {
    branchCfg = loadConfigOrThrow(worktreePath);
  } catch (e) {
    // A branch that broke its own config is refused BEFORE the gates run, naming the file, rather
    // than judged by the main branch's rules behind its back.
    return { error: `the config in ${worktreePath} is not usable (${e.message})` };
  }
  if (!branchCfg) return { gates: cfg.gates, from: 'the main checkout (the branch has no config)' };
  return { gates: branchCfg.gates, from: 'the branch' };
}

// Step 4: commit the tracked ledgers this project's tooling keeps dirty in the MAIN checkout.
//
// WHO commits them, and WHEN: this process, at the head of every landing, and the reasons are the
// three that make it the gate's job at all — it is the only actor allowed to write the main branch,
// it is the only one holding a lock while it does, and it runs often enough that no line ages more
// than one landing. A ticket filed by a review is a fact about the main branch, not a change a
// branch authored, so it belongs in a commit of the main branch's own.
//
// `cfg.ledgers` IS EMPTY IN EVERY PROJECT TODAY and this loop runs zero times — that is not dead
// code and must not be deleted. A project configures `ledgers` when it has a tracked file the main
// branch owns and a branch may not carry, and P5's ticket queue is the first one this plugin ships.
// The day it lands with nothing committing those files, the clash check below refuses every branch
// that touches one: measured as `t-06gjd4s`, 2026-08-19 in planetCraft, on every branch that
// project's fix queue produced.
//
// NO CROSS-PROCESS LOCK, and P5 owes one. The project this was extracted from takes its ticket
// queue's own lock here, because those files have several writers and committing one mid
// read-modify-write puts a torn line in the index. This plugin has no ticket queue yet, so there is
// no lock to take and a lock-shaped no-op would be just-in-case code. P5 adds both together.
//
// BLOCKING, unlike the best-effort writes after the fast-forward, and the difference is what has
// already happened when each runs: this runs before anything is touched, and if it fails the clash
// check two steps down would refuse the landing anyway, with a message about the branch that is
// really about the gate.
function commitLedgers(cfg) {
  const dirty = git(cfg.root, ['diff', '--name-only', '-z', 'HEAD']).split('\0').filter(Boolean);
  const ledgers = S.ledgerPathsToCommit(dirty, cfg.ledgers);
  if (!ledgers.length) return true;
  const ok = gitOk(cfg.root, ['add', '--', ...ledgers])
    && gitOk(cfg.root, ['-c', 'core.hooksPath=/dev/null', 'commit',
      '-m', `chore(ledger): record ${ledgers.length} ledger file(s) written since the last landing`,
      '-m', `${ledgers.join('\n')}\n\nWritten in the main checkout by the tools that file them.`
        + ' Committed by the merge gate, which is the only actor allowed to write the main branch'
        + ' and the only one holding a lock against those writers.']);
  if (!ok) {
    err(`could not commit the main checkout's ledgers (${ledgers.join(', ')})`
      + ' — commit them by hand, nothing was touched');
    return false;
  }
  err(`committed ${ledgers.length} ledger file(s) in ${cfg.root}`);
  return true;
}

// A project's `queue` template (spec §13), or the command itself when there is none.
//
// FUNCTION REPLACEMENTS, not string ones: `String.replace` interprets `$&`, `$1` and `$'` inside a
// string replacement, so a gate command containing a `$` would be silently rewritten into something
// nobody typed.
const commandFor = (cfg, gate) => (cfg.queue
  ? String(cfg.queue).replace(/\{label\}/g, () => gate.name).replace(/\{cmd\}/g, () => gate.cmd)
  : gate.cmd);

const DEFAULT_WAIT = 540; // under the 600-second ceiling of an agent's Bash tool, so a spent budget
                          // is REPORTED rather than killed mid-wait.

export function land(cfg, branch, waitSeconds = DEFAULT_WAIT) {
  const p = gatePaths(cfg.root);

  const pre = precheck(cfg, branch);
  if (pre.exit !== undefined) return pre.exit;
  const { wt } = pre;

  withMutex(p, () => {
    writeFileSync(p.state, S.formatState(S.upsertEntry(S.parseState(readFile(p.state)),
      { branch, worktree: wt.path, at: Math.floor(Date.now() / 1000) }).state));
  });

  if (!acquire(p, branch, waitSeconds)) {
    err(`still waiting after ${waitSeconds}s — run land again`);
    return S.EXIT.busy;
  }
  mark(p, branch, 'landing');

  // Preconditions AFTER the lock, not before: a dirty main checkout or a dirty worktree is exactly
  // what the branch ahead of us was busy creating, so checking before the wait would check a state
  // that no longer holds.
  if (git(cfg.root, ['rev-parse', '--abbrev-ref', 'HEAD']) !== cfg.mainBranch) {
    err(`${cfg.root} is not on ${cfg.mainBranch}`);
    return S.EXIT.precondition;
  }
  // --untracked-files=no, and this is not a detail: a bare `status --porcelain` counts untracked
  // files, and a main checkout has one essentially always — a stray note, a scratch directory. What
  // a rebase can clobber is an uncommitted change to a TRACKED file; an untracked one git itself
  // refuses loudly if the merge would overwrite it, so it is git's business, not this check's.
  //
  // The WORKTREE is checked whole, because the rebase below happens in it and a rebase needs the
  // tree clean whatever the paths are.
  if (git(wt.path, ['status', '--porcelain', '--untracked-files=no'])) {
    err(`the worktree of '${branch}' has uncommitted changes — commit or clean them,`
      + ' nothing was touched');
    return S.EXIT.precondition;
  }
  if (!commitLedgers(cfg)) return S.EXIT.precondition;

  // The main checkout is checked NARROWLY, against the paths this landing would write (see
  // `clashingPaths`). `<main>...<branch>` (three dots) is the branch's own changes since the two
  // diverged, which is what the fast-forward will replay. Two dots would also count what landed
  // since, and would refuse a landing because of a file some OTHER branch changed this morning.
  const clash = S.clashingPaths(
    git(cfg.root, ['diff', '--name-only', '-z', 'HEAD']).split('\0').filter(Boolean),
    git(cfg.root, ['diff', '--name-only', '-z', `${cfg.mainBranch}...${branch}`]).split('\0').filter(Boolean),
  );
  if (clash.length) {
    err(`${clash.length} uncommitted file(s) in the main checkout are also changed by '${branch}'`
      + ' — commit or stash them, nothing was touched:');
    for (const c of clash) err(`  ${c}`);
    return S.EXIT.precondition;
  }

  // Rebase in the worktree, so the main working tree stays untouched until the fast-forward.
  if (spawnSync('git', ['-C', wt.path, 'rebase', cfg.mainBranch],
    { stdio: 'inherit', env: gitEnv() }).status !== 0) {
    const conflicted = git(wt.path, ['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
    spawnSync('git', ['-C', wt.path, 'rebase', '--abort'], { stdio: 'inherit', env: gitEnv() });
    if (!conflicted.length) {
      // A rebase can fail without a conflict — a stale index, an unborn ref. Reporting that as a
      // conflict would send the agent to resolve files that are not conflicted.
      err('rebase failed with no conflicted paths (see above)');
      return S.EXIT.precondition;
    }
    mark(p, branch, 'blocked', conflicted.join(', '));
    err(`conflict on ${conflicted.length} file(s): ${conflicted.join(', ')}`);
    err('resolve in the worktree, rebase --continue, then run land again');
    return S.EXIT.conflict;
  }

  // Read AFTER the rebase, so it is the change as the main branch will receive it. A git that
  // cannot answer is a null, which RUNS every gate (`gateSkipped`).
  let changed = null;
  try {
    changed = git(wt.path, ['diff', '--name-only', `${cfg.mainBranch}...${branch}`])
      .split('\n').filter(Boolean);
  } catch { /* unreadable — every gate runs */ }

  const { gates, from, error } = gatesFor(cfg, wt.path);
  if (error) { mark(p, branch, 'held', error); err(error); return S.EXIT.precondition; }
  if (!gates.length) err(`no gates configured in ${from} — nothing to run before the fast-forward`);
  for (const gate of gates) {
    if (S.gateSkipped(gate, changed)) {
      err(`gate '${gate.name}' skipped — every changed path matches`
        + ` ${gate.skipWhenAllPathsMatch.join(', ')}`);
      continue;
    }
    err(`gate '${gate.name}' (from ${from}) running in ${wt.path}`);
    // In the worktree, under the lock, on the rebased tree — the same tree that lands. Run anywhere
    // else it would judge code that is not what merges.
    //
    // stdio inherited, never captured: a detached landing's stdout IS the log file, so a gate's
    // output reaches `await`'s tail with no capture code at all. What must never be lost is the
    // gate's NAME, and that travels in the line below, in the queue entry's note, and in `await`'s
    // own report.
    const r = spawnSync(commandFor(cfg, gate), {
      cwd: gate.cwd ? join(wt.path, gate.cwd) : wt.path,
      shell: true,
      stdio: 'inherit',
      env: gateEnv(),
      timeout: gate.timeout ? gate.timeout * 1000 : undefined,
    });
    if (r.status !== 0) {
      const why = r.error?.code === 'ETIMEDOUT' || r.signal
        ? `gate "${gate.name}" refused (killed after ${gate.timeout}s)`
        : `gate "${gate.name}" refused`;
      mark(p, branch, 'held', why);
      err(`gate '${gate.name}' refused '${branch}' — held, ${cfg.mainBranch} untouched`);
      return S.EXIT.refused;
    }
  }

  // A fast-forward by construction, since the rebase was onto this very main branch and nothing else
  // may move it while we hold the lock. --ff-only is the assertion that it really is.
  if (spawnSync('git', ['-C', cfg.root, 'merge', '--ff-only', branch],
    { stdio: 'inherit', env: gateEnv() }).status !== 0) {
    mark(p, branch, 'held', `merge --ff-only refused — ${cfg.mainBranch} moved under the lock`);
    return S.EXIT.precondition;
  }

  // The ancestry check is the one thing standing between a cleanup and a lost branch, so it gates
  // the deletion rather than following it.
  if (!gitOk(cfg.root, ['merge-base', '--is-ancestor', branch, cfg.mainBranch])) {
    err(`merged, but '${branch}' is not an ancestor of ${cfg.mainBranch} — nothing deleted`);
    return S.EXIT.precondition;
  }
  // Lowercase -d, never -D: `cleanupAfterLanding` decides what is attempted here and why. The lazy
  // thunks are not a style choice — `provenMerged` and `untrackedFiles` are two git calls each and
  // are reached only when git has already refused something, which on an ordinary landing is never.
  const notes = S.cleanupAfterLanding({
    branch,
    worktree: wt.path,
    hasUncommittedTracked: () => !!git(wt.path, ['status', '--porcelain', '--untracked-files=no']),
    // -z, because porcelain v1 quotes a path containing a space and the note would name a file
    // nobody can copy. `?? ` is the untracked marker.
    untrackedFiles: () => git(wt.path, ['status', '--porcelain', '-z'])
      .split('\0').filter((e) => e.startsWith('?? ')).map((e) => e.slice(3)),
    removeWorktree: () => gitOk(cfg.root, ['worktree', 'remove', wt.path]),
    deleteBranch: () => gitOk(cfg.root, ['branch', '-d', branch]),
    // BOTH halves, which is what makes unpinning the upstream safe: identical tips say the branch is
    // exactly what the main branch carries, and --is-ancestor says it really descends from it.
    provenMerged: () => gitOk(cfg.root, ['merge-base', '--is-ancestor', branch, cfg.mainBranch])
      && git(cfg.root, ['rev-parse', branch]) === git(cfg.root, ['rev-parse', cfg.mainBranch]),
    unsetUpstream: () => gitOk(cfg.root, ['branch', '--unset-upstream', branch]),
  });
  for (const note of notes) err(`landed; ${note}`);

  withMutex(p, () => {
    writeFileSync(p.state, S.formatState(S.dropEntry(S.parseState(readFile(p.state)), branch)));
  });
  err(`landed '${branch}' on ${cfg.mainBranch}`);
  return S.EXIT.ok;
}
```

**One thing to check while you write this, and to report either way:** `commitLedgers` disables the
project's own git hooks with `-c core.hooksPath=/dev/null` rather than `--no-verify`. The source uses
`--no-verify`, because the commit is data rather than source and the hook it skips replays tests the
change cannot reach. Try both in the fixture. If `--no-verify` is enough, use it — it is the
narrower instrument and the one a reader expects. Say in your report which you used and what you
observed.

- [ ] **Step 4: Write `lib/cli/gate.mjs`**

```js
// `orchestra land` — argument parsing and an exit code, and nothing else. Every decision is in
// ../gate/state.mjs and every effect in ../gate/land.mjs.
import { land } from '../gate/land.mjs';
import { EXIT } from '../gate/state.mjs';

const flag = (args, name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

export function landCommand({ cfg, args }) {
  const branch = args.find((a) => !a.startsWith('--'));
  if (!branch) {
    process.stderr.write('usage: orchestra land <branch> [--wait=<seconds>]\n');
    process.exitCode = EXIT.usage;
    return;
  }
  const wait = Number(flag(args, 'wait') ?? 540);
  if (!Number.isInteger(wait) || wait < 0) {
    // Refused loudly rather than silently coerced: a NaN wait would make `acquire` return on its
    // first comparison and report a busy queue that is not busy.
    process.stderr.write(`orchestra land: --wait must be a whole number of seconds, got ${JSON.stringify(flag(args, 'wait'))}\n`);
    process.exitCode = EXIT.usage;
    return;
  }
  process.exitCode = land(cfg, branch, wait);
}
```

- [ ] **Step 5: Register it in `bin/orchestra`**

Add the import beside the others and one `register` line:

```js
import { landCommand } from '../lib/cli/gate.mjs';
```
```js
register('land', { run: landCommand });
```

**Do not pass `machine: true`.** `land` in a project with no config must exit 0 and silent, like
every other subcommand, and `bin/orchestra` already does that for anything not marked machine-level.

- [ ] **Step 6: Run the acceptance**

Run: `node --test test/p3-acceptance.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS. If `test/cli.test.mjs`'s "unknown subcommand" case names a command list, it changed —
update it rather than working around it.

- [ ] **Step 8: Commit**

Stage `lib/gate/land.mjs`, `lib/cli/gate.mjs`, `bin/orchestra`, `test/p3-acceptance.test.mjs`,
message: `feat(gate): one branch lands at a time, and a refusing gate says its own name`

---

### Task 4: `lib/gate/run.mjs` — `--detach`, `await`, and `queue-list`

**Files:**
- Create: `lib/gate/run.mjs`
- Modify: `lib/cli/gate.mjs` (`--detach`, `awaitCommand`, `queueListCommand`)
- Modify: `bin/orchestra` (register `await` and `queue-list`)
- Modify: `test/p3-acceptance.test.mjs` (append)
- Source: `~/Projects/planetCraft/tools/merge-queue.mjs`: `detach()`, `recordOutcome()`,
  `ownsRun()`, `tailOfLog()`, `awaitRun()`, `list()`

**Interfaces:**
- Consumes: Task 3's `gatePaths(root)` and `precheck(cfg, branch)`; Task 2's `parseRun`,
  `formatRun`, `runVerdict`, `runSlug`; Task 1's `EXIT`, `parseState`, `dropVanished`.
- Produces: `detach(cfg, branch, waitSeconds) -> number`, `awaitRun(cfg, branch, forSeconds) -> number`,
  `queueList(cfg) -> number`, `recordOutcome(runFile)`.

**Why now.** The landing works and is unusable by the actor it exists for: an agent's Bash call is
capped at 600 seconds and a landing that runs a real test suite is minutes. This task is the whole
answer to that, and it is what `agents/merge_agent.md` (Task 8) tells the agent to type.

- [ ] **Step 1: Write the failing tests**

Append to `test/p3-acceptance.test.mjs`:

```js
test('land --detach returns 15 at once, and await collects the real code and the gate name', () => {
  const r = project([
    { name: 'slow', cmd: 'sleep 1; echo SLOW-RAN' },
    { name: 'suite', cmd: 'echo "1 test failed" >&2; exit 1' },
  ]);
  const { branch } = branchWith(r);

  const started = run(r.root, 'land', branch, '--detach');
  assert.equal(started.code, 15, started.out);
  assert.match(started.out, /detached — pid \d+/);
  // The caller's own turn is over in milliseconds; the landing is not.
  const waited = run(r.root, 'await', branch, '--for=60');
  assert.equal(waited.code, 11, waited.out);
  assert.match(waited.out, /gate "suite" refused/);   // the queue note, in await's own report
  assert.match(waited.out, /1 test failed/);          // the tail of the log it never watched
  assert.match(waited.out, /full log: .*\.orchestra\/gate\/logs\//);
});

test('await on a branch with no record says how to start one', () => {
  const r = project([{ name: 'green', cmd: 'true' }]);
  branchWith(r);
  const { code, out } = run(r.root, 'await', 'demo/d1', '--for=1');
  assert.equal(code, 1, out);
  assert.match(out, /no detached landing on record/);
  assert.match(out, /land demo\/d1 --detach/);
});

test('a second --detach on a running landing does not start a second one', () => {
  const r = project([{ name: 'slow', cmd: 'sleep 3' }]);
  const { branch } = branchWith(r);
  assert.equal(run(r.root, 'land', branch, '--detach').code, 15);
  const again = run(r.root, 'land', branch, '--detach');
  assert.equal(again.code, 15, again.out);
  assert.match(again.out, /already landing — pid \d+/);
  run(r.root, 'await', branch, '--for=60');
});

test('queue-list prints a held entry with its note, and reaps an entry whose branch is gone', () => {
  const r = project([{ name: 'suite', cmd: 'exit 1' }]);
  const { branch } = branchWith(r);
  assert.equal(run(r.root, 'land', branch).code, 11);

  const held = run(r.root, 'queue-list');
  assert.equal(held.code, 0, held.out);
  assert.match(held.out, /held\s+.*demo\/d1.*gate "suite" refused/);

  // The branch goes; so does the entry — the same liveness argument the lock already makes, and the
  // reason there is no `drop` verb (spec §2's list has three).
  r.git('worktree', 'remove', '--force', join(r.root, '.orchestra', 'worktrees', 'd1'));
  r.git('branch', '-D', branch);
  const after = run(r.root, 'queue-list');
  assert.match(after.out, /merge queue: empty/);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/p3-acceptance.test.mjs`
Expected: FAIL — `--detach` is ignored so `land` runs in the foreground and returns 11 rather than
15, and `await`/`queue-list` are unknown subcommands. Paste the output.

- [ ] **Step 3: Write `lib/gate/run.mjs`**

```js
// A landing outlives the session that asked for it, and this is the whole mechanism.
//
// THE SHAPE, AND WHY IT IS NOT AN ACCOMMODATION. A landing is one process from the lock to the
// fast-forward, and the gates inside it are minutes — against a 600-second ceiling on an agent's
// Bash call. A foreground landing therefore loses that race whenever the machine is busy. But
// backgrounding the call is WORSE than the problem it solves: a subagent has no tool with which to
// wait on a background job, so its only move is to end its turn, and a subagent that ends its turn
// is over. The landing then outlives the only process that knew its exit code, and the outcome is
// lost in a way no amount of care by the agent can recover.
//
// So: `--detach` forks the real work into its own session, writes its outcome to a durable run
// record, and returns at once. `await` blocks in bounded chunks that fit under the ceiling, and can
// be re-run any number of times, by any number of sessions, including ones that started after the
// original died. Nothing needs a notification, so nothing can miss one.
import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitEnv } from '../paths.mjs';
import { gatePaths, precheck } from './land.mjs';
import * as S from './state.mjs';

const err = (s) => process.stderr.write(`orchestra gate: ${s}\n`);
const readFile = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleepMs = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const nowSec = () => Math.floor(Date.now() / 1000);
const age = (s) => (s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`);

// Resolved from this module, never from `process.argv[1]`: the child has to be THIS plugin's entry
// point whatever wrapper invoked the parent.
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'orchestra');

// The parent half. It writes the run record BEFORE the fork so that an `await` racing it by a
// millisecond still finds one, then hands the child its own session and returns.
export function detach(cfg, branch, waitSeconds) {
  const p = gatePaths(cfg.root);
  // Run BEFORE anything is recorded, so a typo is refused by the command the agent actually
  // watched rather than surfacing one poll later, out of a log.
  const pre = precheck(cfg, branch);
  if (pre.exit !== undefined) return pre.exit;

  const runFile = p.runFor(branch);
  const logFile = p.logFor(branch);

  // A landing already running is not something to start twice: the second would only register as a
  // waiter and block behind the first, while overwriting the record that names the first.
  const existing = S.parseRun(readFile(runFile));
  const verdict = S.runVerdict({
    run: existing, alive: existing ? alive(existing.pid) : false, nowSec: nowSec(),
  });
  if (verdict.state === 'running') {
    err(`'${branch}' is already landing — pid ${existing.pid}, ${age(verdict.elapsed)} in`);
    err(`run \`orchestra await ${branch}\``);
    return S.EXIT.started;
  }

  writeFileSync(runFile, S.formatRun({
    branch, pid: null, startedAt: nowSec(), log: logFile, exit: null, endedAt: null,
  }));
  // Truncated, not appended: the log belongs to THIS attempt, and an agent reading a conflict out
  // of the previous one would resolve a conflict that is no longer there.
  const fd = openSync(logFile, 'w');
  try {
    const child = spawn(process.execPath, [BIN, 'land', branch, `--wait=${waitSeconds}`], {
      cwd: cfg.root,
      // Its own session, so the child does not take the SIGHUP that ends the agent's shell — which
      // is the entire point: this process is meant to outlive its caller.
      detached: true,
      stdio: ['ignore', fd, fd],
      env: { ...gitEnv(), ORCHESTRA_GATE_RUN_FILE: runFile },
    });
    child.unref();
    // Read-modify-write, not a second blind write: a child that failed a precondition in the
    // milliseconds since the spawn has already recorded its exit, and stamping the pid over it
    // would erase the only answer anybody wanted.
    const seeded = S.parseRun(readFile(runFile));
    writeFileSync(runFile, S.formatRun({ ...seeded, pid: child.pid }));
    err(`landing '${branch}' detached — pid ${child.pid}, log ${logFile}`);
    err(`poll it with \`orchestra await ${branch}\` — never re-run land`);
  } finally {
    closeSync(fd);
  }
  return S.EXIT.started;
}

// The child half. Whatever happens to it — a throw, a signal — the code it exits with is the one
// thing the caller cannot reconstruct later.
//
// It CLAIMS the record by pid first, and refuses one already claimed by someone else. That is not
// defensive dressing: `ORCHESTRA_GATE_RUN_FILE` travels in the environment, and an environment is
// inherited by every descendant — including a gate that itself runs this plugin. Such a nested run
// would stamp its own exit code onto the live landing's record, so `await` would read a finished
// landing while the real one was still rebasing. A pid cannot be inherited, so it is what tells the
// landing apart from its own descendants.
function ownsRun(run) {
  // pid null is the sliver between the parent's first write and its second, when only the real
  // child can be running at all.
  return !!run && (run.pid === null || run.pid === process.pid);
}

export function recordOutcome(runFile) {
  const claimed = S.parseRun(readFile(runFile));
  if (!ownsRun(claimed)) return;
  try {
    writeFileSync(runFile, S.formatRun({ ...claimed, pid: process.pid }));
  } catch { /* the parent's own write is the authority; ours is only the race-closer */ }
  process.on('exit', (code) => {
    try {
      const run = S.parseRun(readFile(runFile));
      // Re-checked at exit, not trusted from the claim: a later `land --detach` on the same branch
      // legitimately takes the record over, and a landing that has been superseded must not
      // overwrite its successor's outcome on its way out.
      if (!ownsRun(run)) return;
      writeFileSync(runFile, S.formatRun({ ...run, exit: code, endedAt: nowSec() }));
    } catch { /* the landing's own exit code matters more than our bookkeeping */ }
  });
}

// The tail is the report. An agent that polls a landing has no scrollback for it — the output went
// to a file in another session — so a verdict without the last lines of the log would name exit 10
// or 11 and leave the agent to go and find out which files.
const tailOfLog = (logFile, lines) => {
  const text = readFile(logFile).trimEnd();
  return text ? text.split('\n').slice(-lines).join('\n') : '';
};

// The refusing gate's name, from the durable record rather than from the log's last lines, which a
// verbose gate can push out of a 40-line tail. This is the third of the three places the name
// travels, and the only one an agent is guaranteed to read.
const noteFor = (p, branch) => S.findEntry(S.parseState(readFile(p.state)), branch)?.note ?? '';

// Blocks in one bounded chunk and reports; it never waits past the caller's ceiling, and running it
// again is always correct. That is what makes a lost turn survivable: the state lives on disk, so
// the session that reads the outcome need not be the session that started the landing.
export function awaitRun(cfg, branch, forSeconds) {
  const p = gatePaths(cfg.root);
  const runFile = p.runFor(branch);
  const deadline = Date.now() + forSeconds * 1000;
  for (;;) {
    const run = S.parseRun(readFile(runFile));
    const v = S.runVerdict({ run, alive: run ? alive(run.pid) : false, nowSec: nowSec() });
    if (v.state === 'unknown') {
      err(`no detached landing on record for '${branch}'`);
      err(`start one with \`orchestra land ${branch} --detach\``);
      return S.EXIT.usage;
    }
    if (v.state === 'finished') {
      const note = noteFor(p, branch);
      err(`'${branch}' finished with exit ${v.exit} after ${age(v.elapsed)}`
        + `${note ? ` — ${note}` : ''} — full log: ${run.log}`);
      const report = tailOfLog(run.log, 40);
      if (report) process.stderr.write(`${report}\n`);
      return v.exit;
    }
    if (v.state === 'vanished') {
      // Distinguished from `busy` on purpose: the caller must NOT keep waiting, and must not assume
      // nothing happened either — the fast-forward may already have run.
      err(`the landing of '${branch}' (pid ${run.pid}) is gone and recorded no exit after`
        + ` ${age(v.elapsed)} — it was killed, not finished`);
      err(`check \`git -C ${cfg.root} log --oneline -3\` and the log at ${run.log} before starting over`);
      const report = tailOfLog(run.log, 20);
      if (report) process.stderr.write(`${report}\n`);
      return v.exit;
    }
    if (Date.now() >= deadline) {
      err(`'${branch}' is still landing — pid ${run.pid}, ${age(v.elapsed)} in.`
        + ' Run await again; do not run land again.');
      return S.EXIT.busy;
    }
    sleepMs(2000);
  }
}

// What is in the queue, and — the one line worth acting on — whether any live process is moving it.
//
// It also REAPS, which is what replaces the source's `drop` verb: an entry whose branch ref is gone
// landed, or was deleted, and either way nothing will ever move it again. An entry whose branch
// still exists is never touched — remembering a branch blocked by a conflict is the record's job.
export function queueList(cfg) {
  const p = gatePaths(cfg.root);
  const refExists = (b) => {
    try {
      spawnGitVerify(cfg.root, b);
      return true;
    } catch { return false; }
  };
  const state = S.dropVanished(S.parseState(readFile(p.state)), refExists);
  writeFileSync(p.state, S.formatState(state));

  const holder = S.reapHolder(S.parseHolder(readFile(p.holder)), alive);
  const waiters = S.reapWaiters(S.parseWaiters(readFile(p.waiters)), alive);
  if (!state.entries.length) { process.stdout.write('merge queue: empty\n'); return S.EXIT.ok; }
  const now = nowSec();
  for (const e of state.entries) {
    const waiting = waiters.find((x) => x.branch === e.branch);
    // "no live process" is the one line worth acting on: the entry outlived its agent, and nothing
    // will move it until somebody runs `land` again.
    const who = holder?.branch === e.branch ? `pid ${holder.pid} holds the lock`
      : waiting ? `pid ${waiting.pid} waiting`
        : 'no live process';
    process.stdout.write(`${e.state.padEnd(8)} ${age(now - e.enqueuedAt).padStart(5)}`
      + `  ${e.branch}  (${who})${e.note ? ` — ${e.note}` : ''}\n`);
  }
  return S.EXIT.ok;
}
```

**`spawnGitVerify` is deliberately not written above** — write it as the two-line helper it is,
beside the others at the top of the file, using `execFileSync` with `gitEnv()`:

```js
const spawnGitVerify = (root, branch) =>
  execFileSync('git', ['-C', root, 'rev-parse', '--verify', `refs/heads/${branch}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv() });
```

and add `execFileSync` to the `node:child_process` import. If while writing this you find that
`land.mjs` should simply export its own `gitOk` rather than have a second git helper here, do that
instead and say so in your report — one spelling of "does this ref exist" is better than two.

- [ ] **Step 4: Extend `lib/cli/gate.mjs`**

```js
import { land } from '../gate/land.mjs';
import { detach, awaitRun, queueList, recordOutcome } from '../gate/run.mjs';
import { EXIT } from '../gate/state.mjs';
```

In `landCommand`, after the `wait` is parsed:

```js
  if (args.includes('--detach')) { process.exitCode = detach(cfg, branch, wait); return; }
  // Set only by `detach` on the child it forks. The child is an ordinary `land` in every other
  // respect — the outcome record is bookkeeping laid over it, not a second code path.
  if (process.env.ORCHESTRA_GATE_RUN_FILE) recordOutcome(process.env.ORCHESTRA_GATE_RUN_FILE);
  process.exitCode = land(cfg, branch, wait);
```

And the two new commands:

```js
export function awaitCommand({ cfg, args }) {
  const branch = args.find((a) => !a.startsWith('--'));
  if (!branch) {
    process.stderr.write('usage: orchestra await <branch> [--for=<seconds>]\n');
    process.exitCode = EXIT.usage;
    return;
  }
  const forSeconds = Number(flag(args, 'for') ?? 540);
  if (!Number.isInteger(forSeconds) || forSeconds < 0) {
    process.stderr.write(`orchestra await: --for must be a whole number of seconds, got ${JSON.stringify(flag(args, 'for'))}\n`);
    process.exitCode = EXIT.usage;
    return;
  }
  process.exitCode = awaitRun(cfg, branch, forSeconds);
}

export const queueListCommand = ({ cfg }) => { process.exitCode = queueList(cfg); };
```

- [ ] **Step 5: Register them in `bin/orchestra`**

```js
import { landCommand, awaitCommand, queueListCommand } from '../lib/cli/gate.mjs';
```
```js
register('await', { run: awaitCommand });
register('queue-list', { run: queueListCommand });
```

- [ ] **Step 6: Run the acceptance**

Run: `node --test test/p3-acceptance.test.mjs`
Expected: PASS, 12 tests. These four spawn real detached processes and one of them sleeps; if the
whole file takes more than about 30 seconds, say so in your report rather than raising a timeout.

- [ ] **Step 7: Run the whole suite, twice**

Run: `npm test && npm test`
Expected: PASS both times. **Twice on purpose:** a detached landing writes into the fixture's temp
directory and a leak would show as a second run behaving differently from the first.

- [ ] **Step 8: Check nothing was orphaned**

Run: `pgrep -fl 'bin/orchestra land' || echo 'no orphaned landings'`
Expected: `no orphaned landings`. A detached child that outlives its fixture would hold a temp
directory open and, on a developer's machine, look exactly like nothing at all.

- [ ] **Step 9: Commit**

Stage `lib/gate/run.mjs`, `lib/cli/gate.mjs`, `bin/orchestra`, `test/p3-acceptance.test.mjs`,
message: `feat(gate): a landing that outlives its caller, and the two commands that collect it`

---

### Task 5: `orchestra roadmap sync` — the shared channel, reconciled with what landed

**Files:**
- Create: `lib/store/github/sync.mjs`
- Create: `test/sync.test.mjs`
- Modify: `lib/roadmap/board.mjs` (each row carries `subjects` and `landedHere`)
- Modify: `lib/store/github/index.mjs` (`sync(rows)`)
- Modify: `lib/store/files.mjs` (`sync()`)
- Modify: `lib/cli/roadmap.mjs` (`case 'sync'`)
- Modify: `test/both-modes.test.mjs` (the no-op's shape, beside `setStatus`'s)
- Source: `~/Projects/planetCraft/tools/roadmap/sync.mjs`: `tickChecklist`, `planLabels`,
  `planProgrammes`, the closing half of `planSync`, `sync`

**Interfaces:**
- Consumes: `lib/roadmap/board.mjs`'s `reconcile` and `isLanded`; `lib/store/github/issues.mjs`'s
  `LABELS` and `keyFromTitle`; `lib/store/github/ownership.mjs`'s `programmeOf`.
- Produces: `tickChecklist(body, closedNumbers) -> string`, `planLabels(rows) -> [{issue, add, remove}]`,
  `planProgrammes({programmeIssues, taskIssues}) -> [{issue, body, close}]`,
  `planSync({rows, programmeIssues, taskIssues}) -> {close, labels, programmes}`,
  `applySync(gh, plan)`; and on the Store, `sync(rows) -> {noop, why} | {closed, labels, programmes}`.

**What `sync` promises, and nothing more.** `skills/orchestra/SKILL.md` names four things: close what
the register proves landed, move every `status:` label onto what the board derives, tick each
programme's checklist, close a finished programme. That is the whole scope. The source's stale-claim
sweep is not ported (see "What P3 does not do").

**Two rules that look like edge cases and are the whole point.**

1. **A task is closed only when the register recorded its commit subjects AND those subjects are on
   this machine's main branch.** A shared task landed by another developer never reaches your main at
   all, and its own machine closes its own issue. Closing on "the branch is gone" would close it
   wrongly. That fact is `landedHere` — computed in `reconcile`, where the register's `subjects` and
   git's `mainSubjects` are both already in hand.
2. **A programme closes on the NEXT sync, never in the same pass.** `planProgrammes` reads the task
   states as they are now, so a task this run is about to close is still open to it. Closing in the
   same pass means acting on a state not yet written: a roadmap that ends a minute late is a
   cosmetic lag, one that ends on a close that then failed is a lie.

- [ ] **Step 1: Write the failing tests**

Create `test/sync.test.mjs`:

```js
// `sync` is the only command that writes to the shared channel off what git says landed, so its
// failure mode is destructive: a task closed that never landed. Tested with the recorder, never a
// network — `test/helpers/gh.mjs` is the one GitHub simulation every suite here shares.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickChecklist, planLabels, planProgrammes, planSync } from '../lib/store/github/sync.mjs';
import { LABELS } from '../lib/store/github/issues.mjs';

test('the checklist ticks and UNTICKS from what actually closed', () => {
  // Two-way on purpose: a reopened issue unticks. A checklist that could only ever advance would
  // drift ahead of the truth exactly once, and then say so for ever.
  const body = '## Tasks\n- [ ] #11 D1 — one\n- [x] #12 D2 — two\n- [ ] D3 — unpublished\n';
  const out = tickChecklist(body, new Set([11]));
  assert.match(out, /- \[x\] #11 D1/);
  assert.match(out, /- \[ \] #12 D2/);
  // A line naming no issue is left exactly as written: a partly published programme is not a lie.
  assert.match(out, /- \[ \] D3 — unpublished/);
});

test('a landed task wants NO status label, and a stale one is stripped', () => {
  // That was the gap in the source: `landed` fell through the wanted-label lookup and an issue
  // published as `status:todo` kept carrying it after it landed, where it now reads as a lie.
  assert.deepEqual(planLabels([{ issue: 7, status: 'landed', labels: [LABELS.todo] }]),
    [{ issue: 7, add: [], remove: [LABELS.todo] }]);
  // `review` maps onto `wip`: from outside they are the same fact, somebody is on it.
  assert.deepEqual(planLabels([{ issue: 8, status: 'review', labels: [LABELS.todo] }]),
    [{ issue: 8, add: [LABELS.wip], remove: [LABELS.todo] }]);
  // A sync that changes nothing writes nothing — which is what makes it safe to run at the end of
  // every landing and on every tick.
  assert.deepEqual(planLabels([{ issue: 9, status: 'todo', labels: [LABELS.todo] }]), []);
  assert.deepEqual(planLabels([{ issue: 10, status: 'landed', labels: [] }]), []);
});

test('a programme closes only when it has tasks and every one of them is closed', () => {
  const programmeIssues = [{ number: 1, state: 'open', body: '## Tasks\n- [ ] #11 D1 — one\n' }];
  const closedAll = planProgrammes({
    programmeIssues,
    taskIssues: [{ number: 11, state: 'closed', body: 'Programme: #1\n' }],
  });
  assert.equal(closedAll[0].close, true);
  assert.match(closedAll[0].body, /- \[x\] #11/);

  // A programme with NO tasks is one mid-publication, not a finished one: closing it would delete a
  // roadmap between its first and second issue creation.
  assert.deepEqual(planProgrammes({ programmeIssues, taskIssues: [] }), []);
  // A closed programme is never revisited.
  assert.deepEqual(planProgrammes({
    programmeIssues: [{ ...programmeIssues[0], state: 'closed' }],
    taskIssues: [{ number: 11, state: 'closed', body: 'Programme: #1\n' }],
  }), []);
});

test('a task closes only on subjects the register recorded AND main carries', () => {
  const rows = [
    { key: 'demo/D1', issue: 11, issueState: 'open', status: 'landed', labels: [],
      landedHere: true, subjects: ['feat: one'] },
    // Landed by somebody else: their commit never reaches this machine's main, and their own
    // machine closes their own issue.
    { key: 'demo/D2', issue: 12, issueState: 'open', status: 'landed', labels: [],
      landedHere: false, subjects: [] },
    // Already closed: a close against a shut issue is an error, and being conservative costs a tick.
    { key: 'demo/D3', issue: 13, issueState: 'closed', status: 'landed', labels: [],
      landedHere: true, subjects: ['feat: three'] },
  ];
  const plan = planSync({ rows, programmeIssues: [], taskIssues: [] });
  assert.deepEqual(plan.close, [{ issue: 11, key: 'demo/D1', subjects: ['feat: one'] }]);
});

test("a row with no issue is not the shared channel's business", () => {
  const plan = planSync({
    rows: [{ key: 'demo/D1', issue: null, status: 'landed', landedHere: true, subjects: ['x'] }],
    programmeIssues: [], taskIssues: [],
  });
  assert.deepEqual(plan.close, []);
  assert.deepEqual(plan.labels, []);
});
```

Append to `test/store-github.test.mjs`, using that file's own `online(gh)` helper and `task`
constant rather than inventing a second context:

```js
test('store.sync closes the landed issue, strips its stale label and ticks the programme', () => {
  // The whole reconciler, end to end through the recorder — one code path, and the same one a
  // landing runs after its fast-forward.
  const f = makeFakeGh({
    issues: [
      { number: 1, title: 'demo — Demo roadmap', labels: [LABELS.programme],
        body: '- **Roadmap** demo\n\n## Tasks\n- [ ] #5 D1 — First thing\n' },
      { number: 5, title: taskTitle(task), labels: [LABELS.task, LABELS.todo],
        body: 'Programme: #1\n' },
    ],
  });
  const { store } = online(f);

  const res = store.sync([{
    key: 'demo/D1', issue: 5, status: 'landed', landedHere: true, subjects: ['feat: one'],
  }]);

  assert.deepEqual(res.closed, ['demo/D1']);
  assert.equal(f.state.find((i) => i.number === 5).state, 'closed');
  // A landed task wants NO status label: done is the issue being closed, and `status:todo` on a
  // closed issue is a second and weaker way to say it — one that now reads as a lie.
  assert.deepEqual(f.state.find((i) => i.number === 5).labels, [LABELS.task]);
  // The programme's checklist is ticked from what closed. It does NOT close in the same pass: the
  // plan was computed against the task states as they were, and a roadmap that ends a minute late
  // is a cosmetic lag while one that ends on a close that then failed is a lie.
  assert.match(f.state.find((i) => i.number === 1).body, /- \[ \] #5 D1/);
  assert.equal(f.state.find((i) => i.number === 1).state, 'open');
  assert.equal(res.programmes, 0);

  // Idempotent: a second run against the state it just produced closes the programme and nothing
  // else — which is what makes it safe on every landing and every tick.
  const again = store.sync([{
    key: 'demo/D1', issue: 5, status: 'landed', landedHere: true, subjects: ['feat: one'],
  }]);
  assert.deepEqual(again.closed, []);
  assert.equal(again.labels, 0);
  assert.equal(f.state.find((i) => i.number === 1).state, 'closed');
  assert.match(f.state.find((i) => i.number === 1).body, /- \[x\] #5 D1/);
});
```

**One thing this test will tell you, and it is worth reporting either way:** `makeFakeGh`'s
`closeIssue` ignores its comment body, so nothing here asserts the `Landed as:` comment
`applySync` passes. If you add that assertion, `test/helpers/gh.mjs` has to record the body — a
change to the ONE shared GitHub simulation, which is exactly the kind of thing that was
consolidated for a reason. Either record it there for every suite, or say in your report that the
comment body is untested and why you left it so.

Append to `test/both-modes.test.mjs`, beside the `setStatus` no-op:

```js
  // Offline there is nowhere to write a status, so `sync` does nothing — and that is correct
  // (spec §4.1), not a gap. It says why and exits 0.
  const s = p.store.sync([]);
  assert.equal(s.noop, true);
  assert.match(s.why, /nowhere/);
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/sync.test.mjs test/both-modes.test.mjs`
Expected: FAIL — `Cannot find module '../lib/store/github/sync.mjs'`, and `p.store.sync is not a
function`. Paste the output.

Note the apostrophe in the fourth test name: write it with double quotes, or JavaScript will not
parse the file.

- [ ] **Step 3: Give each board row `subjects` and `landedHere`**

In `lib/roadmap/board.mjs`, inside `reconcile`'s `statused` map, the register row `reg` and `git` are
both already in hand. Add two fields to the returned object, beside `issue`:

```js
      // What the shared channel needs and cannot derive: the subjects this machine recorded for the
      // row, and whether they are on ITS main branch. `sync` closes an issue on exactly that fact —
      // a shared task landed by another developer never reaches this main at all, and its own
      // machine closes its own issue, so "the branch is gone" would close it wrongly.
      subjects: reg?.subjects ?? [],
      landedHere: (reg?.subjects ?? []).some((s) => git.mainSubjects.has(s)),
```

Additive: `renderBoard` prints named columns and `--json` gains two keys.

- [ ] **Step 4: Write `lib/store/github/sync.mjs`**

Port the four functions from the source, keeping every comment's reasoning and its dates. The
signature changes are: `planSync` takes `{ rows, programmeIssues, taskIssues }` and no clock (the
stale-claim half is not ported), and it reads `r.landedHere` where the source recomputed the subject
intersection from a register it was handed.

```js
// Reconciling the shared channel with what landed here.
//
// The status label is a PROJECTION of the board's derivation, never a source. Everything below
// computes the DIFFERENCE and nothing else, so a sync that changes nothing writes nothing — which is
// what makes it safe to run at the end of every landing and on every conductor tick.
import { LABELS } from './issues.mjs';
import { programmeOf } from './ownership.mjs';
import { isLanded } from '../../roadmap/board.mjs';

// The programme checklist, ticked from what actually closed. Two-way on purpose: a reopened issue
// unticks. A checklist that could only ever advance would drift ahead of the truth exactly once, and
// then say so for ever.
//
// Only a line that NAMES an issue is touched, and only at the start of its own line: a `- [ ] A1 — …`
// from a partly published programme stays as written, and prose that happens to contain a checkbox
// mid-sentence is prose.
export function tickChecklist(body, closedNumbers) {
  return String(body ?? '').replace(/^- \[[ xX]\] #(\d+) /gm,
    (_m, n) => `- [${closedNumbers.has(Number(n)) ? 'x' : ' '}] #${n} `);
}

// `review` maps onto `wip` because from outside they are the same fact: somebody is on it. There is
// no third label, and a LANDED row asks for none at all — done is the issue being closed, and a
// status label on a closed issue would be a second and weaker way to say it.
//
// Wanting none is not the same as having nothing to do: an issue published as `status:todo` and
// landed since is carrying a label that now reads as a lie, and stripping it is this function's job.
// That was the gap in the source — `landed` fell through the lookup and the label stayed for ever.
export function planLabels(rows) {
  const wanted = { todo: LABELS.todo, claimed: LABELS.wip, review: LABELS.wip };
  const STATUS = [LABELS.todo, LABELS.wip];
  const out = [];
  for (const r of rows ?? []) {
    if (!r.issue) continue;
    const landed = isLanded(r.status);
    if (!landed && !(r.status in wanted)) continue;
    const want = landed ? null : wanted[r.status];
    const has = r.labels ?? [];
    const stale = STATUS.filter((l) => l !== want && has.includes(l));
    if ((!want || has.includes(want)) && !stale.length) continue;
    out.push({ issue: r.issue, add: want && !has.includes(want) ? [want] : [], remove: stale });
  }
  return out;
}

// A roadmap ends when every one of its tasks is closed, and then its programme issue closes too —
// which is what makes a finished roadmap leave the board.
//
// A programme with NO tasks is one mid-publication, not a finished one: closing it would delete a
// roadmap between its first and second `createIssue`. And a programme whose checklist already
// matches and cannot close asks for nothing, so a tick that changed nothing writes nothing.
export function planProgrammes({ programmeIssues, taskIssues }) {
  const out = [];
  for (const p of programmeIssues ?? []) {
    if (p.state === 'closed') continue;
    const mine = (taskIssues ?? []).filter((t) => programmeOf(t.body) === p.number);
    const closed = new Set(mine.filter((t) => t.state === 'closed').map((t) => t.number));
    const body = tickChecklist(p.body, closed);
    const close = mine.length > 0 && closed.size === mine.length;
    if (!close && body === p.body) continue;
    out.push({ issue: p.number, body, close });
  }
  return out;
}

export function planSync({ rows, programmeIssues = [], taskIssues = [] }) {
  const close = [];
  for (const r of rows) {
    if (!r.issue) continue;
    // Gated on the ISSUE's state, never on the derived status: a task I own derives `landed` from
    // GIT, so a guard on the derived status would suppress the very close it was meant to trigger —
    // measured on the 2026-09-01 migration in planetCraft, 31 issues open and 18 of them provably
    // landed. An absent state closes nothing: a close against an already-shut issue is an error, and
    // being conservative here costs one tick.
    if (r.issueState === 'open' && r.landedHere)
      close.push({ issue: r.issue, key: r.key, subjects: r.subjects ?? [] });
  }
  return {
    close,
    labels: planLabels(rows),
    // Computed against the task states as they are NOW, so a task this run is about to close is
    // still open here and its programme closes on the NEXT sync — one tick or one landing later.
    // Closing it in the same pass would mean acting on a state not yet written, which is the worse
    // of the two: a roadmap that ends a minute late is a cosmetic lag, one that ends on a close that
    // then failed is a lie.
    programmes: planProgrammes({ programmeIssues, taskIssues }),
  };
}

export function applySync(gh, plan) {
  for (const c of plan.close)
    gh.closeIssue(c.issue, `Landed as:\n${c.subjects.map((s) => `- ${s}`).join('\n')}`);
  for (const l of plan.labels ?? [])
    gh.updateIssue(l.issue, { addLabels: l.add, removeLabels: l.remove });
  for (const p of plan.programmes ?? []) {
    gh.updateIssue(p.issue, { body: p.body });
    if (p.close) gh.closeIssue(p.issue, 'Every task on this roadmap has landed.');
  }
}
```

- [ ] **Step 5: Add `sync` to both stores**

`lib/store/github/index.mjs`, beside `setStatus` and `close`:

```js
    // The board knows what landed; only this store knows what the issues currently say. Joined here
    // rather than widened into the overlay, which every `board` pays for and only `sync` reads.
    sync(rows) {
      const tasks = taskIssues();
      const programmes = programmeIssues();
      const byKey = new Map(tasks.map((i) => [keyFromTitle(i.title), i]));
      const enriched = rows.map((r) => {
        const i = byKey.get(r.key);
        return { ...r, labels: i?.labels ?? [], issueState: i?.state ?? null };
      });
      const plan = planSync({ rows: enriched, programmeIssues: programmes, taskIssues: tasks });
      applySync(gh, plan);
      return {
        noop: false,
        closed: plan.close.map((c) => c.key),
        labels: plan.labels.length,
        programmes: plan.programmes.length,
      };
    },
```

`lib/store/files.mjs`, beside its `setStatus` no-op:

```js
    // Spec §4.1: offline there is nowhere to write a status, so this does nothing — and that is
    // correct rather than missing. The "never write a status anywhere" invariant is structural here:
    // there is no field to write one into.
    sync: () => ({ noop: true, why: `${NOOP_WHY} — and nowhere to write a status` }),
```

- [ ] **Step 6: Wire `case 'sync'` in `lib/cli/roadmap.mjs`**

```js
function cmdSync(cfg, deps) {
  const store = makeStore(cfg, deps);
  const state = readState(cfg.root);
  const b = reconcile({
    tasks: store.list(),
    git: gatherGit(cfg.root, { mainBranch: cfg.mainBranch }),
    register: state?.tasks ?? [],
    overlay: store.overlay(),
  });
  const r = store.sync(b.rows);
  if (r.noop) return out(`sync: nothing to do — ${r.why}`);
  out(`sync: closed ${r.closed.length ? r.closed.join(', ') : 'nothing'};`
    + ` ${r.labels} label change(s); ${r.programmes} programme(s) updated`);
}
```

and in the switch: `case 'sync': return cmdSync(cfg, deps);`, plus `sync` in the `known:` list of the
default branch's error message.

- [ ] **Step 7: Run the tests**

Run: `npm test`
Expected: PASS. `test/cli-roadmap.test.mjs` asserts the unknown-subcommand message; if it lists the
known verbs, `sync` joins them.

- [ ] **Step 8: Commit**

Stage the six files and the three test files, message:
`feat(roadmap): sync — close what landed, strip a label that became a lie, end a finished roadmap`

---

### Task 6: what the gate writes after the fast-forward

**Files:**
- Modify: `lib/register/state.mjs` (add `recordLanding`)
- Modify: `lib/gate/land.mjs` (call it, then `roadmap sync`, both best-effort)
- Modify: `test/state.test.mjs` (append)
- Modify: `test/p3-acceptance.test.mjs` (append)
- Source: `~/Projects/planetCraft/tools/roadmap/register.mjs`'s `recordLanding`, and
  `tools/merge-queue.mjs`'s `recordLandedSubjects` and `syncLandedIssue`

**Interfaces:**
- Consumes: Task 5's `orchestra roadmap sync`; `lib/register/state.mjs`'s `readState`/`writeState`.
- Produces: `recordLanding(state, branch, subjects) -> {state, matched}`.

**Why this is the gate's job and not the conductor's.** `skills/orchestra/SKILL.md` asks a conductor
to copy the branch's commit subjects into its register row by hand before handing over. Measured
2026-08-20 in planetCraft: skipped for 22 of the 41 landed rows, every one left with `subjects: []` —
which the board can never match, so it printed `todo` for finished work and a session re-planned a
task two days after it had landed. Here the information cannot be missing: the branch is named on the
command line and its commits are exactly `mainBefore..mainBranch`.

**Both writes are BEST EFFORT and neither may change the exit code.** The main branch has already
moved when they run. A landing that has fast-forwarded must not report failure because a JSON file
could not be written or because GitHub was down. What makes that safe is not the author's care but
the acceptance test below, which runs a whole landing and asserts the row afterwards — a catch that
can turn a programming error into a warning needs something exercising the path, or it hides one.
The source shipped exactly that bug: `MAIN` was read from an enclosing scope where it did not exist,
every call threw, the catch printed one warning line, and the landing exited 0 looking successful
while the register was never written. Two days, every landing (`t-1x6goyh`).

- [ ] **Step 1: Write the failing tests**

Append to `test/state.test.mjs`:

```js
test('recordLanding unions subjects onto the matching row and never duplicates them', () => {
  // A row that lands in two goes — a follow-up after a held branch — keeps the subjects of both, and
  // re-running `land` on the same branch cannot duplicate them.
  const state = { tasks: [{ id: 'demo/D1', branch: 'demo/d1', subjects: ['feat: one'], status: 'review' }] };
  const once = recordLanding(state, 'demo/d1', ['feat: one', 'fix: two']);
  assert.equal(once.matched, 'demo/D1');
  assert.deepEqual(once.state.tasks[0].subjects, ['feat: one', 'fix: two']);
  assert.equal(once.state.tasks[0].status, 'landed');
  // A branch with no row is the ordinary case (a fix, a study) and says nothing.
  assert.equal(recordLanding(state, 'nobody/knows', ['x']).matched, null);
  assert.equal(recordLanding({}, 'demo/d1', ['x']).matched, null);
});
```

Append to `test/p3-acceptance.test.mjs`:

```js
test('a landing records its commit subjects on the register row that named the branch', () => {
  // THE WHOLE PATH, in a scratch repository, because the write is wrapped in a catch that can turn a
  // programming error into one warning line — which is exactly how the source shipped a landing that
  // exited 0 while the register was never written, for two days and every landing.
  const r = project([{ name: 'green', cmd: 'true' }]);
  const { branch } = branchWith(r);
  writeFileSync(join(r.root, '.orchestra', 'state.json'), `${JSON.stringify({
    version: 1, root: r.root, adopted: true,
    conductor: { session: null, language: null, inboxSeen: null },
    budgetResetAt: null,
    tasks: [{ id: 'demo/D1', branch, subjects: [], status: 'review' }],
  }, null, 2)}\n`);

  assert.equal(run(r.root, 'land', branch).code, 0);
  const state = JSON.parse(readFileSync(join(r.root, '.orchestra', 'state.json'), 'utf8'));
  assert.deepEqual(state.tasks[0].subjects, ['feat: the branch does a thing']);
  assert.equal(state.tasks[0].status, 'landed');
});

test('an unwritable register does not stop a landing that has already merged', () => {
  const r = project([{ name: 'green', cmd: 'true' }]);
  const { branch } = branchWith(r);
  writeFileSync(join(r.root, '.orchestra', 'state.json'), 'not json at all');
  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 0, out);
  assert.match(out, /landed, but the register was not updated/);
  assert.deepEqual(branches(r), ['main']);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/state.test.mjs test/p3-acceptance.test.mjs`
Expected: FAIL — `recordLanding is not exported`, and the acceptance's register row still has
`subjects: []`. Paste the output.

- [ ] **Step 3: Add `recordLanding` to `lib/register/state.mjs`**

```js
// What the merge gate writes onto a row the moment its branch reaches the main branch, from the one
// process that knows both halves. The conductor is asked to record these by hand BEFORE handing a
// branch over; measured 2026-08-20 in planetCraft, that was skipped for 22 of 41 landed rows, every
// one left with `subjects: []` — which the board can never match, so it printed `todo` for finished
// work and a session re-planned a task two days after it had landed.
//
// Matched on the BRANCH, which is what the gate was given, and never on a key it would have to
// guess. A branch with no row is the ordinary case — a fix, a study — and matches nothing.
export function recordLanding(state, branch, subjects) {
  const rows = state?.tasks;
  if (!Array.isArray(rows) || !branch) return { state, matched: null };
  const i = rows.findIndex((t) => t.branch === branch);
  if (i < 0) return { state, matched: null };

  const row = rows[i];
  // Union, existing first: a row that lands in two goes — a follow-up after a held branch — keeps
  // the subjects of both, and re-running `land` on the same branch cannot duplicate them.
  const seen = new Set(row.subjects ?? []);
  const merged = [...(row.subjects ?? [])];
  for (const s of subjects) if (s && !seen.has(s)) { seen.add(s); merged.push(s); }

  const tasks = rows.slice();
  tasks[i] = { ...row, subjects: merged, status: 'landed' };
  return { state: { ...state, tasks }, matched: row.id ?? branch };
}
```

- [ ] **Step 4: Call it from `lib/gate/land.mjs`, and then `sync`**

Read the main branch's tip **before** the fast-forward — it is what makes the landed subjects
computable without asking the branch, which the cleanup is about to delete:

```js
  const mainBefore = gitOk(cfg.root, ['rev-parse', cfg.mainBranch])
    ? git(cfg.root, ['rev-parse', cfg.mainBranch]) : '';
```

and after the successful `merge --ff-only`, before the cleanup:

```js
  // Two writes the gate makes for others, in the one moment both halves of the fact exist in one
  // process. BOTH ARE BEST EFFORT AND NEITHER MAY CHANGE THE EXIT CODE: the main branch has already
  // moved, and a landing must not report failure because a JSON file could not be written or because
  // a network was down.
  const landedKey = recordLandedSubjects(cfg, branch, mainBefore);
  // Only when a register row actually matched: a fix branch or a study has no issue to close, and
  // spending a round trip under the lock to discover that is waste. Online only — offline `sync`
  // correctly does nothing (spec §4.1) and a spawn per landing to be told so is pure cost.
  if (landedKey && cfg.mode === 'online') syncLandedIssue(cfg, landedKey);
```

with the two helpers beside `commitLedgers`:

```js
// `cfg` is a PARAMETER, and the reason is the bug this cost in the source: it read the checkout path
// out of an enclosing scope where it was not defined, so every call threw on its first git
// invocation, the catch below turned it into its one warning line, and the landing exited 0 looking
// successful while the register was never written. Two days, every landing (`t-1x6goyh`). What makes
// the catch safe now is not care but `test/p3-acceptance.test.mjs`, which runs a whole landing in a
// scratch repository and asserts the row afterwards.
function recordLandedSubjects(cfg, branch, mainBefore) {
  try {
    if (!mainBefore) return null;
    const subjects = git(cfg.root, ['log', '--format=%s', `${mainBefore}..${cfg.mainBranch}`])
      .split('\n').filter(Boolean);
    if (!subjects.length) return null;
    const state = readState(cfg.root);
    if (!state) return null;
    const { state: next, matched } = recordLanding(state, branch, subjects);
    if (!matched) return null;
    writeState(cfg.root, next);
    err(`recorded ${subjects.length} subject(s) on register row '${matched}'`);
    return matched;
  } catch (e) {
    err(`landed, but the register was not updated (${e.message})`
      + " — `orchestra roadmap board` will read this row as unverified");
    return null;
  }
}

// The WHOLE reconciler, not a bespoke close: `roadmap sync` closes the issue off the subjects just
// recorded, moves the status labels and ticks the programme's checklist. One code path, idempotent,
// and the conductor's tick runs the same one — so a landing that could not reach the channel is
// caught by the next tick rather than lost.
//
// Bounded, because this runs while the lock is held and a hung network call would block every branch
// behind it.
function syncLandedIssue(cfg, key) {
  const r = spawnSync(process.execPath, [BIN, 'roadmap', 'sync'],
    { cwd: cfg.root, encoding: 'utf8', timeout: 120_000, env: gateEnv() });
  if (r.status === 0) { err(`synced the shared channel for '${key}'`); return; }
  const why = (r.stderr || r.error?.message || `exit ${r.status}`).split('\n').filter(Boolean).pop() ?? 'failed';
  err(`landed, but the shared channel was not synced for '${key}' (${why.trim()})`
    + " — run `orchestra roadmap sync` when the channel is reachable");
}
```

`BIN` is the same constant `lib/gate/run.mjs` resolves from `import.meta.url`. **Two modules
resolving the same path twice is one too many** — export it from one and import it in the other, and
say in your report which way round you did it.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

Stage the four files, message:
`feat(gate): the two writes a landing owes, from the one process that knows both halves`

---

### Task 7: `orchestra ready` reconciles against the project's own main branch

**Files:**
- Modify: `lib/register/ready.mjs` (`gatherGit`)
- Modify: `lib/cli/tick.mjs` (pass `cfg.mainBranch`)
- Modify: `test/ready.test.mjs` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `gatherGit(root, { mainBranch = 'main', run } = {}) -> { branches, mainSubjects }` —
  the same shape as before, with the branch name no longer hardcoded.

**Why P3 owes this fix.** `lib/roadmap/board.mjs`'s `gatherGit` takes `cfg.mainBranch`; this one
hardcodes the literal `main`, so a project on `master` gets a `ready` set that reconciles nothing, in
silence. P2b named the limitation and deliberately left it, and was right to: fixing another phase's
code inside a documentation phase was the wrong trade. **P3 is the phase that makes it bite.** Until
now the defect was latent because nothing in the plugin could land a branch; from the moment this
gate ships, a project on `master` can land branches that `orchestra ready` will never see as landed —
a working half beside a silently broken one, which is worse than two broken halves.

**What this task does NOT change:** the `-200` window on `git log`. `board.mjs` deliberately has none
and says why at length; this one has one. Reconciling those two is a separate decision with its own
reasoning, and a rider on this fix is not the place to take it.

- [ ] **Step 1: Write the failing test**

Append to `test/ready.test.mjs`. It already imports `makeRepo` and `gatherGit` and already has a
`repo()` helper with an `after` cleanup — use those. Add `join` to its imports (`node:path` is not
imported there yet):

```js
test('gatherGit reconciles against the configured main branch, not the literal main', () => {
  const r = repo();
  r.git('branch', '-m', 'main', 'master');
  r.git('worktree', 'add', '-q', '-b', 'feat/x', join(r.root, 'wt'), 'master');
  const git = gatherGit(r.root, { mainBranch: 'master' });
  // The main branch is not one of the branches to reconcile against itself...
  assert.deepEqual(git.branches, ['feat/x']);
  // ...and its subjects are the landing oracle.
  assert.ok(git.mainSubjects.includes('initial'));
});

test('an unborn main branch is a project with no landed history, not a crash', () => {
  const r = repo();
  const git = gatherGit(r.root, { mainBranch: 'trunk' });
  assert.deepEqual(git.mainSubjects, []);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/ready.test.mjs`
Expected: FAIL — the first case returns `['feat/x', 'master']` (the filter still drops the literal
`main`, which no longer exists) and the second throws on `git log trunk`. Paste both.

- [ ] **Step 3: Fix `gatherGit`**

```js
export function gatherGit(root, { mainBranch = 'main' } = {}) {
  const env = gitEnv();
  const sh = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env }).trim();
  const refs = sh(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
    .split('\n').map((s) => s.trim()).filter(Boolean);
  const branches = refs.filter((b) => b !== mainBranch);
  // An unborn `mainBranch` — a fresh repository, or a default branch nobody has committed to yet —
  // is not a broken repository; it is a project with no landed history, and the honest answer is an
  // empty list. Asked via `refs`, which is already in hand, rather than by matching git's own error
  // text: that text is locale-dependent, so a message match would miss the moment this runs on
  // somebody else's machine. `lib/roadmap/board.mjs` answers the same question the same way.
  const mainSubjects = refs.includes(mainBranch)
    ? sh(['log', '--format=%s', '-200', mainBranch]).split('\n').filter(Boolean)
    : [];
  return { branches, mainSubjects };
}
```

Note the change from `execSync` with a command string to `execFileSync` with an argument array:
`mainBranch` is a value from a config file, and interpolating it into a shell string is an injection
the old form could not have. Update the `node:child_process` import accordingly.

- [ ] **Step 4: Pass it from `lib/cli/tick.mjs`**

```js
  const git = gatherGit(cfg.root, { mainBranch: cfg.mainBranch });
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

Stage the three files, message:
`fix(ready): reconcile against the project's own main branch, not the literal name`

---

### Task 8: `agents/merge_agent.md` — the one actor allowed to run the gate

**Files:**
- Create: `agents/merge_agent.md`
- Source: `~/Projects/planetCraft/.claude/agents/merge_agent.md`, ported project-neutral

**Interfaces:**
- Consumes: the three subcommands and the exit table Tasks 3 and 4 shipped.
- Produces: nothing code reads. This is a document the harness loads, which is why Task 10's version
  bump is not optional.

**The port's transformations**, the same two P2b used on the skill:

- every `node tools/merge-queue.mjs <verb>` becomes `orchestra <verb>` — and the invocation form is
  stated once at the top, `"${CLAUDE_PLUGIN_ROOT}/bin/orchestra"`, exactly as
  `skills/orchestra/SKILL.md` and `skills/roadmap/SKILL.md` state it;
- every measurement is attributed. "262 s on a quiet machine and 1652 s under load" is one project's
  suite on one machine and must say so; the RULE it pays for — a landing outruns a 600-second tool
  call — is general and is stated as general.

**What changes beyond the substitutions**, and each is a real difference rather than a rewording:

1. **The exit table loses 14 and gains a name.** 11 now covers every refusing gate, and the agent is
   told to report **which gate** and its output — that is what replaced the second number.
2. **"the full suite" becomes "a gate".** This plugin does not know what a project runs; it knows
   that a named gate refused. Every sentence that said "the suite is red" says "the gate named in
   the report refused".
3. **`main` becomes "the project's main branch"** wherever the agent types or reads it, because
   `mainBranch` is configurable and this agent is installed in projects that are not on `main`.
4. **Nothing about pushing, and nothing about a remote.** The source forbids `git push` and PRs
   because a human ruled it there. Here the gate simply has no remote behaviour at all — it never
   pushes, and it does not delete a remote ref either (see "What P3 does not do"). Say what the
   agent does; do not import another project's ruling as though it were this plugin's.
5. **The description names `orchestra land`, not a file path.** A `tools/` path would be an
   instruction nobody in an arbitrary project can follow.

- [ ] **Step 1: Write `agents/merge_agent.md`**

```markdown
---
name: merge_agent
description: Integration agent that lands finished worktree branches onto the project's LOCAL main branch, one at a time, through orchestra's merge gate (`orchestra land`). The gate holds a lock across rebase → gates → fast-forward, so a second merge_agent waits its turn instead of gating a base the first is about to invalidate. The agent's own job is resolving conflicts and reporting. It merges locally only — it never opens a pull request and never pushes. Use when a finished worktree branch is ready to land, and have other agents, loops and scheduled jobs call this instead of doing their own merges.
tools: Bash, Read, Edit, Grep, Glob
---

You are the integration agent for this project. You land finished worktree branches onto its
**local main branch**, and you are the only actor that does.

Every command below is:

```sh
"${CLAUDE_PLUGIN_ROOT}/bin/orchestra" <subcommand>
```

Run it from anywhere inside the project. From here on this document writes `orchestra <subcommand>`
and means that. Run `orchestra doctor` first if you do not know the project's `mainBranch` — this
document never assumes it is called `main`.

## Absolute rules

- **Local only. Never `git push`. Never open a pull request.** The gate itself has no remote
  behaviour at all: it does not push, and it does not delete a remote ref.
- **The main branch is integrate-only.** You land work by merging finished branches; you never
  author feature commits on it yourself.
- **You do not perform the landing by hand.** `orchestra land` does it, and it holds a lock for the
  whole rebase → gates → fast-forward, so a second merge_agent running at the same time waits its
  turn instead of gating a base the first one is about to invalidate. Doing the steps yourself
  defeats that and is never correct.

## Landing a branch

**Two commands, both in the FOREGROUND:**

```sh
orchestra land <branch> --detach     # returns at once, exit 15
orchestra await <branch> --for=540   # blocks up to 9 minutes, then reports
```

**Never background either call, and never run `land` twice.** If `await` returns 12, the landing is
still going: **run the same `await` again**, as many times as it takes.

This shape exists because the old one could not work, and the reason is worth knowing so you do not
"simplify" it back. A landing is one process from the lock to the fast-forward, and the gates inside
it are minutes — a full test suite in the project this was extracted from measured 262 s on a quiet
machine and 1652 s under load — against a 600-second ceiling on your Bash call. Foreground therefore
loses whenever the machine is busy. But backgrounding is worse: **you have no tool with which to
wait on a background job** — no Monitor, no TaskOutput — so your only move is to end your turn, and
a subagent that ends its turn is over. The landing then outlives the only process that knew its exit
code. That is not a risk, it is what happened, repeatedly. With `--detach`/`await` nothing needs a
notification, so nothing can miss one: the outcome is on disk, and any session can read it,
including one that starts after you are gone.

Then act on the exit code `await` gives you:

| Code | Meaning | What you do |
|---|---|---|
| 0 | landed; the worktree and the ref are deleted | report it |
| 10 | conflict; the rebase was aborted and the conflicted paths are named | resolve (below), then run `land` again |
| 11 | **a gate refused**; the main branch is untouched | STOP. Report **which gate** and what it printed. Do not retry, do not fix the branch — that is its author's call |
| 12 | still queued, or still landing | run the same `await` again |
| 13 | a precondition failed (dirty tree, missing branch, no worktree, refused cleanup) | report exactly what it named |
| 15 | `land --detach` started it | run `await` |
| 16 | killed, and no outcome was recorded | see below |

**Exit 11 always names a gate**, in `await`'s own report and in `orchestra queue-list`. That name is
the whole verdict: this plugin does not know whether your project's `suite` is vitest or `cargo
test`, and "the gate named `deadcode` refused, here is its output" is what its author needs.

### Exit 16 — killed, not finished

The process is gone and never wrote an outcome, so **nobody knows how far it got**. Do not re-run
`land` on the assumption that nothing happened: it may have merged already.

```sh
orchestra queue-list
git -C <main checkout> log --oneline -3
```

- **the branch is gone and its commits are on the main branch** — it landed. Report that; do not run
  `land` again, it would fail on a branch that no longer exists and read as a new problem.
- **the branch is still there** — the lock is released by an exit handler and a dead holder is reaped
  by pid liveness, so the queue is not wedged. `land --detach` again and let it start over.

A session of yours ending is not one of the ways this happens: your turn ending does not touch the
detached process, which is the point of `--detach`. Exit 16 means something really killed it — a
reboot, a `kill -9`, the machine going to sleep.

## Resolving a conflict (exit 10)

This is the one part of a landing that needs judgement, and the only reason you are here.

1. Rebase in the branch's own worktree: `git -C <worktree> rebase <mainBranch>`.
2. Resolve, using the intent you were given. When unsure which side wins, prefer preserving **both**
   intents — keep the main branch's runtime *values* while keeping the branch's *comments and
   refactor* — and never drop a side silently.
3. `git -C <worktree> add -A && git -C <worktree> rebase --continue`.
4. Run `land --detach` again. It will re-rebase onto whatever the main branch is by then, so the
   conflict can reappear if it moved; that is expected and self-correcting.

Interactive git (`-i`) is unavailable here; script the resolution.

## Reporting

Per branch: landed or held? If held, which code, **which gate**, and what it said. If you resolved a
conflict, which files and how you resolved each one — never just "resolved".
```

- [ ] **Step 2: Check the document against the code, not against this plan**

Run each command in a scratch fixture and confirm the exit codes and the wording of the messages
the table describes. **Paste the output of:**

```sh
grep -n "EXIT = {" -A 12 lib/gate/state.mjs
```

into your report, beside the table you wrote. A table that disagrees with `EXIT` by one number is
the whole failure mode of this document.

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: PASS (this task adds no code).

- [ ] **Step 4: Commit**

Stage `agents/merge_agent.md`, message:
`docs(gate): merge_agent — two commands, and an exit 11 that names its gate`

---

### Task 9: `skills/orchestra/SKILL.md` — every "phase 3" it names is now here

**Files:**
- Modify: `skills/orchestra/SKILL.md`
- Modify: `test/p2b-acceptance.test.mjs` if — and only if — one of its fourteen anchors sits inside a
  sentence this task rewrites

**Interfaces:**
- Consumes: everything Tasks 3–6 shipped, and Task 8's agent.
- Produces: nothing code reads.

**This is the only task in the phase that rewrites another phase's document, and it is last for that
reason.** The document is 1 247 lines of rules that were each paid for; P2b's plan and its branch
review are what stand behind them. **You are changing tense, not content.** A sentence that says
"phase 3 will bring X" becomes a sentence that says what X does. A rule does not change because its
enforcement arrived — the six nevers are unchanged, the framing pass is unchanged, and "you never
merge" is still true: the conductor hands a branch to `merge_agent`, which is a different actor.

- [ ] **Step 1: Find every site, and PASTE THE GREP**

```sh
grep -n "phase 3\|phase three\|merge_agent\|orchestra land\|orchestra await\|queue-list\|roadmap sync\|do not perform\|user's to land\|the user's to" skills/orchestra/SKILL.md
```

**Paste that output verbatim into your report before you edit anything, and cite every later change
by a line number that came out of it.** Three tasks in P2b filed citations that were wrong — one
naming the wrong file entirely — before the method changed to pasting `grep -n` rather than copying
a number by hand. Re-run the grep after your edits and paste it again: the second run is what proves
no site was missed.

- [ ] **Step 2: Rewrite `## What is not here yet`**

The two phase-3 bullets go. What replaces them is **not nothing** — two of the three facts they
carried are still true, and one has become a limitation rather than an absence:

- the merge gate bullet is **deleted**: `orchestra land`, `orchestra await`, `orchestra queue-list`,
  the `merge_agent` agent and the `gates`/`ledgers` config are all here.
- `orchestra roadmap sync` moves from "phase 3, online only" to a **limitation**: it exists, and
  **offline it does nothing and that is correct** (spec §4.1) — there is nowhere to write a status.
- **`ledgers` is empty in every project until phase 5** brings the ticket queue. The gate commits
  what that key lists at the head of every landing; with nothing listed it commits nothing, and a
  conductor's `postLanding` remains the way a branch gets a main-branch ledger written.

Keep the section's own rule: an absent command is named with its phase and never as something to
type. The phase-4 and phase-5 bullets are untouched.

- [ ] **Step 3: Rewrite the tick's step 6, "Landings"**

Today it says the conductor does not perform a landing, that an approved branch is the user's, and
that phase 3 will bring the hand-off. Replace that with the hand-off itself. Keep, unchanged and in
place: the two flavours of a refused gate and the ablation rule; `postLanding`; the results-page
rule; and "record the branch's commit `subjects` in the row before it lands".

**Keep that last one even though Task 6 made the gate do it**, and say why in a clause: the gate
records them from the one process that knows both halves, and the conductor's own copy is what makes
the row readable if the gate's best-effort write fails. Two writers of one field is worth a sentence
rather than a silent removal.

What the conductor now does when a branch is ready:

```sh
orchestra land <branch> --detach     # returns at once, exit 15
orchestra await <branch> --for=540   # exit 0 landed, 11 a gate refused, 12 run it again
```

or hands the branch to the `merge_agent` agent, which is the same two commands with the conflict
judgement attached. **Never background either call.** Then: journal the `landing` line, carry it in
the checkpoint (never #1), and re-run step 1 — the launch step picks up whatever the landing
unblocked.

- [ ] **Step 4: Rewrite the four remaining "(`gates`, phase 3)" sites**

They are in never #1, the framing pass, the playtest gate, and step 6's refused-gate paragraph. Each
becomes "(`gates`)" or "the project's own `gates` entry" — the parenthetical named a phase, not a
fact, and the fact is unchanged.

- [ ] **Step 5: Rewrite the merge-approval stamp rule**

In the journal's third obligation it reads, today, "for a merge approval that means after the
landing has actually happened — in this phase, after the user reports it landed; phase 3's
`merge_agent` is what will return in its place." It now means: **after `orchestra await` has returned
0**. Keep the 2026-08-13 measurement in full — the approval stamped at 13:17:20, the hand-off
journalled, the landing that never happened because the session ended, the four hours before a human
asked. That measurement is now the argument FOR the shape that exists, not a promise about one.

- [ ] **Step 6: Rewrite step 7's `sync` paragraph**

`orchestra roadmap sync` exists. It closes what the register proves landed, moves every `status:`
label onto what the board derives, ticks each programme's checklist, and closes a finished programme
— which is what makes a finished roadmap leave the board. It is idempotent: a tick that changed
nothing writes nothing. **It is the BACKSTOP, not the primary writer** — the merge gate runs the same
command after every fast-forward, online only. Offline it does nothing, and that is correct.

Also in that step: "**No command in this phase reports a board as stale**" is still true (`guard-claim`
is phase 5's). Leave the stale-board rule exactly as it stands.

- [ ] **Step 7: Rewrite the two remaining tense sites**

- the tick's closing paragraph: "the landing re-invokes you once phase 3 brings it" → the landing
  re-invokes you, now, when `await` returns;
- the playtest gate's "The hand-off itself is phase 3's" → the hand-off is the two commands above,
  and a landing deletes the worktree and the ref.

- [ ] **Step 8: Re-run the grep, and the P2b acceptance**

```sh
grep -n "phase 3\|phase three" skills/orchestra/SKILL.md
```
Expected: **no output.** Paste it (or whatever it prints) into your report.

Run: `node --test test/p2b-acceptance.test.mjs`
Expected: PASS, unchanged. Its fourteen anchors are measurements, not tense — if one broke, you
rewrote a rule rather than a promise, and that is the finding to report rather than a test to edit.

- [ ] **Step 9: Run the whole suite and commit**

Run: `npm test`
Stage `skills/orchestra/SKILL.md`, message:
`docs(orchestra): the merge gate is no longer a promise, and the protocol says so`

---

### Task 10: the release — README, the version bump, and the hand-over

**Files:**
- Modify: `README.md` ("What works today", and the example `gates` entry)
- Modify: `.claude-plugin/plugin.json` (0.3.1 → 0.4.0)

**Interfaces:** none. This is what makes everything above reach a user.

**Why the bump is not optional, and why it is last.** The plugin cache is indexed by VERSION. Shipping
a skill or an agent under an unchanged version never makes it visible — the 0.2.0 installed at the
time contained only `skills/roadmap`, and nothing about that was diagnosable from the repository.
This phase adds `agents/merge_agent.md`, a file the harness loads, and rewrites
`skills/orchestra/SKILL.md`, another. **Both are invisible until this number changes.**

- [ ] **Step 1: Bump the version**

`.claude-plugin/plugin.json`: `"version": "0.4.0"`.

Minor, not patch: this phase adds an agent and three subcommands. 0.3.1 was a patch because it
shipped corrections to a document.

- [ ] **Step 2: Rewrite the README's "What works today"**

Add, in the same voice as the existing entries:

```markdown
- **`orchestra land <branch> [--detach] | await <branch> [--for=N] | queue-list`** — the merge gate:
  one branch at a time behind a lock, the project's own `gates` run in order in the rebased
  worktree, a fast-forward, and the worktree and ref deleted. `--detach` and `await` exist because a
  landing outlives the 600-second ceiling on an agent's tool call; the outcome is on disk, so any
  session can collect it. A refusing gate returns 11 **and names itself**.
- **`orchestra roadmap sync`** — online: close what landed, move the `status:` labels, tick each
  programme's checklist, close a finished roadmap. Offline it does nothing, and that is correct:
  there is nowhere to write a status.
- **`merge_agent`** — the agent that runs the gate, resolves a conflict and reports. Nothing else
  should land a branch.
```

and correct the "Not yet" line: the monitoring page and `orchestra instances` (4); the guard hooks,
`orchestra init`, the ticket queue and the heartbeat (5).

Add a `gates` example under the opt-in section, since the config's most important key now has a
reader:

```jsonc
{
  "mode": "offline",
  "gates": [
    { "name": "deadcode", "cmd": "npm run knip" },
    { "name": "suite",    "cmd": "npm test" },
    { "name": "visual",   "cmd": "npm run gate:visual",
      "skipWhenAllPathsMatch": ["docs/**", "**/*.md", "tests/**"] }
  ]
}
```

with one sentence: gates run in the order written, cheapest first is the project's call, and
`skipWhenAllPathsMatch` skips a gate **only** when every changed path matches — an unreadable or
empty diff runs it.

- [ ] **Step 3: Write the hand-over section in the README, or in this plan**

Four things P3 leaves for a later phase. Put them where the phase that needs them will look:

1. **P5's `.orchestra/.gitignore` must cover `gate/`.** Spec §3.2's list of gitignored runtime state
   predates this phase and does not name it. `orchestra init` writes that file; without the line, a
   project commits its queue record, its logs and its run records.
2. **P5's `guard-main-commit` must reconcile two markers for one fact:** `ORCHESTRA_GATE` (set by the
   gate) and `ORCHESTRA_WRITES_MAIN` (set by `lib/store/files.mjs`). And it must decide how a
   PreToolUse hook reads either, since a hook sees the agent's command text and not this process's
   environment.
3. **P5's ledger commit owes a cross-process lock.** `commitLedgers` takes none, because there is no
   ticket queue to take one from yet.
4. **`rerere.enabled` belongs in P5's `templates/CLAUDE-rules.md` and in `doctor`**, not in a gate
   that refuses. A queue that rebases branches all day meets recurring conflict hashes, and rerere's
   cache is shared by every worktree of a repository.

- [ ] **Step 4: Run everything, twice, and check for orphans**

Run: `npm test && npm test`
Expected: PASS both times. Record the total.

Run: `pgrep -fl 'bin/orchestra land' || echo 'no orphaned landings'`
Expected: `no orphaned landings`.

- [ ] **Step 5: Commit**

Stage `README.md` and `.claude-plugin/plugin.json`, message:
`chore(plugin): 0.4.0 — the merge gate, roadmap sync, and merge_agent`

### Hand-over to P5

Recorded here, not in the README, because each item is a fact about this phase's own code that only
becomes actionable once P5 exists to act on it — a reader of the plan that adds the ticket queue and
`orchestra init` is who needs to find these, not a user of `orchestra land` today.

1. **`.orchestra/.gitignore` must cover `gate/`.** Spec §3.2's list of gitignored runtime state
   predates this phase and does not name it. `orchestra init` writes that file; `lib/gate/land.mjs`'s
   `gatePaths` creates `.orchestra/gate/queue.json`, `gate/runs/`, `gate/logs/`, `gate/waiters`,
   `gate/holder` and `gate/mutex` — without the line, a project commits its queue record, its logs
   and its run records.
2. **`guard-main-commit` must reconcile two markers for one fact.** `lib/gate/land.mjs`'s `gateEnv`
   stamps `ORCHESTRA_GATE=1` on the environment of the gate's own git calls and every configured
   gate; `lib/store/files.mjs` already stamps `ORCHESTRA_WRITES_MAIN=1` on its two git write calls,
   for the same guard, with no reader today. Two spellings of one fact is how they start
   disagreeing, and P5 must also decide how a PreToolUse hook reads either one, since such a hook
   sees the agent's Bash command text, never this process's environment.
3. **The ledger commit owes a cross-process lock.** `commitLedgers` (`lib/gate/land.mjs`) takes none,
   because there is no ticket queue yet to take one from — P5's ticket queue is what closes this gap.
4. **`rerere.enabled` belongs in `templates/CLAUDE-rules.md` and in `doctor`, not in a gate that
   refuses.** A queue that rebases branches all day meets recurring conflict hashes, and rerere's
   cache is shared by every worktree of a repository — enabling it project-wide, not refusing a
   landing on its absence, is the right lever.

---

## Review checklist for the branch review

Beyond the per-task reviews. **Keep this a single final wave.** A per-task review does not see a
class of defect: in P2b it missed four Important findings that only appeared when the document was
read whole.

1. **Does any exit code disagree with any other document?** `lib/gate/state.mjs`'s `EXIT`,
   `agents/merge_agent.md`'s table, the spec's §5 table, and every sentence in
   `skills/orchestra/SKILL.md` that names a code. Four places, one fact.
2. **Was every test watched failing?** Tasks 1–7 each specify a red run. If a task presented a green
   run as its proof without a prior red one, say so. A test written after the code passes on both
   sides.
3. **Did a fix land only halfway?** In P2b one task added a correction twenty lines below the
   sentence it contradicted, and both halves were locally coherent. The seams to read here: who
   records a landing's subjects (the gate in Task 6, the conductor in the skill's step 6 — both, on
   purpose, and one sentence must say so); who performs a landing (the nevers, step 6, the playtest
   gate); what `sync` does offline (the roll-call, step 7, the README, `lib/store/files.mjs`).
4. **Is any measurement implied of the reader's machine?** "262 s on a quiet machine and 1652 s under
   load", "23 of 27 scenes", "22 of 41 landed rows", "73 rerere entries" — every one belongs to
   planetCraft and must say so. The rule each pays for is general and is stated as general.
5. **Does anything promise a command this plugin does not have?** The greps cannot check "start the
   dev server" or "run the full suite". Read for those in `agents/merge_agent.md` and in every
   sentence Task 9 rewrote.
6. **Is the lock actually released on every path?** `land` returns from eleven places. `armRelease`
   is meant to make that irrelevant; confirm it by reading, and confirm the signal handlers do not
   leave a `holder` file behind. This is the one defect the acceptance suite cannot catch.
7. **Does `queueList` write the queue record without the mutex?** As specified in Task 4 it does: it
   reaps vanished entries and writes them back while a landing may be marking an entry. Decide
   whether it should take `withMutex` (which would mean exporting it from `land.mjs`), or whether it
   should reap in memory and print without writing at all — a read command that races a writer is
   the smaller of the two problems, and a `queue-list` that rewrites the record under a live landing
   is the larger. Say which you chose.
8. **Is `ORCHESTRA_GATE_RUN_FILE`'s inheritance really closed?** A gate that itself invokes this
   plugin would inherit the variable. `ownsRun` compares pids, which cannot be inherited. Read it
   against the case where a gate spawns `orchestra land` for another branch.
9. **Does `gateSkipped` fail in the safe direction everywhere?** Null, empty, no globs, a glob that
   matches nothing. A missed gate is the failure this predicate exists to prevent.
10. **Is a reviewer's own claim verified before it is paid for?** A central P1 finding was refuted by a
   thirty-second measurement. Here the equivalent is a claim about what a command prints or what git
   does: run it in a fixture before rewriting anything to match a guess.

## Executing this plan

Worktree, per the repository's own practice: `git worktree add .worktrees/p3-merge-gate -b
p3-merge-gate main`, and `.worktrees/` is already gitignored. A fresh implementer per task, a review
per task, and one branch review at the end. **This repository has no dead-code gate and no linter
over prose — those reviews are the only filter.**

**And write the briefs so an implementer can overrule them.** Five times in P2b an implementer found
the brief wrong and was right to override it. Every task above states its reasoning, not only its
instruction, so that disagreeing is possible. What is not allowed is doing the other thing silently.
