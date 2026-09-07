# P5 — The hooks, `orchestra init`, the ticket queue and the heartbeat

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a project opts in with one command and is then held by the machine rather than by a
prompt: `orchestra init` writes the config, the gitignore and the rules; seven hooks refuse what a
prompt cannot; `orchestra tickets` gives the stand-down sweep a ledger to read; and
`orchestra install-heartbeat` installs the per-project timer that ticks it hourly. This is the last
phase — after it the plugin has no forward references left.

**Architecture:** the split every subsystem here keeps, applied to hooks for the first time.
`lib/guards/` holds the DECISIONS — pure functions over a command string and a config, unit-tested
without a repository — and `hooks/*.mjs` holds only the payload plumbing, the wording of a refusal
and the exit code. That split is not taste: a hook reads stdin and spawns a child at import, so a
refusal written inside one is a refusal no test can exercise, and three refusals nobody exercises
are three refusals nobody can trust (the reasoning is in the source project's own
`guard-roadmap-claim.mjs`). `lib/tickets/` is a port of one file with its identity rules intact.
`templates/` holds every file whose content is rendered into somebody else's machine, and
`lib/cli/init.mjs` and `lib/cli/heartbeat.mjs` are the two commands that render them.

**Tech Stack:** ESM, node builtins only (`node:fs`, `node:path`, `node:child_process`, `node:os`,
`node:crypto`, `node:url`), `node:test` + `node:assert/strict`. No runtime dependencies. The
rendered heartbeat artefacts are `/bin/sh`, a launchd plist and a systemd unit pair.

**Spec:** `docs/specs/2026-09-02-orchestra-plugin-design.md` — **§10** (the seven hooks and their
events), **§11** (`orchestra init`), **§9** (tickets), **§12** (the heartbeat and why launchd and
not cron), **§8.5** (one agent per project, labelled `com.orchestra.<id>`), §3.1 (the off switch),
§3.2 (runtime state resolves to the main checkout), §13 (what does not travel), §14 (a temporary
`HOME`), §16 (a test per hook), and **§15**, whose P5 row is the acceptance: `init` on a bare
repository produces a project that ticks; each hook is a silent no-op without a config;
`install-heartbeat` refuses a label held by another root.

**Port source:** `~/Projects/planetCraft/.claude/hooks/` (7 files, 525 lines),
`~/Projects/planetCraft/tools/tickets.mjs` (869 lines),
`~/Projects/planetCraft/tools/orchestra/com.planetcraft.orchestra.plist.template`,
`install-heartbeat.sh` and `cron-tick.sh`. **Never write anything under `~/Projects/planetCraft`** —
it is the source, not a workspace.

**Repository state at planning time:** `main` at `c3cbf57`, 505 tests green, no remote, plugin
installed at 0.5.0.

## Global Constraints

P1's through P4's, unchanged. Every task's requirements implicitly include this section.

- **Node ≥ 20**, **git ≥ 2.31**.
- **Zero runtime dependencies.** Nothing under `bin/`, `lib/` or `hooks/` may import anything but a
  `node:` builtin or a relative path. `test/no-dependencies.test.mjs` holds it — check what that
  test actually walks before assuming `hooks/` and `templates/` are covered or excluded.
- **ESM only**, `node:test` + `node:assert/strict`.
- **Everything committed is in English** — code, comments, docs, skills, commit messages, test
  names, and every string this code prints, a refusal's wording included. The deliberate inversion
  of the source project's rule.
- **A rule keeps the measurement that paid for it, with its date.** Never drop a date, a count or a
  duration to shorten a sentence.
- **A measurement is attributed, never implied of the reader.** Name `planetCraft` where the
  sentence recounts a dated event there; say "the project this was extracted from" where the
  sentence states a general rule. Five comments carried over in P4 became false the moment they
  arrived here; a comment that says "we" or "this repository" is the shape to check.
- **No dead code, no just-in-case code**, and its prose equivalent: no instruction nobody can
  follow. There is no dead-code gate and no linter over prose here — the per-task review and the
  branch review are the only filter.
- **Every subcommand except the machine-level ones exits 0 and silent when
  `.orchestra/config.json` is absent** (spec §3.1). **Every HOOK does too** (§10), and that is
  this phase's most load-bearing sentence: the plugin is installed globally, so a project that has
  not opted in must see no behaviour at all.
- **Runtime state resolves to the main checkout** (`lib/paths.mjs`), never to the worktree the
  caller is standing in. A hook is the one place where that is not automatic: a hook receives the
  agent's `cwd`, which is very often a worktree, and must resolve from there.
- Commit after every task. Run `npm test` before every commit.

---

## The scope questions, answered

These were put to this plan explicitly. Each answer is binding; **an implementer who thinks one is
wrong should say so in their report rather than quietly do the other thing** — five times in P2b an
implementer found the brief wrong and was right to override it, and that is worth more than
obedience. What is not allowed is doing the other thing silently.

### 1. One marker for one fact, and the guard reads it from the command text

`lib/gate/land.mjs` stamps `ORCHESTRA_GATE=1`; `lib/store/files.mjs` stamps
`ORCHESTRA_WRITES_MAIN=1`. Both mean "the plugin itself is writing to the main branch on purpose",
neither has a reader, and two spellings of one fact is how they start disagreeing.

**`ORCHESTRA_GATE` survives; `ORCHESTRA_WRITES_MAIN` is deleted** and `lib/store/files.mjs`'s
`gitWrite` stamps `ORCHESTRA_GATE=1` instead. The spec chose the spelling for us — §10's table says
"unless `ORCHESTRA_GATE=1`" — and one name a guard can be read against beats a more precise name
the guard does not mention. The comment above `gitWrite` keeps its real point, which is not the
name: the marker sits on the two calls that write and on no shared helper, because a marker on a
shared helper hands the bypass to every future read by default.

**How `guard-main-commit` reads it: from the segment's own text first, from `process.env` second.**
A PreToolUse hook fires on the AGENT's Bash tool call and receives that command as text; it does not
inherit the environment of the `orchestra land` process running elsewhere on the machine. So:

- **the text** — a segment carrying an `ORCHESTRA_GATE=1` assignment passes. This is the only form a
  human or an agent can actually type, and it is the same explicit-override idiom the source
  project's `MERGE_AGENT=1` and `FULL_SUITE=1` already use.
- **the hook's own environment** — `process.env.ORCHESTRA_GATE === '1'` disarms the guard for the
  whole session. This is not decoration: `orchestra land` runs each configured gate as a child
  under `gateEnv()`, so a project whose `gates` entry is itself an agent session gets a session
  whose hooks inherit the marker, and refusing that agent's commits would refuse the landing the
  gate exists to perform.

State both readers in the hook's header, and state plainly what neither of them covers: the gate's
own `execFileSync('git', …)` calls are not tool calls, so no hook ever fires on them and the marker
is not what lets the gate write to main — nothing was ever going to stop it. `guard-full-suite`
reads `ORCHESTRA_FULL_SUITE` exactly the same two ways, for the same reason.

### 2. The gitignore `init` writes covers `gate/`, and four more things

Spec §3.2's list predates the merge gate and the heartbeat. The file `init` writes must cover every
path the plugin creates under `.orchestra/` and nothing else:

```
state.json  journal.jsonl  inbox.jsonl  archive.jsonl  conductor.beat.json
tick.lock  drafts/  worktrees/  images/  gate/  tick.sh  *.log  *.err
```

`gate/` is P3's own hand-over: without the line a project commits its merge queue record, its
landing logs and its run records. `tick.sh` is this phase's addition (task 6) — a rendered script
holding machine-absolute paths, which must never be committed. `config.json` and `.gitignore`
itself are the two files that ARE committed, so the file must not use a blanket `*` with
exceptions: list what is ignored, so adding a committed file later needs no thought.

### 3. The ledger commit takes the ticket queue's lock

`commitLedgers` (`lib/gate/land.mjs`) commits the tracked files named by `ledgers` at the head of
every landing, under the gate's own lock — which is a lock against *other landings*, not against a
ticket being written between the `git add` and the `git commit`. The ticket queue's
`withQueueLock` is the missing one, and it is why this phase can close the hole P3 could only
record. `commitLedgers` acquires it over every path in `ledgers`, in sorted order so two callers
can never take two locks in opposite orders, and `withQueueLock`'s 30-second-then-throw behaviour
is preserved unchanged: the stand-down tick depends on that throw being a recorded error rather
than a deadlock.

### 4. `rerere.enabled` is reported, never required

A merge gate that rebases branches all day meets the same conflict hashes repeatedly, and git's
rerere cache is shared by every worktree of a repository, so enabling it project-wide is a real
win. It goes in `templates/CLAUDE-rules.md` as a recommendation and in `doctor` as an observed row.
**It never becomes a gate that refuses.** Refusing to land in a project whose owner deliberately
enabled — or deliberately did not enable — rerere is imposing somebody else's decision through a
tool they installed for something else.

### 5. `init` writes `monitor.port` as `"auto"` or not at all

Never a number it picked. A chosen number pins a port for a project that never asked for one, and
`doctor`'s conflict check (§8.3, already shipped) reports a pinned port held by another live
instance as an **error** — so two fresh installs on one machine would declare themselves in
conflict over a decision neither of them made. `"auto"` is already the default; writing it
explicitly is a readable no-op, and omitting the key entirely is equally correct. Either, never a
third thing.

### 6. The page still does not wake a sleeping conductor. The heartbeat is the answer

P4 refused to wire the page's reply button to spawn a tick, and this phase does not reverse that:
in the source project, a page that spawned a tick per answer created a conductor instead of
reaching the live one — six conductor identities in half an hour on 2026-08-13 in planetCraft, two
`merge_agent` runs twelve seconds apart on one branch, three answers left unread because the
register kept naming a reader that had already died.

What changes is that the gap now has a floor. An answer typed while a conductor is beating still
reaches it in seconds through that session's `watch-answers` loop. An answer typed while nobody is
beating waits for the next heartbeat slot — at most an hour — because `decideTick`'s first
override is an unconsumed answer in the inbox. **That override is only reachable at all once task 1
lands**, which is why the archive fix comes first in this plan and not last.

The shape of the timer is not a free choice either: a **launchd agent** on macOS, a **systemd user
timer** on Linux, and never a cron entry. A crontab entry runs outside the login session and cannot
read the login keychain, so every tick dies on `Not logged in` — eight consecutive ticks did and
seven hours were lost on the night of 2026-08-12/13 in planetCraft — while reading, to anyone
inspecting the crontab, exactly like a working protection.

### 7. What of `tools/tickets.mjs` travels

The rule, so the implementer does not have to weigh 869 lines one at a time: **keep every field of
a ticket row, and every function that reads or writes a row. Drop every function whose input is one
of the source project's sessions, evidence rows, builds or oracle rules, and everything whose
output is Notion.** That removes `judgeTicket`, `applyVerdict`, `judgeTickets`, `qualifies`,
`recordSighting`, `upsertEvidence`, `loadEvidence`, `saveEvidence`, `notionPayload`,
`isNameableBuild` and their constants; it keeps `normalizeSubject`, `normalizeId`,
`fingerprintFor`, `ticketIdFor`, `loadTickets`, `saveTickets`, `withQueueLock`, `pushHistory`,
`upsertTicket`, `findTicket`, `setTicket`, `listTickets` and the three vocabularies (`KINDS`,
`STATUSES`, `SEVERITIES`). Of `fingerprintFor`'s observation kinds, `subject` and `fingerprint`
travel — the second is the seam a project's own crash reporter files through — and `rule` does not,
because it is a key of a table (`ORACLE_RULES`) that stays behind. §9's "the ledger's shape is
unchanged" is the constraint that decides every borderline case: a `tickets.jsonl` written by the
source project must still load here.

---

## Task 1: an open question keeps its row out of the archive

**Files:**
- Modify: `lib/register/archive.mjs` (the `partition` loop, and the header claim at `:49`)
- Modify: `skills/orchestra/SKILL.md` (the stand-down section's sentence about what leaves the register)
- Test: `test/archive.test.mjs`

**Interfaces:**
- Produces: no signature change. `partition(state, { at })` keeps returning `{ next, archived }`.

**The defect.** The header at `:49` says `pending` is deliberately not prose, because the tick gate
honours an open question on any row "whatever that row's status", so archiving it would swallow a
question already put. That holds on one of the two paths. A terminal row something still depends on
is kept as a stripped tombstone and keeps its `pending`; a terminal row **nothing** depends on is
appended to `archive.jsonl` and not kept at all — its `pending` with it. Three readers lose the
question at once: `decideTick` (`lib/register/tick.mjs`) stands the heartbeat down, `openPendingIds`
(`lib/register/inbox.mjs`) stops recognising the answer, and the page stops showing the ask. The
user's eventual answer then has no open item to attach to. The clause "whatever that row's status"
is itself the evidence that a terminal row with an open item is a real state — a worker's question
outliving a landing or a drop.

**The fix.** Make an open question a reason to keep a row, exactly as a surviving dependency already
is, and express it with the gate's own predicate — a row is asked-of when any `pending[]` item has
`answer == null` — so the two cannot drift. The row still contributes its line to `archive.jsonl`;
what changes is that it is also kept, stripped, in the register. Both branches of the loop take the
new predicate: the drop skips a stripped husk only when nothing depends on it AND nothing is asked
of it, and the keep re-adds a stripped row when either holds.

- [ ] **Step 1: write the failing test.** In `test/archive.test.mjs`: a register whose only row is
  `landed`, which no surviving row lists in `deps`, and which carries one `pending[]` item with no
  `answer`. Assert the returned `next.tasks` still contains that row, that its `pending` array is
  intact, and that `archived` has its line. Add its twin, which is what stops the fix from becoming
  "never archive anything": the same row with the item ANSWERED leaves entirely.
- [ ] **Step 2: run it and watch it fail** — `node --test test/archive.test.mjs`, expected red on
  the row being absent from `next.tasks`.
- [ ] **Step 3: fix `partition`.**
- [ ] **Step 4: green**, and `npm test` whole.
- [ ] **Step 5: correct the two documents that state the rule.** `archive.mjs:49` currently
  promises behaviour it did not have — it becomes true rather than being deleted, and says which
  three readers depend on it. `skills/orchestra/SKILL.md`'s stand-down section says a finished row
  "leaves the register entirely, unless a surviving row still depends on it"; that sentence now has
  a second exception and must carry it, or this fix is one fact in two documents corrected on one
  side.
- [ ] **Step 6: commit** — `fix(register): an unanswered question keeps its terminal row in the register`

**Verification the review must demand.** A test that claims to guard a regression has to be shown
failing against the old code, not asserted to. Restore the previous `partition` in a scratch copy,
run the new test against it, and paste the red output in the report. A test written after the fix
passes on both sides and guards nothing.

---

## Task 2: the ticket queue, and the lock the ledger commit was missing

**Files:**
- Create: `lib/tickets/ledger.mjs`, `lib/tickets/lock.mjs`, `lib/cli/tickets.mjs`
- Modify: `bin/orchestra` (register `tickets`), `lib/gate/land.mjs` (`commitLedgers` takes the lock)
- Test: `test/tickets.test.mjs`, `test/tickets-lock.test.mjs`

**Interfaces:**
- Consumes: `cfg.tickets.file`, `cfg.ledgers`, `cfg.root` (`lib/config.mjs`); `orchestraDir`
  (`lib/paths.mjs`).
- Produces: `ticketsPath(cfg) → string` (resolved against `cfg.root`, never the caller's cwd);
  `loadTickets(file) → rows[]`; `saveTickets(file, rows)`; `upsertTicket(rows, obs, { now })`;
  `findTicket(rows, ref)`; `setTicket(row, changes, { now })`; `listTickets(rows, filters)`;
  `fingerprintFor(obs)`; `ticketIdFor(fingerprint)`; `withQueueLock(file, fn, { waitMs })` from
  `lib/tickets/lock.mjs`, exported separately because `lib/gate/land.mjs` takes the lock without
  wanting the ledger.

**Why identity is the whole job.** A queue that appends is a queue nobody reads: an oracle that
trips every night files thirty tickets in a month instead of one ticket seen thirty times. So
everything upserts onto a fingerprint, and a caller cannot hand this module a free-form one — it
declares which KIND of observation it holds and the fingerprint is computed from that. Timestamps,
line numbers, coordinates and counts never reach the function that computes identity; they ride in
the body where a reader wants them. Port that structure, not just the functions.

**The path is the main checkout's.** `ticketsPath` resolves against `cfg.root`. The source project
paid for this: its CLI resolved on its own location, so run inside a worktree it read that
worktree's copy — `set <id>` answered "no ticket" for everything filed since the branch was cut, and
a landing deletes the worktree, so the ticket died with it.

**The CLI is four verbs** (spec §2): `list [--status S] [--kind K] [--severity S]`, `add`,
`close <id> [--note …]`, `show <id>`. `add` is an upsert onto the fingerprint, which is what makes
filing the same friction twice cheap and correct. Every write goes through `withQueueLock`.

**The gate's ledger commit.** `commitLedgers` wraps its `git add` + `git commit` in
`withQueueLock` over each path in `cfg.ledgers`, sorted, so two processes can never acquire two
locks in opposite orders. Preserve the 30-second-then-throw: a lock that waits for ever turns a
stuck ticket write into a stuck landing with nothing in the log.

- [ ] **Step 1:** port `lib/tickets/lock.mjs` and its test first — the lock is what everything else
  writes through, and a test that proves a second acquirer waits and then throws at the deadline is
  the one test here that cannot be written after the fact.
- [ ] **Step 2:** port `lib/tickets/ledger.mjs` under scope answer 7's rule, with the identity tests
  (two subjects that fold to one ticket; two that must not; an id stable across a re-file).
- [ ] **Step 3:** `lib/cli/tickets.mjs` and its registration in `bin/orchestra`, plus a test that
  the command is silent and exits 0 with no config, like every other project-level command.
- [ ] **Step 4:** `commitLedgers` takes the lock; extend `test/gate-state.test.mjs` or the P3
  acceptance suite with a landing that commits a ledger while the lock is held elsewhere.
- [ ] **Step 5: commit** — `feat(tickets): the ticket queue, and the lock the ledger commit owed`

---

## Task 3: the hook spine, and the two integrate-only guards

**Files:**
- Create: `lib/guards/payload.mjs`, `lib/guards/segments.mjs`, `lib/guards/mainCheckout.mjs`
- Create: `hooks/guard-main-edit.mjs`, `hooks/guard-main-commit.mjs`, `hooks/hooks.json`
- Modify: `lib/store/files.mjs` (scope answer 1: the marker's name)
- Test: `test/guards-segments.test.mjs`, `test/guards-main.test.mjs`

**Interfaces:**
- Produces:
  - `readPayload() → object|null` — the hook's stdin as JSON, null on anything unreadable.
  - `projectFor(cwd) → cfg|null` — `loadConfig` with every throw swallowed into `null`. The off
    switch is "no config", and a config that fails to parse must not make a hook noisy in a project
    that is merely broken; a hook is the wrong place to report it, `doctor` is the right one.
  - `segments(command) → string[]` — the shell-splitting rule, once, for all five command guards.
  - `envAssigned(segment, name) → boolean`, `stripEnv(segment) → string`.
  - `isMainCheckout(dir) → { root, onMain } | null` from `mainCheckout.mjs`.

**`segments` is the module that pays for itself.** Five hooks in the source project each carry the
same paragraph and the same regex, and the paragraph is load-bearing: a backslash-newline is a shell
line CONTINUATION, not a command boundary, so a plain `\n` split cuts `git -C <path> \` from
`commit -m x` into two segments that neither one alone matches — silently letting a main-checkout
commit through. The shell removes the backslash and the newline together, so this joins with
nothing, not a space: `wor\<newline>ktree` becomes `worktree`, never `wor ktree`. Splitting is then
on `\n`, `;`, `&&`, `||` and `|`. Leading `NAME=value` assignments are stripped before matching, so
a prefix cannot hide a runner from the guard — and are readable separately, which is how the
`ORCHESTRA_GATE=1` override is recognised.

**`isMainCheckout` is the other shared decision, and it is three git questions, not one.** A linked
worktree's `--git-dir` sits under the main checkout's `.git/worktrees/<name>` while its
`--git-common-dir` is the shared `.git`; the two are equal only in the main checkout itself.
`--path-format=absolute` on **both** calls is mandatory — without it git returns a relative form
from a subdirectory and a main-checkout subdirectory is reported as a worktree. And "git-dir equals
git-common-dir" alone cannot tell this project's main checkout from any other repository's, since a
user works across several in one session: scope by comparing against the `--git-common-dir` of the
project the hook resolved from `cwd`. A directory that is not a repository at all is nobody's
business and returns `null`.

**`guard-main-edit`** (PreToolUse `Edit|Write|MultiEdit|NotebookEdit`) refuses a write whose target
resolves into the main checkout while HEAD is `cfg.mainBranch`. Two things it must get right:

- **A `Write` can create a file whose parent directories do not exist**, and `git -C` on a
  nonexistent path fails. Walk up to the nearest existing ancestor before asking git anything, or a
  brand-new file inside a worktree is misread as "not a repository" and wrongly permitted.
- **`.orchestra/` is exempt.** The register, the journal and the drafts live in the main checkout by
  design (§3.2), and the conductor protocol has the conductor editing `state.json` there by hand. A
  guard that blocked that would break the thing it is installed to protect. Paths git reports as
  ignored are exempt too — untracked scratch in the main checkout is not an integration change.
  Nothing else is exempt: the source project's `docs/` exemption was a user ruling in that project
  and does not travel.

**`guard-main-commit`** (PreToolUse `Bash`) refuses a `git commit` whose effective repository is the
main checkout on `mainBranch`. Keep the measurement: on 2026-07-28 in planetCraft a `git commit
--amend` meant for a worktree ran in the main checkout because the shell cwd had drifted between two
calls; it replaced main's tip and swept 34 untracked files into version control. Follow `cd` between
segments and honour `git -C`, because cwd drift IS the failure mode. `git merge` is deliberately not
blocked — that is the landing itself. The override is scope answer 1's `ORCHESTRA_GATE=1`, read from
the segment and from `process.env`.

**`hooks/hooks.json`** registers each hook as `node "${CLAUDE_PLUGIN_ROOT}/hooks/<name>.mjs"` with
a `statusMessage`. This task creates it with two entries; tasks 4 and 5 add theirs.

- [ ] **Step 1:** `lib/guards/segments.mjs` + tests, including the backslash-continuation case and
  an `ORCHESTRA_GATE=1`-prefixed segment.
- [ ] **Step 2:** `lib/guards/mainCheckout.mjs` + tests over a fixture with a real linked worktree
  (`makeRepo` then `git worktree add`), asserting main checkout, worktree, subdirectory of each, a
  second unrelated repository, and a non-repository path.
- [ ] **Step 3:** `lib/guards/payload.mjs`, the two hook files, `hooks/hooks.json`.
- [ ] **Step 4:** rename the marker in `lib/store/files.mjs` and check no test asserts the old name.
- [ ] **Step 5: commit** — `feat(hooks): main is integrate-only, for edits and for commits`

---

## Task 4: the four remaining refusals

**Files:**
- Create: `lib/guards/suite.mjs`, `lib/guards/draft.mjs`, `lib/guards/claim.mjs`
- Create: `hooks/guard-full-suite.mjs`, `hooks/guard-draft.mjs`, `hooks/guard-claim.mjs`,
  `hooks/lint-roadmap.mjs`
- Modify: `hooks/hooks.json`
- Test: `test/guards-suite.test.mjs`, `test/guards-draft.test.mjs`, `test/guards-claim.test.mjs`

**Interfaces:**
- Consumes: `segments`, `stripEnv`, `envAssigned`, `projectFor` (task 3); `startVerdict`
  (`lib/roadmap/policy.mjs`, already shipped and already unit-tested).
- Produces: `bareSuiteRun(command, suiteCmd) → string|null`; `draftAdds(command, draftsDir) →
  string|null`; `claimedBranches(command) → string[]`.

**`guard-full-suite` is generalised, not ported.** The source project's version carries a table of
runners (`npm test`, `npm t`, `vitest`) because the suite command was hardcoded. Here the suite is
`cfg.gates.find((g) => g.name === 'suite').cmd` — the project already told us what it is — so the
rule becomes exact instead of guessed: a segment whose command, once env prefixes and
report-shaping noise flags are stripped, is that command and nothing more. Anything that narrows the
run (a file path, `-t 'name'`, `--changed`) passes straight through, because only a run with
NOTHING narrowing it is the merge gate's run. No gate named `suite` means the hook has nothing to
guard and exits 0. The refusal names `cfg.branchTests` as what to run instead, and
`ORCHESTRA_FULL_SUITE=1` as the override, read the two ways scope answer 1 fixed.

**`guard-draft`** refuses a `git add` naming any path under `cfg.roadmaps.drafts`. Spec §10 asks for
no `-f`, and it is right not to: the drafts directory is gitignored by the file `init` writes, so an
ordinary `git add` of a draft is already refused by git and the only way past it is `-f` — but a
project that has not run `init`, or has edited its gitignore, has no such floor. Say in the header
what this cannot catch: `git add -A` sweeps a draft without naming it, and only the gitignore stops
that.

**`guard-claim`** refuses `git worktree add -b <branch>` for a task the board does not show claimed
by you. **The gesture that starts the work is the gesture that posts the claim** — that is the whole
design, and it works because every change in a project running this plugin goes through a worktree.
Take every `-b` in the command, not the first: a chained `git worktree remove old && git worktree
add new -b <shared-branch>` still starts a task through its second segment. Do no string work after
finding no branch: a command with no `worktree add -b` must never pay for a `board --json`
subprocess. The verdict is `startVerdict`, unchanged; this hook owns only the wording. It **fails
open** when the board is unreachable — a warning on stderr and the command proceeds, because
blocking on an unreachable channel is worse than the duplicated effort it prevents — and **fails
closed** on a board served from cache, since a cached board is telling you in as many words that
what it knows is out of date. A parse that succeeds on a shape that is not a board (`null`, `{}`, a
number) fails open the same way as an unreachable one, in the same check.

**`lint-roadmap`** (PostToolUse `Edit|Write`) refuses nothing; it lints a roadmap the moment it is
written and reports. It matches on the FORMAT, not on a directory — a file under
`cfg.roadmaps.drafts` or `cfg.roadmaps.published`, or any `.md` whose frontmatter declares a
`roadmap:` key — so a roadmap written somewhere unexpected is still checked. The frontmatter test
must be bounded by the closing `---`: an unbounded search scans the whole file, and a body line
beginning "roadmap:" — which any document discussing this system has, this plan included —
classifies that document as a roadmap and blocks an edit to it. The drift it stops is measured: on
2026-08-11 in planetCraft the same three fields were written four different ways across five
roadmaps, all by one skill, because nothing looked.

- [ ] **Step 1:** each pure decision with its tests, then its hook. Four hooks, four wordings.
- [ ] **Step 2:** register all four in `hooks/hooks.json`.
- [ ] **Step 3: commit** — `feat(hooks): the suite, the draft, the claim and the roadmap format`

---

## Task 5: the hook that speaks, and the proof that all seven stay silent

**Files:**
- Create: `hooks/orchestra-inbox.mjs`
- Modify: `hooks/hooks.json`
- Test: `test/hooks-offswitch.test.mjs`, `test/hooks-inbox.test.mjs`

**Interfaces:**
- Consumes: `relay` (`lib/register/relay.mjs`), `liveConductor` (`lib/register/beat.mjs`),
  `inboxPath` (`lib/register/inbox.mjs`), `projectFor` (task 3).

**`orchestra-inbox`** (UserPromptSubmit) hands an interactive conductor the answers the user typed on
the page, without it having to ask. It is a convenience and not the channel — a tick fetches the
same text with `orchestra inbox`, and must, because this hook is structurally unable to serve a
session the page spawned. Both go through `relay`, so the two can never say different things about
the same answer.

It runs in EVERY session in a project that has opted in — every worker, the user's own — so its
first duty is to say nothing. Three gates, cheapest first: no config; no `.orchestra/inbox.jsonl`
(the page has never run and the read costs nothing); not the conductor.

**Which session is the conductor is asked of the beat first and of the register only after.**
`conductor.inboxSeen` is a single shared watermark with no owner: whoever reads these answers is
expected to stamp past them, and from that moment nobody else is ever told they existed. Measured
2026-08-12 in planetCraft — a second session stamped and five answers (a design ruling, a failed
hands-on check, a merge approval, a launch ruling, a question) were never delivered to the conductor the
user was actually talking to. The register cannot prevent it, because it named a session that had
already been dead for half an hour on 2026-08-13 while three more answers rotted. The beat can: it
is written every two seconds by a loop that lives exactly as long as the session holding the baton.
With no live beat, fall back to the register. The register stores a SHORT id while the payload
carries a full session UUID, so the comparison is a prefix — and below eight characters it is not an
identity at all, it is a way to hand a worker somebody else's decisions.

**The off-switch matrix is spec §16's mitigation and this task's real deliverable.** For each of the
seven hooks: spawn it as a process, with a payload that WOULD be refused, `cwd` inside a git
repository that has no `.orchestra/config.json`, and assert exit 0 with empty stdout and empty
stderr. Table-driven over the seven, so an eighth hook added later without a row is a visible gap.
Spawn the real file rather than importing it — importing proves nothing about a hook, whose whole
contract is a process's exit code and its two streams.

- [ ] **Step 1:** the off-switch matrix first, over the six hooks that already exist. Watch it pass,
  then break one hook deliberately (make it write to stderr unconditionally) and watch the matrix go
  red. A matrix that cannot fail is not a test.
- [ ] **Step 2:** `hooks/orchestra-inbox.mjs`, its registration, its own tests (live beat wins over
  the register; a short id under 8 characters is never a match; no inbox file is silent), and its
  row in the matrix.
- [ ] **Step 3: commit** — `feat(hooks): answers reach a live conductor, and every hook is silent without a config`

---

## Task 6: the heartbeat

**Files:**
- Create: `templates/heartbeat.plist`, `templates/heartbeat.service`, `templates/heartbeat.timer`,
  `templates/tick.sh`
- Create: `lib/cli/heartbeat.mjs`
- Modify: `bin/orchestra` (register `install-heartbeat`), `lib/cli/doctor.mjs`
- Test: `test/heartbeat.test.mjs`

**Interfaces:**
- Produces: `renderTemplate(text, vars) → string`; `plistPath(id) → string`;
  `installedRoot(text) → string|null`; `installHeartbeat(cfg, { home, run, print }) → report`.
  `run` is the launchctl/systemctl invoker, injected — **a test must never touch the developer's own
  `~/Library/LaunchAgents`, and must never spawn `launchctl`.** Use a temporary `HOME` and a
  recorder, as §14 already requires of the machine registry.

**One agent per project, labelled `com.orchestra.<id>`** (§8.5), where `id` is the six-hex hash of
the main checkout's absolute path — the only thing that is unique when two checkouts of one
repository, or two projects sharing a directory name, both want a heartbeat.

**It refuses a label held by another root.** Read the installed plist, recover the root it was
rendered with, and if that root is not this project's, refuse and name both paths. This is the P5
acceptance line and it is not hypothetical: an agent left behind by another checkout fires that
tree's tick script and logs into that tree's `.orchestra/`, which reads as "my heartbeat is running"
while nothing about this project is being ticked. Re-installing over the SAME root is idempotent and
expected — a moved checkout self-heals by re-rendering.

**Why a template and not a committed plist.** launchd needs an absolute path and expands nothing, so
one committed file cannot name two developers' checkouts. The source project committed one naming
its author's, and from 2026-08-14 its installer correctly refused to run anywhere else — the
heartbeat simply did not exist on the second machine, where every one of the 79 ticks that ever ran
was started by hand.

**The plist's schedule is a calendar interval, not `StartInterval`.** Across sleep, `StartInterval`
simply stops counting; launchd fires a missed calendar slot when the machine wakes. Eight slots of
1 h 23 to 3 h 26 were lost the other way in one 46-hour roadmap in planetCraft, about six hours,
one of them killing a worker mid-turn. `AbandonProcessGroup` is equally load-bearing and equally
unobvious: without it launchd kills every remaining process in the job's process group the moment
the tick exits, which would kill the `caffeinate` the tick starts to outlive it by ninety minutes,
and any worker the tick launched with it.

**`templates/tick.sh` is the script the timer runs**, rendered into `<root>/.orchestra/tick.sh`
(gitignored, scope answer 2) with the project root and the path to this plugin's `bin/orchestra`.
Its order is the source project's and each step earns its place: export a PATH that includes where
`claude` and `node` actually live, since an agent's environment is minimal; take the conductor lock
and exit **0** if another holds it, because a second conductor is the system working and not
failing; read `orchestra tick-gate`'s one line and act on its FIRST WORD only; hold `caffeinate`
when that line says `hold-awake`; ask `orchestra yield-check` again at the last moment, because the
gate decided well above here and a conductor that started in that window would be conducted over;
then launch the tick with **`env -u CLAUDE_CODE_CHILD_SESSION claude -p …`**, never a bare `claude`
— a tick started from inside a Claude Code session inherits that variable and dies on "OAuth session
expired", a message that lies, since the keychain is fine. That is 30 recorded deaths across two
wordings in the source project's tick log.

**The plugin's path contains its version, and that is a trap this phase must handle rather than
discover.** The rendered timer points at `bin/orchestra` inside the installed plugin's cache
directory, which moves on every version bump. So: the rendered `tick.sh` checks that the binary is
still there and, when it is not, writes one line into the tick log saying the plugin moved and to
re-run `orchestra install-heartbeat` — a loud failure instead of an hourly silent one. And `doctor`
compares the installed agent against a fresh render and reports drift, which is the same check that
catches an agent left by another checkout.

**`doctor` gains three rows**: the heartbeat (not installed / installed / installed for another root
/ drifted from a fresh render), `rerere.enabled` as observed by `git config --get` with one line
saying why a rebasing queue benefits from it (scope answer 4 — a row, never a refusal), and the
installed agents on this machine listed against `~/.orchestra/instances.json`, so a project deleted
while its heartbeat lived on is visible rather than mysterious (§8.5).

**Linux is written from the same shape and is not tested**, and the README says exactly that rather
than implying it works (§12). `install-heartbeat` picks by `process.platform` and says which path it
took.

- [ ] **Step 1:** the four templates, and `renderTemplate`/`installedRoot` with tests over rendered
  text — no filesystem, no launchctl.
- [ ] **Step 2:** `installHeartbeat` with the injected runner, tested under a temporary `HOME`:
  a fresh install writes and bootstraps; a re-install over the same root is idempotent; a plist
  rendered for another root is refused, naming both paths; `--print` renders and installs nothing.
- [ ] **Step 3:** `doctor`'s three rows, with tests.
- [ ] **Step 4: commit** — `feat(heartbeat): one agent per project, and the tick it runs`

---

## Task 7: `orchestra init`

**Files:**
- Create: `lib/cli/init.mjs`, `templates/config.json`, `templates/CLAUDE-rules.md`
- Modify: `bin/orchestra` (register `init`), `skills/orchestra/SKILL.md` (an adoption section)
- Test: `test/init.test.mjs`

**Interfaces:**
- Produces: `detect(root) → { buildSystem, branchTests, gates, ledgers, missing[] }` (pure over a
  directory listing plus one `package.json` read); `initProject(root, { mode, force }) → report`.

**`init` is registered `machine: true`** — like `doctor` and `instances`, it must answer in a project
that has no config, which is the only kind of project that ever needs it. It writes:

1. **`.orchestra/config.json`** — `mode` from `--mode` (required; it is the one key with no default,
   and guessing it wrong is the difference between roadmaps as issues and roadmaps as files),
   everything else from `detect`. Refuses to overwrite an existing config unless `--force`.
   `monitor.port` is `"auto"` or absent, never a number (scope answer 5).
2. **`.orchestra/.gitignore`** — scope answer 2's list, each line as a listed path rather than a
   blanket with exceptions.
3. **`CLAUDE.md`** — `templates/CLAUDE-rules.md` appended, or the file created. These are the rules
   the hooks cannot hold: work happens on a worktree; a dev agent never merges, `merge_agent` does;
   run the tests your change affects and leave the whole suite to the gate; what is committed is
   English; and `git config rerere.enabled true` is worth setting in a repository whose branches are
   rebased all day. Appending twice must not duplicate the block — recognise a marker line.
4. **Prints the two steps it cannot take** (§11): `orchestra install-heartbeat`, and the one-time
   interactive acceptance of `claude --dangerously-skip-permissions` that `--bg` launches require.

**One spec line is answered differently from how it is written, deliberately.** §16 says `doctor`
checks for that one-time acceptance. There is no documented file whose content states whether it was
granted, and a `doctor` row that guessed would be worse than no row: it would read as a check.
`init` prints the step, and the `orchestra` skill's preflight proves it on a throwaway session
before planning any launch — which is where it was always actually established. Say so in the
README's line rather than leaving the spec sentence unanswered.

**`--detect --json` reports without writing**, which is what lets the `orchestra` skill ask the user
about what detection could not settle rather than guessing (§11). Detection is one table and no
cleverness: `package.json` with `scripts.test` proposes a `suite` gate running `npm test` and, if a
script named `test:branch` or `test:changed` exists, that as `branchTests`; a script named `knip` or
`lint` proposes a cheaper gate placed BEFORE `suite`, because cheapest first is the project's own
call and this is only a proposal; `Cargo.toml` proposes `cargo test`; `pyproject.toml` proposes
`pytest`; a `Makefile` with a `test:` target proposes `make test`. Anything not found is listed in
`missing` and left out of the file — **`init` never invents a command that has not been seen to
exist**, because a gate that does not run is a gate that refuses every landing.

- [ ] **Step 1:** `detect` and its tests, table-driven over five fixture shapes plus the empty one.
- [ ] **Step 2:** `initProject`, its tests (refusal without `--mode`; refusal over an existing
  config; the gitignore's exact content; `CLAUDE.md` created, then appended to, then appended to
  again with no duplicate block).
- [ ] **Step 3:** the templates, the registration, and the skill's adoption section — the skill is
  where the asking lives, so it must say what to ask about and in what order.
- [ ] **Step 4: commit** — `feat(init): a project opts in with one command`

---

## Task 8: the acceptance, the sweep and the release

**Files:**
- Create: `test/p5-acceptance.test.mjs`
- Modify: `README.md`, `skills/orchestra/SKILL.md`, `lib/register/archiveImages.mjs`,
  `.claude-plugin/plugin.json`
- Test: the acceptance file itself

**The acceptance is spec §15's P5 row, one test per clause:**

- **`init` on a bare repository produces a project that ticks.** A fixture with no config: `init
  --mode offline` succeeds; `doctor` prints a resolved configuration and exits 0; `git status`
  shows `.orchestra/config.json` and `.orchestra/.gitignore` as the only new tracked-able paths;
  `orchestra tick-gate` answers a line whose first word is `skip` and whose reason is that no
  register exists yet; and after one non-terminal row is written into the register, the same command
  answers `run hold-awake`. That progression IS "a project that ticks".
- **Each hook is a silent no-op without a config** — the matrix from task 5, referenced rather than
  duplicated.
- **`install-heartbeat` refuses a label held by another root** — under a temporary `HOME`, with the
  injected runner.

**The documentation sweep, in one wave.** Three cosmetic debts and one structural one:

- `skills/orchestra/SKILL.md` and `README.md` **undercount `orchestra instances`' columns**: it
  prints a truncated conductor session id and a beat age as well, both of which §8.2 names as the
  registry entry's content.
- `lib/register/archiveImages.mjs`'s header still speaks of P4 in the future tense ("the three P4's
  monitoring page *will* scan"). That page shipped.
- `skills/orchestra/SKILL.md`'s **`## What is not here yet`** section is the structural one. It is
  the single roll-call, and every "phase 5" reference in the document points at it — around twenty
  of them. After this phase there is no phase 5, so each becomes either a plain statement of what
  the command does, or a deliberate **Never**. Two things must survive as Nevers rather than
  disappear: a retrospective tool (§13 — its metrics belong to the source project), and **the page
  starting a session** (scope answer 6, with its six-identities measurement). The stand-down
  section's "the ticket queue is phase 5's" paragraph becomes the sweep it always described, now
  that `orchestra tickets` exists. `ledgers` is no longer empty by necessity: `init` proposes the
  ticket file.
- `README.md`: the "Not yet" line goes; the hooks, `init`, `tickets` and `install-heartbeat` join
  "What works today"; the hand-written `.orchestra/gate/` gitignore instruction is replaced by
  `orchestra init`; and the systemd path is stated as **written from the same shape and not tested**
  (§12).

**One line for the user, and the version bump.** `.claude-plugin/plugin.json` to **0.6.0** — the
plugin cache is indexed by version, so without the bump nothing that this phase adds reaches an
installed project, however correct the code is.

- [ ] **Step 1:** the acceptance test.
- [ ] **Step 2:** the sweep, all four items in one pass.
- [ ] **Step 3:** the version bump and the README's summary line.
- [ ] **Step 4: commit** — `chore(plugin): 0.6.0 — the hooks, init, the ticket queue and the heartbeat`

---

## The traps this phase pays for in advance

Six that cost time in earlier phases and are all still live here.

1. **The plugin cache is indexed by version.** Without the bump in task 8, nothing arrives. This
   phase adds a second face to the same trap: an installed LaunchAgent points into the versioned
   cache directory, so a bump silently orphans it. Task 6 makes that loud.
2. **A comment carried from the source can become false on arrival** — five did in P4. Every ported
   header names a file, a path or a phase that may not exist here.
3. **A measurement is attributed, never implied.** "measured 2026-08-13 in planetCraft", never "we
   measured".
4. **A test written after the code passes on both sides.** The test file exists before the code
   file. Where a test claims to guard a regression — task 1 above all, and task 5's matrix —
   restore the old behaviour in a scratch copy and paste the red output.
5. **A literal NUL byte makes a file binary to git**, which silently empties a review packet. Run
   `git diff --stat` before dispatching any review and check no file reports `Bin`.
6. **A 429 cuts an agent mid-flight.** When it happens, look at `git status` before concluding the
   work is lost — twice in P4 it was intact, once staged but uncommitted.

## Review checklist for the branch review

Beyond the per-task reviews, which are mandatory on every task: each of P4's five found a real
defect. **Keep this a single final wave.** A per-task review cannot see the class below — one fact
living in two documents and corrected in one of them.

1. **Is any fact in more than one place, and do all its copies agree?** The archive's keep-rule
   (`archive.mjs`'s header, `SKILL.md`'s stand-down section, this plan); the gitignore's list
   (`init`, the README, spec §3.2); the exit codes; `instances`' columns; the marker name after
   task 3's rename.
2. **Does every hook exit 0 and silent without a config**, including the two that spawn a
   subprocess before they check?
3. **Is there any path where a guard blocks the plugin's own work** — the conductor's by-hand
   register edit, `init` writing into the main checkout, a landing's ledger commit, a configured
   gate that is itself an agent session?
4. **Does anything still say "phase 5"** in a skill, a README, a comment or a template?
5. **Does any test touch the developer's real `HOME`, `~/.orchestra`, `~/Library/LaunchAgents` or
   spawn `launchctl`/`systemctl`?**
6. **Are the measurements intact** — every date, count and duration carried from the source, with
   its attribution?
