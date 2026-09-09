# Worker briefs — what `orchestra brief` renders, and the two hand-overs

`orchestra brief <key>` renders the brief; you do not compose one. Read this when you need to know
WHAT it renders and why, when a design row reaches its handoff, or when `orchestra ready` prints a
`RETIRE:` line and you want to know what the hand-over does and what decided it.

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

## Retiring a long worker

A worker's context only grows, and every request re-reads the whole of it, so a session's cost is
not its length — it is its PREFIX INTEGRATED OVER its length. Measured 2026-09-09 across duckJam's
122 worker sessions: a worker boots at 34 k, grows 1.18 k a request, and ends at 253 k median and
707 k worst. 4.17 billion tokens read to produce 30.7 million written, 131 to 1. Past a point,
carrying the prefix costs more than starting over on the same worktree.

**The tick does not decide this and you do not estimate it. `orchestra ready` says when.**

```sh
orchestra cost                     # what every live session costs, and why each is or is not firing
orchestra retire <key>             # the hand-over: wrap-up turn, note onto the row, session stopped
```

`ready` prints one `RETIRE:` line per row past its threshold, carrying the two numbers the decision
rests on — what one more request from that session costs, and what a replacement would start at.
`orchestra cost` prints the whole fleet including the rows that are NOT firing, with the reason,
because "nothing fired" is only useful if you can see what held it back.

### What the threshold is, and why that number

`retireAt`, 200 000 tokens of prefix, a config key. It was chosen by replaying all 122 real sessions
under this rule, cutting whenever it fired and paying a fresh boot plus a re-acquisition R:

| `retireAt` | R = 30 k | R = 60 k | R = 100 k | R = 150 k |
|---|---|---|---|---|
| 150 k | +45.7 % | +35.1 % | +18.4 % | −1.8 % |
| **200 k** | **+36.0 %** | **+31.3 %** | **+21.1 %** | **+7.6 %** |
| 250 k | +26.1 % | +22.7 % | +18.2 % | +10.7 % |

200 k is the lowest round threshold that is POSITIVE at every re-acquisition cost simulated, at
about one hand-over per session. 150 k saves more when a hand-over is cheap and loses when it is
not. Raise `retireAt` if your project's hand-overs are expensive; the rule also raises it by itself,
which is the next paragraph.

### The three guards, and the one that makes it safe

**Twice its own boot.** A session is never retired below twice the prefix of its OWN first request.
This is not a belt-and-braces rule — it is what stops the mechanism destroying itself. A threshold
below `boot + R` means the REPLACEMENT is born already over the line and is retired again on its
next request, for ever: simulated at R = 150 k against a 100 k threshold, that is 141 hand-overs per
session and **160 % more tokens read than doing nothing at all**. The floor closes it without
needing to know R, because a session's own boot IS `boot + R` for the replacement of an expensive
hand-over — so an expensive hand-over automatically raises the bar for the next one on that row, and
nothing has to be remembered anywhere. Same simulation with the floor on: −17 % and 1.4 hand-overs,
bad but bounded, and no runaway anywhere in the sweep.

**Twenty requests.** 11 % of sessions cross 200 k with fewer than twenty requests left to run, and a
hand-over they pay for is never recouped.

**Never mid-anything.** Not a row being driven (its prefix is already out of date and the turn's
work would be lost), not one waiting on the user (the answer is coming back to THAT session), not
one waiting on the gate (its worker has already finished), not a terminal row. `orchestra retire`
re-asks every one of these against the register as it is when it runs, not as the tick found it —
and there is deliberately no `--force`: every refusal is a case where the hand-over loses work or
costs more than it saves.

### What a hand-over actually does, and where it stops

1. It drives ONE wrap-up turn, with the plugin's own prompt: commit everything, then make your final
   message a note under four headings — DONE, NEXT, FILES, TRAPS. **The note is the re-acquisition**,
   and the table above is how much the note's quality is worth: a vague note makes the replacement
   re-read the branch to find out where it is, which is the whole cost the hand-over was avoiding.
   That is why the prompt is the tool's and not yours.
2. It writes that note onto the row, and only then stops the session. A crash between the two leaves
   the note recorded and the worker alive, which is the recoverable way round.
3. **It stops there. It does not launch the replacement.** What it leaves is a live row with a
   branch, a worktree, a note and no session — which `ready` reports as `RELAUNCH:` — so the
   replacement starts through the launch path that already exists and is already guarded. A second
   launch path written into the tool would be a second copy of the session-naming, the claim gesture
   and the journal line to keep right.

So a retirement completes across two ticks, and that is the safe way round: if anything dies
halfway, the row is either untouched or waiting to be relaunched, and the tick knows how to finish
both. **A wrap-up that produced no note retires nothing** and says so, exit 1, session untouched.

**What this buys is quota first and speed second.** The five-hour ceiling is a token budget — on one
planetCraft run four workers and the conductor hit it within forty minutes of each other and the
whole fleet stopped for 1 h 36 — and 31 % fewer tokens read buys a later exhaustion. There is a
latency effect too, and it is real but modest: measured over 21 858 duckJam requests, the
request-to-request floor roughly doubles from 0.5 s below 50 k to 1.0 s past 400 k, while the median
gap plateaus past 150 k.

**`RELAUNCH:` is not only for retirements.** Any worker killed by hand, by a reboot or by a stray
`claude stop` leaves the same state, and until 2026-09-09 NOTHING REPORTED IT: a `claimed` row with
a live branch, a live worktree and no session appeared in `ready`, in `blocked` and in all three
obligations as nothing at all. The skill had always told you to relaunch such a row at the launch
step; the row you were to notice was invisible.
