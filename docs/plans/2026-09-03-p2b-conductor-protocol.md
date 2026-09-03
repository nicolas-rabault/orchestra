# P2b — The conductor protocol, ported neutral, and the worker briefs templated

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A session that reads `skills/orchestra/SKILL.md` can conduct a project's roadmaps with the
twelve subcommands P2a shipped — and every rule it carries still names the failure it was paid for,
every command it names exists, and every measurement in it says whose machine it was taken on.

**Architecture:** One document and no code, plus one test that holds the document honest.
`skills/orchestra/SKILL.md` is a **section-by-section port** of the 1 031-line protocol at
`~/Projects/planetCraft/.claude/skills/orchestra/SKILL.md`, in the source's own section order, so
that "section N of the source is section N of the port" and nothing can be lost by being moved. Two
transformations run through every section: each `node tools/orchestra/x.mjs` becomes the subcommand
`orchestra x`, and each measurement that says "this machine", "this harness" or "this repository" is
attributed to the project it was taken in. The worker briefs become templates over nine named
substitutions, `briefExtra` among them, which is what replaces the source brief's appeals to one
project's subject map.

**Tech Stack:** Markdown with YAML frontmatter (a Claude Code skill); `node:test` +
`node:assert/strict` for the acceptance; no runtime dependencies, and this phase adds no `lib/` code
at all.

**Spec:** `docs/specs/2026-09-02-orchestra-plugin-design.md` — **§6** is this phase (its last two
paragraphs are the whole contract), with §2 (the subcommand list and the English rule), §3.1 (the
config keys the protocol reads), §4.1/§4.4 (what the two modes change), §8.4 (worker session names),
§8.6 (the machine's capacity), §13 (what is explicitly not portable) and §15 (the phase table, which
sets the acceptance).

**Port source:** `~/Projects/planetCraft/.claude/skills/orchestra/SKILL.md`, at `86bf8412`, the
commit the README records the extraction from. Verified 2026-09-03: the file is byte-identical at
`86bf8412` and at today's `planetCraft` main, so the working tree may be read directly. **Never
write anything under `~/Projects/planetCraft`** — it is the source, not a workspace.

**Repository state at planning time:** `main` at `b2a4b34` (`chore(release): 0.2.0`), 255 tests
green, no remote.

## Global Constraints

These are P1's and P2a's, unchanged, and every task's requirements implicitly include them.

- **Node ≥ 20**, **git ≥ 2.31**.
- **Zero runtime dependencies.** Nothing under `bin/`, `lib/` or `hooks/` may import anything but a
  `node:` builtin or a relative path. `test/no-dependencies.test.mjs` holds it. This phase adds no
  module, so the invariant is only at risk through the test file.
- **ESM only**, `node:test` + `node:assert/strict`.
- **Everything committed is in English — this skill included, and that is the deliberate inversion
  of the source project's rule** (spec §2). The plugin is shared, so its own code, skills and docs
  are English; what it *says to a user at runtime* follows the project's `language` config. The
  skill therefore has an English section instructing the conductor to write to the user in
  `language`, which is not a contradiction and must not be "fixed" into one.
- **A rule keeps the measurement that paid for it, with its date.** A rule stripped of its evidence
  reads as an opinion and gets deleted by the next reader; several of the rules in the source were
  paid for twice that way. Never drop a date, a count or a duration to shorten a sentence.
- **A measurement is attributed, never implied of the reader.** Name `planetCraft` where the
  sentence recounts a specific dated event in that repository ("measured 2026-08-13 in
  planetCraft"); say "the project this protocol comes from" where the sentence states a general
  rule. Do not churn one form into the other. This is P2a's own practice — `lib/roadmap/board.mjs`
  does the first, `lib/register/state.mjs` the second.
- **No dead code, no just-in-case code, and its prose equivalent: no instruction nobody can
  follow.** A protocol that tells a worker to run a command this plugin does not have is worse than
  a false comment, because a worker types it.
- **Every subcommand except `doctor` exits 0 and silent when `.orchestra/config.json` is absent.**
  The plugin's off switch (spec §3.1). The skill's first instruction is therefore `orchestra
  doctor`, exactly as the roadmap skill's is.
- Commit after every task. Run `npm test` before every commit.

---

## The invocation form, and the two conventions the whole document rests on

**Copy these three rules into every task; the acceptance test enforces all three.**

1. **One entry point.** The skill states the invocation form once, at the top, in the form
   `skills/roadmap/SKILL.md` already uses:

   ```sh
   "${CLAUDE_PLUGIN_ROOT}/bin/orchestra" <subcommand>
   ```

   and then writes `orchestra <subcommand> …` everywhere else. There is no `node …` invocation, no
   `npm run …`, and no path under `tools/` anywhere in the document.

2. **`{name}` means a brief substitution and nothing else.** The nine brief placeholders are the
   only single-word braces in the document. A config key referred to in prose is written as a
   backticked key name — `` `docs.results` ``, `` `branchTests` ``, `` `worktrees` `` — never as
   `{docsResults}`. A path a conductor must fill in is written `<like this>`. **In particular, never
   spell the `queue` config's own template placeholders**: name the key and point at `orchestra
   doctor`, which prints its value.

3. **A command that does not exist is named with its phase, never as something to type.** Every one
   of them is also roll-called in a single section, `## What is not here yet`, so a reader sees the
   whole shape of what is missing in one place.

## The port substitution table

Applies to every section. Each row is mechanical; several also falsify a sentence around them, which
must be **rewritten, never deleted**.

| In the source | In the port |
|---|---|
| `node tools/orchestra/journal.mjs <kind> <task> "<text>"` | `orchestra journal <kind> <task\|-> "<text>"` |
| `node tools/orchestra/inbox.mjs` | `orchestra inbox` |
| `node tools/orchestra/lock.mjs acquire\|release --kind conductor --session <id>` | `orchestra lock acquire\|release --kind conductor --session <id>` |
| `node tools/orchestra/watch-answers.mjs <session>` | `orchestra watch-answers <session>` |
| `node tools/orchestra/ready.mjs --json` | `orchestra ready --json` |
| `node tools/orchestra/yield-check.mjs` | `orchestra yield-check` |
| `node tools/orchestra/tick-gate.mjs` | `orchestra tick-gate` |
| `node tools/orchestra/archive.mjs --write` | `orchestra archive --write` |
| `node tools/orchestra/archive-images.mjs --write` | `orchestra archive-images --write` |
| `npm run roadmap -- board\|claim\|enrol\|lint` | `orchestra roadmap board\|claim\|enrol\|lint` |
| `npm run roadmap -- sync` | `orchestra roadmap sync` — **does not exist**, phase 3; offline it never will (spec §4.1) |
| `node tools/roadmap/cli.mjs board --json` | `orchestra roadmap board --json` |
| `npm run monitor`, the page, port 4380 | `orchestra monitor` — **phase 4**, and the port is allocated, never assumed (spec §8.3) |
| `tools/merge-queue.mjs land\|await\|list`, `merge_agent` | `orchestra land\|await\|queue-list` and the `merge_agent` agent — **phase 3** |
| `node tools/tickets.mjs list --json` | `orchestra tickets list` — **phase 5** |
| the heartbeat installer, the plist, `launchctl list` | `orchestra install-heartbeat` — **phase 5** |
| the heartbeat's shell script, the answer-watch shell script | the heartbeat's shell — **phase 5**; the level-triggered answer net is **not in this plugin at all** (P2a scope note 4) |
| the retrospective tool and its ledger | **dropped**, spec §13 |
| the execution queue's shell, its router, `npm run queue` | the `queue` config key, and `orchestra ready`'s budget — see Task 4 |
| the session-usage scanner | **dropped**; the rule it served survives without it — see Task 12 |
| `.claude/orchestra/<file>` | `.orchestra/<file>` |
| `.claude/worktrees/<slug>` | `<worktrees>/<slug>`, from the `worktrees` config (default `.orchestra/worktrees`) |
| the source project's specs and plans directories | the `docs.specs` / `docs.plans` config keys; in a brief, `{specsDir}` / `{plansDir}` |
| the source project's results directory | the `docs.results` config key |
| the source project's published roadmap and its local drafts | the `roadmaps.published` / `roadmaps.drafts` config keys |
| the source project's agent-instructions file, "this repository's rules", the subject map | the `briefExtra` config key; in a brief, `{briefExtra}` |
| the source project's branch-test script | the `branchTests` config key; in a brief, `{branchTests}` |
| the source project's dev-server script | "the project's own dev command" — the worker knows it, the conductor does not need to |
| the dead-code, suite and visual gates | the `gates` config, read by phase 3's merge gate |
| the tracked ledgers main owns | the `ledgers` config, committed by phase 3's gate |
| "on this machine", "in this harness", "this repository" (in a measurement) | "in planetCraft" / "in the project this protocol comes from" |

**Two of those rows are also forbidden strings in the acceptance test** (`node tools/`, `npm run `,
`.claude/orchestra`, and the rest of the list in Task 1). Writing the left-hand column into the
document, even as an illustration of what changed, fails the test — the substitution table lives
here, in the plan, and not in the skill.

## Scope

**In:** `skills/orchestra/SKILL.md`, the four worker briefs inside it, `test/p2b-acceptance.test.mjs`,
and the README's "What works today".

**Out, and each for a reason a reader will otherwise go looking for:**

- **The retex block** (source 941–978). Spec §13 excludes retex: its contract is that a
  recommendation must name a metric its tool computes and a threshold that metric can fail, and
  those metrics belong to the source project. Nothing in this plugin computes one, and
  `capabilities.retex` is **not** a key `lib/config.mjs` knows — `doctor` does not print it and
  nothing reads it — so an instruction conditioned on it would be unfollowable. The stand-down tick
  has no retex step in this phase.
- **The `CLAUDE_CONFIG_DIR` correction** (source 1008–1014). It corrects two specific lines of the
  source project's own register and journal. Neither exists here, so the correction has no referent.
- **The answer-watch shell script as a thing to install** (source 1015–1031 in part). P2a
  deliberately did not port the level-triggered net. What survives is the honest half: what the
  watch covers, what it cannot, and that nothing else is under it in this plugin.
- **The execution queue's lane vocabulary** (the two lanes, the three local slots, the pinned
  bench). Spec §13 keeps the fleet in `planetCraft`. The rules that generalise survive — see Task 4.
- **Anything under `agents/`, `hooks/`, `templates/`, `lib/monitor/`, `lib/gate/`, `lib/tickets/`.**
  Phases 3, 4 and 5.
- **A `worker-name` subcommand.** §8.4's naming rule is prose, not code: this plugin has no
  launcher, spec §2's subcommand list does not contain one, and a command nothing calls is the
  just-in-case code the rules forbid. Task 8 decides this explicitly and records the alternative.

## Three scope questions this plan answers, because nothing before it did

1. **§8.4, the worker session names, is P2b's** — the phase table assigns it to nobody and P2a
   routed it here, because nothing before this phase engendered a session. Task 8 writes it:
   `orchestra-<project id>-<task slug>`, with the slug rule spelled out and one worked example, plus
   the two rules §8.4 says are now load-bearing for isolation as well.
2. **The launcher.** `claude --bg` is the **harness's own** command, available to any Claude Code
   session; it is not a plugin feature and needs none. So the skill describes launching as something
   the session does itself, exactly as the source does, and this is not a promise of an absent
   command. Everything that *is* absent is a plugin subcommand, and every one of those is named with
   its phase and roll-called in `## What is not here yet`.
3. **Every mention of a later phase names the phase, not a file.** The merge gate → phase 3; the
   monitoring page, the port allocation and `orchestra instances` → phase 4; the hooks, `init`, the
   tickets and the heartbeat → phase 5; `roadmap sync` → phase 3, and never offline.

## Known divergences you will meet, and what to write

**Describe the code. Where the spec and the code disagree, the code is what a worker will run.**

1. **§8.2 vs `lib/machine.mjs`.** The spec reaps a registry entry "whose pids are dead and whose
   beat is stale"; `isLive` reads `updatedAt` — the write stamp — because `beatAt` is legitimately
   null whenever no `watch-answers` loop is armed, and an entry that read dead the instant it was
   written would make every other project over-launch. The spec has not been amended; it is the
   user's document. If the skill speaks of this at all, it says: an entry is reaped when its root is
   gone, or when neither its conductor pid is alive nor it has reported itself within six hours.
2. **The register's `roadmap` field is a SLUG here, not a file path** (spec §4.4). The source's
   adoption section contains the opposite instruction — that on a register row it is a file path,
   and that copying the slug into it is wrong rather than a shortcut — and that sentence is **false
   in this plugin**. Task 9 inverts it and says why, in one clause.
3. **Never #5 collapses offline** (spec §4.1). Online: git wins for a local task, a closed issue
   wins for a shared one, because another developer's commit never reaches your main. Offline every
   task is local, so it is simply "git wins", with no exception. Task 1 writes both halves and marks
   which mode each belongs to.
4. **The inbox has no writer until phase 4.** The monitoring page is what appends to
   `.orchestra/inbox.jsonl`; until it exists, `orchestra inbox` correctly prints nothing and the
   user answers in the conversation. The cursor rules are written now because they are the
   acceptance and because they are what the page will read — say so plainly rather than implying a
   channel that has no writer. `pending[]`, by contrast, is load-bearing **today**: `orchestra
   ready` prints its `WAITING:` line off it, `orchestra tick-gate` honours an open item on any row
   whatever its status, and `orchestra archive` deliberately never moves it.
5. **`orchestra archive-images` sweeps `.orchestra/images/` only, never `.orchestra/`** — the port's
   one deliberate divergence from its source, because here `.orchestra/` also holds `config.json`
   and defaults to holding `worktrees/`, so a sweep of it would walk into a live worktree and delete
   the project's own pictures.
6. **`lib/register/ready.mjs`'s `gatherGit` reconciles against the literal branch `main`**, in both
   its branch filter and its `git log`, while `lib/roadmap/board.mjs`'s takes `cfg.mainBranch`. A
   project whose main branch is not `main` therefore gets a `ready` that reconciles nothing, in
   silence. **Do not fix it in this phase and do not write prose that promises otherwise**: say "the
   project's main branch" where a conductor types the name, and name the limitation once, in the
   roll-call section, so a reader whose main branch is `master` is not left to discover it from an
   empty ready set.
7. **The two `600`s.** The worker's own internal wait ceiling and the conductor's tool-call ceiling
   are different ceilings with the same number; they are acceptance item 7 and must stay
   distinguished.

## The acceptance, and what it is worth

Spec §15's P2 row: **"the section checklist of §6 is present"**. That is the whole criterion, and
§6 enumerates fourteen items by name. Task 1 turns them into `test/p2b-acceptance.test.mjs`, which
is written **before** the document and watched failing on all fourteen. Each later task turns its
own items green.

The fourteen, with the heading that carries each and the anchor that proves its measurement
survived:

| # | §6 item | Heading | Anchor |
|---|---|---|---|
| 1 | the nevers | `## The six nevers` | `never merge a row`, case-insensitive |
| 2 | the journal's four keys, and the tool that takes the clock | `## The journal (three mechanical obligations, no decision)` | `` `ts`, `kind`, `task`, `text` `` and `Never type the timestamp` |
| 3 | `pending[]` with `id`, `options`, `askedAt`; a question not in `pending[]` does not exist | same heading | `askedAt` and `A QUESTION THAT IS NOT IN` |
| 4 | the shared `inboxSeen` cursor and the stolen stamp | same heading | `inboxSeen` and `FIVE answers` |
| 5 | the framing pass, one interruption per row | `## The framing pass, and the one interruption` | `thirteen` and `2026-08-14` |
| 6 | the resume cycle; `SendMessage` does not wake a `--bg` worker | (the tick, step 3) | `SendMessage does NOT wake` and `claude stop` |
| 7 | the two distinct 600-second ceilings | (the tick, step 3) | `TWO 600-SECOND CEILINGS` |
| 8 | exit code and CLI status are non-evidence; the filesystem is the witness | (the tick, step 3) | `NON-EVIDENCE` and `exit 144` |
| 9 | an undelivered relay is an obligation | (the tick, step 3) | `UNDELIVERED:` and `8 h`/`eight hours` |
| 10 | the decision template, and the picture rule | `## The decision template` + `### A question about a picture must carry the picture` | `Where it stands`; `thumbnail` |
| 11 | the playtest gate; never hand out an unfetched URL | `## The playtest gate` | `Never hand out a URL you have not fetched` |
| 12 | the dev-server sweep | `### The dev-server sweep` | `ORPHAN is the only verdict that kills` |
| 13 | the conductor beat and the lock | (the tick, steps 0–1) | `conductor.beat.json` and `orchestra lock acquire` |
| 14 | the stand-down tick, its ticket sweep and its archiving | `## The stand-down tick` | `orchestra archive --write`, `orchestra archive-images --write`, `S1` |

**Say this in the review rather than letting it pass for more than it is:** the checklist proves no
section was dropped and no anchor measurement stripped. It cannot prove a section is *correct*. That
is what the per-task review is for, and it is the only filter — **this repository has no dead-code
gate and no linter over prose.**

---

### Task 1: the acceptance test, then the skill's head

**Files:**
- Create: `test/p2b-acceptance.test.mjs`
- Create: `skills/orchestra/SKILL.md` (frontmatter, preamble, `## What is not here yet`,
  `## The six nevers`, `## The language you write in`)
- Source: `~/Projects/planetCraft/.claude/skills/orchestra/SKILL.md` lines 1–60

**Interfaces:**
- Consumes: `bin/orchestra` (the registered subcommand names), `lib/cli/roadmap.mjs` (the eight
  roadmap verbs).
- Produces: `skills/orchestra/SKILL.md`, appended to in document order by every later task; and the
  six tests of `test/p2b-acceptance.test.mjs`, which every later task runs.

**Why now.** The checklist is the phase's acceptance, so it is written first and watched failing —
otherwise it is a pin written after the fact, which is trap 3 of the five this plan is trying not to
pay again. Writing it first also settles the document's outline once, so thirteen later implementers
append into a decided shape instead of negotiating headings one section at a time.

- [ ] **Step 1: Write the acceptance test**

Create `test/p2b-acceptance.test.mjs`:

```js
// The phase's acceptance (spec §15): the section checklist of §6 is present. It is a pin against
// the risk §16 names — "the protocol document is 1031 lines of hard-won rules and the port could
// quietly drop one" — plus four guards that hold the two transformations of §6's last paragraph.
//
// What it CANNOT do is judge whether a section is right. There is no dead-code gate and no prose
// linter in this repository; the per-task review is the only filter, and this file must never be
// presented as one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SKILL = join(ROOT, 'skills', 'orchestra', 'SKILL.md');
const read = (p) => readFileSync(p, 'utf8');

// ---- the §6 checklist -------------------------------------------------------------------------
// One row per item §6 names. `heading` is the section that carries it — several items share one,
// which is why `anchors` exists: each anchor is the MEASUREMENT the item was paid for, so a section
// that survives the port with its evidence stripped fails here too.
const JOURNAL = '## The journal (three mechanical obligations, no decision)';
const SECTIONS = [
  { item: 'the nevers', heading: '## The six nevers', anchors: [/never merge a row/i] },
  { item: "the journal's four keys and the clock", heading: JOURNAL,
    anchors: [/`ts`, `kind`, `task`, `text`/, /Never type the timestamp/] },
  { item: 'pending[] with id, options and askedAt', heading: JOURNAL,
    anchors: [/askedAt/, /A QUESTION THAT IS NOT IN/] },
  { item: 'the shared inboxSeen cursor and the stolen stamp', heading: JOURNAL,
    anchors: [/inboxSeen/, /FIVE answers/] },
  { item: 'the framing pass and the one interruption',
    heading: '## The framing pass, and the one interruption',
    anchors: [/thirteen/, /2026-08-14/] },
  { item: 'the resume cycle; SendMessage does not wake a --bg worker',
    heading: '## The tick', anchors: [/SendMessage does NOT wake/, /claude stop/] },
  { item: 'the two 600-second ceilings',
    heading: '## The tick', anchors: [/TWO 600-SECOND CEILINGS/] },
  { item: 'exit code and CLI status are non-evidence',
    heading: '## The tick', anchors: [/NON-EVIDENCE/, /exit 144/] },
  { item: 'an undelivered relay is an obligation',
    heading: '## The tick', anchors: [/UNDELIVERED:/, /8 h|eight hours/] },
  { item: 'the decision template', heading: '## The decision template',
    anchors: [/Where it stands/] },
  { item: 'the picture rule',
    heading: '### A question about a picture must carry the picture', anchors: [/thumbnail/] },
  { item: 'the playtest gate and the unfetched URL', heading: '## The playtest gate',
    anchors: [/Never hand out a URL you have not fetched/] },
  { item: 'the dev-server sweep', heading: '### The dev-server sweep',
    anchors: [/ORPHAN is the only verdict that kills/] },
  { item: 'the conductor beat and the lock', heading: '## The tick',
    anchors: [/conductor\.beat\.json/, /orchestra lock acquire/] },
  { item: 'the stand-down tick, its ticket sweep and its archiving',
    heading: '## The stand-down tick',
    anchors: [/orchestra archive --write/, /orchestra archive-images --write/, /\bS1\b/] },
];

// The document's outline, in order. A superset of the headings above: it also pins the sections that
// §6 does not name item by item but that the port must still carry.
const OUTLINE = [
  '## What is not here yet',
  '## The six nevers',
  '## The language you write in',
  '## The journal (three mechanical obligations, no decision)',
  '## The framing pass, and the one interruption',
  "## The machine's capacity — the budget owns it, and you do not",
  '## The tick',
  '## Adoption (first run, or state lost)',
  '## Preflight (once per machine, before the first launch)',
  '## The decision template',
  '### A question about a picture must carry the picture',
  '## The playtest gate',
  '### The dev-server sweep',
  '## Design→execution handoff (design tasks)',
  '## Worker briefs',
  '## Retiring a long worker (EXPERIMENT — one row at a time)',
  '## The stand-down tick',
  '### The answer net, and what has no net under it yet',
];

// The nine substitutions §6 fixes for the briefs. They are also the ONLY single-word braces the
// document may contain: a config key named in prose is a backticked key name, never a placeholder,
// and a tenth placeholder is a promise the conductor has nothing to fill from.
const PLACEHOLDERS = ['branch', 'task', 'title', 'excerpt', 'language', 'branchTests',
  'specsDir', 'plansDir', 'briefExtra'];

// Every path and command of the source project. A survivor here is transformation 1 or 2 left undone
// — and a false invocation in a protocol is worse than a false comment, because a worker types it.
const FORBIDDEN = [
  'node tools/', 'tools/orchestra', 'tools/merge-queue', 'tools/tickets', 'tools/retex',
  'tools/queue', 'tools/roadmap/', 'tools/usage-scan', 'npm run ', '.claude/orchestra',
  '.claude/worktrees', 'docs/superpowers/', 'docs/local/', 'docs/ROADMAP.md', 'docs/retex',
  'reports/', 'CLAUDE.md', 'com.planetcraft', 'launchctl', 'crontab -',
];

// The slice of `text` that belongs to ONE heading — from the heading's own line up to (not
// including) the next heading at level 2 or 3. Anchors are tested against this slice, not the
// whole document: several items share a heading, and several headings share a document, so an
// anchor belonging to a section not yet written must not be satisfiable by prose that belongs to
// its neighbour. Returns null when the heading itself is absent.
function sectionSlice(text, heading) {
  const at = text.indexOf(`\n${heading}\n`);
  if (at < 0) return null;
  const bodyStart = at + 1 + heading.length; // index of the heading's own trailing newline
  const next = text.slice(bodyStart).search(/\n#{2,3} /);
  const end = next < 0 ? text.length : bodyStart + next;
  return text.slice(at + 1, end);
}

test('every section of spec §6 is present, with the measurement that paid for it', () => {
  const text = read(SKILL);
  const missing = [];
  for (const s of SECTIONS) {
    const slice = sectionSlice(text, s.heading);
    if (slice === null) { missing.push(`${s.item}: no heading "${s.heading}"`); continue; }
    for (const a of s.anchors) if (!a.test(slice)) missing.push(`${s.item}: anchor ${a} absent`);
  }
  assert.deepEqual(missing, []);
});

test('the outline is complete and in order', () => {
  const text = read(SKILL);
  const at = OUTLINE.map((h) => [h, text.indexOf(`\n${h}\n`)]);
  assert.deepEqual(at.filter(([, i]) => i < 0).map(([h]) => h), []);
  const order = at.map(([, i]) => i);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('the nine brief placeholders are all used, and nothing else is a placeholder', () => {
  const text = read(SKILL);
  const found = new Set([...text.matchAll(/(?<!\$)\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((m) => m[1]));
  assert.deepEqual([...found].filter((p) => !PLACEHOLDERS.includes(p)), []);
  assert.deepEqual(PLACEHOLDERS.filter((p) => !found.has(p)), []);
});

// Every `orchestra …` the document names must be a subcommand `bin/orchestra` actually dispatches,
// or be roll-called in `## What is not here yet` with its phase. Parsed out of the sources rather
// than listed here, so a subcommand renamed in a later phase fails this test instead of rotting.
const registered = () => new Set(
  [...read(join(ROOT, 'bin', 'orchestra')).matchAll(/^register\('([a-z-]+)'/gm)].map((m) => m[1]),
);
const roadmapVerbs = () => new Set(
  [...read(join(ROOT, 'lib', 'cli', 'roadmap.mjs')).matchAll(/^\s*case '([a-z-]+)':/gm)].map((m) => m[1]),
);

// Commands are only ever written inside backticks or a fenced block, so those are the only places
// scanned — prose that happens to contain the word "orchestra" is not an invocation.
//
// The two patterns are BUILT rather than written as literals, and that is not style: a literal
// triple backtick in this file closes the markdown fence of any document quoting it, so every copy
// taken from the plan arrives truncated at this line. Measured while pre-flighting that plan.
const TICK = String.fromCharCode(96);
const FENCED = new RegExp(`${TICK.repeat(3)}[a-z]*\\n([\\s\\S]*?)${TICK.repeat(3)}`, 'g');
const INLINE = new RegExp(`${TICK}([^${TICK}\\n]+)${TICK}`, 'g');

function invocationsIn(text) {
  const spans = [
    ...[...text.matchAll(FENCED)].flatMap((m) => m[1].split('\n')),
    ...[...text.matchAll(INLINE)].map((m) => m[1]),
  ];
  const out = [];
  for (const raw of spans) {
    const s = raw.trim().replace(/^"\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/orchestra"\s*/, 'orchestra ');
    const m = /^orchestra\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?/.exec(s);
    if (m) out.push(m[1] === 'roadmap' && m[2] ? ['roadmap', m[2]] : [m[1]]);
  }
  return out;
}

test('every command the protocol names either exists or is roll-called with its phase', () => {
  const text = read(SKILL);
  const from = text.indexOf('\n## What is not here yet\n');
  const to = text.indexOf('\n## The six nevers\n');
  assert.ok(from >= 0 && to > from, 'the roll-call section must come before the nevers');
  const rollCall = text.slice(from, to);
  const cmds = registered();
  const verbs = roadmapVerbs();
  const bad = [];
  for (const [head, verb] of invocationsIn(text)) {
    const known = verb ? verbs.has(verb) : cmds.has(head);
    const named = verb ? `orchestra roadmap ${verb}` : `orchestra ${head}`;
    if (!known && !rollCall.includes(`\`${named}\``)) bad.push(named);
  }
  assert.deepEqual([...new Set(bad)], []);
});

test('no path or command of the source project survives', () => {
  const text = read(SKILL);
  assert.deepEqual(FORBIDDEN.filter((f) => text.includes(f)), []);
});

test('the frontmatter names the skill and says when to use it', () => {
  const text = read(SKILL);
  const fm = /^---\nname: orchestra\ndescription: (.+)\n---\n/.exec(text);
  assert.ok(fm, 'frontmatter must open the file with name: orchestra and one description line');
  assert.match(fm[1], /\/orchestra/);
});
```

- [ ] **Step 2: Run it and watch every guard fail**

Run: `node --test test/p2b-acceptance.test.mjs`
Expected: FAIL — six tests, all of them, on `ENOENT … skills/orchestra/SKILL.md`. **Paste the run
verbatim in the report.**

- [ ] **Step 3: Prove the two guards that cannot fail on an empty file**

`forbidden` and `invocations` are vacuously green on a document with no content, so prove them now
rather than trusting them later. Create `skills/orchestra/SKILL.md` containing exactly:

```markdown
---
name: orchestra
description: placeholder for /orchestra
---

## What is not here yet

## The six nevers

Run `node tools/orchestra/journal.mjs note - "x"` and then `orchestra frobnicate`.
```

Run: `node --test test/p2b-acceptance.test.mjs`
Expected: FAIL on `no path or command of the source project survives`, naming `node tools/` and
`tools/orchestra`, AND on `every command the protocol names either exists or is roll-called`,
naming `orchestra frobnicate`. **Paste both failures verbatim.** Then delete the file before Step 4
— the real one is written from scratch.

- [ ] **Step 4: Write the frontmatter and the preamble**

Port source lines 1–12. The frontmatter:

```markdown
---
name: orchestra
description: Conduct every roadmap of this project at once — one background worker session per ready task, and every question relayed to the user in plain language. Use when the user says /orchestra, or asks to orchestrate or parallelise the roadmaps.
---
```

The source's description also promises "automatic relaunch when a branch lands" and a cron firing
`/orchestra tick`; both depend on the merge gate (phase 3) and the heartbeat (phase 5), so neither
is claimed here.

Then `# Orchestra — the conductor protocol` and a preamble carrying, from source 7–12: the plugin's
own spec path (`docs/specs/2026-09-02-orchestra-plugin-design.md`); and "you hold no state in your
head — everything below rehydrates from `.orchestra/state.json`, git and `claude agents --json`, and
the conversation is a cache, so any fresh session running this skill takes over completely".

Add three things the source has no need of and this document does:

- **the invocation form**, once: `"${CLAUDE_PLUGIN_ROOT}/bin/orchestra" <subcommand>`, then
  `orchestra …` everywhere after; if `CLAUDE_PLUGIN_ROOT` is unset, the binary is `bin/orchestra` at
  the root of the plugin's own directory.
- **`orchestra doctor` first, always.** It is the only command that answers in a project that has
  not opted in; it prints the resolved configuration, marks every defaulted key, and names the mode.
  If it says the project has not opted in, stop and do what it says — every other subcommand exits 0
  and silent, on purpose, and that silence is what makes the plugin safe to install globally. The
  conductor reads `name`, `id`, `language`, `mainBranch`, `worktrees`, `branchTests`, `docs.specs`,
  `docs.plans`, `docs.results` and `briefExtra` off it, and nothing else.
- **runtime state resolves to the main checkout, never to the worktree you are standing in.** Every
  subcommand does that for itself. What it cannot do for you is the register you edit **by hand**:
  `.orchestra/state.json` has no subcommand that writes it, so a path typed after a `cd` into a
  worktree writes the wrong file. Use the main checkout's absolute path, and check that the
  register's own `root` key names the project you think you are conducting.

- [ ] **Step 5: Write `## What is not here yet`**

The single roll-call. Every entry names its phase, and every absent command appears in backticks so
the acceptance test can find it:

- **phase 3, the merge gate**: `orchestra land`, `orchestra await`, `orchestra queue-list`, the
  `merge_agent` agent, and the `gates` and `ledgers` config they read. Until then **no landing
  happens through this protocol**: an approved branch is named to the user, in the journal and in
  the checkpoint, and it is the user's to land. You never merge — that rule outlives its
  enforcement, and phase 5's hooks are what will hold it.
- **phase 3, online only**: `orchestra roadmap sync`. Offline there is nowhere to write a status, so
  it will never exist there, and that is correct (spec §4.1).
- **phase 4, the monitoring page**: `orchestra monitor`, `orchestra instances`, the allocated port.
  **The page is also the only writer of `.orchestra/inbox.jsonl`**, so until it exists `orchestra
  inbox` prints nothing and the user answers in the conversation. The journal is still written, and
  `pending[]` is still load-bearing: `orchestra ready` reports it, `orchestra tick-gate` honours it,
  and `orchestra archive` never moves it.
- **phase 5**: the guard hooks, `orchestra init`, the ticket queue (`orchestra tickets`) and the
  heartbeat (`orchestra install-heartbeat`). **Never propose a cron entry for the heartbeat**: a
  cron job runs outside the login session and cannot read the login keychain, so every tick dies on
  `Not logged in` — eight consecutive ticks did, and seven hours were lost, on the night of
  2026-08-12/13 in planetCraft. A launchd agent or a systemd user timer is the shape that works.
- **never**: a retrospective tool (spec §13 — its metrics belong to the source project), and a
  level-triggered net under the answer watch. See `### The answer net, and what has no net under it
  yet`.
- **one limitation, not an absence**: `orchestra ready` reconciles against the literal branch
  `main`. A project whose main branch has another name gets a ready set that reconciles nothing, in
  silence, until a later phase widens it.

- [ ] **Step 6: Write `## The six nevers`**

Port source 13–40, all six, each with its measurement. The substitutions that bite here:

- **never 1**: the landing is phase 3's (the row still needs the user's look; what changes is who
  performs the landing). "a green FULL suite and green knip" → "every configured gate green"
  (`gates`, phase 3). Keep "thirteen merge approvals asked, thirteen granted, none refused" and the
  three defects caught by the look on 2026-08-12/14, attributed to planetCraft. Keep **what you may
  never do is land in SILENCE**.
- **never 3**: keep the three conditions verbatim, keep the `/usr/bin/find <wt> -newermt '-60
  minutes' -not -path '*/node_modules/*' -type f | head -1` probe, and keep the measurement
  (2026-08-12, asking cost two hours forty-four minutes on stricter evidence and the answer came
  back "yes, take all four" in six minutes). Attribute the absolute-`find` detail: a PATH-rewriting
  hook in the source project dropped `-newermt` from the bare name.
- **never 4**: unchanged.
- **never 5**: **write both modes.** Online, `deriveSharedStatus` in `lib/store/github/index.mjs` is
  the reference. Offline, every task is local, so it is simply "git wins" with no exception to
  remember (spec §4.1).
- **never 6**: `orchestra roadmap claim <key>` first. Add the honest half: offline the claim succeeds
  without telling anybody, because there is nobody to tell — the register row and the branch ref are
  the interlock; online the issue is how every other machine learns the task is taken. Phase 5's
  `guard-claim` hook is the backstop, not the mechanism.

- [ ] **Step 7: Write `## The language you write in`**

Port source 41–60 with one inversion made explicit: **this document is English because the plugin is
shared; what you write for the user follows the project's `language`.** Keep `conductor.language` in
`state.json`, keep "write it down the first time you see it" and the reason (most journal lines are
written by a headless tick with no user message to infer from, so a language only ever deduced is a
language lost on every tick the heartbeat and the page start), and keep the fallback to English.

Replace the exceptions list: it does not apply to a published roadmap or to any roadmap's parsed
skeleton — the seven field names, `**Why.**`, `**Acceptance.**`, ids and branch names are English in
every channel, and `orchestra roadmap lint` fails if they are not. Name the `roadmaps.published` and
`roadmaps.drafts` keys rather than one project's paths.

- [ ] **Step 8: Run the acceptance and the suite**

Run: `node --test test/p2b-acceptance.test.mjs; npm test`
Expected: the `§6` and `outline` tests still FAIL, naming exactly the sections later tasks add and
nothing else; `placeholders` FAILS on the nine not yet used; `invocations`, `forbidden` and
`frontmatter` PASS. `npm test` otherwise green (255 tests plus this file's six).

**In the report, list which §6 items are green.** Expected: item 1, the nevers. Everything else is
still owed.

- [ ] **Step 9: Commit**

Stage `test/p2b-acceptance.test.mjs` and `skills/orchestra/SKILL.md`, with the message:
`test(p2b): the section checklist of spec 6, watched failing on all fourteen`

---

### Task 2: the journal — three mechanical obligations

**Files:**
- Modify: `skills/orchestra/SKILL.md` (append `## The journal (three mechanical obligations, no decision)`)
- Source: lines 61–184

**Interfaces:**
- Consumes: Task 1's conventions (the invocation form, the roll-call, `{name}` reserved for briefs).
- Produces: §6 items 2, 3 and 4 green.

**Why now.** It is the densest section of the source — 124 lines for three obligations — and three of
the fourteen acceptance items live in it. It is also the section whose commands changed most: two of
the three obligations are performed with a subcommand.

- [ ] **Step 1: Read the code before the prose**

Read `lib/register/journal.mjs`, `lib/register/inbox.mjs`, `lib/register/relay.mjs`,
`lib/register/pending.mjs` and `lib/cli/register.mjs`. The document must describe **these**, not the
source's tools. What differs from the source's account:

- `orchestra journal <kind> <task|-> "<text>"` — `-` is how "about the tick itself" is typed,
  because an empty shell argument is too easy to pass by accident. It prints the journal's path. An
  unknown `kind` is **refused**, not written. The eight kinds are unchanged: `launch`, `question`,
  `answer`, `report`, `landing`, `note`, `tick`, `ruling`.
- `orchestra inbox` prints an `<orchestra-monitor-inbox count="N">` block, or **nothing at all**
  when there is nothing unconsumed. Its batch is the **oldest** unconsumed answers first, capped at
  20, and it says in a line when it truncated — so stamping `conductor.inboxSeen` to the newest
  timestamp *shown* stamps past exactly what was relayed and no further.
- Unconsumed means: newer than `inboxSeen`, **or** answering an item still open in `pending[]` and
  less than four hours old. A free remark carries no `pending`, so nothing recovers it once the
  cursor is past it — which is why the stolen-stamp rule matters here at least as much as in the
  source.
- A `pending[]` item with no explicit `id` is keyed by a sha1 of row/kind/ask, and a row carrying two
  such items leaves **no way to tell which was answered**. That is the mechanism behind the source's
  "write an `id`" rule; state it.

- [ ] **Step 2: Write obligation 1 — one journal line per event**

Port source 69–107. Substitute the path and the command; keep every measurement:

- `.orchestra/journal.jsonl`, and never `inbox.jsonl`, which is the page's file (phase 4) and the one
  thing you never write. One writer per file is what makes this lock-free; two writers is the only
  way it can corrupt.
- The command block becomes:
  ```sh
  orchestra journal question lod/C2 "…"      # task `-` for a tick-level line
  ```
- Keep **Never type the timestamp, and never hand-write the line**, with the 2026-08-12/14 numbers
  in full: 75% of 165 stamps ending in `:00` or `:30`; 29 lines out of chronological order against
  the file's own append order; the "+2 h Paris local, still suffixed `Z`" defect as a symptom rather
  than a separate bug; and the cost — question latency could not be measured from the file at all.
  Keep the four lines truncated mid-JSON by two conductors appending at once, and the tool's two
  answers to it: one complete line per write, and a missing trailing newline repaired before the
  next append.
- Keep **those four keys, copied exactly — `ts`, `kind`, `task`, `text` — and no others**, with the
  wrong-shape line written into the wrong file on 2026-08-12 quoted verbatim, and the three
  corrections it earns (`ts` not `at`, `text` not `action`, the item id belongs in `state.json`'s
  `pending[]`). Say who the reader is: phase 4's page reads them by name and shows nothing else.
- Keep the per-kind guidance and "skipping a line degrades the page's left panel and nothing else —
  never skip a `question` or an `answer`", which is what the user reads back.

- [ ] **Step 3: Write obligation 2 — the `pending[]` item**

Port source 108–155. Keep, in full: the explicit `id` (`"<lowercased row id>-<kind>-<n>"`) and why
the hash fallback drifts; `options` as an array of `{"letter","text"}` copied from the decision
template **in the user's language**; `askedAt` taken with `date -u '+%Y-%m-%dT%H:%M:%SZ'` and not
typed; the JSON example; the page offering one button per option and **nothing** when there are
none; **A QUESTION THAT IS NOT IN `pending[]` DOES NOT EXIST**, with "pourquoi je n'ai pas les
notifications" and the two decisions in a row on 2026-08-12; and withdrawing an item the moment its
question dies, with the 17:43 / 17:56 / 22:09 contradiction.

Two additions the plugin's code earns:

- the page is phase 4, and `pending[]` is read **today** by `orchestra ready` (its `WAITING:` line,
  which reports unanswered items older than thirty minutes, oldest first) and by `orchestra
  tick-gate` (an open item on any row keeps the heartbeat awake, whatever that row's status).
- an item written with no `askedAt` is reported **with no age rather than dropped**, so an old row
  never silently disappears from the very report that exists to find the longest wait.

- [ ] **Step 4: Write obligation 3 — the shared cursor**

Port source 156–184. The command becomes `orchestra inbox`; "by the hook" becomes "by phase 5's
`orchestra-inbox` hook, once it exists". Keep the whole stolen-stamp passage: the cursor is a single
shared watermark with no owner; a forgotten stamp is the safe failure and a stolen one the dangerous
failure; the 2026-08-12 measurement (a second conductor stamped `20:10:33.311Z` and FIVE answers — a
design ruling, a failed playtest, a merge approval, a launch ruling and a question — were never
delivered to the conductor the user was talking to; a worker sat fifty minutes on a verdict that had
already arrived, and three others were launched against a "keep the box quiet" nobody had read); and
the instruction: whenever `inboxSeen` is ahead of the last value **you** wrote, do not trust the
hook — read `.orchestra/inbox.jsonl` yourself and re-derive which of its lines answer items still in
`pending[]`. Keep "the same applies the moment a user says anything like 'I answered that on the
page': open the file, do not argue with it".

Keep **stamp only once the action the answer AUTHORISES has completed**, with X2's 2026-08-13
approval at 13:17:20 stamped, journalled and never performed, surfacing four hours later only
because a human asked; and the closing asymmetry — an unstamped answer costs one repeated relay, a
stamped-but-unacted answer costs the user their decision, silently.

Add one clause, because the code says it: the four-hour grace rule recovers an answer to an item
still open, so the dangerous window is narrower than it was — **and it does not cover a free
remark**, which targets no item at all.

- [ ] **Step 5: Run the acceptance and the suite**

Run: `node --test test/p2b-acceptance.test.mjs; npm test`
Expected: §6 items 2, 3 and 4 green; `forbidden`, `invocations` and `frontmatter` still PASS. Report
which items are now green and which remain.

- [ ] **Step 6: Commit**

Stage `skills/orchestra/SKILL.md`, message:
`docs(orchestra): the journal - three obligations, ported with their clock`

---

### Task 3: the framing pass, and the one interruption

**Files:**
- Modify: `skills/orchestra/SKILL.md` (append `## The framing pass, and the one interruption`)
- Source: lines 185–221

**Interfaces:**
- Consumes: Task 2's `ruling` journal kind.
- Produces: §6 item 5 green.

**Why now.** It is the section that decides whether a question is asked at all, so the decision
template (Task 10) and the playtest gate (Task 11) both lean on it. It is short and self-contained,
which makes it the right place to settle how a `ruling` is journalled here.

- [ ] **Step 1: Port the section**

Port source 185–221 whole. Keep the user's standing instruction of 2026-08-14 in substance: **take
the maximum of information at framing, then decide alone — no more than one interruption per row
during development.** Keep the anticipated decision list at adoption, all rows at once, one
document, one sitting; `decisions: [{q, answer, at}]` written onto the row; **binding and never
re-asked**.

Keep the arithmetic that sets the budget: thirteen merge approvals asked, thirteen granted, none
refused, zero defects caught; three human looks at a page, three serious defects caught, every one
past a green suite. Keep the two-way rule (a row that ships a page a human reads or a gameplay
change → the playtest gate; a row that ships neither → no interruption).

Substitutions:

- "it lands on a green FULL suite and green knip" → "it lands once every configured gate is green"
  (`gates`, phase 3).
- the `ruling` command block:
  ```sh
  orchestra journal ruling dev-loop/S3 "old cross-build curves: kept empty with their reason, per the framing answer on S3"
  ```
- "the morning digest leads with the rulings" → keep, and say where the digest is in this phase: the
  checkpoint and the journal. The page that renders it is phase 4.
- "this repository's rules" → the project's own rules, which reach a worker as `briefExtra`.

Keep **exceeding the budget is not forbidden — it is recorded**, keep the instruction to say in the
same breath what framing failed to anticipate, and keep the cost stated plainly: a wrong solo ruling
runs until the next checkpoint instead of being stopped within the hour, and the exposure is a fork
framing did not anticipate and no precedent covers.

- [ ] **Step 2: Run the acceptance and the suite**

Run: `node --test test/p2b-acceptance.test.mjs; npm test`
Expected: §6 item 5 green; everything else unchanged.

- [ ] **Step 3: Commit**

Stage `skills/orchestra/SKILL.md`, message:
`docs(orchestra): the framing pass, and the one interruption a row is allowed`

---

### Task 4: the machine's capacity

**Files:**
- Modify: `skills/orchestra/SKILL.md` (append `## The machine's capacity — the budget owns it, and you do not`)
- Source: lines 222–261, **rewritten** against spec §8.6 and §13

**Interfaces:**
- Consumes: nothing.
- Produces: the outline's sixth heading. No §6 item — this section is in the outline because §8.6's
  budget has to be explained somewhere a conductor reads, and the section it replaces was about a
  tool this plugin does not ship.

**Why now.** It is the one section that is a **rewrite rather than a port**, so it gets its own
review. The source section is about `planetCraft`'s multi-machine execution queue, which spec §13
keeps there; §8.6 gives the portable answer, and it is smaller and advisory.

- [ ] **Step 1: Read what actually enforces the budget**

Read `lib/machine.mjs` and `lib/cli/tick.mjs`'s `readyCommand`. The facts the section must state,
all of them in that code:

- `orchestra ready` is the **one** command that writes `~/.orchestra/instances.json`, publishing
  this project's in-flight count (rows `claimed` or `review`) for every other orchestra on the
  machine to budget against, and reaping whatever died since the last tick in the same pass.
- The cap is `min(--width, maxWorkers − workers held by other live instances)`, where `maxWorkers`
  comes from `~/.orchestra/machine.json` and defaults to 8. `--width` itself defaults to 8.
- The lines it prints, verbatim, because a conductor reads them:
  ```
  in flight: 2/6 (width 8, held down to 6: 2 of 8 worker(s) belong to other project(s) on this machine)
  HELD: 3 task(s) are ready and this machine has no slot for them — 8 of 8 are held elsewhere
  ```
  A conductor held to zero **says so and does not launch anyway**.
- The registry is **advisory, never authority**. Its errors point one way on purpose: a conductor
  killed with `-9` leaves its count behind until its entry is reaped, which under-budgets everybody
  else for a few minutes. Too few launches, never too many.
- An entry is reaped when its root no longer exists, or when **neither** its conductor pid is alive
  **nor** it has reported itself within six hours. (Spec §8.2 says "whose beat is stale"; the code
  reads the write stamp instead, because the beat field is legitimately null whenever no
  `watch-answers` loop is armed, and an entry that read dead the instant it was written would make
  every other project over-launch. Describe the code.)
- **It budgets sessions, not CPU.** Four projects each running one full test suite is within budget
  and can still saturate the machine. A project that needs that ordering configures `queue`; unset,
  a command runs directly. Name the key and point at `orchestra doctor` — **do not spell the
  template's placeholders**, or the acceptance test's placeholder guard fails.

- [ ] **Step 2: Write the section**

Structure it as: what owns the machine (the budget, plus the project's `queue` if it has one), then
the rules that survive the source section because they generalise — each keeping its measurement,
attributed to planetCraft, 2026-09-02:

- **Never read a load average to decide anything.** A conductor spent a morning hand-managing load —
  reading `uptime`, telling workers to hold off benches, promising a quiet window — and got it wrong
  in three different ways in three hours: a landing refused on an innocent test at load 26, another
  dead in a queue, and a "quiet machine" announced off the **15-minute** average while the 1-minute
  figure was 11.99 and a second test run had started *after* the hold was issued. If you must know
  what is running, ask the budget: `orchestra ready` prints it.
- **Never promise a worker a quiet window.** You cannot deliver one: you do not control the other
  worktrees, the other developers, or the heartbeat.
- **Do not tell a worker to avoid heavy jobs.** It buys nothing and costs it the measurement it was
  launched to take. If the project has a `queue`, its own commands already route through it.
- **The one thing that is yours**: a worker reporting that its measurement could not get what it
  needed is a **tooling finding** — it goes to the user, not into a workaround. No amount of
  conductor vigilance substitutes for fixing it.

- [ ] **Step 3: Run the acceptance and the suite**

Run: `node --test test/p2b-acceptance.test.mjs; npm test`
Expected: the outline test misses one heading fewer. `placeholders` must NOT regress — if it fails
naming a brace this task introduced, the `queue` template was spelled out and must be replaced by a
pointer to `orchestra doctor`.

- [ ] **Step 4: Commit**

Stage `skills/orchestra/SKILL.md`, message:
`docs(orchestra): the machine's capacity - an advisory budget, not a fleet`

---

### Task 5: the tick, steps 0 to 2

**Files:**
- Modify: `skills/orchestra/SKILL.md` (append `## The tick` and its steps 0, 1 and 2)
- Source: lines 262–366

**Interfaces:**
- Consumes: Task 2's journal, Task 4's budget lines.
- Produces: §6 item 13 (the beat and the lock) green; the `## The tick` heading, under which Tasks
  6, 7 and 8 append their steps. **Do not close the section** — the numbered list continues in Task
  6 at step 3.

**Why now.** The tick is 354 source lines and four of the fourteen items; it is split across four
tasks so each is reviewable. This one carries the two writes a session that is about to hand back
must not make, which is exactly why the source asks the yield question before either of them.

- [ ] **Step 1: Read the code**

Read `lib/register/wake.mjs`, `lib/register/beat.mjs`, `lib/register/watch.mjs`,
`lib/register/lock.mjs`, `lib/cli/tick.mjs` and `lib/cli/register.mjs`. The real behaviour:

- `orchestra yield-check` prints one line and exits **10** when a live conductor holds the baton; it
  has already journalled the handback (and never the same line twice running). Every other outcome,
  a crash included, means "nothing to do" — the safe direction.
- Its evidence is the beat and **nothing else**: no fallback to `conductor.session`, which named a
  dead conductor for half an hour on 2026-08-13 while three answers rotted in it.
- A beat is live if its stamp is under **60 seconds** old (thirty two-second periods) **and** its pid
  answers signal 0. It counts as *conducting* if `state.json`'s mtime is under **90 minutes** old. A
  conductor that beats but has not conducted for 90 minutes has a **loose baton** and you may act
  past it — `yield-check` says so in its own line.
- `orchestra beat` reads the same file: `nobody is holding the baton`, or `<session> (pid N) —
  conducting`, or `<session> (pid N) — beating but silent for N min: the baton is loose`.
- `orchestra lock acquire --kind conductor --session <id>` prints `acquired`, or `held by conductor
  <session> (pid N) since <ts>` **and exits 1**. A `conductor` holder is alive only while the beat
  names **that** session; a `tick` holder is alive while its pid is; any holder older than four
  hours is broken automatically. `--pid` must be a positive integer or the command refuses, naming
  what was passed. Release is identity-checked, so a conductor already broken for staleness cannot
  delete its successor's lock. `orchestra lock holder` answers `free` or `held by …`.
- `orchestra watch-answers <session>` never returns. Its first round announces nothing and only
  remembers what is already there, because the tick that arms it reads the inbox itself at step 4.
  It writes the beat first and unconditionally on every period, so a register it cannot read never
  costs the machine its only evidence that a conductor is alive. It announces at most ten answers
  per round, as `ANSWER <task> · <pending id> · <ts> — "<the answer, one line>"`.

- [ ] **Step 2: Write step 0 — ask whether somebody is already conducting**

Port source 264–276. The command becomes:

```sh
orchestra yield-check     # exit 10 = hand back; it has already journalled the line
```

Keep the whole reason this is step 0 and not step 2: step 1 arms a watch and records the session as
conductor, and both are writes a session that must hand back may not make — a second watch
overwrites the live conductor's beat with its own, and recording yourself puts a session about to
stand down into `conductor.session`. Asking after those two is asking too late. Keep "on exit 10,
STOP. Nothing else in this tick happens." Substitute: phase 5's heartbeat runs the same one.

- [ ] **Step 3: Write step 1 — rehydrate**

Port source 277–364, in the source's own order: the page, the answer watch, `ready`, the lock, then
the only-conductor check.

- **The page.** In this phase there is none (phase 4). Do not port the `lsof` one-liner and do not
  name a port. Keep, as one short paragraph addressed to the phase that will need it, the two rules
  that were measured and would otherwise be paid for again: **probe with `lsof`, never with `curl`**
  — measured 2026-08-12 in planetCraft, `curl` from the conductor's shell cannot reach a localhost
  server that `lsof` proves is listening and a browser is using, so the `curl` form hangs for ever
  and the `||` never fires; and **a page that accepts the connection and never replies is not a
  wedged process** — restarting it changes nothing, because a fresh one does the same; it is blocked
  on something it fetches synchronously per request, and that was GitHub being unreachable, through
  the board read, for nine hours on 2026-08-12. Keep "the page is never required".
- **The answer watch, armed once, before anything else in this tick.** Keep the Monitor block, with
  the command substituted:
  ```
  Monitor(command: "orchestra watch-answers <your full session uuid>",
          persistent: true, description: "answers posted on the monitoring page")
  ```
  Keep both jobs on one timer; the one-second measurement of 2026-08-13; the fact that this is the
  only channel that reaches a session sitting idle between ticks (`SendMessage` only queues, and
  your next turn otherwise comes when the user types); and that the beat is the **only** evidence
  anywhere that a conductor is alive. Keep **arm exactly one** — a second watch on the same session
  announces everything twice — and **a headless tick arms none**, because the loop would die with
  the tick and its beat would spend the next minute naming a conductor already gone. Add the honest
  clause: until phase 4 there is no page writing answers, so the loop's announcements are empty and
  it is armed **for the beat**, which the lock and phase 5's heartbeat both read.
- **`orchestra ready --json`**, from the main checkout, plus `claude agents --json` and
  `ListAgents`. No state file → Adoption. `conductor.session` not you → you are a replacement:
  record yourself, and SendMessage every live worker a new hello — "new conductor; reply to this
  address; resend any pending question". Keep the note that a question lost in the handover is
  re-collected by step 3's probe, not dropped.
- **Then take the lock**, before anything else this tick does. Keep the measurement — a second tick
  ran beside the first three times on 2026-08-12, once double-running the landing on the same branch
  — and the block:
  ```sh
  orchestra lock acquire --kind conductor --session <your full session uuid>
  ```
  Exit 0 means it is yours; exit 1 prints who holds it and **you stop the tick there** — journal one
  line and hand back. Release it in step 9 and only there: while you hold it, no headless tick will
  start. Keep "a holder that is provably gone is broken automatically — a dead pid for a tick, a
  stopped beat for a conductor — so a killed session cannot wedge the heartbeat", and keep "arm the
  answer watch BEFORE you rely on this: your beat is what proves you are alive, and a conductor that
  holds the lock without beating is one the next tick will correctly break".
- **Then check you are the only conductor anyway.** Port source 337–364 whole: the lock stops two
  conductors *starting* together and cannot see one that began before it existed — six sessions took
  the baton from each other in half an hour on 2026-08-13. `.orchestra/conductor.beat.json` is the
  one check that answers rather than hints, and step 0 has already made it; what follows is what
  that check means. A beat naming a session that is not you, stamped under a minute ago, whose pid
  is alive, **is** a live conductor: journal one line and hand back, whatever `conductor.session`
  says. Keep the one exception in full: **a beat proves a session can be REACHED, never that it is
  conducting** — the loop is armed for the whole session, so a window left open and untouched beats
  for ever; measured 2026-08-17/18, four consecutive heartbeat slots stood down for one while four
  finished workers sat uncollected about thirteen hours. Say that `orchestra yield-check` also reads
  how long the register has stood still and lets you act past ninety minutes of it, and keep the
  instruction to **ask the user to close that session**, with its reason: its answer watch is still
  writing the beat and yours will be too, so the two loops take turns naming the conductor until one
  is closed. Keep "the register is the opposite and always was". Keep the no-beat fallback tells — a
  row that reconciles to `claimed` on a ref you never created, a `git worktree list` entry you did
  not add, a `git branch -d` that refuses because a worktree you do not know holds the branch, an
  `inboxSeen` ahead of your own last write — with "do NOT touch its worktree (never 3)", "record
  what it built so the work is not lost", and **the branch ref is the interlock that actually held**.

- [ ] **Step 4: Write step 2 — apply corrections**

Port source 365–366. `orchestra ready` prints its corrections as `fix: <id>: <what changed>` lines;
write the reconciled rows back to `.orchestra/state.json`. You are the only writer of that file;
workers never touch it. Add the guard from Task 1's preamble in one clause: the register carries the
`root` it was created for, and a hand-written path after a `cd` is how another project's register
gets written.

- [ ] **Step 5: Run the acceptance and the suite**

Run: `node --test test/p2b-acceptance.test.mjs; npm test`
Expected: §6 item 13 green (both anchors — `conductor.beat.json` and `orchestra lock acquire`);
items 6, 7, 8 and 9 still failing, since they are Task 6's.

- [ ] **Step 6: Commit**

Stage `skills/orchestra/SKILL.md`, message:
`docs(orchestra): the tick, steps 0-2 - yield first, then the beat and the lock`

---

### Task 6: the tick, step 3 — liveness and the resume cycle

**Files:**
- Modify: `skills/orchestra/SKILL.md` (append step 3 under `## The tick`)
- Source: lines 367–451

**Interfaces:**
- Consumes: Task 5's step 1 and step 2.
- Produces: §6 items 6, 7, 8 and 9 green. Introduces the `relay: {text, writtenAt, deliveredAt}`
  row shape that Task 7's step 4 writes into and Task 8's step 9 must not drop.

**Why now.** Four of the fourteen acceptance items are in these 85 lines, and every one of them is a
worker that went silent while a tick recorded it as idle. It is the single most expensive section of
the source, and it gets its own review for that reason.

- [ ] **Step 1: Read what `ready` reports and what the resume cycle actually is**

Read `lib/register/ready.mjs`'s `undeliveredRelays` and `lib/cli/tick.mjs`. Two facts to describe
exactly:

- the undelivered line is printed **first, above everything else**, and its real form is:
  ```
  UNDELIVERED: dev-loop/S3 [review] — relay written 2026-08-13T18:35:00Z, 600 min ago
  ```
  A relay whose `writtenAt` will not parse is still reported, with no age rather than with `NaN`.
- terminal rows are excluded, and **status is deliberately not part of the filter**: a row can owe
  the user an answer and owe its worker a message at the same time.

- [ ] **Step 2: Write the resume cycle**

Port source 367–400. Keep, verbatim in substance:

- a `--bg` worker stops at the end of each turn and sits `waiting`; it does not drive itself for
  hours, and **SendMessage does NOT wake it** — messages queue until the receiver's next turn, which
  never comes on its own. `claude -p --resume` refuses while the session is registered as a bg agent.
- the cycle, measured 2026-08-10:
  ```sh
  claude stop <short-id>                      # unregister; the conversation is kept
  cd <worktree> && claude -p --resume <full-uuid> --dangerously-skip-permissions \
    "<nudge: read queued conductor messages, continue, print status or done-report>"
  ```
- **run it in the FOREGROUND and wait for it** — queued messages drain on that turn. Keep the
  measurement: backgrounding it is how the turn dies, because a backgrounded resume is reaped when
  the tick's own turn ends; measured twice in one morning on 2026-08-14, on the same row, ~55 minutes
  lost each time. Keep "a resume you did not watch finish is a resume that did not happen".
- **the reply printed on that resume is the ONLY channel a worker has to reach you**, so the nudge is
  the question you want answered, not a poke. Keep the 2026-08-12 measurement, three times: a
  worker session cannot resolve the conductor's address, so the hello arrives and the answer cannot
  come back; one design question and one done-report were found only by reading a transcript by hand.
  Keep **a resume that fails is a worker gone silent, not a worker idle** — the Bash task can die
  (exit 144 was seen) and you must notice and re-send.
- the per-row rule for every row **that is not `landed` or `dropped`, whatever its status — `review`
  included**, with the mtime probe (`/usr/bin/find <worktree> -newermt '-20 minutes' -not -path
  '*/node_modules/*' -type f | head -1`, absolute `find`, and the PATH-rewriting-hook reason
  attributed to the source project), and the relaunch case (same worktree, original brief plus "read
  what is already committed and dirty first", model re-evaluated — a done design relaunches on the
  execution model).
- **a `review` row means the USER owes an answer; it does not mean the WORKER has nothing to do** —
  with dev-loop/S3 on 2026-08-13, eight hours sixteen minutes, seven consecutive ticks writing
  "nothing moved, and that is normal".

The source's "same worktree" instruction refers to the project's `worktrees` directory; name the key,
not one project's path.

- [ ] **Step 3: Write the non-evidence rule**

Port source 401–420. Keep the heading sentence as it is written — **THE EXIT CODE AND THE CLI'S
STATE ARE BOTH NON-EVIDENCE. The filesystem is the only witness.** — and all three faces of
2026-08-25 with their rows: `exit 0` with a plausible-looking output that executed nothing (the
session ceiling's refusal, "You've hit your session limit · resets 1:50pm", reading like a thin
report — RP6, RP7 and SK3 at once); status `working` for 2 h 40 with zero files written and zero
commits (RP5 and MA2); `exit 144` with empty output, the Bash task killed outright (RP5 again, four
hours later).

Keep the instruction: when a resume REPORTS work, confirm it at the filesystem before you journal it
or act on it — the mtime probe, or `git -C <worktree> log --oneline -1`; and a resume that reports NO
work is a resume that did not happen. Keep the cost line: the probe costs milliseconds, each of the
three faces cost between forty minutes and two hours forty.

- [ ] **Step 4: Write the two 600-second ceilings**

Port source 421–436. Keep the heading — **TWO 600-SECOND CEILINGS, AND THEY ARE NOT THE SAME ONE** —
and both, distinguished:

- *the worker's own internal wait ceiling*: a worker waiting on something long has its turn cut at
  600 s while the thing it waits on survives, being a separate process. RP3 lost its turn this way
  with both its servers still up. Prefix its launch or its resume with
  `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` whenever the brief makes it wait.
- *your own tool-call ceiling*: a foreground resume you are watching is YOUR Bash call, and it is
  cut at 600 s too (MA4's worker, 05:57 on 2026-08-26). **A cut is a turn boundary, not a death**:
  the conversation is intact and the work is in the worktree, uncommitted — three dirty files that
  time, nothing lost. So the next nudge must OPEN with "your turn was cut at the ceiling — commit
  what is already in your tree first, then continue", or the following cut loses the same work
  twice.

- [ ] **Step 5: Write the relay obligation and the budget refusal**

Port source 437–451.

- **Writing a relay and delivering it are two acts, and only the second one counts.** The row shape
  is `relay: {text, writtenAt, deliveredAt}`, and `deliveredAt` is stamped only when the resume cycle
  has returned. Quote the real `UNDELIVERED:` line from Step 1. Keep **that line is an obligation
  for this tick, not information** and **a tick may not end with one outstanding**. Keep "delivering
  means the stop+resume cycle with the relay text inside the nudge: `SendMessage` is NOT delivery — a
  `--bg` worker's queue drains on a turn that never comes."
- **Budget refusal is not death**: a resume printing "You've hit your session limit · resets <time>"
  means every turn is refused until then — leave the rows claimed, note the reset time in
  `state.json` (the key is `budgetResetAt`, and `orchestra tick-gate` stands the heartbeat down
  until it passes rather than spending a session on a refusal already certain), and let the next tick
  retry. Do not mark workers dead on it.

- [ ] **Step 6: Run the acceptance and the suite**

Run: `node --test test/p2b-acceptance.test.mjs; npm test`
Expected: §6 items 6, 7, 8 and 9 green. Nine of fourteen now green; report the list.

- [ ] **Step 7: Commit**

Stage `skills/orchestra/SKILL.md`, message:
`docs(orchestra): the tick, step 3 - the resume cycle, the two ceilings, the relay obligation`

---

### Task 7: the tick, steps 4 to 6

**Files:**
- Modify: `skills/orchestra/SKILL.md` (append steps 4, 5 and 6 under `## The tick`)
- Source: lines 452–536

**Interfaces:**
- Consumes: Task 2's cursor rules, Task 6's `relay` shape.
- Produces: no new §6 item; step 6 is where the landing's phase-3 boundary is stated, and Task 8's
  step 7 continues from it.

**Why now.** These three steps are what a tick does with what it has just found: the answers, the
user, and a finished branch. Step 6 is also the step that changes most, because the landing itself
is phase 3.

- [ ] **Step 1: Write step 4 — the inbox**

Port source 452–467. The command becomes `orchestra inbox`. Keep **run it on every tick** and the
reason the hook alone is not enough: it serves an interactive conductor only and is structurally
blind to a tick the page itself spawns, because a fresh session's `SessionStart` and its one
`UserPromptSubmit` both fire before it can record itself in `state.json`, so the gate is still
reading the previous conductor's id. Keep the 2026-08-12 cost: five answers reached nobody that way,
G1 sat fifty minutes on a defect the user had already described, and three tasks launched half an
hour after the user had said to keep the machine quiet.

Keep the four-part obligation, whichever channel the text arrives by: **relay verbatim, clear the
`pending[]` item, journal an `answer`, stamp `conductor.inboxSeen`.** Then the worker-message
classification: *blocking* (the worker cannot continue) → relay to the user immediately in the
decision template; *non-blocking* (ready to test, an approval, an FYI) → append to that row's
`pending` in `state.json`.

Add the phase note in one clause: the hook is phase 5's and the page that writes the inbox is phase
4's, so in this phase `orchestra inbox` prints nothing and the answers arrive in the conversation —
the four obligations are unchanged, minus the stamp, which has nothing to stamp past.

- [ ] **Step 2: Write step 5 — the checkpoint**

Port source 468–485. Keep the three triggers (the user addresses you; pending count ≥ 3; the ready
set is empty while decisions pend) and the headless rule: never present; instead, **if `orchestra
ready` printed a `WAITING:` line, send ONE PushNotification**, ≤ 200 chars, naming the count, the
oldest row and its ask. Keep the example, minus the page URL, which is phase 4's — say so, and say
that the URL joins the notification when the page does:
```
3 waiting · dev-loop/F1: integrate the fix queue?
```
Keep **whether or not any of them is blocking**, with the reason it was the wrong filter: the four
asks that sat longest on 2026-08-12/14 were all merge approvals, and a merge approval blocks nothing
you are doing. Keep one push per tick and the four-hour resend rule. Keep the whole latency
measurement — 8 to 15 minutes when he knew something was waiting, 2 to 8 hours when he did not, and
four asks that had waited between 2 h 19 and 8 h 07 all answered inside the same four minutes: he
batches, and your job is to say there is a batch.

- [ ] **Step 3: Write step 6 — landings**

Port source 486–536, with the landing itself moved to phase 3. What that means concretely:

- For every row the reconcile just moved to `landed`: tell the user at the next checkpoint and
  continue — the launch step picks up whatever the landing unblocked.
- **When the user approves a merge, in this phase you do not perform it.** Name the branch to the
  user, journal the `landing` line when it lands, and re-run step 1 after. Phase 3 is what brings
  `orchestra land <branch> --detach` / `orchestra await <branch>` and the `merge_agent` agent, one
  branch at a time behind a lock. Keep the reason the shape is what it is, since it is a rule about
  this protocol and not about one project: landings are serialised by a lock, so a second one waits
  for the first and rebases onto the advanced main; the queue orders landings and decides nothing
  about them — whether a row needed the user's look at all is never the queue's question.
- Record the branch's commit `subjects` in the row BEFORE it lands. That is what makes landed
  detection work: `orchestra ready` matches the exact commit **subject** on the main branch, never a
  hash, because a landing rebases.
- **A REFUSED GATE IS A CLAIM, NOT A VERDICT — and it comes in two flavours you must tell apart
  before you act.** Keep both, with MA4's three refusals on 2026-08-26 and only the first being
  about MA4:
  - *a golden that moved* — never authorise a re-cut on an attribution you have not seen PROVEN, and
    prove it by ABLATION in both directions on the branch's own worktree: revert the suspect alone
    and re-hash, remove the real suspect alone and re-hash. Keep the outcome (the named file was
    gated on a climate the test's seed did not have; the true cause was elsewhere entirely) and the
    conclusion: a re-cut taken on the plausible answer writes a false cause into a test that
    outlives everybody who reads this. The ablation costs one run; make the worker do it and make it
    paste both hashes. Say that the gate itself is a project's own `gates` entry (phase 3), so the
    rule applies to whatever gate a project configures.
  - *a single failure on a test the branch does not touch* — check three things before believing it:
    the branch touches neither the test nor its subject; the machine was over-subscribed while the
    suite ran; the test passes on re-run in isolation. All three held on MA4's second refusal — the
    branch was innocent and the gate was reading load. File the missing cushion as a finding rather
    than carrying the suspicion into the next branch (the ticket queue is phase 5, so in this phase
    it goes to the user).
- **Drain the row's `postLanding` — the writes the BRANCH could not make.** Keep it, and name the
  mechanism generically: the `ledgers` config lists tracked files the main branch owns and phase 3's
  gate commits at the head of every landing, so a branch that must change one writes the COMMAND
  down instead of running it. Carry them on the row as `postLanding: [{cmd, ranAt, error}]`, lifted
  from the worker's report, and run them in the MAIN checkout on the tick that sees the landing.
  Keep the 2026-08-26 cost: MA4 landed and its two closures and its one new ticket were still
  unwritten when the run was reviewed and called green. Keep **attempt-and-record, never a blocking
  obligation**, and keep the mechanical reason — the ticket ledger takes a queue lock, waits 30 s and
  then throws, and the gate takes the same lock to commit those very ledgers, so a tick forbidden to
  end with one outstanding would deadlock against the landing that produced it.
- **A landing whose Acceptance was a MEASUREMENT owes one page under `docs.results`.** Keep the
  measurement: of the fifteen council lines landed 2026-08-24/26 in planetCraft, fourteen wrote a
  spec, a plan and an evidence directory, and exactly one wrote a results page — and nothing looks
  in an evidence directory. Keep "the page may be five lines: the acceptance question, the number it
  came back with, and a pointer to the evidence" and **discoverability is the whole deliverable, not
  the prose**. Say what makes it discoverable here: `docs.results` is the directory `orchestra
  doctor` prints, and reading it is the first thing anyone does before opening new work.

- [ ] **Step 4: Run the acceptance and the suite**

Run: `node --test test/p2b-acceptance.test.mjs; npm test`
Expected: no new §6 item, no regression. `invocations` must still PASS — if it names `orchestra
land` or `orchestra await`, they were written outside a backtick that the roll-call also carries;
check Task 1's roll-call spells each of them exactly as this section does.

- [ ] **Step 5: Commit**

Stage `skills/orchestra/SKILL.md`, message:
`docs(orchestra): the tick, steps 4-6 - the inbox, the checkpoint, and a landing that is phase 3's`

---

### Task 8: the tick, steps 7 to 9, and the worker session names

**Files:**
- Modify: `skills/orchestra/SKILL.md` (append steps 7, 8 and 9 under `## The tick`, closing the
  section)
- Source: lines 537–615, plus spec §8.4

**Interfaces:**
- Consumes: Tasks 5–7's steps 0–6; `orchestra doctor`'s `id`, `worktrees` and `mainBranch` rows.
- Produces: the naming rule Task 12's briefs are launched with; the closed `## The tick` section.

**Why now.** §8.4 is the one §8 rule the phase table left unassigned, and P2a routed it here because
nothing before this phase engendered a session. Step 8 is where a session is engendered, so this is
the step it belongs to.

- [ ] **Step 1: Write step 7 — the shared channel**

Port source 537–555. The commands become:

```sh
orchestra roadmap enrol   # rows the register lacks; silent when there are none
```

`enrol` is first and costs nothing when there is nothing to do. Keep its whole reason: it exists for
the tasks `publish` cannot enrol — another developer's roadmap never passes through this machine's
publish at all — and a task with no register row is one nothing here will ever schedule or even
count. Keep that it refuses a stale board rather than degrading to it, and that it never touches a
row that already exists (append-only, returned by identity).

`sync` is **phase 3, and online only**: it closes what the register proves landed, moves the
`status:` labels onto what the board derives, ticks each programme's checklist and closes a finished
programme — which is what makes a finished roadmap leave the page. Offline there is nowhere to write
a status, so it does nothing and that is correct (spec §4.1). Say that when it arrives it is the
BACKSTOP, not the primary writer: the merge gate runs the same command after every fast-forward.

Keep the stale-board rule as a rule of this step: **if `orchestra roadmap board` reports itself
stale, launch nothing this tick and end here** — a cached board cannot say whether another developer
has taken a task, and starting anyway overwrites their claim. Say so in the journal. Add the honest
half: offline, a board is never served from cache, so this rule is online's.

- [ ] **Step 2: Write step 8 — launch, and the names**

Port source 556–592. The launch block becomes:

```sh
orchestra roadmap claim <key>
git worktree add <worktrees>/<slug> -b <branch> <the project's main branch>
claude --bg -n orchestra-<project id>-<task slug> --model <model> --dangerously-skip-permissions "<brief>"
```

- **Claim first, always**, for your own roadmaps too: online the claim is what turns the issue
  `status:wip` for everyone else watching; offline it is the register row and the branch ref. If it
  reports a loss, drop the row from this batch and record who holds it — phase 5's `guard-claim`
  hook is the backstop, not the mechanism.
- `<worktrees>` is the `worktrees` config (default `.orchestra/worktrees`). **Do not run a
  dependency install here.** The source project's launch did; a portable protocol cannot know
  whether a fresh worktree needs one, so if the project needs a per-worktree bootstrap the worker's
  brief says so — that is one of the things `briefExtra` is for.
- **The session name is `orchestra-<project id>-<task slug>`, and it is not optional** (spec §8.4).
  Write all four parts:
  - `<project id>` is the `id` row of `orchestra doctor` — six hex of the main checkout's absolute
    path, so two checkouts of one repository and two projects sharing a directory name do not
    collide.
  - `<task slug>` is the register row's id, lowercased, with every run of non-alphanumeric
    characters replaced by a single `-`. Worked example: project `a3f19c`, row `lod/C2` →
    `orchestra-a3f19c-lod-c2`.
  - **without a name, the session is named from the whole prompt**, which exceeds SendMessage's
    200-character address limit and makes the worker unaddressable by name — measured, the first
    batch had to be relaunched for it. The name above stays far inside that limit.
  - **why the project id is in it**: `orchestra-<task id>` alone collides the moment two projects
    have a task called `S3`, and the symptom is bad, because `SendMessage` addresses by name and
    `claude agents --json` is matched by name and cwd.
  - and the two rules §8.4 says are now load-bearing for isolation as well: **a worker is matched by
    cwd equal to its worktree path**, and the worktrees directory is per project.
- `--bg` with skipped permissions requires the user to have accepted the disclaimer once,
  interactively. If launches fail with a disclaimer error, that one-time step is the fix and it is
  the user's to run.
- Then find the new session in `claude agents --json` (match cwd = the worktree path), record the
  **full session UUID** — the resume cycle needs it, a short id is not enough — plus `sessionName`,
  `model` and status `claimed` in `state.json`, and SendMessage it a hello: "I am your conductor —
  reply to this address with questions and reports." The hello drains at the worker's next turn, not
  instantly. **Say in the same hello that replying does not work** and that its report must be its
  FINAL MESSAGE: telling a worker to reply to an address that cannot resolve is telling it to wait
  for ever.
- **`cd` PERSISTS BETWEEN Bash CALLS.** Keep the measurement (a `state.json` write straight after a
  launch went to the worktree and failed with `ENOENT` on 2026-08-12, and the same shape has
  silently written files into the wrong tree) and the instruction: after any launch, `cd` back to the
  main checkout or use absolute paths. Add the one thing that is different here: the subcommands
  resolve runtime state to the main checkout themselves, so this hazard is now confined to the files
  you write by hand — `state.json` above all.
- Keep the two launch-plan rules the tool does not make: never launch two rows of the same serial
  `Lane` together, and **files are not a reason to wait** — two rows editing the same file run side
  by side and the conflict is resolved at the merge; that changed on 2026-09-01 because the declared
  `Touches` never predicted what a task actually edited and the collisions happened anyway.
  `Touches` is documentation for the reader and for the landing now; it schedules nothing, and
  `orchestra ready` no longer reads it.
- Keep **take your own roadmaps first**: the launch plan fills every slot from rows whose `mine` is
  not false before it takes a row from a roadmap another developer opened to everyone — they offered
  spare capacity, not priority.
- Add one line from Task 4: the plan is already capped by the machine's budget, so a `HELD:` line
  means launch nothing and say so.

**Record the alternative that was not taken, in the plan and not in the skill:** a `worker-name`
subcommand would remove the hand-slugging, and it was refused — spec §2's subcommand list does not
contain one, nothing else would call it, and the two inputs (`id` from `doctor`, the row id from the
register) are both already in front of the conductor. What guards a wrong name instead is that the
`launch` journal line names it, so a name that does not match the session in `claude agents --json`
is visible on the next tick.

- [ ] **Step 3: Write step 9 — write, release, stop**

Port source 593–615. The command becomes:

```sh
orchestra lock release --kind conductor --session <your full session uuid>
```

Keep: release it even though your session lives on, because the lock covers the TICK and your beat
covers the gaps between ticks — a headless tick stands down for a live beat on its own, so holding
the lock across your idle time would block the heartbeat for nothing. Keep that the release is
identity-checked, so if you were already broken for being stale it leaves your successor's lock
alone.

Keep **write the register even on a tick that changed nothing**: its write time is the only mark that
separates a conductor which is conducting from a session which is merely open, and a tick that skips
the write reads as ninety minutes of silence at the next heartbeat slot.

Keep "stopping is no longer going deaf", with the four things that wake you, each named with its
phase where it has one: the answer watch hands you each new answer within seconds (and until phase 4
there are no answers to hand, so the beat is what it is really doing); worker turns you resumed
notify you as their Bash tasks complete; the landing re-invokes you when phase 3 brings it; and
phase 5's heartbeat guarantees a tick every hour whatever happens to you, standing down while you
are alive so it cannot become a second conductor beside you. Keep the optional second Monitor
polling `claude agents --json` for `orchestra-*` sessions leaving `busy` (2-minute interval,
transitions only) as the fast path for nudging workers between ticks, and keep **it is a SECOND
watch, on a different subject: do not fold it into the answer watch, whose loop must stay a
two-second file read with no child process in it.**

- [ ] **Step 4: Run the acceptance and the suite**

Run: `node --test test/p2b-acceptance.test.mjs; npm test`
Expected: no regression; nine of fourteen items green (10–12 and 14 are still owed).

- [ ] **Step 5: Commit**

Stage `skills/orchestra/SKILL.md`, message:
`docs(orchestra): the tick, steps 7-9 - the claim, the launch and its name, the release`

---

### Task 9: adoption, and the preflight

**Files:**
- Modify: `skills/orchestra/SKILL.md` (append `## Adoption (first run, or state lost)` and
  `## Preflight (once per machine, before the first launch)`)
- Source: lines 616–670

**Interfaces:**
- Consumes: `orchestra roadmap board --json`'s row shape.
- Produces: two outline headings. **This task carries the one sentence of the source that is false
  here** — the register's `roadmap` field (spec §4.4).

**Why now.** Adoption is what runs when there is no register at all, and the divergence it carries is
the kind that is invisible until a dependency silently looks unmet. Preflight comes with it because
it is the other thing that happens exactly once.

- [ ] **Step 1: Write adoption**

Port source 616–647. Substitutions and one inversion:

- `orchestra roadmap publish` writes a register row for every task it publishes, and `orchestra
  roadmap enrol` is the catch-up for what publish cannot reach: a roadmap published from another
  developer's machine, and anything published before that existed. `board` names that command on the
  orphan line itself. Keep **a roadmap published after adoption enrols itself — do NOT hand-copy its
  rows**, and keep the cost: treating adoption as the way a new roadmap gets in left 22 tasks out on
  2026-08-19, 15 on 08-25 and 28 on 09-02, each caught by a human reading the board.
- Read-only. Build the task table from `orchestra roadmap board --json`, which returns one row per
  task with `key`, `order`, `deps`, `touches`, `lane`, `branch`, `design`, derived `status` and
  `issue` (not `ref` — `ref` is the Store interface's own field name, which `board.mjs` renames to
  `issue` on the row it emits; `visibility` is dropped, it appears nowhere in `lib/`). Keep **the
  board emits both `key` and already-resolved `deps`**, with the
  reason: a task's own `Deps` may name a bare sibling id or a `<roadmap>/<ID>` cross-file one, and
  the board resolves either into a qualified key before it ever leaves the board. So **a register
  row's `id` IS the board row's `key`, and a register row's `deps` IS the board row's `deps`,
  byte-for-byte.**
- **THE INVERSION.** The source continues "that direct copy stops at `roadmap`: on the board row it
  is the task's roadmap SLUG; on a register row it is a FILE PATH — copying the slug into the path
  field is wrong, not a shortcut." **That is false in this plugin.** Write it the other way, with
  the reason (spec §4.4): a register row's `roadmap` is the **slug** in both modes and never a path,
  because the path form forced exactly that rule and then left the field pointing at a draft
  `publish` had deleted. The slug is what both stores already key on. One clause is enough; do not
  turn it into a paragraph.
- Keep `orchestra ready`'s refusal: it matches `deps` against `id` byte-for-byte and **throws,
  naming the offender**, rather than schedule anything if a row's `id` or any of its `deps` is not
  already qualified. Keep the measurement: qualifying `id` without qualifying `deps` to match made
  every dependency look unmet, even a landed one, with no error anywhere.
- Keep: inventory in-flight branches, worktrees and live sessions WITHOUT writing to any of them;
  then present the table, who holds what, and the launch plan, and **launch nothing until the user
  approves it**; record the approval in `state.json` (`adopted: true`); ticks are autonomous from
  then on.

- [ ] **Step 2: Write the preflight**

Port source 648–670 essentially unchanged — it is harness, not project:

```sh
claude --bg -n orchestra-preflight --model haiku --dangerously-skip-permissions "reply OK and stop"
claude agents --json | grep orchestra-preflight
claude stop orchestra-preflight
```

Keep: if any of them is refused, put **one** question to the user carrying the exact command and the
exact refusal, and stop the tick. Do not discover this one launch at a time, and **do not try to
grant it to yourself** — editing a settings file to widen your own permissions is a hard boundary and
will be refused too. Keep the measurement: three consecutive ticks were spent finding this out one
refusal at a time on 2026-08-12 (the launch flag refused, then the settings edit refused, then the
allow-rule the user added turning out not to cover the flag), and the user ended up typing four
launch commands into a terminal himself — two hours forty-four minutes before a single worker
existed. Keep **retry a failed launch once, identically, before calling it a failure**, with
`claude: command not found` appearing twice from a shell whose `PATH` was correct and an identical
retry succeeding seconds later.

- [ ] **Step 3: Run the acceptance and the suite**

Run: `node --test test/p2b-acceptance.test.mjs; npm test`
Expected: two more outline headings present; no §6 item changes.

- [ ] **Step 4: Commit**

Stage `skills/orchestra/SKILL.md`, message:
`docs(orchestra): adoption and the preflight - and the register's roadmap is a slug here`

---

### Task 10: the decision template, and the picture rule

**Files:**
- Modify: `skills/orchestra/SKILL.md` (append `## The decision template` and
  `### A question about a picture must carry the picture`)
- Source: lines 671–715

**Interfaces:**
- Consumes: Task 3's framing pass (the three checks), Task 2's `options` copy rule.
- Produces: §6 item 10 green.

**Why now.** It is the shape every question the user ever sees takes, and Task 2's `options`
instruction says "the SAME options the decision template has just made you formulate" — so the
template has to exist for that sentence to mean anything.

- [ ] **Step 1: Write the three checks and the template**

Port source 671–697. Keep the three checks before ANY mid-development question: was it already
answered at framing (`decisions[]` on the row)? Can you answer it yourself from a recorded decision,
the project's own rules, or a precedent already set on another row? Has this row already spent its
one interruption? If any lands, **rule and journal it instead of asking** (`kind: ruling`). Keep
both expensive examples of 2026-08-12/14: releasing a file hold owned by a branch abandoned two weeks
earlier, which no rule ever created, waited 8 h 07; and taking over four worktrees whose sessions
were provably dead waited two hours forty-four before the answer came back "yes, all four" in six
minutes.

Keep the template verbatim in shape, in the user's language, body written for someone who has never
read the code — no path, no function name, no identifier, no millisecond in the body; what the user
sees, what it changes, what each option costs; technical detail in a `<sub>` footer:

> **[<ID> — <title> · `<branch>` · session `<name>` · server :<port>]**
> **Where it stands**: <one sentence, plain language>
> **Its question**: "<the worker's question, plain language>"
> **What you need to decide**: <the context that makes the choice real: rules that apply,
> precedents, what waits behind it>
> **Options**: A) … · B) … · C) …
> <sub>Technical: <the numbers and names, for when the user wants them>
> Pictures: <repo-relative path(s) to any screenshot the question is about></sub>

Keep "relay the user's answer back to the worker verbatim, plus whatever context the worker needs".
Substitute "this repository's rules" → the project's own rules (`briefExtra` is how a worker gets
them).

- [ ] **Step 2: Write the picture rule**

Port source 698–715. Keep: you have no way to show the user an image and they have no way to open one
you only describe, so a question like "which of these two arms reads better?" is unanswerable unless
the file itself is on screen. **Name every screenshot the question is about by its repo-relative
path, in the `<sub>` footer.** Substitute the two example paths for `.orchestra/images/`-shaped ones.
Keep that the reader resolves those paths against the checkout, the worker's worktree and
`.orchestra/images/`, and draws each one as a **thumbnail** beside the question, one click from full
size — and that nothing else is required: there is no field to fill and no upload. Name the phase:
the page that draws it is phase 4, and `.orchestra/images/` is also the one directory `orchestra
archive-images` sweeps.

Keep the footer's justification (a path in the body would break the plain-language rule; a path in
the footer breaks nothing), and keep the last paragraph: the same reading applies to a `note` and to
a journal line, so a capture worth keeping is worth naming in either — a worker reporting a
measurement from a frame writes the frame's path where it says what it measured, and a note saying
"it looks wrong now" with no path is a claim the user cannot check.

- [ ] **Step 3: Run the acceptance and the suite**

Run: `node --test test/p2b-acceptance.test.mjs; npm test`
Expected: §6 item 10 green, both anchors (`Where it stands`, `thumbnail`).

- [ ] **Step 4: Commit**

Stage `skills/orchestra/SKILL.md`, message:
`docs(orchestra): the decision template, and a question about a picture carries the picture`

---

### Task 11: the playtest gate, and the dev-server sweep

**Files:**
- Modify: `skills/orchestra/SKILL.md` (append `## The playtest gate` and `### The dev-server sweep`)
- Source: lines 716–786

**Interfaces:**
- Consumes: Task 3's two-way interruption rule, Task 7's step 6.
- Produces: §6 items 11 and 12 green.

**Why now.** The gate is the one interruption a row is allowed, so it is the payoff of Task 3; and
the sweep is given its own heading here — the source carries it inside the gate section, and item 12
is checkable only if it has one.

- [ ] **Step 1: Write the gate**

Port source 716–732. Keep the first question — what does the row actually ship? If it ships no page
a human reads and no gameplay change, **there is no gate**: it lands on green gates, the `landing`
goes in the journal, and the digest carries it. Keep the measurement: seven of the sixteen rows of
the dev-loop roadmap were in that class and every one of their approvals was granted unread.

Otherwise: tell the worker to start its dev server — **the project's own dev command; the worker
knows it and you do not need to** — and to report the port it actually bound plus its pid; set the
row to `review`; queue a checkpoint item with the port. Keep **the user's validation of the page IS
the approval** — do not then ask a second time for the merge; that second question is the one this
roadmap paid for thirteen times over. Keep "record the branch's commit `subjects` in the row BEFORE
handing it off — that is what makes landed detection work", and say that the hand-off itself is
phase 3's, and that a landing deletes the worktree and the ref.

- [ ] **Step 2: Write the URL rule**

Port source 738–755. Keep the heading sentence exactly: **Never hand out a URL you have not fetched
AND READ.** Keep that `curl` cannot reach a localhost server this shell can see listening, and keep
the snippet as it is — node is the one thing this plugin can assume:

```sh
node -e 'fetch(process.argv[1],{signal:AbortSignal.timeout(4000)}).then(r=>r.text())
  .then(t=>console.log(t.replace(/\s+/g," ").slice(0,200))).catch(e=>console.log("FAILED",e.message))' <url>
```

Keep **the status code is worthless here**, with the measurement attributed: in planetCraft the dev
server answers 200 with the application's own entry page for any path at all, so a wrong path looks
healthy from every angle except the one that matters — measured 2026-08-13, an ask sent the user to
the wrong path, nothing flagged it, and he lost a whole test run to it. Generalise the rule in one
clause: any dev server with a catch-all route does this, so **reading the first 200 characters is
the entire check.**

Keep the paragraph about a deleted worktree: kill its dev server and any page explicitly, because a
server whose directory has been removed keeps serving — which reads as a live page showing stale code
and is indistinguishable from a working one until someone trusts it. Servers are killed **by pid**,
never by pattern.

- [ ] **Step 3: Write the sweep, under its own heading**

Port source 756–777 under `### The dev-server sweep`. Keep **once per tick**, and the reason:
killing your own on deletion is not enough, because the server that hurts is the one nobody remembers
launching. Keep the measurement, attributed and generalised: a dev server in the MAIN checkout takes
the ticket ledger's queue lock and writes its tickets into the main branch's ledger, which is what
refused a landing on 2026-08-25 in planetCraft; one orphan was found and killed that afternoon, its
worktree deleted that morning, and another was still listening forty hours later when the run was
reviewed.

Port the block, with the one substitution its `case` needs — the page to skip is this plugin's own
(phase 4), not one project's script:

```sh
lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk '$1=="node"{print $2"\t"$9}' | sort -u |
while IFS=$'\t' read -r pid addr; do
  cmd=$(ps -o command= -p "$pid"); case "$cmd" in *orchestra*monitor*) continue;; esac
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | grep '^n' | head -1 | cut -c2-)
  if   [ -z "$cwd" ];       then v="NO CWD -> ask"
  elif [ ! -d "$cwd" ];     then v="ORPHAN -> kill"
  elif [ "$cwd" = "$PWD" ]; then v="MAIN CHECKOUT -> ask, never kill"
  else v="OTHER TREE -> leave"; fi
  echo "pid=$pid port=${addr##*:} age=$(ps -o etime= -p $pid|tr -d ' ')  $v"
done
```

Keep all three details and the fact that each was a wrong answer a first draft gave: **skip your own
page** — it runs from the main checkout and had been up eight days, so without that `case` the sweep
reports the conductor's own instrument as a suspect every hour; `$NF` is `(LISTEN)`, the address is
`$9`; and `lsof -Fn` answers `p<pid>`/`f<fd>`/`n<path>`, so take the first `n` line, not the second
line. Keep **ORPHAN is the only verdict that kills**, and that a server in the main checkout may be
the USER's, so it becomes a question — a note nobody reads is how one survived forty hours.

- [ ] **Step 4: Write the two rules the subset gate cannot enforce**

Port source 779–786, with `branchTests` in place of one project's script:

- a branch that is a **new consumer** of a module another in-flight row has just rewritten needs the
  full suite. Keep the failure: a dead-code sweep on the main branch removed an export that a branch
  in flight had just started importing; different lines, so git merged both sides happily and
  produced a runtime `TypeError`. Neither the diff nor the dead-code gate could see it — the gate was
  right on main and the branch was right on itself.
- **land an unused-export sweep LAST**, after everything in flight against the same modules.
- a branch-test command that selects by import graph can select exactly ONE file for a tool nothing
  imports but its own test. When the subset looks suspiciously small, **say the number out loud** and
  run the full suite instead of trusting it.

- [ ] **Step 5: Run the acceptance and the suite**

Run: `node --test test/p2b-acceptance.test.mjs; npm test`
Expected: §6 items 11 and 12 green. Thirteen of fourteen; only item 14 remains.

- [ ] **Step 6: Commit**

Stage `skills/orchestra/SKILL.md`, message:
`docs(orchestra): the playtest gate, the unfetched URL, and the sweep for servers nobody remembers`

---

### Task 12: the design handoff, the worker briefs, and retiring a long worker

**Files:**
- Modify: `skills/orchestra/SKILL.md` (append `## Design→execution handoff (design tasks)`,
  `## Worker briefs`, `## Retiring a long worker (EXPERIMENT — one row at a time)`)
- Source: lines 787–878

**Interfaces:**
- Consumes: Task 8's launch block and session-name rule; `orchestra doctor`'s `language`,
  `branchTests`, `docs.specs`, `docs.plans` and `briefExtra` rows.
- Produces: the four brief templates, and all nine placeholders used — which is the second half of
  §6's contract.

**Why now.** The three sections are one subject: a design task launches on one model and hands over
to another, a long worker hands over to a fresh session, and all three hand-overs are performed by
choosing one of the four briefs.

- [ ] **Step 1: Write the design handoff**

Port source 787–796. A `design: true` task launches on the design model with a brief whose
deliverable is the committed spec and plan on its branch; it must not write implementation code, and
its session ends there. When it reports done: **adopt the plan's own recommended approach — do NOT
ask the user**, the one bounded exception to never #2; if the design ends in a genuine fork with no
recommendation, that is a blocking question. Then launch a fresh execution-model session on the SAME
worktree with the brief "read the committed spec and plan, execute the plan", and update `model` in
the row. Do not kill anything: a completed background session costs nothing.

State where the two models come from: `orchestra ready` puts the model in its launch line —
`launch: <id> — <title> [fable] on <branch>` for a `design` row, `[opus]` otherwise — so the choice
is the plan's and not the conductor's.

- [ ] **Step 2: Write the substitution table for the briefs**

Above the templates, one table of the nine and where each comes from. It is the reason the briefs are
templates at all, and a conductor reads it once:

| Placeholder | Filled from |
|---|---|
| `{branch}` | the row's `branch` |
| `{task}` | the row's qualified key, `<roadmap>/<ID>` |
| `{title}` | the row's title |
| `{excerpt}` | the task's own section, verbatim: offline from the file under `roadmaps.published`, online from the issue body |
| `{language}` | `orchestra doctor`'s `language` row |
| `{branchTests}` | `orchestra doctor`'s `branchTests` row. **When it prints `—`, the project has configured none**: drop the clause and tell the worker to run the project's own tests for what it changed and to say which |
| `{specsDir}` | `orchestra doctor`'s `docs.specs` row |
| `{plansDir}` | `orchestra doctor`'s `docs.plans` row |
| `{briefExtra}` | `orchestra doctor`'s `briefExtra` row, pasted verbatim. Empty means the paragraph is omitted entirely |

Say what `briefExtra` is for, because it is the replacement for the source brief's appeals to one
project's own map: it is where a project states the rules a prompt cannot derive — where its code
lives, what its worker must never touch, whether a fresh worktree needs a bootstrap step.

- [ ] **Step 3: Write the four briefs**

Port source 797–851. Execution brief (the execution model):

```
You are a dev agent working ONLY in this worktree, on branch {branch}.
Task {task} — {title}. Your roadmap excerpt, verbatim:
{excerpt}
Hard rules: never work on the main branch; run {branchTests} on every iteration, never the project's
full suite; everything you commit is English.
{briefExtra}
Your roadmap excerpt above names its `Touches` files: START FROM THEM. Reach for a repository-wide
search only when the excerpt and the rules above have both failed you. This is not a style note:
every file you open stays in front of every later request of this session, so a sweep at turn 10 is
still being paid for at turn 200.
Write to me in {language} — questions, reports, anything of yours that reaches me. That is not in
tension with the rule above: what you commit is English, what you say to me reaches one person on
one machine.
Protocol: your conductor will message you a hello. SENDING A MESSAGE BACK DOES NOT WORK — a worker
session cannot resolve the conductor's address, measured three times, and a report sent that way
reaches nobody. Instead: STATE YOUR REPORT OR QUESTION AS YOUR FINAL MESSAGE AND STOP. The conductor
watches for your session leaving the working state and resumes you, and what you printed comes back
on that resume. Design question → state it and stop until answered. Built → say so; start a dev
server only when told, and report the port it ACTUALLY bound plus its pid (servers are killed by pid
here, never by pattern). You never merge, and whether your branch needs a human look first is your
conductor's call, not yours.
```

Design brief (the design model): the same header and rules, then:

```
This task's design is open. Use superpowers:brainstorming, then superpowers:writing-plans. Your
deliverable is the committed spec ({specsDir}) and plan ({plansDir}) on this branch, with a
recommended approach stated. Do not write implementation code. State your done-report as your final
message (see the protocol above — messaging the conductor does not work); your session ends there.
```

Relaunch brief (dead session, intact worktree): the original brief, prefixed with:

```
A previous session worked this task and died. Its worktree is intact. Before anything else: read
git log <the project's main branch>..{branch} and git status in this worktree, and continue from
what exists — do not restart the task from scratch.
```

Handover brief (the previous session was ALIVE and retired on purpose): the original brief, prefixed
with:

```
A previous session took this task to <n> turns and was retired to drop its accumulated context. It
committed its work and wrote where it had got to. Before anything else: read
git log <the project's main branch>..{branch}, git status in this worktree, and the `note` on your
row. Continue from there — do not restart, and do not re-read files the note tells you are already
done.
```

- [ ] **Step 4: Write the retirement rule**

Port source 852–878, minus the scanner this plugin does not ship. Keep the mechanism and every
number, attributed: a worker's context grows monotonically, ~2 K a turn from its own tool results,
and every request re-reads the whole prefix; measured on one run in planetCraft, sessions started at
57 K and reached 400–740 K, and one worker's request cost ten times more at its last turn than at
its first. Cutting a long session in two saves 20–30 % of its read tokens.

Keep **what that buys is quota, not speed** — a turn's duration tracks what it OUTPUTS, not the
context behind it (measured flat over 1 831 turns), but the five-hour ceiling is a token budget, and
on that run four workers and the conductor hit it within forty minutes of each other and the whole
fleet stopped for 1 h 36.

Keep **measure before you act, and act on ONE row**, with the sensitivity that makes it an
experiment: the saving depends on how much a handover has to re-read — 31 % at a 50 K
re-acquisition, 13 % at 150 K, and below roughly 110 turns splitting costs more than it saves. Say
plainly that **this plugin ships no tool that measures a session's token use**, so the turn count is
the only signal a conductor has here; the source project has one and this one does not.

Keep the procedure: past ~120 turns on a row you are willing to experiment on, ask the worker to
commit, write where it got to into its row's `note`, and stop it. Then launch a **NEW** session on
the same worktree with the handover brief — **never `--resume`**, which keeps precisely the context
this is trying to drop. Journal it as a `note` with the turn count. Keep both limits: do not do this
to more than one row until that number exists, and never to a row in the middle of a playtest gate.

- [ ] **Step 5: Run the acceptance and the suite**

Run: `node --test test/p2b-acceptance.test.mjs; npm test`
Expected: the `placeholders` test PASSES for the first time — all nine used, and nothing else
matching `{word}`. If it fails naming an extra, a config key was written as a placeholder instead of
a backticked key name.

- [ ] **Step 6: Commit**

Stage `skills/orchestra/SKILL.md`, message:
`docs(orchestra): the briefs, templated over nine substitutions, and the two hand-overs`

---

### Task 13: the stand-down tick, and the answer net

**Files:**
- Modify: `skills/orchestra/SKILL.md` (append `## The stand-down tick` and
  `### The answer net, and what has no net under it yet`)
- Source: lines 879–1007 and 1015–1031 (**not** 941–978, the retex block, and **not** 1008–1014,
  the `CLAUDE_CONFIG_DIR` correction — see this plan's Scope)

**Interfaces:**
- Consumes: Task 2's journal, Task 5's beat, Task 7's checkpoint.
- Produces: §6 item 14 green — the last of the fourteen.

**Why now.** It is the last section, and it is the one whose commands exist **today** while the thing
that runs them does not: `orchestra tick-gate`, `orchestra archive` and `orchestra archive-images`
are all shipped, and the heartbeat that would call the first of them is phase 5. The section is
therefore written as the conductor's own end-of-run duty rather than as a description of a timer.

- [ ] **Step 1: Read the gate**

Read `lib/register/tick.mjs` and `lib/cli/archive.mjs`. What the section must state, exactly:

- `orchestra tick-gate` prints **one line** whose first word is the verb, and the exit code is
  deliberately NOT the channel — a gate that cannot answer must not be able to stop the heartbeat.
  The real lines:
  ```
  skip a conductor is live (<session>, pid N)
  skip no register — orchestra has not been adopted here
  skip budget resets <ts>
  skip nothing to do — 87 row(s), all landed or dropped
  run hold-awake
  run — took the baton back from <session> (pid N), beating but silent for 97 min
  ```
- The order of its rules, and why the conductor rule is first: the cost of a second conductor is
  corruption (two writers on one register), while the cost of a late tick is only lateness. It
  stands down for a conductor that is live **and conducting**, never merely live.
- The four things that override the stand-down, each a way orchestra could otherwise go permanently
  deaf: an unconsumed answer in the inbox (phase 4's page spawns a tick from its own reply button, so
  a gate that ignored this would swallow, in silence, the answer the user had just typed — this is
  the one that matters most); a `pending[]` item on any row, whatever that row's status; an
  undelivered relay; and any row not yet terminal.
- `absent` and `unreadable` are told apart **by errno**: the register is rewritten in place, so a
  failed read is most likely a mid-write and the tick runs; an absent register is a machine where
  nobody ever typed `/orchestra`, and firing a session at it hourly buys nothing.
- `orchestra archive` **refuses while a conductor is live** and stands down by itself when nothing
  is terminal. `orchestra archive-images` carries **no** conductor refusal, deliberately, because it
  rewrites no register — its guard is a **seven-day freshness floor**, which is 140× the worst
  measured gap between a photograph being written and the first line naming it.

- [ ] **Step 2: Write the stand-down and its two costs**

Port source 900–928 as the section's opening, without the installer:

- **it holds the machine awake while work is in flight** — the `hold-awake` word in the gate's line
  is what a heartbeat acts on. Keep the measurement: eight slots of 1 h 23 to 3 h 26 were lost to
  sleep in one 46-hour roadmap, about six hours, one of them killing a worker mid-turn. Say the
  shell that acts on the word is phase 5's.
- **it stands down when there is nothing to do**, and every decision is logged, so a heartbeat that
  went quiet always says why. List the four stand-down reasons and the four overrides from Step 1.
- **why an unused heartbeat costs nothing**: once a roadmap finishes, an hourly session that reads
  sixteen landed rows and exits is real budget for no work — and the account ceiling was hit twice
  during the roadmap this came from, freezing everything for 2 h 48. **Waking it back up costs one
  `/orchestra`**: adoption writes `todo` rows and the very next slot returns `run`.

- [ ] **Step 3: Write the ticket sweep**

Port source 929–940. Keep the heading sentence: **A GREEN REGISTER IS NOT A FINISHED RUN, and the
stand-down tick is where you say so.** Keep the measurement in full: the council of 2026-08-24/26
landed fifteen lines and opened seventeen tickets doing it, three of them S1 — one of which was the
runtime wall at the far end of the very advice another line had just landed to fix — and all
seventeen were filed correctly and none was routed anywhere.

So on the tick that stands orchestra down, before the stand-down: list what the run opened, name the
S1s and S2s in the journal and in the checkpoint, and put ONE question on the page — work them down,
or leave them for the queue. Keep **do not open the lines yourself**: a finished roadmap is the
user's moment to choose the next one.

The phase note: the ticket queue is phase 5 (`orchestra tickets`). Until it exists there is no ledger
to list, so the sweep is over what the run's own journal `note` lines record — and say that plainly
rather than naming a command that is not there.

- [ ] **Step 4: Write the archiving**

Port source 979–1007, both halves.

The prose half:

```sh
orchestra archive --write
```

It moves every terminal row's `note`, `subjects`, `decisions` and `touches` — and the register's
top-level prose with them — into `.orchestra/archive.jsonl`. Describe the code, which is more precise
than the source: a finished row **leaves the register entirely** unless a surviving row still
depends on it, in which case it stays **stripped of exactly those four fields**, so dependency
resolution and the progress bar keep working. It is a MOVE: nothing is deleted. Keep the measurement:
at the end of one roadmap, `state.json` was 202 KB and 87 of its 87 rows were terminal — not one live
row — with 136 KB of that in post-mortem notes describing work landed weeks earlier, and every hourly
tick re-read all of it. Keep **this is not tidiness, it is the register you rehydrate from**, keep
the conductor refusal and the no-op-when-nothing-is-terminal behaviour, and keep why it is placed
here rather than earlier: a row's note is worth having in the register while its roadmap is still
running.

The photographs:

```sh
orchestra archive-images --write
```

Keep **prose is not the weight — pictures are**, with the measurement attributed: measured
2026-09-02 in planetCraft, the register's directory held 70.2 MB and 68 MB of it was 115 screenshots
and boards, every one belonging to a run that had landed weeks earlier. Keep the sweep's one
question — can any live surface still draw it? — and the three surfaces that can: an open `pending`
ask on any row whatever its status, the `note` of a row that is not terminal, and a journal or inbox
line about work that is still running. The rest are filed as `photo` lines in the same archive,
each carrying its size and the finished row or line that named it, before the file is removed.

Two things to state that the source does not:

- **the sweep's world is `.orchestra/images/`, never `.orchestra/`** — here that directory also holds
  `config.json` and defaults to holding `worktrees/`, so a sweep of it would walk into a live
  worktree, decide no register line names the project's own pictures, and delete them.
- it carries no conductor refusal and needs none: it rewrites no register, and its hazard — a picture
  a worker has just taken and nobody has cited yet — is answered by the seven-day floor.

- [ ] **Step 5: Write the answer net**

Port source 1015–1031 as `### The answer net, and what has no net under it yet`, honestly:

- An answer normally reaches a conductor without any of this: the watch armed in step 1 hands it over
  in seconds, and phase 4's page starts nothing while that beat is live.
- What the watch cannot cover, and this is the code's own account: an answer **already sitting when
  the watch was armed** — its first round announces nothing and only remembers — and an answer left
  behind by **a tick that died before relaying it**, because the watch dies with the session too.
- **There is no level-triggered net under it in this plugin.** The source project has a shell script
  for exactly this, and it is not ported: what it proposes is a cron entry, and a cron tick cannot
  read the login keychain, so the net would catch nothing while reading as protection. A second
  launchd agent or systemd timer is the shape that would work, and deciding to install one is the
  user's, not a tick's — phase 5 is where it is wired and where it is paid for. Say so and stop.

- [ ] **Step 6: Run the acceptance and the suite**

Run: `node --test test/p2b-acceptance.test.mjs; npm test`
Expected: **all six tests PASS** — fourteen of fourteen §6 items green, the outline complete and in
order, the nine placeholders used, every invocation real, no source path surviving, the frontmatter
in place. Paste the run.

- [ ] **Step 7: Commit**

Stage `skills/orchestra/SKILL.md`, message:
`docs(orchestra): the stand-down tick - the ticket sweep, the archiving, and the net that is not here`

---

### Task 14: the whole-document pass, and the README

**Files:**
- Modify: `skills/orchestra/SKILL.md` (corrections only)
- Modify: `README.md` ("What works today")
- Test: `test/p2b-acceptance.test.mjs` (only if it names a real gap)

**Interfaces:**
- Consumes: everything.
- Produces: the phase's deliverable, and the one line a user can type.

**Why now.** Thirteen implementers wrote thirteen sections and none of them read the other twelve.
P1's whole-branch review found a spec violation twelve per-task reviews had passed; this task is the
document's equivalent, and it is deliberately a single pass rather than one correction per section.

- [ ] **Step 1: Read the document end to end, once, in order**

Not by grep. The four questions to answer while reading, each of which is a defect class the
acceptance test cannot see:

1. **Does any sentence promise something that is not here?** A command, a page, a hook, a gate, a
   ticket. Every one must name its phase.
2. **Does any measurement read as a claim about the reader's machine?** "on this machine", "in this
   harness", "this repository" — each must name planetCraft or say "the project this protocol comes
   from".
3. **Is any rule stated twice, in two voices?** The known candidates: the `curl`/`lsof` rule (step 1
   and the playtest gate — the source states it twice on purpose, once per subject, so keep both but
   make sure they do not contradict); the `cd` hazard (step 2 and step 8); the beat's two facts
   (step 0, step 1, the stand-down tick); `pending[]` being honoured on any row (the journal and the
   stand-down tick). Two statements of one rule are fine; two *different* statements are not.
4. **Does a step reference a step number that moved?** The source's cross-references ("see step 3",
   "step 5", "never 3") were written for its own numbering and the port kept it — verify each.

- [ ] **Step 2: Grep for the substitution table's left-hand column**

Run, from the repository root:

```sh
grep -nE 'tools/|npm run|\.claude/|docs/superpowers|docs/local|ROADMAP\.md|reports/|launchctl|crontab|retex|usage-scan' skills/orchestra/SKILL.md
```

Expected: **no output.** The acceptance test covers most of these; this catches the near-misses it
does not list.

- [ ] **Step 3: Check the config keys named in the document are real**

Run:

```sh
grep -oE '`(name|id|mode|root|language|mainBranch|worktrees|roadmaps\.[a-z]+|docs\.[a-z]+|branchTests|gates|ledgers|queue|monitor\.port|tickets\.file|briefExtra)`' skills/orchestra/SKILL.md | sort -u
```

Cross-check every line against `lib/config.mjs`'s `DEFAULTS` and `lib/cli/doctor.mjs`'s row list. A
key the document names that `doctor` does not print is a key the conductor cannot read.

- [ ] **Step 4: Update the README**

Replace `README.md`'s "What works today" section with:

```markdown
## What works today

Phase 1 shipped the roadmap layer, phase 2a the register and the machine budget, phase 2b the
protocol that drives them:

- **`/orchestra`** — the conductor protocol: the nevers, the journal, the framing pass, the nine
  steps of a tick, the playtest gate, and the worker briefs as templates a project fills from its
  own config (`briefExtra` is where it pastes its own hard rules).
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

A conductor launches its workers with the harness's own `claude --bg`; there is no launcher in the
plugin, and `ready` produces a plan rather than executing one.

Not yet: the merge gate and `roadmap sync` (3), the monitoring page and `orchestra instances` (4),
the guard hooks, `orchestra init`, the ticket queue and the heartbeat (5). Until the page exists
nothing writes `.orchestra/inbox.jsonl`, so a conductor takes its answers from the conversation. See
the spec's phase table (§15).
```

- [ ] **Step 5: Run everything, twice**

Run: `npm test && npm test`
Expected: PASS both times, 261 tests. Two suites override `HOME`; confirm the developer's own is
untouched with `ls ~/.orchestra`.

- [ ] **Step 6: Commit**

Stage `skills/orchestra/SKILL.md` and `README.md`, message:
`docs(p2b): the whole-document pass, and what a user can type today`

---

## Review checklist for the branch review

Beyond the per-task reviews. The first four are P1's and P2a's, re-aimed at prose; the last four are
this phase's own.

1. **Does any sentence in the document promise a command this plugin does not have?** The acceptance
   test checks the `orchestra …` forms. It cannot check "start the dev server", "run the full suite",
   "spawn merge_agent", "install the heartbeat" — read for those.
2. **Is any measurement implied of the reader's machine?** Every date, count and duration must be
   attributed. This is transformation 2 and it is the one a grep cannot finish.
3. **Was every guard of the acceptance test watched failing?** Task 1's Steps 2 and 3 are the proof
   for five of the six; the `placeholders` guard first passes in Task 12 and was red from Task 1
   onward. If a task presented a green run as a proof without a prior red one, say so in the review.
4. **Did the port drop a sentence rather than rewrite it?** Every substitution falsifies prose around
   it. For each of the fourteen sections, diff the *content* against the source's line range — not
   the wording, the claims. A rule that lost its measurement passes the anchor test if another
   section happens to carry the same number.
5. **Is the §6 checklist honest, or was an anchor written to satisfy the test?** Each anchor must be
   in a sentence that means it. An anchor pasted into a list to make a test green is the prose
   version of a vacant test.
6. **Do the four briefs actually fill from `doctor`?** Take a real fixture config, resolve all nine
   substitutions by hand, and read the result. A `{branchTests}` that resolves to `—` must produce a
   sentence, not a dash in the middle of a hard rule.
7. **Does the document contradict itself across tasks?** The known seams: the `curl`/`lsof` rule
   (twice), the `cd` hazard (twice), the beat's live-versus-conducting distinction (three times),
   `pending[]` honoured on any row (twice), and who performs a landing (the nevers, step 6, the
   playtest gate).
8. **Is a reviewer's claim verified before it is paid for?** A central P1 finding was refuted by a
   thirty-second measurement. For this phase the equivalent is a claim about what a subcommand
   prints: run it in the fixture before rewriting a sentence to match a guess.
