# Worker briefs — what `orchestra brief` renders, and the two hand-overs

`orchestra brief <key>` renders the brief; you do not compose one. Read this when you need to know
WHAT it renders and why, when a design row reaches its handoff, or when you are considering
retiring a long worker.

## Worker briefs

**`orchestra brief <key>` renders the brief. Nothing here is a template for you to fill.** It was
one — a fourteen-row substitution table and four prose bodies, filled by hand once per launch, 123
times in duckJam alone — and that shape was paid for twice: by the conductor, in an `orchestra
doctor` read and five hundred composed words per launch, every one of them free to come out
different from the last; and by the worker, which was handed a task and left to find the project
for itself.

The worker's half was the larger one. Every session sampled in duckJam on 2026-09-09 opened the
same way — `ls`, `git log --oneline -8`, `find design -type f`, `wc -l` over the files it hoped
were right, `ls docs/roadmaps/` — four to eleven Bash calls before the first productive one. And a
session's context only grows: that rediscovery was still being re-read at turn 150. One worker ran
the same failing grep four times with different flags.

### What it renders

The text lives in `lib/register/brief.mjs` and is covered by `test/brief.test.mjs`; this is what it
puts in, and why:

| In the brief | From | Why it is there rather than found by the worker |
|---|---|---|
| the branch, the task key and its title | the row | — |
| the excerpt | `renderTaskBlock` over the parsed row | the one canonical form both stores already publish, so online and offline cannot drift, and no line-range slice can catch a neighbouring heading |
| the commit the worktree was cut from | `git log -1 <mainBranch>` | measured being asked for by hand as `git log --oneline -8`, in every session sampled |
| the `Touches` paths, located and sized | `statSync` per path | the `ls` and `wc -l` those sessions spent their first calls on. `new <path>` is read as the grammar it is (docs/roadmap-format.md), and a path declared new that ALREADY exists says so loudly — a worker that overwrites what someone else created has destroyed work nobody asked it to touch |
| the task's spec and plan already on disk | a name match on the task id under `docs.specs` and `docs.plans` | the `ls docs/specs/ && grep` pass |
| `branchTests`, or the sentence for a project with none | the config | — |
| `briefExtra`, verbatim | the config | where a project states what a prompt cannot derive: where its code lives, what never to touch, whether a fresh worktree needs a bootstrap (the launch step runs no dependency install, for exactly that reason) |
| the project's own rules | `.orchestra/CLAUDE-rules.md` when it exists | offline mode keeps them out of the committed `CLAUDE.md`; online the same rules are already in it and every session reads them |
| the context rule | fixed | see below |
| the language to write to you in | `language` | — |
| the protocol, and the model's own tail | the row | execution, design or review, decided by the row: `pr` roadmap AND a `PR<number>` id is a review, `Design yes` is a design, everything else is execution. Either half of the review shape alone is a guess |
| `base`, on a review row | the register row, written by the sweep | a caller that had to supply it would be copying out of a file the command can read itself |

`--relaunch` prefixes the take-over of a dead session with an intact worktree; `--handover <n>`
prefixes the take-over of one retired on purpose, and carries the row's own `note`. Neither
replaces the brief — both prefix it.

`--repo <owner/name>` is the one thing it cannot derive, and only a review row needs it: never a
repository name you typed, always `gh repo view --json nameWithOwner -q .nameWithOwner` or the
`repo` field `orchestra pr scan --json` already prints.

### The context rule, and why it is in every brief

4.03 billion tokens of context were read to produce 30.7 million tokens of output across duckJam's
123 worker sessions — 131 to 1. The cause is structural: 91 % of a worker's tool calls are Bash,
and everything a Bash call prints stays in front of every later request that session makes. A
repository-wide sweep is the worst shape of it — large, mostly irrelevant, and paid for until the
session ends.

So every brief carries three sentences the worker can act on: start from the files named above;
send a genuine repository-wide search to an Explore subagent and keep its conclusion, not its
output; read a range in preference to a whole file you only need part of.

### Changing a brief

Edit `lib/register/brief.mjs` and its test. Do not paste an edited brief into a launch line: a
brief that differs from what the renderer produces is a brief nobody can reproduce from the row,
and the launch journal records only that the row was launched.

## Design→execution handoff (design tasks)

A row whose `design` field is true — the roadmap's own `**Design** yes`, set by
`lib/roadmap/parse.mjs` — launches on the design model, which is what `orchestra brief` renders for
it without being asked: its only deliverable is the committed spec (`docs.specs`) and plan
(`docs.plans`) on its own branch. It must not write implementation code, and its session ends there.

When it reports done: **adopt the plan's own recommended approach — do NOT ask the user.** This is
the one bounded exception to never #2: a stated recommendation is acted on, not relayed to the user
as a question. If the design genuinely ends in a fork with no recommendation, THAT is a blocking
question. Then launch a fresh execution-model session on the SAME worktree, with the brief "read
the committed spec and plan, execute the plan" carried by that same rendered brief, and update
`model` on the row. Do not kill
anything first: a completed background session costs nothing.

**That second session's brief is `orchestra brief <key> --model execution`, and the flag is not
optional.** The row's `Design` stays `yes` — it is a fact about how the task was WRITTEN, not about
which session is running now — so without the override the execution session is handed the design
brief again and told once more not to write implementation code.

**Where the two models come from.** The launch plan (`planLaunches`, `lib/register/ready.mjs`)
sets each launched row's `model` from that same `design` field — the design model when it is true,
the execution model otherwise — and the tick prints the choice in its launch line
(`lib/cli/tick.mjs`):
```
launch: <id> — <title> [fable] on <branch>
```
for a design row, `[opus]` for any other. So the choice is the roadmap's, made when the task was
written — not a judgment call the conductor makes at launch time.

## Retiring a long worker (EXPERIMENT — one row at a time)

A worker's context grows monotonically, roughly 2 K tokens a turn from its own tool results —
measured in planetCraft — and every request re-reads the whole prefix. Measured on one run in
planetCraft: sessions started at 57 K and reached 400–740 K, and one worker's request cost ten
times more at its last turn than at its first. Cutting a long session in two saves 20–30 % of its
read tokens, measured on that same run in planetCraft.

**What that buys is quota, not speed.** A turn's duration tracks what it OUTPUTS, not the context
behind it — measured flat over 1 831 turns in planetCraft. But the five-hour ceiling is a token
budget: on that run in planetCraft, four workers and the conductor hit it within forty minutes of
each other, and the whole fleet stopped for 1 h 36. Fewer tokens bought a later exhaustion, not a
faster turn.

**Measure before you act, and act on ONE row.** The saving depends on how much a handover has to
re-read, which nothing has directly measured: at a 50 K re-acquisition it works out to 31 %, at
150 K to 13 %, and below roughly 110 turns splitting costs more than it saves. That sensitivity is
exactly why this is an
**EXPERIMENT**, not a settled rule: what it saves on one project's shape of task is not a promise
about yours.

**This plugin ships no tool that measures a session's token use.** The source project scores every
handover with its own scanner; this plugin carries none. The turn count is therefore the only
signal a conductor has here.

Past ~120 turns on a row you are willing to experiment on: ask the worker to commit, write where it
got to into its row's `note`, and stop it. Then launch a **NEW** session on the same worktree with
`orchestra brief <key> --handover <n>` — **never `--resume`**, which keeps precisely the context this is trying
to drop. Journal it as a `note` with the turn count, so a later measurement can judge what the
hand-over actually cost. Keep both limits: do not do this to more than one row until that number
exists, and never to a row in the middle of a hands-on gate.
