---
name: roadmap
description: Write, check and manage a project's roadmaps with the orchestra plugin — drafted as markdown, then published either as GitHub issues (online mode) or as committed markdown (offline mode). Status is always derived, never written. Use when the user asks to write a roadmap, add or take a task, file a bug as a task, see the board, claim or release a task, open or reserve a roadmap, or publish a programme.
---

# The roadmap CLI — one grammar, two destinations

Every command below is `orchestra roadmap …`, which means:

```sh
"${CLAUDE_PLUGIN_ROOT}/bin/orchestra" roadmap <subcommand> [args]
```

Run it from anywhere inside the project. If `CLAUDE_PLUGIN_ROOT` is unset, the binary is `bin/orchestra`
at the root of this plugin's own directory. **First, always:**

```sh
"${CLAUDE_PLUGIN_ROOT}/bin/orchestra" doctor
```

`doctor` prints the resolved configuration in a project that has already opted in, marking every
key that fell back to a default, and names the mode. **If it says the project has not opted in,
stop and do what it tells you** — run `orchestra init --mode online` or `--mode offline`. Nothing
else in this skill works before that, and every other subcommand exits 0 and silent rather than
complaining, on purpose: that silence is what makes this plugin safe to install globally. (`doctor`,
`orchestra instances` and `orchestra init` itself are the three exceptions that answer with no
config at all.)

## 1. Two destinations, one drafting room

- **`<roadmaps.drafts>/<slug>.md`** (default `.orchestra/drafts/`) is where a roadmap is WRITTEN and
  linted. Nothing else can see it: it is not published, `board` lists it under `unpublished:`
  precisely so it cannot be mistaken for work anyone knows about, and nothing will schedule it.
- **`publish`** is the frontier. What it produces depends on the mode, and that is the only thing
  the mode changes:
  - **offline** — the draft moves to `<roadmaps.published>/<slug>.md` (default `docs/roadmaps/`),
    is committed, and the drafting file is gone. From that moment the committed file *is* the
    roadmap.
  - **online** — one programme issue plus one issue per task, and the drafting file is deleted.
    From that moment the issues *are* the roadmap.

Either way, `publish` also enrols every task in the register, because publishing is the moment a
roadmap becomes schedulable and nothing else in the system notices.

**What offline mode cannot answer**, and say so if the user's question depends on it: "is somebody
already working on this" has an answer **for this machine only**. There is one register and one
owner. That question is the entire reason online mode exists.

## 2. The grammar

**Read `docs/roadmap-format.md` in this plugin before writing a task.** It is the whole contract and
this section is not a substitute for it. In outline: a roadmap is prose plus a block per task — a
`### <ID> — <title>` heading, seven fields in any order, then two required paragraphs.

```
### S1 — Read the config at boot

- **Roadmap** startup
- **Order** 1
- **Deps** —
- **Touches** `src/main.rs`
- **Branch** `startup/s1-read-config`
- **Design** no
- **Lane** —

**Why.** Plain language: what a user of the thing sees or feels differently once this lands.

**Acceptance.** How you know it landed, and with which instrument.
```

Three details the linter will refuse and that are worth getting right first time:

- **`—` (U+2014, an em dash) is the explicit way a field says "none"** — never an empty string, a
  hyphen, or "N/A". Three fields do not admit it: every task belongs to a roadmap, lands on a
  branch, and either needs a design pass or does not.
- **A task's key is `<roadmap>/<ID>`.** The ID alone is unique only inside its own file, so pick one
  no other roadmap has used either.
- **There is no status field.** Not `Status`, `State`, `Landed`, `Done`, `Progress`, `Session`,
  `Owner` or `Claimed`. Status is always derived — from git and the register locally, from the issue
  for a task somebody else owns. Writing one is refused by name.

The last segment of `Branch` must start with the task's lowercased id and a hyphen (`s1-`), because
the id is what reconciliation matches on. The prefix before it is free.

Check any roadmap before considering it finished:

```sh
orchestra roadmap lint [path…]
```

With no path it checks every draft. It exits non-zero on an error, prints warnings without failing,
and says so when a file is clean.

## 3. The commands that exist

Nine subcommands, and this list is exhaustive — **there is no `new` and no `bug`.**

- **`lint [path…]`** — checks the grammar of the given files, or every draft if none are given.
- **`board [--json]`** — prints the derived state of every task, reconciled against git and the
  register. `--json` is the machine-readable form. See §4 for how to read its lines.
- **`publish [path]`** — lints first and refuses on any error, then publishes per the mode above and
  enrols the tasks. With no path it takes the first draft in sorted order. If enrolment fails after a
  successful publish it says so, names the recovery command, and exits non-zero — the roadmap IS
  published in that case, so re-running `publish` is not what fixes it.
- **`enrol`** — writes a register row for every published task that has none. Append-only: an
  existing row is returned untouched, so it can never overwrite a note, a session or a recorded
  commit subject. Safe to re-run.
- **`claim <key>`** — takes a task. Online this assigns its issue and labels it, so every other
  machine sees it taken; offline it succeeds without telling anybody, because there is nobody to
  tell. A lost claim names the holder and exits non-zero.
- **`release <key> [--force]`** — releases a claim **you** hold. Releasing one **somebody else**
  holds needs `--force`; without it the command names the holder and refuses.
- **`open <roadmap>`** / **`reserve <roadmap>`** — hands a roadmap's tasks to everyone, or takes that
  back. Online this is one label on the programme issue. Offline both print why they did nothing.
- **`sync`** — reconciles the shared channel with what actually landed. Online: closes every issue
  the derivation proves landed, moves each task's `status:` label onto what the board derives, ticks
  every programme's checklist against its own closed tasks, and closes a programme once all of it
  has. Offline it does nothing, and that is correct: there is nowhere to write a status.

A command that cannot apply in the current mode says so rather than pretending to succeed. Relay
that sentence to the user instead of treating it as an error.

## 4. Reading the board

`board` prints one table plus up to five kinds of line, and they are not the same fact:

- **`correction:`** — a real disagreement between the register and the derivation. It wants a human.
- **`unverified:`** — the register says a task landed and recorded no commit subject to prove it. It
  prints as `landed?`, never as `todo`, and is listed separately so an absence never quietly becomes
  a verification.
- **`not ours:`** — a task somebody else owns, deliberately dropped here so nothing schedules it.
  Never a problem, and offline cannot produce this line at all.
- **`orphan:`** — a task one record has and the other does not, and the two halves are different
  facts. *In a roadmap and not in the register* means nothing will schedule it or even count it: run
  the command the line names. *In the register and in no roadmap* is the reverse — a task nobody
  else can see — and it wants a roadmap line written for it.
- **`unpublished:`** — a draft. Nobody but this machine knows it exists.

**If a board line looks wrong, the derivation is wrong** — git, the register, or the issue — or the
register is stale. Fix that. Never add a field to make the board agree with what you already know;
the block has no field for it, on purpose.

## 5. Three rules, and what enforces them today

- **Never take a roadmap that is not yours and not open.** Ask its owner to `open` it.
- **Never work a task you have not claimed**, your own roadmaps included. Claiming is what makes the
  task visibly taken to everyone else watching.
- **Never write a status anywhere.**

**Be honest about enforcement**: `guard-claim` (`hooks/guard-claim.mjs`) refuses `git worktree add
-b <branch>` — the one gesture that starts work — for a task that is neither yours-and-open nor
claimed by you, failing open when the board is unreachable. That is one gesture, not every way work
could start, so the rules still outlive what it catches; keep them on the paths where no tool is
watching. The third rule needs no enforcement offline: there is no field to write a status into.

## 6. Writing a good task

`Why` names what a user of the thing sees or feels differently once the task lands — never a
mechanism, never a file, never an internal number. `Acceptance` names the instrument that will show
it: a test, a benchmark number, a screenshot pair, a log line. When that instrument does not exist
yet, say so plainly rather than gesturing at "will look right" — building it is honest work, and it
is often the task's own first step.

Filing a bug is done with what exists: draft it as an ordinary task with its soft fields — `Order`,
`Deps`, `Touches` and `Lane` — all `—`, because a bug usually does not yet know where it sits in a
sequence, what it blocks, or which files fixing it will touch. Publish it like any other task.
