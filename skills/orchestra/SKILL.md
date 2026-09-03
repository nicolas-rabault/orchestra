---
name: orchestra
description: Conduct every roadmap of this project at once — one background worker session per ready task, and every question relayed to the user in plain language. Use when the user says /orchestra, or asks to orchestrate or parallelise the roadmaps.
---

# Orchestra — the conductor protocol

Spec and recorded decisions: `docs/specs/2026-09-02-orchestra-plugin-design.md`. You are the
conductor for this tick. You hold no state in your head — everything below rehydrates from
`.orchestra/state.json`, git and `claude agents --json`, and the conversation is a cache, so any
fresh session running this skill takes over completely.

Every command below is `orchestra <subcommand>`, which means:

```sh
"${CLAUDE_PLUGIN_ROOT}/bin/orchestra" <subcommand>
```

Run it from anywhere inside the project. If `CLAUDE_PLUGIN_ROOT` is unset, the binary is
`bin/orchestra` at the root of this plugin's own directory. From here on, this document writes
`orchestra <subcommand>` and means that.

**`orchestra doctor` first, always.** It is the only command that answers in a project that has not
opted in: it prints the resolved configuration, marks every key that fell back to a default, and
names the mode. If it says the project has not opted in, stop and do what it says — every other
subcommand exits 0 and silent otherwise, on purpose, and that silence is what makes the plugin safe
to install globally. Read off it `name`, `id`, `language`, `mainBranch`, `worktrees`, `branchTests`,
`docs.specs`, `docs.plans`, `docs.results` and `briefExtra`, and nothing else.

**Runtime state resolves to the main checkout, never to the worktree you are standing in.** Every
subcommand does that for itself. What it cannot do for you is the register you edit **by hand**:
`.orchestra/state.json` has no subcommand that writes it, so a path typed after a `cd` into a
worktree writes the wrong file. Use the main checkout's absolute path, and check that the register's
own `root` key names the project you think you are conducting.

## What is not here yet

The single roll-call. An absent command is named here with its phase, in backticks, and never as
something to type — every occurrence of it elsewhere in this document is a bug, not an instruction.

- **Phase 3, the merge gate**: `orchestra land`, `orchestra await`, `orchestra queue-list`, the
  `merge_agent` agent, and the `gates` and `ledgers` config they read. Until then **no landing
  happens through this protocol**: an approved branch is named to the user, in the journal and in
  the checkpoint, and it is the user's to land. You never merge — that rule outlives its
  enforcement, and phase 5's hooks are what will hold it.
- **Phase 3, online only**: `orchestra roadmap sync`. Offline there is nowhere to write a status, so
  it will never exist there, and that is correct (spec §4.1).
- **Phase 4, the monitoring page**: `orchestra monitor`, `orchestra instances`, the allocated port.
  **The page is also the only writer of `.orchestra/inbox.jsonl`**, so until it exists `orchestra
  inbox` prints nothing and the user answers in the conversation. The journal is still written, and
  `pending[]` is still load-bearing: `orchestra ready` reports it, `orchestra tick-gate` honours it,
  and `orchestra archive` never moves it.
- **Phase 5**: the guard hooks, `orchestra init`, the ticket queue (`orchestra tickets`) and the
  heartbeat (`orchestra install-heartbeat`). **Never propose a cron entry for the heartbeat**: a
  cron job runs outside the login session and cannot read the login keychain, so every tick dies on
  `Not logged in` — eight consecutive ticks did, and seven hours were lost, on the night of
  2026-08-12/13 in planetCraft. A launchd agent or a systemd user timer is the shape that works.
- **Never**: a retrospective tool (spec §13 — its metrics belong to the source project), and a
  level-triggered net under the answer watch. See `### The answer net, and what has no net under it
  yet`.
- **One limitation, not an absence**: `orchestra ready` reconciles against the literal branch
  `main`. A project whose main branch has another name gets a ready set that reconciles nothing, in
  silence, until a later phase widens it.

## The six nevers

1. Never merge a row that ships **a page a human reads or a gameplay change** without the user
   having looked at it. That look is the one interruption the row is allowed (see The framing
   pass), and it is not a formality: in planetCraft, on 2026-08-12/14, three serious defects were
   caught by exactly that look and by nothing else, every one of them past a green 4 900-test
   suite. **Any other row lands once every configured gate is green, without asking** (`gates`,
   phase 3) — thirteen merge approvals were asked on that roadmap and thirteen were granted, none
   refused, at a cost of hours each. What you may never do is land in SILENCE: the landing goes in
   the journal and in the checkpoint, and the user keeps a veto by revert.
2. Never answer a design question in the user's place. One bounded exception: at the
   design→execution boundary you adopt a brainstorm's own recommendation (see Design→execution
   handoff).
3. Never write into a worktree you did not launch — **unless all three of these hold: its session
   is absent from `claude agents --json`; no file under it has changed in 60 minutes
   (`/usr/bin/find <wt> -newermt '-60 minutes' -not -path '*/node_modules/*' -type f | head -1`);
   and its branch is behind its own last report.** Then take it over with the relaunch brief and
   record it in a `note` — do not ask. If any of the three is unclear, ask. (Measured 2026-08-12 in
   planetCraft: asking cost two hours forty-four minutes on evidence stricter than this, and the answer was
   "yes, take all four", in six minutes. The probe uses the absolute `/usr/bin/find` on purpose: a
   PATH-rewriting hook in the source project dropped `-newermt` from the bare name.)
4. Never start a dev server before a task reaches the playtest gate.
5. Never trust `.orchestra/state.json` over git — for a LOCAL task; git wins there, correct the
   register. A SHARED task, online, is the opposite: another developer's landing closes its issue
   but that commit never reaches your local main, so git under-reports it forever — the closed
   issue is authority instead (`deriveSharedStatus` in `lib/store/github/index.mjs`), not git. Offline
   every task is local, so it is simply **git wins**, with no exception to remember (spec §4.1).
6. Never work — or launch a worker on — a shared task you have not claimed.
   `orchestra roadmap claim <key>` first. Online, the issue is how every other machine learns the
   task is taken. Offline the claim still comes first, but it succeeds without telling anybody,
   because there is nobody to tell: the register row and the branch ref are the interlock. Phase
   5's `guard-claim` hook is the backstop, not the mechanism.

## The language you write in

This document is English, because the plugin is shared: the same words read the same way in every
project it is installed into. What you write **for the user** is not — every journal line, every
`ask` and its `options`, every `note`, every checkpoint, every question relayed, is written **in the
user's language**. `.orchestra/state.json`, and the rest of the runtime state next to it, is
gitignored and has exactly one reader — this is that committed-in-English rule's deliberate
exception, not a contradiction of it: what a worker commits stays English, and so does its branch,
because the exception is the conversation, not the code.

You learn that language by being spoken to, and you **write it down the first time you see it** —
`conductor.language` in `.orchestra/state.json`, a plain name (`français`, `English`). That write is
the whole mechanism, and it is not bookkeeping: most journal lines are written by a headless tick
that has no user message to infer anything from, so a language only ever deduced is a language lost
on every tick the heartbeat and the page start. Absent from the register, write English and keep
watching for a message that settles it.

It applies to what a worker sends you, too — the briefs below ask for it — and to a roadmap you
draft (`roadmaps.drafts`). It does NOT apply to a published roadmap (`roadmaps.published`) or to any
roadmap's parsed skeleton: the seven field names, `**Why.**`, `**Acceptance.**`, ids and branch
names are English in every channel, and `orchestra roadmap lint` fails if they are not.
