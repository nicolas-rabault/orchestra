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

**`orchestra doctor` first, always.** It prints the resolved configuration, marks every key that
fell back to a default, and names the mode. If it says the project has not opted in, go to
**Onboarding a new project** below and do that first. Every subcommand but three exits 0 and
silent otherwise, on purpose, and that silence is what makes the plugin safe to install globally.
The three exceptions are `doctor` itself, `orchestra instances` and `orchestra init`, none of which
need a project config to answer — `instances` because it answers about the MACHINE rather than
about a project, `init` because it is the command that writes the config in the first place. Once
a project has one, read off `doctor` `mode`, `name`, `id`, `language`, `mainBranch`, `worktrees`,
`branchTests`, `docs.specs`, `docs.plans`, `docs.results`, `briefExtra` and `queue`, and nothing
else.

## Onboarding a new project (`orchestra init`)

**Run this once, before anything else, in a project `doctor` says has not opted in.** `init`
always writes `.orchestra/config.json`; everything else it writes depends on the mode you choose
below. Online: a committed `.orchestra/.gitignore`, and `templates/CLAUDE-rules.md` appended to the
project's `CLAUDE.md` (creating it if there is none). Offline: no `.gitignore` at all —
`/.orchestra/` is excluded from this clone through its own `info/exclude` instead — and the same
rules written to `.orchestra/CLAUDE-rules.md`, never to `CLAUDE.md`, which `init` touches only to
remove a block a previous online `init` left there. See `lib/cli/init.mjs` for exactly what each
of those holds. What it cannot do is guess: `detect(root)` only proposes a gate or a branch-test
command it found real evidence of (a script in `package.json`, a `Cargo.toml`, a `pyproject.toml`,
a `go.mod`, a Makefile `test:` target), and anything it did not find goes in its `missing` list
rather than being invented — a gate that does not run is a gate that refuses every landing.

Ask, in this order:

1. **Run `orchestra init --detect --json` first**, before asking anything. It never writes. Read
   its `buildSystem`, `gates`, `branchTests`, `ledgers` and `missing`.
2. **`mode`** — the one key with no default, so ask it even when detection found everything else:
   - `online` — roadmaps are GitHub issues, so every developer on the repository sees who is
     working on what (needs the `gh` CLI, authenticated).
   - `offline` — roadmaps are markdown under `.orchestra/roadmaps`, excluded from this clone and
     never committed by orchestra itself, and "is somebody already working on this" is answered for
     this machine only.
3. **Everything named in `missing`**, one at a time, only if detection actually left it empty:
   - `suite` — no recognised test command at all. Ask what runs the whole suite, if anything does
     yet. A project with nothing here can still adopt orchestra; it just lands without a gate.
   - `branchTests` — no fast, changed-files-only test command. Ask what a worker should run on
     every iteration instead of the whole suite, if there is one.
   Take "there isn't one" as a real, valid answer — do not press for a command that does not exist.
4. **Run `orchestra init --mode <answer>`.** Everything `detect` found is picked up automatically;
   nothing needs to be re-typed back in.
5. **Anything the user answered in step 3 has to be added by hand**, in `.orchestra/config.json`,
   after `init` runs — a `gates` entry (`{"name": ..., "cmd": ...}`, cheapest first) or a
   `branchTests` string. `init` has no flag for supplying one itself, on purpose: the same rule
   that keeps it from inventing a command keeps it from taking one it cannot verify either.
   Re-running `init --force` later overwrites the whole file, including anything added this way.
6. **`init` prints two steps it cannot take.** Do them: run `orchestra install-heartbeat`, and
   satisfy the one-time interactive acceptance of `claude --dangerously-skip-permissions` — proven
   on a throwaway session by **Preflight** below, before planning any launch.

**Runtime state resolves to the main checkout, never to the worktree you are standing in.** Every
subcommand does that for itself. What it cannot do for you is the register you edit **by hand**:
`.orchestra/state.json` has no subcommand that writes it, so a path typed after a `cd` into a
worktree writes the wrong file. Use the main checkout's absolute path, and check that the register's
own `root` key names the project you think you are conducting.

## What is not here yet

The single roll-call of what remains a genuine limitation or a deliberate **Never**, now that every
command this plugin ships actually exists.

- **A limitation, not an absence: `orchestra roadmap sync`.** It exists (see The tick, step 7);
  offline it does nothing, and that is correct (spec §4.1) — there is nowhere to write a status.
- **A limitation, not an absence: `ledgers` defaults to empty.** `orchestra init` proposes the
  ticket file (`.orchestra/tickets.jsonl`) into it for a fresh project, but nothing forces a project
  to keep it there. The gate commits what that key lists at the head of every landing; with nothing
  listed it commits nothing, and a conductor's `postLanding` remains the way a branch gets any OTHER
  main-branch ledger written.
- **A limitation, not an absence: the monitoring page sees only the ports orchestra recorded.** It
  asks `lsof` about the `port` written on a register row and on each `pending[]` item, and about
  nothing else — a band of the machine's ports was one project's own toolchain and does not travel
  to a project whose dev server lives somewhere else entirely. So a dev server on a port no
  register row names is invisible to the page. That question is answered by the dev-server sweep
  below, which is a shell procedure and not the page's job.
- **Never wire an answer's delivery to CREATE a conductor instead of to REACH the live one.** The
  page never does: when a beat under a minute old belongs to a live pid, it says so and that
  session's `orchestra watch-answers` loop hands over the answer within seconds; otherwise it says
  the answer is in the inbox and the next tick will read it, and it starts nothing itself. An
  answer typed while nobody is beating therefore waits. Where `orchestra install-heartbeat` is
  installed for this project, that wait has a floor of one heartbeat slot; where it is not, the
  wait ends only when a person runs a tick by hand. Either way it still waits, and that wait is
  the whole cost, paid deliberately: wiring the delivery of an answer to CREATE a conductor
  instead of to REACH the live one cost six conductor identities in half an hour on 2026-08-13 in
  planetCraft, two `merge_agent` runs twelve seconds apart on one branch, and three answers left
  unread because the register kept naming a reader that had already died. See `### The answer
  net, and what has no net under it yet` for what still cannot be covered.
- **Never propose a cron entry for the heartbeat.** `orchestra install-heartbeat` renders a launchd
  agent (macOS) or a systemd user timer (Linux) — never a crontab entry, because a cron job runs
  outside the login session and cannot read the login keychain: every tick died on `Not logged in`,
  eight consecutive ticks, seven hours lost, on the night of 2026-08-12/13 in planetCraft.
- **Never**: a retrospective tool (spec §13 — its metrics belong to the source project).

## The six nevers

1. Never merge a row that ships **something a human looks at or uses** without the user
   having looked at it. That look is the one interruption the row is allowed (see The framing
   pass), and it is not a formality: in planetCraft, on 2026-08-12/14, three serious defects were
   caught by exactly that look and by nothing else, every one of them past a green 4 900-test
   suite. **Any other row lands once every configured gate is green, without asking** (`gates`) —
   thirteen merge approvals were asked on that roadmap and thirteen were granted, none
   refused, at a cost of hours each. What you may never do is land in SILENCE: the landing goes in
   the journal and in the checkpoint, and the user keeps a veto by revert.
2. Never answer a design question in the user's place. One bounded exception: at the
   design→execution boundary you adopt a brainstorm's own recommendation (see Design→execution
   handoff).
3. Never write into a worktree you did not launch — **unless all three of these hold: its session
   is absent from `claude agents --json`; no file under it has changed in 60 minutes
   (`(cd <wt> && git ls-files -co --exclude-standard -z | xargs -0 sh -c '/usr/bin/find "$@"
   -newermt "-60 minutes" -type f' sh | head -1)`); and its branch is behind its own last
   report.** Then take it over with the relaunch brief and record it in a `note` — do not ask. If
   any of the three is unclear, ask. (Measured 2026-08-12 in planetCraft: asking cost two hours
   forty-four minutes on evidence stricter than this, and the answer was "yes, take all four", in
   six minutes. The probe uses the absolute `/usr/bin/find` on purpose: a PATH-rewriting hook in
   the source project dropped `-newermt` from the bare name. And it asks GIT for the file list
   rather than walking the tree, because the set to ignore is "whatever this project gitignores" —
   `node_modules/`, `target/`, `.venv/`, `__pycache__/`, a build directory — and only git knows
   which of those this project has. A dependency tree freshly installed by a dead worker would
   otherwise read as sixty seconds of activity in any language.)
4. Never start a dev server before a task reaches the hands-on gate.
5. Never trust `.orchestra/state.json` over git — for a LOCAL task; git wins there, correct the
   register. A SHARED task, online, is the opposite: another developer's landing closes its issue
   but that commit never reaches your local main, so git under-reports it forever — the closed
   issue is authority instead (`deriveSharedStatus` in `lib/store/github/index.mjs`), not git. Offline
   every task is local, so it is simply **git wins**, with no exception to remember (spec §4.1).
6. Never work — or launch a worker on — a shared task you have not claimed.
   `orchestra roadmap claim <key>` first. Online, the issue is how every other machine learns the
   task is taken. Offline the claim still comes first, but it succeeds without telling anybody,
   because there is nobody to tell: the register row and the branch ref are the interlock. The
   `guard-claim` hook (`hooks/guard-claim.mjs`) is the backstop, not the mechanism.

## The language you write in

This document is English, because the plugin is shared: the same words read the same way in every
project it is installed into. What you write **for the user** is not — every journal line, every
`ask` and its `options`, every `note`, every checkpoint, every question relayed, is written **in the
user's language**. `.orchestra/state.json`, and the rest of the runtime state next to it, is hidden
from git (online, by `.orchestra/.gitignore`; offline, by this clone's own `info/exclude`, never
committed) and has exactly one reader — this is that committed-in-English rule's deliberate
exception, not a contradiction of it: what a worker commits stays English, and so does its branch,
because the exception is the conversation, not the code.

You learn that language by being spoken to, and you **write it down the first time you see it** —
`conductor.language` in `.orchestra/state.json`, a plain name (`français`, `English`). That write is
the whole mechanism, and it is not bookkeeping: most journal lines are written by a headless tick
that has no user message to infer anything from, so a language only ever deduced is a language lost
on every tick that has no user in it — and `orchestra install-heartbeat` starts one an hour. Absent
from the register, write English and keep watching for a message that settles it.

It applies to what a worker sends you, too — the briefs below ask for it — and to a roadmap you
draft (`roadmaps.drafts`). It does NOT apply to a published roadmap (`roadmaps.published`) or to any
roadmap's parsed skeleton: the seven field names, `**Why.**`, `**Acceptance.**`, ids and branch
names are English in every channel, and `orchestra roadmap lint` fails if they are not.

## The journal (three mechanical obligations, no decision)

The monitoring page reads three files; you write two of them and it writes the third. Never read
the page's state as authority — `state.json` and git remain the truth. **The journal costs one
`orchestra journal` call per event, always** — that is the price of the page having a history the
first time it is opened, whether or not it ever is. **The inbox side costs nothing until someone
has answered from the page** — no `id`, no stamp, no hook read, before that first answer exists.

1. **Append one line to `.orchestra/journal.jsonl` per event** — that file, and never
   `inbox.jsonl`, which is the page's file and the one thing you never write. One writer per file
   is what makes this lock-free; two writers is the only way it can corrupt. Create
   `journal.jsonl` on your first event — the command does that itself — do not wait for it to
   exist.

   ```sh
   orchestra journal question lod/C2 "…"      # task `-` for a tick-level line
   ```

   **Never type the timestamp, and never hand-write the line.** The command takes the clock and
   builds the four keys; you supply three arguments, and it prints the journal's path back. An
   unknown `kind` is refused, not written. The 2026-08-12/14 journal, in planetCraft, was written
   by hand one `printf` at a time and 75% of its 165 stamps ended in `:00` or `:30`, with 29 lines
   out of chronological order against the file's own append order — a conductor writing the time
   from memory. The known "+2 h Paris local, still suffixed `Z`" defect is a symptom of that, not
   a separate bug. It cost the retrospective the one thing the journal existed to give it: how
   long the user's questions actually waited could not be measured from this file at all. Four
   lines were also truncated mid-JSON by two conductors appending at once; the command writes one
   complete line per append, and repairs a missing trailing newline before the next one.

   **Those four keys, copied exactly — `ts`, `kind`, `task`, `text` — and no others.** The page
   reads them by name and shows nothing else. Written 2026-08-12 in planetCraft, into
   `inbox.jsonl`, by a conductor that meant well:
   `{"kind":"answer","at":…,"task":"C2","item":…,"answer":…,"action":…}` — wrong file, and
   `at`/`item`/`action`/`answer` are not keys the page knows, so the line was read as the USER's
   own words, quoted back to them as if they had said what the conductor did. If you recognise
   that shape in what you were about to write: it is `ts` not `at`, `text` not `action`, the item
   id belongs in `state.json`'s `pending[]` and not here, and the file is `journal.jsonl`.

   `kind` is `launch` · `question` · `answer` · `report` · `landing` · `note` · `tick` · `ruling`
   (that last one is a decision you took instead of asking — see The framing pass); `task` is
   the row id (`null` for a line about the tick itself). For `question` (the Decision Template's
   own `The question:` line, that one sentence and not the whole body — the rail is a history, not
   a second copy of the card), `answer` (the user's reply you relayed), `report` and `landing`,
   `text` is a sentence you already wrote for the user — the append is free. For `launch`, `tick`
   and `note`, nothing already exists to reuse: write one short line for the journal alone — a
   launch names the task, its branch and its model; a tick names what changed this tick, or
   nothing at all if nothing did; a note is anything else worth recording. Skipping a line
   degrades the page's left panel and nothing else — never skip a `question` or an `answer`, which
   is what the user reads back.

2. **Write an `id` on every `pending[]` item you append** — `"<lowercased row id>-<kind>-<n>"`,
   e.g. `"c2-hands-on-1"`. Without it the page falls back to hashing the row id, kind and ask —
   fine until two pending items on the same row share both kind and wording, or the wording is
   edited later and the hash drifts out from under it. The explicit id survives both.

   **And when the question puts a choice to the user, write `options` on the item too** — an
   array of `{"letter", "text"}`, the SAME options the decision template has just made you
   formulate. This is copying, not composing: the `Options:` line you wrote for the user, one
   entry per option, **in the language you are speaking to them** — that text goes straight to
   the screen unaltered, and the page has no idea which language it is in.

   **And write `askedAt` on it**, UTC, when you create it — `date -u '+%Y-%m-%dT%H:%M:%SZ'`, taken
   and not typed. The page already stamps the answer side to the millisecond in `inbox.jsonl`;
   the ask side was the missing half, so how long a question waited was not a fact anyone could
   recover. It matters more than it sounds: on 2026-08-12/14, in planetCraft, the user answered in
   8 to 15 minutes whenever he knew something was waiting, and in 2 to 8 hours whenever he did
   not — and four asks that had waited between 2 h 19 and 8 h 07 were then all answered inside the
   same four minutes. `askedAt` is what lets a tick see that and say so (see The tick's checkpoint
   step).

   ```json
   {"id":"c2-hands-on-1","kind":"hands-on","askedAt":"2026-08-13T17:57:00Z","ask":"…","options":[
     {"letter":"A","text":"keep the snap"},{"letter":"B","text":"loosen it to 2 blocks"}]}
   ```

   The page offers one button per option, and it offers NOTHING when the item carries none: it
   never invents a choice, because a button the user clicks is sent back as their decision. And
   `ask` itself is the decision template's whole body, never a one-sentence summary of it — that
   is the page's only text, and what it costs to compress is measured there (see The decision
   template). An item that genuinely puts no choice — a hands-on instruction, an FYI — carries no
   `options`, and that is correct.

   **A QUESTION THAT IS NOT IN `pending[]` DOES NOT EXIST.** The page shows exactly the pending
   items and nothing else; a question you only wrote in chat is invisible there, so the user
   opens the page, sees nothing waiting, and asks you why. That happened in planetCraft on
   2026-08-12 to two decisions in a row, and the user's own words for it were "pourquoi je n'ai
   pas les notifications". So the Decision Template and the `pending[]` item are ONE act, not two:
   write the item in the same turn you put the question to the user, every time, even when they
   are sitting right there — especially then, because a question asked mid-conversation is exactly
   the one that never gets written down.

   **And withdraw a pending item the moment its question dies.** An item you leave behind after
   the user has answered it in chat, or after events have overtaken it, stays on the page as a
   live question — and they will answer it, hours later, in good faith. In planetCraft on
   2026-08-12 a launch question from 17:43 was answered at 22:09 with "keep the box quiet" while
   the same user had told the conductor in chat at 17:56 to prioritise three tracks; the two
   readings were both coherent and the conductor could only hand the contradiction back. Clearing
   the item at 17:56 would have prevented all of it. When a chat answer arrives, clear the item it
   answers in the same write.

   Two additions the plugin's code earns: `pending[]` is read by **more than the page** — by
   `orchestra ready` (its `WAITING:` line, which reports unanswered items older than thirty
   minutes, oldest first) and by `orchestra tick-gate` (an open item on any row keeps the heartbeat
   awake, whatever that row's status), so an item is load-bearing whether or not a page is open.
   And an item written with no `askedAt` is reported **with no age rather than dropped**, so an old
   row never silently disappears from the very report that exists to find the longest wait.

3. **When answers reach you — by the `orchestra-inbox` hook or by
   `orchestra inbox` — stamp `conductor.inboxSeen`** with the newest timestamp you were shown, in
   the same write that clears the answered `pending[]` items. Forget it and the same answers come
   back next tick — a repeated relay, never a lost one. The stamp is a single shared watermark, so
   it says only "somebody has read this far": never stamp past a batch you have not actually
   relayed to its worker.

   **But that cursor is SHARED and has no owner, so a forgotten stamp is the safe failure and a
   stolen one is the dangerous failure.** The hook only shows you answers newer than `inboxSeen`,
   whoever wrote it. If another session read the inbox first and stamped, your user's answers are
   consumed and you will never be told they existed. Measured 2026-08-12 in planetCraft: a second
   conductor stamped `20:10:33.311Z`, and FIVE answers — a design ruling, a failed hands-on check, a
   merge approval, a launch ruling and a question — were never delivered to the conductor the user
   was actually talking to. A worker sat fifty minutes on a verdict that had already arrived, and
   three others were launched against a "keep the box quiet" nobody had read. **So: whenever
   `inboxSeen` is ahead of the last value YOU wrote, do not trust the hook — read
   `.orchestra/inbox.jsonl` yourself and re-derive which of its lines answer items still in
   `pending[]`.** The file is append-only and cheap; the cursor is the only lossy part. The same
   applies the moment a user says anything like "I answered that on the page": open the file, do
   not argue with it.

   `orchestra inbox` re-shows an answer whose `pending[]` item is still open for four hours after
   it was written, whatever the cursor says — that grace narrows the dangerous window, but it does
   not cover a free remark, which targets no item at all: once the cursor is past it, nothing
   recovers it.

   **And stamp only once the action the answer AUTHORISES has completed** — not when you decide to
   take it, not when you announce it. For a merge approval that means after `orchestra await` has
   returned 0 — or, on the hand-off path (step 6 below), after `merge_agent`'s own report names the
   branch landed: you never run `await` yourself on that path, so its report is the completion
   event to wait on, not an `await` exit code you never saw. Measured 2026-08-13 in planetCraft:
   X2's merge was approved at 13:17:20, the cursor was stamped to exactly that instant, the
   hand-off was written in the journal — and it never
   happened, because the conductor's session ended before merge_agent existed. The approval was
   consumed and the action was lost; it surfaced four hours later only because a human asked what
   had become of it. That measurement is now the argument FOR waiting on `await`'s own exit code
   rather than a human report, not a promise about one: an unstamped answer costs you one repeated
   relay, and a stamped-but-unacted answer costs the user their decision, silently — the worse of
   the two failures.

## The framing pass, and the one interruption

The user's standing instruction, 2026-08-14 in planetCraft: **take the maximum of information at
framing, then decide alone — no more than one interruption per row during development.**

**At adoption, before any launch**, go through every row of the roadmap and produce its
**anticipated decision list**: each fork the row will plausibly hit, with your recommendation and
what each branch costs. All rows at once, one document, one sitting. Put them to the user together.
Write each answer onto its row as `decisions: [{q, answer, at}]`. **Those are binding and are never
re-asked** — a recorded answer that gets asked again is the failure this pass exists to prevent.

**Then one interruption per row, for the row's whole life**, and the measurements say what to spend
it on. In planetCraft, across one roadmap: thirteen merge approvals asked, thirteen granted, none
refused, zero defects caught. Three human looks at a page, three serious defects caught, every one
past a green suite. So:

- a row that ships **something a human looks at or uses** → its one interruption is the
  **hands-on gate**, unchanged;
- a row that ships nothing of the sort → **no interruption**: it lands once every configured gate
  is green (`gates`).

Everything else you decide yourself, from the recorded decisions, the roadmap and the project's own
rules, which reach a worker as `briefExtra`. **Every such decision is journalled as a `ruling`** —
the question, what you chose, why, and the precedent you leaned on:

```sh
orchestra journal ruling dev-loop/S3 "old cross-build curves: kept empty with their reason, per the framing answer on S3"
```

The rulings are visible in the checkpoint, in the journal, and on the page, whose rail carries a
`ruling` line like every other journalled line — so deciding alone stays visible to a later reader
and any of them can be broken.
**Exceeding the budget is not forbidden — it is recorded.** When you genuinely must ask a second
time, say in the same breath what framing failed to anticipate; that is the input that makes the
next framing pass better, and it is the only way this regime improves rather than drifts.

What this costs, stated plainly so nobody discovers it later: a wrong solo ruling now runs until the
next checkpoint instead of being stopped within the hour. The exposure is a fork framing did not
anticipate and no precedent covers — which is exactly what the `ruling` lines make visible.

## The machine's capacity — the budget owns it, and you do not

One conductor per project is the point of a portable plugin, so several of them run on the same
machine, and `orchestra ready` is the one command that speaks for yours. Every time you run it, it
writes `~/.orchestra/instances.json`: your project's live worker count — every row `claimed` or
`review` — for every other orchestra on this machine to budget against, and in the same pass it
reaps whatever died since the last write.

The cap it computes is `min(--width, maxWorkers − others)`, floored at zero: `maxWorkers` comes
from `~/.orchestra/machine.json` and defaults to 8, `--width` itself defaults to 8, and `others` is
what every other live project on this machine currently holds. The two lines a conductor reads,
verbatim:

```
in flight: 2/6 (width 8, held down to 6: 2 of 8 worker(s) belong to other project(s) on this machine)
HELD: 3 task(s) are ready and this machine has no slot for them — 8 of 8 are held elsewhere
```

**A conductor held to zero says so and does not launch anyway.**

The registry is **advisory, never authority** — the truth about a project stays inside that
project's own register and git. Its errors point one way on purpose: a conductor killed with `-9`
leaves its worker count behind until its entry is reaped, which under-budgets every other project
for a few minutes. Too few launches, never too many. An entry is reaped when its project's root no
longer exists, or when neither its conductor pid is alive nor it has reported itself within six
hours — the write stamp taken on every call, not the watch-loop beat. The beat is legitimately null
whenever no `watch-answers` loop is armed, and reaping on it instead would make an entry read as
dead the instant it was written, which would make every OTHER project over-launch.

**It budgets sessions, not CPU.** Four projects each running one full test suite is within budget
and can still saturate the machine. A project that needs that ordering configures the `queue` key —
run `orchestra doctor` to see its resolved value; unset, a command runs directly.

Four rules survive from the tool this replaces, because they generalise past any one project's own
fleet, and each is paid for by the same measurement: a conductor in planetCraft spent a morning,
2026-09-02, hand-managing load instead — reading `uptime`, telling workers to hold off benches,
promising "a quiet window" — and got it wrong three different ways in three hours. A landing was
refused on an innocent test at load 26; another died queued; a "quiet machine" was announced off
the **15-minute** load average while the 1-minute figure was 11.99 and a second test run had
started *after* the hold was issued.

- **Never read a load average to decide anything.** If you must know what is running, ask the
  budget: `orchestra ready` prints it.
- **Never promise a worker a quiet window.** You cannot deliver one: you do not control the other
  worktrees, the other developers, or the heartbeat.
- **Do not tell a worker to avoid heavy jobs.** It buys nothing and costs it the measurement it was
  launched to take. If the project has a `queue`, its own commands already route through it.
- **The one thing that is yours**: a worker reporting that its measurement could not get what it
  needed is a tooling finding — it goes to the user, or to a ticket (`orchestra tickets add`),
  never into a workaround. No amount of conductor vigilance substitutes for fixing it.

## The tick

0. **Before anything else — before the page, before the watch, before you record yourself — ask
   whether somebody is already conducting.** One command, and the heartbeat runs the same
   one:
   ```sh
   orchestra yield-check     # exit 10 = hand back; it has already journalled the line
   ```
   On exit 10, STOP. Nothing else in this tick happens.

   **The check itself is the beat, and step 1 explains it — this step is about WHEN.** Step 1 has
   you arm a watch and record yourself as a replacement, and both are writes a session that is not
   the conductor must not make: a second watch overwrites the live conductor's beat with its own,
   and recording yourself puts a session that is about to hand back into `conductor.session`.
   Asking after those two is asking too late, so it is asked here, off a file that costs a read and
   a signal-0.
1. **Rehydrate.**

   **The page.** `orchestra instances` prints one line for the whole machine — the page's URL, or
   why there is none — above a table of every orchestra registered here, in the order its row
   prints them: name, id, mode, worker count, a truncated conductor session id, how long since its
   last beat, how long since it reported itself, and its root. With `doctor`, `init` and `monitor`
   it is one of the four subcommands that answer without a project config, so it answers from
   anywhere. The page's port is stable across restarts: `4380` by default, overridable by
   `monitorPort` in `~/.orchestra/machine.json`, still probed upward until one is free, and the
   port **actually bound** — together with the pid that bound it — is what
   `~/.orchestra/monitor.json` records.

   ```sh
   orchestra instances                                          # the one page's URL, above the table — listening or not
   lsof -nP -iTCP:<the port in that URL> -sTCP:LISTEN           # the same question, asked directly
   nohup orchestra monitor --no-open >/dev/null 2>.orchestra/monitor.err &   # start it — read below first
   ```

   **`orchestra monitor` serves in the foreground and never returns** — the listening socket is
   what keeps that process alive — so start it detached, or the call that started it waits out its
   own timeout and takes the page down with it. Run `orchestra instances` again afterwards for the
   URL it bound. It is a machine command and runs from anywhere, not only from inside a project.
   `--no-open` is its only flag, and there is deliberately no `--port`: the port has exactly one
   source of truth, `monitorPort` in `~/.orchestra/machine.json`. Without `--no-open` it also opens
   a browser, which a headless tick must never do. Run anywhere while the page is already up, it
   prints that URL and exits 0 rather than binding a second one — one page for the whole machine,
   and the project you want is a tab on it, never a separate page.

   **stderr goes to a file under `.orchestra/`, never to `/dev/null`.** The page's own bind never
   refuses any more — a taken port is simply stepped over — but a runtime failure still only ever
   surfaces on stderr: a socket error on the bound server (`the monitor's socket reported an
   error: …`, `lib/monitor/server.mjs`) or a 500 line naming what an in-flight request hit. Sent to
   `/dev/null`, that line vanishes, and the only thing left to read is `orchestra instances`
   printing one of the page's states with no cause behind it. The file says why.

   Two rules were measured against the page in planetCraft, and both still hold. **Probe with
   `lsof`, never with `curl`** — measured 2026-08-12, `curl` from the conductor's shell could not
   reach a localhost server that `lsof` proved was listening and a browser was using, so the
   `curl` form hung forever and the `||` never fired. `orchestra instances` asks `lsof` for you and
   prints one of four states for the one page: a bare URL when it is listening; the same URL with
   `— recorded, but nothing is listening there` when the pid is dead or something else took the
   port; `(cannot tell whether it is listening)` when `lsof` could not answer at all, which is this
   machine saying it does not know and is not a no; or `no page is open — run orchestra monitor`
   before anything has ever bound. That last one is the state of a first run, so a conductor
   following this section meets it immediately, before ever starting the page below. **And a page
   that accepts the connection and never replies is not a wedged process** — restarting it changes
   nothing, because a fresh one does the same; it is blocked on something it fetches synchronously
   per request, and that was GitHub being unreachable, through the board read, for nine hours on
   2026-08-12. That measurement is now this plugin's own rule rather than a warning you have to
   remember: `readBoard` (in `lib/monitor/sources.mjs`) bounds its board read at 10 s, remembers a
   failure for 60 s, and keeps serving the last board that answered, said plainly as stale.

   **The page is never required.** Everything it shows it reads out of `state.json`, the journal,
   the inbox and git, and the whole tick runs with no page open at all.

   **Then arm the answer watch, once, before anything else in this tick.** It is what turns an
   answer's worst case from a whole heartbeat interval into seconds:
   ```
   Monitor(command: "orchestra watch-answers <your full session uuid>",
           persistent: true, description: "answers posted on the monitoring page")
   ```
   One two-second loop doing two jobs. It prints one line per answer the page takes, and that line
   reaches THIS session as an event whatever you are doing — including sitting idle between ticks,
   which is the one state nothing else can reach (`SendMessage` only queues, and your next turn
   otherwise comes when the user types). Measured 2026-08-13 in planetCraft: one second from the
   file changing to the event arriving. And it writes `.orchestra/conductor.beat.json`, which is
   the only evidence anywhere that a conductor is ALIVE — the loop lives exactly as long as this
   session, so a beat under a minute old whose pid answers signal 0 is a live conductor, where a
   register naming one is not. Both halves earn their keep now: the page writes the answers this
   loop announces, and the beat is what the lock and the heartbeat both read.
   Arm exactly one: a second watch on the same session announces everything twice. **A headless
   tick arms none** — the loop would die with the tick, and its beat would spend the next minute
   naming a conductor that is already gone.

   **Then arm the worker watch, beside it.** It is what reaches you in the one state step 3's
   obligations cannot otherwise reach: alive, holding the baton, sitting between two turns with
   the fleet stopped.
   ```
   Monitor(command: "orchestra watch-workers",
           persistent: true, description: "workers stopped on live rows, relays undelivered")
   ```
   Once a minute it computes exactly what `orchestra ready` prints as `IDLE:` and `UNDELIVERED:`
   (one definition, `lib/register/drive.mjs`), and prints one line when that set changes, and
   again every ten minutes while it stands — three minutes after a stop, never sooner, so a turn
   you are reading in a foreground `drive` is not announced back at you:
   ```
   OWED: 6 stopped worker(s) on live rows (f6, cg5, sc2, sc5 +2) · 2 undelivered relay(s) (DW1 180 min, DW4 160 min) — run `orchestra drive`
   ```
   **When that line reaches you, run `orchestra drive`.** Measured 2026-09-08 in duckJam: a
   conductor read the reports of an eleven-worker wave, spent its turn on other things and ended
   it; six sessions sat idle, four more had been stopped and never resumed, two relays sat
   undelivered from 06:52Z and 07:13Z, and `tick-gate` stood the heartbeat down for that
   conductor — correctly, it was alive and writing the register — until the user asked why nothing
   moved. This loop is the only thing that can wake that conductor, and it is that conductor's own,
   so it can never make a second one. It is a SECOND Monitor on purpose: the answer watch must stay
   a two-second file read with no child process in it, because its loop's liveness IS your beat,
   and this one's witness (`claude agents --json`) costs two seconds and may hang. A headless tick
   arms neither.

   Then `orchestra ready --json`. Read `claude agents --json` and `ListAgents`. If there is no
   state file, go to Adoption. If `state.json`'s `conductor.session` is not you, you are a
   replacement: record yourself, and SendMessage every live worker a new hello — "new conductor;
   reply to this address; resend any pending question". A question lost in the handover is
   re-collected by step 3's probe, not dropped.

   **Then take the lock, before anything else this tick does.** A headless tick and an interactive
   one take the identical lock, and that symmetry is the fix for a measured defect, not a
   formality: on 2026-08-12 in planetCraft, before the lock covered an interactive tick at all, a
   second tick ran beside the first three times, once double-running the landing on the same
   branch.
   ```sh
   orchestra lock acquire --kind conductor --session <your full session uuid>
   ```
   Exit 0 means it is yours; exit 1 prints who holds it, and you stop the tick there — journal one
   line and hand back. Release it in step 9, and only there: while you hold it, no headless tick
   will start. A holder that is provably gone is broken automatically — a dead pid for a tick, a
   stopped beat for a conductor — so a killed session cannot wedge the heartbeat. Arm the answer
   watch before you rely on this: your beat is what proves you are alive, and a conductor that
   holds the lock without beating is one the next tick will correctly break.

   **Then check that you are the only conductor anyway.** The lock stops two conductors from
   *starting* together; it cannot see one that began before it existed — six sessions took the
   baton from each other in half an hour on 2026-08-13 in planetCraft. `.orchestra/conductor.beat.json`
   is the one check that answers rather than hints, and step 0 has already made it — what follows
   is what that check means. A beat naming a session that is not you, stamped under a minute ago,
   whose pid is still alive, IS a live conductor: journal one line and hand back, whatever
   `conductor.session` says. There is nothing to weigh — the beat is written every two seconds by
   a loop that dies with the session it names, so a stale one is not a slow conductor, it is an
   absent one.

   **One exception, and it is the only one: a beat proves a session can be REACHED, never that it
   is conducting.** The loop is armed for the whole session, so a window left open and untouched
   beats for ever — measured 2026-08-17/18 in planetCraft: four consecutive heartbeat slots stood
   down for one while four finished workers sat uncollected about thirteen hours. `orchestra
   yield-check` therefore also reads how long the register has stood still and lets you act past
   ninety minutes of it. When it does, say so in your journal line and **ask the user to close
   that session**: its answer watch is still writing the beat and yours will be too, so the two
   loops take turns naming the conductor until one of them is closed. **The register is the
   opposite and always was**: it named a dead conductor for half an hour that morning while three
   answers rotted in it, so `conductor.session` naming somebody else is not evidence that anybody
   is there.

   When there is no beat at all, fall back to the tells: a row that reconciles to `claimed` on a
   ref you never created; a `git worktree list` entry you did not add; a `git branch -d` that
   refuses because a worktree you do not know holds the branch; an `inboxSeen` ahead of your own
   last write. When you find one, name the other session from `ListAgents` and SendMessage it to
   stand down — the user is in the session they typed `/orchestra` into, and that is the one that
   keeps the baton. Do NOT touch its worktree (never 3), and record what it built so the work is
   not lost. **The branch ref is the interlock that actually held**: a worktree and branch created
   by one conductor make the row read `claimed` to the other, which is why no task was ever
   launched twice.
2. **Apply corrections.** `orchestra ready` prints its corrections as `fix: <id>: <what changed>`
   lines; write the reconciled rows back to `.orchestra/state.json`. You are the only writer of
   this file; workers never touch it. This is a hand-edit, not a subcommand, so the guard from the
   top of this document applies here for real: the register carries the `root` it was created for,
   and a hand-written path after a `cd` into a worktree is how another project's register gets
   written — check `state.json`'s own `root` key before you save.
3. **Liveness — and the resume cycle, which is the ONLY thing that moves a worker.** A `--bg`
   worker stops at the end of each turn and sits `waiting`; it does not drive itself for hours, and
   **SendMessage does NOT wake it** — messages queue until the receiver's next turn, which never
   comes on its own. `claude -p --resume` refuses while the session is registered as a bg agent.
   The cycle — `claude stop`, then `claude -p --resume` in the worktree with a nudge, measured
   2026-08-10 in planetCraft — is one command now, and you run no other form of it:
   ```sh
   orchestra drive                    # every row ready prints as UNDELIVERED: or IDLE:
   orchestra drive <id> [<id>…]       # these rows, whatever they are waiting on
   ```
   `orchestra ready` names what you owe, first, above everything else it has to say:
   ```
   UNDELIVERED: dome/DW1 [claimed] — relay written 2026-09-08T06:52:00Z, 180 min ago
   IDLE: forge/F6 [claimed] — orchestra-fc69aa-f6 stopped 2026-09-08T09:55:02Z — last words: report: rebased, tests green, waiting for your look
   IDLE: media/SC2 [claimed] — orchestra-fc69aa-sc2 background session idle
   driving: arena/PV1 [claimed] — driven turn pid 40798
   owed: 3 worker turn(s) — orchestra drive
   ```
   **Both lines are obligations for this tick, not information. A tick may not end with either
   outstanding.** `IDLE:` is a row that is not terminal, has a session, is not waiting on the
   USER (no open `pending[]` item, not `review`), and has no turn running anywhere — not `busy`
   in `claude agents --json`, no `--resume` process in the table, no driven turn on record whose
   process is alive (`lib/register/liveness.mjs` reads all three). Measured 2026-09-08 in duckJam:
   ten such rows and two undelivered relays sat for hours while `ready` printed nothing about the
   ten and the conductor did not act on the two. A stopped worker is the ORDINARY state of a
   worker between two nudges, so the invariant reads the other way round: at the end of your tick,
   every live row is either running a turn, or waiting on the user, or landed.

   What `drive` does per row: unregisters the background session if it is still one, resumes the
   session in its worktree with the row's own `relay.text` verbatim at the head of the nudge (or
   the plain continue-nudge), **detached** — the turn survives your 600-second ceiling and the end
   of a headless tick, exactly as `orchestra land --detach` does — and waits up to `--for=540`,
   printing each report as its turn returns. Exit 12 means some are still running: run `drive`
   again, they went on without you; the outcome is on disk under `.orchestra/drive/<slug>.json`
   and `.out`, so the session that reads it need not be the one that started it.

   **Then read every report `drive` printed and decide per row**: a done-report → `review` (the
   hands-on gate) or hand it to `merge_agent`; a question → `pending[]`, and ask the user; still
   working → it is `IDLE:` again at your next `ready`, and `drive` again. A worker that keeps
   saying "done" while its row stays `claimed` costs a wasted turn per cycle — that is your undone
   status change showing, not a reason to stop driving.

   **The reply printed on that resume is the ONLY channel a worker has to reach you**, so treat the
   nudge as the question you want answered, not as a poke. Measured three times on 2026-08-12 in
   planetCraft: `SendMessage` from a worker session could not resolve the conductor's address —
   the hello it sent arrived, and the answer could not come back. A worker that finds this out
   mid-task prints its report where nobody reads it: one design question and one done-report were
   found only by reading the worker's transcript by hand. **So a turn that fails is a worker gone
   silent, not a worker idle** — `drive` records it (`the turn … is gone and recorded no exit`,
   or a non-zero exit with the log's tail), and the row is `IDLE:` again with those words on it.

   Conversation gone entirely (the turn's log says `No conversation found`) → relaunch (same
   `worktrees` directory, original brief plus "read what is already committed and dirty first",
   model re-evaluated — a done design relaunches on the execution model). To tell a dead-quiet
   worktree from a working one, mtimes — never 3's probe with its window shortened:
   `(cd <worktree> && git ls-files -co --exclude-standard -z | xargs -0 sh -c '/usr/bin/find "$@"
   -newermt "-20 minutes" -type f' sh | head -1)` (never 3's header says why it is spelled this
   way: the absolute `/usr/bin/find`, and git rather than a tree walk). That is a different question
   from never 3's 60-minute probe, which asks whether you may write into a worktree you did not
   launch — this probe only asks whether the worktree is alive.

   **A `review` row means the USER owes an answer. It does not mean the WORKER has nothing to
   do.** A row can be both, and dev-loop/S3 was, for eight hours and sixteen minutes on 2026-08-13
   in planetCraft: it sat in `review` while carrying an unfixed blocking defect, so every tick
   skipped it and the relay written that evening reached its worker at 04:35 the next morning.
   Seven consecutive ticks looked at that row and wrote "nothing moved, and that is normal". Never
   let a status that describes the USER's side of the exchange silence the WORKER's side.

   **THE EXIT CODE AND THE CLI'S STATE ARE BOTH NON-EVIDENCE. The filesystem is the only
   witness.** The same trap wore three faces in one day in planetCraft, 2026-08-25, and not one of
   them is visible in the thing you would naturally read:
   - `exit 0` with a short, plausible-looking output that executed NOTHING — the session ceiling
     was hit and the refusal ("You've hit your session limit · resets 1:50pm") reads like a thin
     report. RP6, RP7 and SK3, all three at once.
   - status `working` in `claude agents --json` for 2 h 40 with **zero files written and zero
     commits** — a turn eaten by that same ceiling leaves a session that declares itself busy. RP5
     and MA2.
   - `exit 144` with empty output — the Bash task killed outright. RP5 again, four hours later.

   So: **when a turn REPORTS work — a commit, an edit, a measurement — confirm it at the
   filesystem before you write it in the journal or act on it**, with the mtime probe above or
   `git -C <worktree> log --oneline -1`. `drive` names the first face for you — a turn whose output
   carries the refusal is printed `REFUSED (budget: …); this turn executed nothing`, and the row
   stays owed — but the other two it cannot: a turn that reports NO work is a turn that did not
   happen; drive it again, do not record it as a worker idling. The probe costs milliseconds; each
   of the three faces above cost between forty minutes and two hours forty.

   **TWO 600-SECOND CEILINGS, AND THEY ARE NOT THE SAME ONE.** Both were paid for on 2026-08-25 in
   planetCraft, and confusing them sends you to the wrong fix:
   - *the worker's own internal wait ceiling* — a worker that waits on something long (a long
     check, a bench, a served page) has its turn cut at 600 s while the thing it was waiting on
     survives, being a separate process. RP3 lost its turn this way with both its servers still up.
     Prefix its launch with `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` whenever the brief makes it
     wait; a driven turn inherits your environment, so export it before `drive` for the same rows.
   - *your own tool-call ceiling* — a `drive` you are watching is YOUR Bash call, and it is cut at
     600 s too, which is why the turns it started are detached and `--for` defaults to 540: the
     cut takes your wait, never the turn. Before this existed, MA4's worker was cut mid-turn at
     05:57 on 2026-08-26 — **a cut is a turn boundary, not a death**: the conversation is intact
     and the work is in the worktree, uncommitted (three dirty files, that time, and nothing lost).
     Every nudge `drive` sends therefore opens the continue part with "commit what is already in
     your tree first", so a cut never loses the same work twice.

   **Writing a relay and delivering it are two acts, and only the second one counts — and only
   `drive` can perform the second.** Put the text on the row as `relay: {text, writtenAt}` and
   nothing else: `deliveredAt` and `receipt` are written by the driven turn that carried the text,
   after it returned with exit 0 and no refusal, and a `deliveredAt` written by any other hand is
   not delivery — `orchestra ready` keeps printing `UNDELIVERED:` for a relay with no receipt, and
   `tick-gate` keeps the heartbeat up for it. Measured 2026-09-08 in duckJam: three relays were
   written onto rows, `deliveredAt` was stamped by hand, and the workers were resumed with a generic
   nudge; one came back asking, word for word, the question the user had already answered. A relay
   rewritten while its turn runs is a new relay nobody has delivered, and gets no receipt either.
   Terminal rows are excluded, and status is deliberately not part of the filter: a row can owe the
   user an answer and owe its worker a message at the same time, `review` included — dev-loop/S3
   sat in `review` for eight hours and sixteen minutes with a blocking defect written on it,
   2026-08-13 in planetCraft. A relay whose `writtenAt` will not parse is still reported, with no
   age rather than with `NaN`. `SendMessage` is NOT delivery — a `--bg` worker's queue drains on a
   turn that never comes.

   **Budget refusal is not death**: a turn that prints "You've hit your session limit · resets
   <time>" means every turn is refused until that time — `drive` prints it as `REFUSED`, writes
   no receipt, and the row stays owed. Leave the rows claimed, note the reset time in `state.json`
   (the key is `budgetResetAt`, and `orchestra tick-gate` stands the heartbeat down until it
   passes rather than spending a session on a refusal already certain), and let the next tick
   retry. Do not mark workers dead on it.
4. **Inbox — two sources, and you must go and get the second one.**
   ```sh
   orchestra inbox          # what the user answered on the page
   ```
   **Run it on every tick.** It prints nothing when there is nothing, and what it prints when
   there is, is a decision the user has already made and is waiting on. The
   `orchestra-inbox` hook injects the same text into an interactive conductor's
   session — but it is structurally blind to a session that has only just started: a fresh
   session's `SessionStart` and its one `UserPromptSubmit` both fire before it can record itself in
   `state.json`, so the gate is still reading the previous conductor's id. In planetCraft, where
   the page spawned a tick of its own from its reply button — this plugin's page deliberately
   spawns none — five answers reached nobody that way on 2026-08-12: G1 sat fifty minutes on a
   defect the user had already described, and three tasks launched half an hour after the user had
   said to keep the machine quiet. Here the fresh session that meets that same gate is the
   heartbeat tick. Whether the text arrives by hook or by this command, the obligation is the
   same one: relay verbatim, clear the `pending[]` item, journal an `answer`, stamp
   `conductor.inboxSeen` — the journal's third obligation is this same mechanic seen from the
   cursor's side.

   Then process worker messages. Classify both: *blocking* (the worker cannot continue) → relay
   to the user immediately in the Decision Template; *non-blocking* (ready to test, an approval,
   an FYI) → append to that row's `pending` in `state.json`.

   The page is the writer of `.orchestra/inbox.jsonl`, so this command now has something to print:
   the oldest answers nobody has taken yet, whether they answer a `pending[]` item or are a free
   remark. The hook adds a third path when it can fire, but a session's own first turn is exactly
   where it goes blind, so treat it as a bonus rather than a substitute — this command on every
   tick, and step 1's answer watch in between, remain the two paths guaranteed to reach you, and
   all four obligations above stand, the stamp included. An answer posted while nobody was beating
   started nothing and is simply sitting there; this read is what collects it.
5. **Checkpoint.** A checkpoint is the moment you stop trickling questions out one at a time and
   present every pending decision to the user together, grouped and ordered, each in its Decision
   Template — the act the journal and the framing pass both mean when they call a landing or a
   ruling "visible in the checkpoint". You reach one when: the user addresses you; pending count
   ≥ 3; or the ready set is empty while decisions pend. In a headless tick (`claude -p`), never
   present — instead, **if `orchestra ready` printed a `WAITING:` line, send ONE
   PushNotification**, ≤ 200 chars, naming the count, the oldest row and its ask:
   ```
   3 waiting · dev-loop/F1: integrate the fix queue? · http://127.0.0.1:4380
   ```
   **The page's URL goes on that line**, read off the one line `orchestra instances` prints above
   the table — the same across restarts, for every project on the machine — and the user opens it
   and picks this project's tab. It is where the user answers, and a notification that names a
   batch without saying where to answer it spends the interruption and saves nothing. **Whether or not
   any of them is blocking**, which was the old filter and was the wrong one: on 2026-08-12/14 in
   planetCraft the four asks that sat longest were all merge approvals, and a merge approval
   blocks nothing you are doing. One push per tick; do not resend for an item you have already
   pushed unless it crosses four hours.

   The reason this is worth a notification at all, measured across nine stamped answers on
   2026-08-12/14 in planetCraft: the user answered in **8 to 15 minutes** every time he knew
   something was waiting, and in **2 to 8 hours** every time he did not — and four asks that had
   waited between 2 h 19 and 8 h 07 were then all answered inside the same four minutes. He
   batches. Your job is to say there is a batch, not to wait for him to come and find one.
6. **Landings.** For every row the reconcile just moved to `landed`: tell the user at the next
   checkpoint, and continue — the launch step below picks up whatever the landing unblocked.

   **When the user approves a merge, this is the hand-off — and you still never merge BY HAND: that
   rule outlives its enforcement, and `guard-main-commit` is what holds it now — it refuses `git
   commit` and `git merge` on the main checkout's main branch alike, `--abort|--continue|--quit`
   exempted, unless `ORCHESTRA_GATE=1` marks the gate's own process.**

   ```sh
   orchestra land <branch> --detach     # returns at once, exit 15
   orchestra await <branch> --for=540   # exit 0 landed, 11 a gate refused, 12 run await again
   ```

   or hand the branch to the `merge_agent` agent — a different actor running the same two
   commands with the conflict judgement attached, and the one to hand off to on any other code
   too: 10 (conflict), 13 (a precondition failed), 16 (killed, no outcome recorded). **Never
   background either call.** One branch lands at a time behind a lock: landings are serialised,
   so a second one waits for the first and rebases onto the advanced main. The queue orders
   landings and decides nothing about them — whether a row needed the user's look at all is never
   the queue's question; `orchestra queue-list` shows what is queued or landing right now, for
   when one seems stuck. Then: journal the `landing` line, carry it in the checkpoint (never #1),
   and re-run step 1 — the launch step picks up whatever the landing unblocked.

   Record the branch's commit `subjects` in the row before it lands, even though the gate
   records them too: the gate writes them from the one process that knows both halves, and the
   conductor's own copy is what keeps the row readable if the gate's best-effort write fails.
   That is what makes landed detection work: `orchestra ready` matches an exact commit
   **subject** against `main`, never a hash, because a landing rebases.

   **A REFUSED GATE IS A CLAIM, NOT A VERDICT — and it comes in two flavours you must tell apart
   before you act.** On 2026-08-26 in planetCraft, MA4 was refused three times and only the
   first refusal was about MA4:
   - *a golden that moved* — never authorise a re-cut on an attribution you have not seen
     PROVEN, and prove it by ABLATION in both directions on the branch's own worktree: revert
     the suspect alone and re-hash, remove the real suspect alone and re-hash. The outcome that
     time: the named file was gated on a climate the test's seed did not have, and the true
     cause was elsewhere entirely. A re-cut taken on the plausible answer writes a false cause
     into a test that outlives everybody who reads this. The ablation costs one run; make the
     worker do it and make it paste both hashes. The gate itself is a project's own `gates`
     entry, so this rule applies to whatever gate a project configures.
   - *a single failure on a test the branch does not touch* — check three things before
     believing it: the branch touches neither the test nor its subject; the machine was
     over-subscribed while the suite ran; the test passes on re-run in isolation. All three held
     on MA4's second refusal — the branch was innocent and the gate was reading load. File the
     missing cushion as a finding rather than carrying the suspicion into the next branch:
     `orchestra tickets add`.

   **Drain the row's `postLanding` — the writes the BRANCH could not make.** The `ledgers`
   config lists tracked files the main branch owns, and the gate commits them at the head
   of every landing, so a branch that must change one writes the COMMAND down instead of running
   it. Carry them on the row as `postLanding: [{cmd, ranAt, error}]`, lifted from the worker's
   report, and run them in the MAIN checkout on the tick that sees the landing. On 2026-08-26 in
   planetCraft, MA4 landed and its two closures and its one new ticket were still unwritten when
   the run was reviewed and called green — nobody owned that other end. So this is
   **attempt-and-record, never a blocking obligation**, unlike an undelivered relay, and the
   difference is mechanical: the gate's own commit of `ledgers` files takes a lock now
   (`lib/gate/land.mjs`'s `commitLedgers`, over `lib/tickets/lock.mjs`'s queue lock — one target
   per distinct directory `cfg.ledgers` resolves into), but a `postLanding` command is neither
   that write nor under that lock: it runs later, by hand, in the same tick that saw the landing,
   and nothing wraps it in a lock or checks that it ran at all. So a tick forbidden to end with one
   outstanding would not deadlock against the landing that produced it; it would race an
   unserialised writer for nothing, which is reason enough on its own. Record the error on the row;
   the next tick retries.

   **A landing whose Acceptance was a MEASUREMENT owes one page under `docs.results`.** Of the
   fifteen council lines landed 2026-08-24/26 in planetCraft, fourteen wrote a spec, a plan and
   an evidence directory, and exactly one wrote a results page — and nothing looks in an
   evidence directory. The page may be five lines: the acceptance question, the number it came
   back with, and a pointer to the evidence. **Discoverability is the whole deliverable, not the
   prose**: `docs.results` is the directory `orchestra doctor` prints, and reading it is the
   first thing anyone does before opening new work.
7. **Sync the shared channel.**
   ```sh
   orchestra roadmap enrol   # rows the register lacks; silent when there are none
   ```
   `enrol` is first and costs nothing when there is nothing to do. It exists for the tasks
   `publish` cannot enrol — another developer's roadmap never passes through this machine's
   publish at all — and a task with no register row is one nothing here will ever schedule or
   even count. It never touches an existing row, only adds to it — `if (!task.key ||
   known.has(task.key)) continue;` (`lib/roadmap/enrol.mjs`) — so a task the register already
   knows about is left exactly as this machine last wrote it.

   `orchestra roadmap sync` exists. It closes what the register proves landed, moves every
   `status:` label onto what the board derives, ticks each programme's checklist, and closes a
   finished programme — which drops it from the shared channel's open-issue view, not from
   `orchestra roadmap board`: that command's own listing keeps every closed task forever, by
   design (`state: 'all'`). It is idempotent:
   a tick that changed nothing writes nothing. **It is the BACKSTOP, not the primary writer**: the
   merge gate runs the same command after every fast-forward, online only. Offline it does
   nothing, and that is correct (spec §4.1) — there is nowhere to write a status.

   Keep the stale-board rule as a rule of this step: **if `orchestra roadmap board` reports
   itself stale, launch nothing this tick and end here** — a cached board cannot say whether
   another developer has taken a task, and starting anyway overwrites their claim. Say so in the
   journal. Offline, a board is never served from cache, so this rule is online's.
   **`guard-claim` holds the same line at the point that matters more, when it can fire.** It
   fails closed on a cached board deliberately, rather than let an out-of-date read authorise the
   `git worktree add -b <branch>` that starts a task — the gesture which starts the work is the
   gesture the guard checks. But no store in this plugin caches a board today: `orchestra roadmap
   board --json` either reaches its backend or fails outright, so `board.stale` is always absent
   and this branch is wired but unreached (`hooks/guard-claim.mjs`'s own header says so, and it
   stays rather than being dropped — `startVerdict`'s `stale` reason is already written and
   tested, and a hook that dropped the field would have to be edited again the day a cache
   lands). **This step's own reasoning is still what you are relying on, not an alarm**: the
   guard cannot yet catch a stale read for you.
8. **Launch, and the names.** Launch each row `orchestra ready` places in `launches` — already
   width-capped by "The machine's capacity" above. **Claim first, always**, for your own
   roadmaps too, now that every roadmap is published:
   ```sh
   orchestra roadmap claim <key>
   ```
   Online the claim is what turns the issue `status:wip` for everyone else watching; offline it
   is the register row and the branch ref. If it reports a loss — `lib/cli/roadmap.mjs`'s
   `claim` case throws `claim lost: <key> is held by <holder>` when the store refuses — drop the
   row from this batch and record who holds it. The `guard-claim` hook is the backstop,
   not the mechanism.
   ```sh
   git worktree add <worktrees>/<slug> -b <branch> <the project's main branch>
   claude --bg -n orchestra-<project id>-<task slug> --model <model> --dangerously-skip-permissions "<brief>"
   ```
   `<worktrees>` is the `worktrees` config (`orchestra doctor`'s own row; default
   `.orchestra/worktrees`). **Do not run a dependency install here.** The source project's launch
   did; a portable protocol cannot know whether a fresh worktree needs one, so if the project
   needs a per-worktree bootstrap the worker's brief says so — that is one of the things
   `briefExtra` is for.

   **The session name is `orchestra-<project id>-<task slug>`, and it is not optional** (spec
   §8.4). Four parts, and each is load-bearing:
   - `<project id>` is the `id` row of `orchestra doctor` — six hex of sha256 over the main
     checkout's absolute path (`lib/paths.mjs`'s `projectId`), so two checkouts of one repository
     and two projects that happen to share a directory name do not collide.
   - `<task slug>` is the register row's own id, lowercased, with every run of non-alphanumeric
     characters replaced by a single dash. Worked example: project `a3f19c`, row `lod/C2` →
     `orchestra-a3f19c-lod-c2`.
   - **Without a name, the session is named from the whole prompt**, which exceeds
     SendMessage's 200-character address limit and makes the worker unaddressable by name —
     measured in planetCraft: the first batch had to be relaunched for it. The name above stays
     far inside that limit.
   - **Without the project id**, `orchestra-<task id>` alone collides the moment two projects
     have a task called `S3`, and the symptom is bad: `SendMessage` addresses by name, and
     `claude agents --json` is matched by name and cwd, so two sessions can answer to the same
     name at once.

   And two rules that already held for a single project are now load-bearing for isolation as
   well (spec §8.4): a worker is matched by **cwd equal to its worktree path**, and the
   worktrees directory is **per project** — `<worktrees>` above, never one shared across
   projects.

   Journal the launch with the session name you gave it, alongside the task, its branch and its
   model (see The journal): a name that does not match the session in `claude agents --json` is
   then visible on the next tick, not silently wrong.

   `--bg` with skipped permissions requires the user to have accepted the disclaimer once,
   interactively. If launches fail with a disclaimer error, that one-time step is the fix, and it
   is the user's to run.

   Then find the new session in `claude agents --json` (match cwd = the worktree path), record
   the **full session UUID** — the resume cycle needs it, a short id is not enough — plus
   `sessionName`, `model` and status `claimed` in `state.json`, and SendMessage it a hello: "I am
   your conductor — reply to this address with questions and reports." The hello drains at the
   worker's next turn, not instantly. **Say in the same hello that replying does not work** and
   that its report must be its FINAL MESSAGE: telling a worker to reply to an address that
   cannot resolve is telling it to wait for ever.

   **`cd` PERSISTS BETWEEN Bash CALLS.** Keep the measurement — a `state.json` write straight
   after a launch went to the worktree and failed with `ENOENT` on 2026-08-12 in planetCraft,
   and the same shape has silently written files into the wrong tree since — and the
   instruction: after any launch, `cd` back to the main checkout or use absolute paths. The one
   thing that is different here: every subcommand resolves runtime state to the main checkout
   itself, so this hazard is now confined to the files you write by hand — `state.json` above
   all.

   Keep the two launch-plan rules the tool does not make: never launch two rows of the same
   serial `Lane` together; and **files are not a reason to wait** — two rows editing the same
   file run side by side and the conflict is resolved at the merge, which changed on 2026-09-01
   in planetCraft because the declared `Touches` never predicted what a task actually edited and
   the collisions happened anyway. `Touches` is documentation for the reader and for the landing
   now; it schedules nothing, and `orchestra ready` no longer reads it.

   Keep **take your own roadmaps first**: `planLaunches` fills every slot from rows whose `mine`
   is not false before it takes a row from a roadmap another developer opened to everyone — they
   offered spare capacity, not priority.

   Add the one line from the budget above: the plan is already capped by the machine's capacity,
   so a `HELD:` line means launch nothing and say so.
9. **Drive, release, write, stop.**
   ```sh
   orchestra ready                    # no UNDELIVERED: and no IDLE: line, or you are not done
   orchestra lock release --kind conductor --session <your full session uuid>
   ```
   **A tick may not end with a worker stopped on a live row.** Run `orchestra ready` once more
   before you release: every row must be `driving:`, waiting on the user, or terminal. If it
   prints `owed:`, run `orchestra drive` and read what comes back — the launches of step 8 are
   background sessions that end their first turn on their own, and that first stop is yours to
   drive too.

   Release it even though your session lives on: the lock covers the TICK, and your beat covers
   the gaps between ticks — a headless tick stands down for a live beat on its own, so holding
   the lock across your idle time would block the heartbeat for nothing. The release is
   identity-checked (`lib/register/lock.mjs`), so if you were already broken for being stale it
   leaves your successor's lock alone. Measured 2026-09-08 in duckJam: a conductor that skipped
   this release held the lock from 07:12Z, and three consecutive heartbeat slots were refused
   `held by conductor` before the gate was ever consulted.

   **Write the register even on a tick that changed nothing.** Its write time is the only mark
   that separates a conductor which is conducting from a session which is merely open
   (`lib/register/beat.mjs`'s `conductorState`, read off the register file's own mtime), and a
   tick that skips the write reads as ninety minutes of silence at the next heartbeat slot.

   Stopping is no longer going deaf. Four things wake you: the answer watch armed in step 1 hands
   you each new answer within seconds — the page writes them and that loop is what turns one into
   an event here, whatever you are doing; the worker watch armed beside it says `OWED:` within
   three minutes of a worker stopping on a live row or a relay being written and not delivered,
   and says it again every ten minutes until you `drive` — the wake the 2026-09-08 conductor in
   duckJam never got, sitting alive between two turns over a stopped fleet; a landing dispatched
   to `merge_agent` wakes you as its turn ends, and a landing you run yourself needs no wake at
   all, since `await` blocks in bounded chunks inside your own turn and re-running it is always
   correct; and, where `orchestra install-heartbeat` has been run for this project, the heartbeat
   guarantees a tick every hour whatever happens to you, standing down while you are alive so it
   cannot become a second conductor beside you. Where it has not, nothing but your own two watches
   wakes you, and a session closed on an unfinished roadmap is what going quiet looks like.

## Adoption (first run, or state lost)

**A roadmap published after adoption enrols itself — do NOT hand-copy its rows.** `orchestra
roadmap publish` writes a register row for every task it publishes, and `orchestra roadmap enrol`
is the catch-up for what publish cannot reach: a roadmap published from another developer's
machine, and anything published before adoption existed. `board` names that command on the orphan
line itself. This section is what runs when there is NO table at all; it is not the way a new
roadmap gets in, and treating it as such is what left 22 tasks out on 2026-08-19, 15 on 08-25 and
28 on 09-02 in planetCraft, each caught by a human reading the board.

Read-only. Build the task table from `orchestra roadmap board --json`, which returns one row per
task with `key`, `order`, `deps`, `touches`, `lane`, `branch`, `design`, derived `status` and
`issue`. **The board emits both `key` and already-resolved `deps`** — a task's own `Deps` field
may name a bare sibling id or a `<roadmap>/<ID>` cross-file one, and `reconcile()`
(`lib/roadmap/board.mjs`) resolves either into a qualified key before it ever leaves the board. So
**a register row's `id` IS the board row's `key`, and a register row's `deps` IS the board row's
`deps`, byte-for-byte** — a register row is a direct copy, nothing to resolve on the way in. **A
register row's `roadmap` is the slug in both modes, never a file path — the path form is what
forced that very rule in planetCraft, and it left the field pointing at a draft `publish` had
already deleted; the slug is what both stores already key on.**

`orchestra ready` (`lib/register/ready.mjs`'s `computeReadySet`) trusts this and does no
resolution of its own: it matches `deps` against `id` byte-for-byte, and throws — naming the
offender — rather than schedule anything if a row's `id` or any of its `deps` is not already
qualified. Getting this wrong once already emptied the ready set silently, in planetCraft:
qualifying `id` without qualifying `deps` to match made every dependency look unmet, even a landed
one, with no error anywhere.

Inventory in-flight branches, worktrees and live sessions WITHOUT writing to any of them. Then
present to the user: the table, who holds what, and the launch plan — and launch nothing until
they approve it. Record their approval in `state.json` (`adopted: true`); ticks are autonomous
from then on.

## Preflight (once per machine, before the first launch)

Prove the three mechanisms the whole protocol rests on, on one throwaway session, BEFORE planning
any launch:

```sh
claude --bg -n orchestra-preflight --model haiku --dangerously-skip-permissions "reply OK and stop"
claude agents --json | grep orchestra-preflight
claude stop orchestra-preflight
```

If any of them is refused, put **one** question to the user carrying the exact command and the
exact refusal, and stop the tick. Do not discover this one launch at a time, and **do not try to
grant it to yourself** — editing `settings.json` to widen your own permissions is a hard boundary
and will be refused too. Measured 2026-08-12 in planetCraft: three consecutive ticks were spent
finding this out one refusal at a time (the launch flag refused, then the settings edit refused,
then the allow-rule the user added turning out not to cover the flag), and the user ended up
typing four launch commands into a terminal himself. Two hours forty-four minutes, before a single
worker existed.

**Retry a failed launch once, identically, before calling it a failure.** In planetCraft,
`claude: command not found` appeared twice in a row from a shell whose `PATH` was correct, and an
identical retry succeeded seconds later.

## The decision template

**Before you put ANY question mid-development, three checks.** Was it already answered at framing —
`decisions[]` on the row (see The framing pass, and the one interruption)? Can you answer it
yourself from a recorded decision, the project's own rules (which reach a worker as `briefExtra`),
or a precedent already set on another row? Has this row already spent its one interruption? If any
of those lands, **rule and journal it instead of asking** (`kind: ruling`). The two most expensive
questions of the 2026-08-12/14 roadmap, in planetCraft, were both of this kind: releasing a file
hold owned by a branch abandoned two weeks earlier, which no rule ever created, waited 8 h 07; and
taking over four worktrees whose sessions were provably dead waited two hours forty-four before the
answer came back "yes, all four" in six minutes.

Every question is written once and lands in two places: the message you put in chat, and the `ask`
of its `pending[]` item. **The `ask` carries that whole body, word for word — never a summary of
it.** The page prints `ask` and nothing else, so a body squeezed into one line there is the
question asked with the half that made it answerable taken out. Measured 2026-09-08 in duckJam,
where every ask was one dense sentence: of the twelve answers given from the page that day, two
were not answers at all — "Ta question n'a aucun sens, je ne comprends rien" and "pourquoi tu as
besoin de 2 personnes ?" — each costing a full round trip before the question could even be
understood, and one of the two had to be asked twice.

**Write it for someone who has never seen the code AND does not know the project's vocabulary.**
The first half of that is the easy half: no path, no function name, no identifier, no millisecond.
The second half is the one that fails. Every word a worker uses for a thing — the name of a model,
a mode, a stage, a score, a policy — is a word learnt inside the code, and on the page it means
nothing. Three tests, and a body failing any of them is rewritten before it is sent:

- **what you name is something the user can see or do**, never what the code calls it;
- **every number says what it counts and what would be good** — "scores 0.312 where the other
  scores 4.580" is two numbers and no question, "falls over on 31 tries out of 32" is a fact
  anyone can judge. A number that will not speak that way belongs in the footer;
- **the question itself is one sentence, ends in a question mark, and reads on its own.** If the
  user has to reconstruct what is being asked from the paragraph above it, it is not a question
  yet.

**And relaying is rewriting, never quoting.** A worker's sentence was written by the one person who
has been reading that code all day; passed through untouched, it carries their vocabulary straight
onto the page. That is where nearly every unreadable ask comes from.

That same duckJam question, before and after — the failure is not the length, it is that every
noun in it was learnt in the code:

> written: "Round 04: the published walker falls 31 times out of 32 and scores 0.312, where the
> recovery policy scores 4.580. The round is passable, but by a tool other than the season's. Is
> that the intended shape?"
> asked: "Nobody can finish round 04: the character players download falls over on 31 of its 32
> tries. A different character, one that is not part of the season, does finish it. Do we keep
> round 04 as it is, or make it beatable by the season's own character?"

The body carries no markdown — the page prints it verbatim, so `**` shows as two asterisks — and
its labels are plain words in the user's language. The bracket header is the chat message's alone:
the card already names the row, its kind and its port.

> [<ID> — <title> · `<branch>` · session `<name>` · server :<port>]  ← the chat message only
> Where it stands: <one sentence, about the thing itself, in plain language>
> The question: <one sentence, ending in a question mark>
> Why it is yours to decide: <what makes the choice real: what each option costs, which rules or
> earlier answers apply, what is waiting behind it>
> Options: A) … · B) … · C) …
> <sub>Technical: <the numbers, names and paths, for when the user wants them>
> Pictures: <repo-relative path(s) to any screenshot the question is about></sub>

The trailing `server :<port>` is present only on a row that actually serves something. A CLI, a
library or a firmware image drops it, and the one command that shows the change goes in the body
instead — see The hands-on gate.

Relay the user's answer back to the worker verbatim, plus whatever context the worker needs.

### A question about a picture must carry the picture

You have no way to show the user an image and they have no way to open one you only describe, so a
question like "which of these two arms reads better?" is unanswerable unless the file itself is on
screen. **Name every screenshot the question is about by its repo-relative path, in the `<sub>`
footer** — `.orchestra/images/c1-altitude-branch.png`, `.orchestra/images/s1-dossier-home.png`. The
page reads those paths out of the ask, resolves them against the checkout, the worker's worktree
and `.orchestra/images/`, and draws each one as a thumbnail beside the question, one click from
full size. Nothing else is required of you: there is no field to fill and no upload.
`.orchestra/images/` is also the one directory `orchestra archive-images` sweeps.

The footer is where they belong precisely because the body stays free of paths — a path in the body
would break the plain-language rule above, and a path in the footer breaks nothing.

The same reading applies to a `note` and to a journal line, so a capture worth keeping is worth
naming in either. Ask a worker that reports a measurement from a frame to write the frame's path
where it says what it measured; a note that says "it looks wrong now" with no path is a claim the
user cannot check.

## The hands-on gate

When a worker reports built, first ask what the row actually ships. **If it ships nothing a human
looks at or uses, there is no gate**: it lands once every configured gate is green (`gates`), the
`landing` line goes in the journal, and the checkpoint carries it (never #1). Seven of the sixteen
rows of the dev-loop roadmap, in planetCraft, shipped nothing of the sort, and every one of their
approvals was granted unread.

Otherwise: tell the worker to put the thing in front of the user — **with the project's own
command; the worker knows it and you do not need to** — and to report exactly how it is reached.
Two shapes, and the row is one or the other: a project that SERVES something reports the port it
actually bound plus its pid; a CLI, a library, a firmware image or a data pipeline reports the one
command that shows the change, to be run from the worktree. Set the row to `review`, and add a
`pending[]` item — `kind: "hands-on"` — carrying whichever it is: a port goes on the
item's own `port` field, which the card prints beside the kind, and into the chat message's header;
a command goes in the ask itself, where the user can copy it.
**The user's validation IS the approval** — do not then ask a second time for the merge; that
second question is the one this roadmap paid for thirteen times over, in planetCraft (see The
framing pass, and the one interruption). What follows validation is step 6's business (see The
tick): record the branch's commit `subjects` in the row BEFORE the hand-off — that is what makes
landed detection work. The hand-off is the two commands above, and a landing deletes the worktree
and the ref.

**Never hand out a URL you have not fetched AND READ**, and never a command you have not run.
For a URL, not `curl` — it cannot reach a localhost server this shell can see listening. Fetch it
and look at the body (`node` here is the PLUGIN's own runtime, always present wherever `orchestra`
runs, and says nothing about what the project is written in):

```sh
node -e 'fetch(process.argv[1],{signal:AbortSignal.timeout(4000)}).then(r=>r.text())
  .then(t=>console.log(t.replace(/\s+/g," ").slice(0,200))).catch(e=>console.log("FAILED",e.message))' <url>
```

The status code is worthless here: in planetCraft the dev server answers 200 with the
application's own entry page for any path at all, so a wrong path looks healthy from every angle
except the one that matters. Measured 2026-08-13 in planetCraft: an ask sent the user to the wrong
path, nothing flagged it, and he lost a whole test run to it. **Any dev server with a catch-all
route does this**, so reading the first 200 characters is the entire check.

**And when a worktree is deleted, kill whatever server it started and close any page open on it,
explicitly.** A server whose directory has been removed keeps serving — which reads as a live page
showing stale code, and is indistinguishable from a working one until someone trusts it. Servers
are killed **by pid**, never by pattern.

**Three rules `{branchTests}` — the subset gate — cannot enforce for you**, all paid for on
2026-08-14 in planetCraft:

- a branch that is a **new consumer** of a module another in-flight row has just rewritten needs
  the full suite. A dead-code sweep on the main branch removed an export that a branch in flight
  had just started importing; different lines, so git merged both sides happily and produced a
  runtime `TypeError`. Neither the diff nor the dead-code gate could see it — the gate was right on
  main and the branch was right on itself;
- **land an unused-export sweep LAST**, after everything in flight against the same modules;
- a `branchTests` command that selects by import graph can select exactly ONE file for a tool
  nothing imports but its own test. When the subset looks suspiciously small, **say the number out
  loud** and run the full suite instead of trusting it.

### The dev-server sweep

**And sweep for the ones you did not start, once per tick** — killing your own on deletion is not
enough, because the server that hurts is the one nobody remembers launching. A dev server in the
MAIN checkout takes the ticket ledger's queue lock and writes its tickets into main's ledger, which
is what refused a landing on 2026-08-25 in planetCraft: one orphan was found and killed that
afternoon, its worktree deleted that morning, and another was still listening forty hours later,
from the main checkout, when the run was reviewed.

**Run it from the main checkout**, and a second time from `worktrees` if the project puts its
worktrees outside it: a listener is selected by its WORKING DIRECTORY, not by its process name.
The source project matched `node` alone, which is a statement about one toolchain — a Rust, Python
or Go dev server holding a port out of a deleted worktree does exactly the same damage and would
never have appeared. Everything listening from outside this project's trees is somebody else's and
is not printed at all, which is what keeps the machine's own daemons out of the output.

```sh
lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $2"\t"$9}' | sort -u |
while IFS=$'\t' read -r pid addr; do
  case "$(ps -o command= -p "$pid" 2>/dev/null)" in *orchestra*monitor*) continue;; esac
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | grep '^n' | head -1 | cut -c2-)
  case "$cwd" in
    "$PWD")   v="MAIN CHECKOUT -> ask, never kill";;
    "$PWD"/*) [ -d "$cwd" ] && v="WORKTREE -> leave" || v="ORPHAN -> kill";;
    *)        continue;;
  esac
  echo "pid=$pid port=${addr##*:} age=$(ps -o etime= -p $pid|tr -d ' ')  $v"
done
```

Three details, each one a wrong answer the first drafts gave: **skip your own page** — this
plugin's own monitoring page runs from the main checkout and, in planetCraft, had been up eight
days, so without that `case` the sweep reports the conductor's own instrument as a suspect every
hour, and `orchestra instances` is the second way to recognise it, by the port its row for this
project names; `$NF` is `(LISTEN)`, the address is `$9`; and `lsof -Fn` answers `p<pid>`/`f<fd>`/
`n<path>`, so take the first `n` line, not the second line.

**ORPHAN is the only verdict that kills.** A server in the main checkout may be the USER's, so it
becomes a question — a note nobody reads is how one survived forty hours.

## Design→execution handoff (design tasks)

A row whose `design` field is true — the roadmap's own `**Design** yes`, set by
`lib/roadmap/parse.mjs` — launches on the design model, with the Design brief below: its only
deliverable is the committed spec (`docs.specs`) and plan (`docs.plans`) on its own branch. It must
not write implementation code, and its session ends there.

When it reports done: **adopt the plan's own recommended approach — do NOT ask the user.** This is
the one bounded exception to never #2: a stated recommendation is acted on, not relayed to the user
as a question. If the design genuinely ends in a fork with no recommendation, THAT is a blocking
question. Then launch a fresh execution-model session on the SAME worktree, with the brief "read
the committed spec and plan, execute the plan," and update `model` on the row. Do not kill
anything first: a completed background session costs nothing.

**Where the two models come from.** The launch plan (`planLaunches`, `lib/register/ready.mjs`)
sets each launched row's `model` from that same `design` field — the design model when it is true,
the execution model otherwise — and the tick prints the choice in its launch line
(`lib/cli/tick.mjs`):
```
launch: <id> — <title> [fable] on <branch>
```
for a design row, `[opus]` for any other. So the choice is the roadmap's, made when the task was
written — not a judgment call the conductor makes at launch time.

## Worker briefs

Every launch and every hand-over below fills a brief from the same ten substitutions, plus — for a
relaunch or a hand-over only — `<the project's main branch>` (`orchestra doctor`'s `mainBranch` row)
and `<n>`, the turn count. One table, read once:

| Placeholder | Filled from |
|---|---|
| `{branch}` | the row's `branch` |
| `{task}` | the row's qualified key, `<roadmap>/<ID>` |
| `{title}` | the row's title |
| `{excerpt}` | the task's own section, verbatim: offline from the file under `roadmaps.published`, online from the issue body |
| `{language}` | `orchestra doctor`'s `language` row |
| `{branchTests}` | `orchestra doctor`'s `branchTests` row. **When it prints `—`, the project has configured none**: the Hard rules clause "run {branchTests} on every iteration, never the project's full suite" becomes "run the project's own tests for what you changed, and say which" |
| `{specsDir}` | `orchestra doctor`'s `docs.specs` row |
| `{plansDir}` | `orchestra doctor`'s `docs.plans` row |
| `{briefExtra}` | `orchestra doctor`'s `briefExtra` row, pasted verbatim. Empty means the paragraph is omitted entirely |
| `{projectRules}` | the contents of `.orchestra/CLAUDE-rules.md` when that file exists (offline mode — `init` writes it there instead of into the committed `CLAUDE.md`), pasted verbatim. Absent means the paragraph is omitted entirely: online, the same rules are already in the project's `CLAUDE.md`, which every session reads |

`{briefExtra}` is the replacement for the source brief's appeals to one project's own subject map:
it is where a project states the rules a prompt cannot derive on its own — where its code lives,
what a worker must never touch, whether a fresh worktree needs a bootstrap step (step 8, above,
already runs no dependency install, for exactly that reason).

Fill the ten placeholders and pass the result as the `claude --bg` prompt — step 8, above, gives
the rest of the launch line. Execution brief (the execution model):

```
You are a dev agent working ONLY in this worktree, on branch {branch}.
Task {task} — {title}. Your roadmap excerpt, verbatim:
{excerpt}
Hard rules: never work on the main branch; run {branchTests} on every iteration, never the project's
full suite; everything you commit is English.
{projectRules}
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
on that resume. Design question → state it and stop until answered. Built → say so; put it in
front of me only when told, with the project's own command, and report exactly how it is reached —
the port you ACTUALLY bound plus its pid if you started a server, otherwise the one command that
shows the change (servers are killed by pid here, never by pattern). You never merge, and whether
your branch needs a human look first is your conductor's call, not yours.
```

Design brief (the design model): the same header and rules as above, then:

```
This task's design is open. Use superpowers:brainstorming, then superpowers:writing-plans. Your
deliverable is the committed spec ({specsDir}) and plan ({plansDir}) on this branch, with a
recommended approach stated. Do not write implementation code. State your done-report as your final
message (see the protocol above — messaging the conductor does not work); your session ends there.
```

Relaunch brief (dead session, intact worktree): the original brief — execution or design, whichever
the row was launched with — prefixed with:

```
A previous session worked this task and died. Its worktree is intact. Before anything else: read
git log <the project's main branch>..{branch} and git status in this worktree, and continue from
what exists — do not restart the task from scratch.
```

Handover brief (the previous session was ALIVE and retired on purpose — see below): the original
brief, prefixed with:

```
A previous session took this task to <n> turns and was retired to drop its accumulated context. It
committed its work and wrote where it had got to. Before anything else: read
git log <the project's main branch>..{branch}, git status in this worktree, and the `note` on your
row. Continue from there — do not restart, and do not re-read files the note tells you are already
done.
```

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
the Handover brief above — **never `--resume`**, which keeps precisely the context this is trying
to drop. Journal it as a `note` with the turn count, so a later measurement can judge what the
hand-over actually cost. Keep both limits: do not do this to more than one row until that number
exists, and never to a row in the middle of a hands-on gate.

## The stand-down tick

**It is a heartbeat's own end-of-run duty.** The three commands below all ship —
`orchestra tick-gate`, `orchestra archive` and `orchestra archive-images` — and the loop that calls
the first of them hourly is `orchestra install-heartbeat`'s own `templates/tick.sh`. So this
section is not a description of a timer; it is what a conductor's own last tick on a roadmap does
before it goes quiet, whether that tick is fired by a person or by the loop itself.

`orchestra tick-gate` answers in **one line whose first word is the verb**:

```sh
orchestra tick-gate
```

```
skip a conductor is live (<session>, pid N)
skip no register — orchestra has not been adopted here
skip budget resets <ts>
skip nothing to do — 87 row(s), all landed or dropped
run hold-awake
run — took the baton back from <session> (pid N), beating but silent for 97 min
```

A line rather than JSON, because its consumer is `/bin/sh` and a shell that has to parse JSON is a
shell that will one day parse it wrong. **The exit code is deliberately NOT the channel** — a gate
that cannot answer must not be able to stop the heartbeat, and a `set -e` in some future caller
would turn a non-zero exit into exactly that. The shell reads the first word of the line and
nothing else.

**Order matters, and the conductor rule runs first.** The cost of a second conductor is corruption
— two writers on one register — while the cost of a late tick is only lateness. It stands down for
a conductor that is live **and conducting**, never merely live: the beat proves only that a session
can be REACHED, and a window left open and untouched has already silenced the heartbeat for good
once, not merely in theory — step 1 carries the measurement.

`absent` and `unreadable` are told apart **by errno**, not guessed: the register is rewritten in
place, so a failed read is most likely a mid-write and the tick runs; an absent register is a
machine where nobody has ever typed `/orchestra`, and firing a session at it hourly buys nothing.

Four things override the stand-down, each a way orchestra could otherwise go permanently deaf: an
unconsumed answer in the inbox — **the one that matters most**, and more so here than in the
project this was extracted from, whose page spawned a tick from its own reply button: this page
starts nothing, so an answer typed while nobody is beating waits for a tick, and a gate that
ignored the inbox would stand that tick down and swallow, in silence, the answer the user had just
typed; a `pending[]` item on any row, whatever that row's status; an
undelivered relay; and any row not yet terminal — this last one is what prints `hold-awake`.

**It holds the machine awake while work is in flight.** `hold-awake` is the word the gate's line
carries whenever a row is still non-terminal; the shell that turns that word into a wake lock is
`templates/tick.sh`'s own `caffeinate` step, not this command's — `tick-gate` only prints the word.
Keep the reason it exists: eight heartbeat slots of 1 h 23 to 3 h 26 were lost to sleep in one
46-hour roadmap in planetCraft, about six hours of it, one of them killing a worker mid-turn.

**It stands down when there is nothing to do, and every decision is logged**, so a heartbeat that
went quiet always says why — the four `skip` lines above are the whole of it. An unused heartbeat
costs nothing on purpose: once a roadmap finishes, an hourly session that reads sixteen landed rows
and exits is real budget for no work — the account ceiling was hit twice during the roadmap this
measurement came from, in planetCraft, freezing everything for 2 h 48. Waking it back up costs one
`/orchestra`: adoption writes `todo` rows, and the very next slot returns `run`.

**A GREEN REGISTER IS NOT A FINISHED RUN, and the stand-down tick is where you say so.** Every row
terminal means the roadmaps are done; it says nothing about what the run FOUND on its way there.
The council of 2026-08-24/26 in planetCraft landed fifteen lines and opened seventeen tickets doing
it, three of them S1 — one of which was the runtime wall at the far end of the very advice another
line had just landed to fix. All seventeen were filed correctly and none was routed anywhere.

So on the tick that stands orchestra down, before the stand-down: list what the run opened, name
the S1s and S2s in the journal and at the checkpoint, and put one question there, in the Decision
Template — work them down, or leave them for the queue. **Do not open the lines yourself**: a
finished roadmap is the user's moment to choose the next one.

**File each S1 and S2 as a ticket, not just a journal note.** `orchestra tickets add --severity
S1|S2 --kind bug|friction|design|perf --title '<title>' --subject '<one line>'` (or `--fingerprint`
when the finding already carries one) as you name it in the journal, rather than leaving it to a
note nobody re-reads. `orchestra tickets list --severity S1` is the sweep itself, for whoever opens
the next roadmap and was not on this one.

**Then archive the finished rows, on that same tick.**

```sh
orchestra archive --write
```

It moves every terminal row's `note`, `subjects`, `decisions` and `touches` — and the register's
own top-level prose with them — into `.orchestra/archive.jsonl`. This is more precise than it
sounds: a finished row **leaves the register entirely**, unless a surviving row still depends on
it, or it still carries an unanswered question in `pending[]` — in either case it stays stripped
of exactly those four fields (`pending` is never one of them), so dependency resolution, the
heartbeat's own stand-down check above, and the progress bar keep working. It is a MOVE: nothing
is deleted.

Keep the measurement it exists for: measured 2026-08-30 in planetCraft, at the end of one roadmap,
`state.json` was 202 KB and 87 of its 87 rows were terminal — not one live row — with 136 KB of
that in post-mortem notes describing work landed weeks earlier, and every hourly tick re-read all
of it. This is not tidiness, it is the register you rehydrate from.

It refuses while a conductor is live — the register is rewritten in place and a conductor holds it
in memory across a whole tick, so a write underneath one would silently lose everything that tick
decided — and it is a no-op when nothing is terminal, so it is safe on any tick. It sits here
rather than earlier because a row's note is worth having in the register while its roadmap is still
running.

**Then the photographs those notes point at.**

```sh
orchestra archive-images --write
```

Prose is not the weight — pictures are: measured 2026-09-02 in planetCraft, the register's own
runtime directory held 70.2 MB in 199 files, of which 68 MB was 114 screenshots and boards, every
one belonging to a run that had landed weeks earlier. The sweep asks one question of each
photograph: can any live surface still draw it? Three can — an open `pending` ask on any row
whatever its status, the `note` of a row that is not terminal, and a journal or inbox line about
work that is still running. The rest are filed as `photo` lines in the same archive, each carrying
its size and the finished row or line that named it, before the file is removed.

Two things about it worth stating on their own:

- **The sweep's world is `.orchestra/images/`, never `.orchestra/`.** In this plugin `.orchestra/`
  also holds `config.json` and defaults to holding `worktrees/`, so a sweep of the whole directory
  would walk into a live worktree, decide no register line names the project's own pictures, and
  delete them.
- **It carries no conductor refusal, deliberately, and needs none: it rewrites no register.** Its
  hazard is a different one — a picture a worker has just taken and nobody has cited yet — and a
  clock answers it where a lock cannot. Measured over the 22 photographs the journal named, in
  planetCraft: the gap between a file being written and the first line citing it was at most
  1.2 hours, and negative for three of them (the file was rewritten after the sentence). Seven
  days is 140x the worst measured gap.

### The answer net, and what has no net under it yet

An answer normally reaches a conductor through none of this: the two-second watch armed at step 1
hands it over in seconds. The page starts nothing either way — it reaches the conductor whose beat
is live and never creates one — so an answer typed while nobody is beating sits in the inbox until
the next tick reads it.

What the watch cannot cover, in the code's own words: an answer **already sitting when the watch
was armed** — its first round announces nothing and only remembers what is already there — and one
left behind by **a tick that died before relaying it**, because the watch dies with the session
too.

**Where it is installed, the net under it is the heartbeat, and it is a floor, never a wake-up
call.** `orchestra install-heartbeat`'s hourly tick is `decideTick`'s own first override
(`lib/register/tick.mjs`): an unconsumed answer in the inbox forces `run` even when every other
row is terminal, so an answer typed while nobody is beating waits at most one heartbeat slot
rather than for ever — in a project that has run `install-heartbeat`. **Where it has not, there
is still no net at all**: the wait ends only when a person runs a tick by hand, exactly as before
this phase. Either way it is a wait, not a delivery — see the Never in `## What is not here yet`
for why that shape is deliberate and what the other shape cost. Never propose a cron entry as a
substitute: a cron tick cannot read the login keychain, so it would catch nothing while reading as
protection.
