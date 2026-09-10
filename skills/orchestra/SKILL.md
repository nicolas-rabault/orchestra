---
name: orchestra
description: Conduct every roadmap of this project at once — one background worker session per ready task, and every question relayed to the user in plain language. Use when the user says /orchestra, or asks to orchestrate or parallelise the roadmaps.
---

# Orchestra — the conductor protocol

## Runtime: Claude Code or Codex desktop

One roadmap task owns one **independent session**, on either runtime. A Codex sub-agent is
not that session: it belongs to its parent's task and cannot replace an orchestra worker.
Workers may themselves use sub-agents for bounded work inside their own independent session.

In Codex desktop, read `reference/codex.md` before conducting. It replaces the Claude-only
session, resume, monitor-loop and heartbeat mechanics below; the roadmap, claim, budget,
journal, lock, human-look and landing rules remain in force. With Claude Code, continue below
unchanged. A row without `runtime` is a legacy Claude row, never an invitation to guess.

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
`reference/first-run.md` and do that first. Every subcommand but three exits 0 and
silent otherwise, on purpose, and that silence is what makes the plugin safe to install globally.
The three exceptions are `doctor` itself, `orchestra instances` and `orchestra init`, none of which
need a project config to answer — `instances` because it answers about the MACHINE rather than
about a project, `init` because it is the command that writes the config in the first place. Once
a project has one, read off `doctor` `mode`, `name`, `id`, `language`, `mainBranch`, `worktrees`,
`branchTests`, `docs.specs`, `docs.plans`, `docs.results`, `briefExtra` and `queue` — plus
`pr.ledger` and `pr.direction` when this tick has a pull-request review row on it — and nothing
else.


## Roadmap worker engines

There is one conductor per project, regardless of how many worker engines are used. Reserve a
roadmap's engine locally with `orchestra roadmap runtime <slug> claude` or `codex`; omit the
engine to inspect it, or use `inherit` to remove the reservation. This is separate from ownership
and claims. An existing session keeps its recorded runtime (missing means legacy Claude).
A new worker follows the roadmap reservation, otherwise the conductor runtime, otherwise Claude.
Read the launch plan's runtime and use that engine's transport; never silently substitute the
other engine when unavailable. Codex models are the user's native defaults, not Claude labels.
Every worker emits `orchestra notify <task-key>` before its final report/question; with an enabled
Codex conductor this queues an event, while Claude retains its existing watches. The final report
and ordinary claims, human-look and landing rules remain unchanged.

## What is not in this file, and when to read it

This file is the tick. Runtime-specific and occasional instructions live beside it, in
`reference/`, and a tick that does not reach one never pays for it — the whole point: measured
2026-09-09, this skill cost 32.6 k tokens at every conductor boot and rode in the prefix of all
five hundred-odd requests that followed, so a tick that launched nothing still paid for the
hands-on gate, the pull-request rows and the stand-down.

Read one when the tick reaches its situation, and not before:

| Read | When |
|---|---|
| `reference/codex.md` | Before conducting from Codex desktop; native independent tasks replace only Claude's transport |
| `reference/first-run.md` | `orchestra doctor` says this project has not opted in, or there is no `state.json` at all, or this MACHINE has never launched a `--bg` worker. Onboarding, adoption and preflight |
| `reference/asking-the-user.md` | Before you put a question to the user, and before you decide not to. The framing pass, the one interruption, the decision template |
| `reference/hands-on-gate.md` | A row's acceptance needs a human to look, or you are about to start a dev server. The gate, and the dev-server sweep |
| `reference/pull-request-rows.md` | This tick has a row on the standing `pr` roadmap |
| `reference/worker-briefs.md` | You need to know what `orchestra brief` renders and why, a design row reaches its handoff, or `ready` prints a `RETIRE:` line |
| `reference/stand-down.md` | Every row is terminal — the roadmap is finished |
| `reference/not-here-yet.md` | You are about to reach for something and want to know whether this plugin has it |

They are prose, not summaries: each one is the section it used to be, moved whole.

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
   design→execution boundary you adopt a brainstorm's own recommendation (see `reference/worker-briefs.md`'s Design→execution
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
4. Never start a dev server before a task reaches the hands-on gate (`reference/hands-on-gate.md`).
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

## Worker progress in the monitor

Workers on either runtime must publish meaningful progress with
`orchestra progress <task-key> "<message>"`: at the start of a substantive step, after a
verification result, when blocked, and when finishing. Write concise observations in the
user's language, never an update per tool call or an artificial heartbeat. A finishing note
states the evidence; it does not itself mark the task complete.

This is an explicit exception to conductor-only journal writing: workers may append notes
through `progress`, which validates the registered task and uses the journal's complete-line
writer. Workers still never edit `state.json`, `inbox.jsonl`, or journal files directly.
Progress is visible in the monitor and sends no wake event. A final report or question remains
in the worker's final message and uses `orchestra notify` for the separate conductor wake.

## The journal (three mechanical obligations, no decision)

The monitoring page reads three files; you write two of them and it writes the third. Never read
the page's state as authority — `state.json` and git remain the truth. **The journal costs one
`orchestra journal` call per event, always** — that is the price of the page having a history the
first time it is opened, whether or not it ever is. **The inbox side costs nothing until someone
has answered from the page** — no `id`, no stamp, no hook read, before that first answer exists.

1. **Append one line to `.orchestra/journal.jsonl` per event** — that file, and never
   `inbox.jsonl`, which is the page's file and the one thing you never write. The conductor writes orchestration events; workers may publish progress notes only through
   the atomic `progress` command described above. Never append raw file content. Create
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
   (that last one is a decision you took instead of asking — see `reference/asking-the-user.md`); `task` is
   the row id (`null` for a line about the tick itself). For `question` (the decision template's
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
   array of `{"letter", "text"}`, the SAME options the decision template (`reference/asking-the-user.md`) has just made you
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
   `ask` itself is the decision template's whole body (`reference/asking-the-user.md`), never a one-sentence summary of it — that
   is the page's only text, and what it costs to compress is measured there (see The decision
   template). An item that genuinely puts no choice — a hands-on instruction, an FYI — carries no
   `options`, and that is correct.

   **A question about the RUN does not go on a row at all** — it goes in `runAsks[]` at the top of
   the register. A run has ended by the time such a question is put, so every row is terminal, and a
   terminal row cannot carry a question anybody will see: that is ticket `t-0antbtb`, and the
   stand-down tick (`reference/stand-down.md`) is where the shape and the two guards are written out.

   **A QUESTION THAT IS NOT IN `pending[]` (OR IN `runAsks[]`) DOES NOT EXIST.** The page shows
   exactly those items and nothing else; a question you only wrote in chat is invisible there, so the user
   opens the page, sees nothing waiting, and asks you why. That happened in planetCraft on
   2026-08-12 to two decisions in a row, and the user's own words for it were "pourquoi je n'ai
   pas les notifications". So the decision template and the `pending[]` item are ONE act, not two:
   write the item in the same turn you put the question to the user, every time, even when they
   are sitting right there — especially then, because a question asked mid-conversation is exactly
   the one that never gets written down.

   **And retire a pending item the moment its question dies — MOVE IT, never delete it.** An item
   you leave behind in `pending[]` after the user has answered it in chat, or after events have
   overtaken it, stays on the page as a live question — and they will answer it, hours later, in
   good faith. In planetCraft on 2026-08-12 a launch question from 17:43 was answered at 22:09 with
   "keep the box quiet" while the same user had told the conductor in chat at 17:56 to prioritise
   three tracks; the two readings were both coherent and the conductor could only hand the
   contradiction back. Retiring the item at 17:56 would have prevented all of it. When a chat answer
   arrives, move the item it answers in the same write.

   **The destination is `answered[]`, an array on the same row, and the item arrives there with the
   `askedAt` it already had plus an `answeredAt`** — UTC, taken and not typed, exactly as `askedAt`
   was. Keep only what a clock needs, `id`, `kind`, `askedAt`, `answeredAt`: the words are in the
   journal, and the register is rewritten every tick.

   ```json
   "answered": [{"id":"c2-playtest-1","kind":"playtest",
                 "askedAt":"2026-08-13T17:57:00Z","answeredAt":"2026-08-13T18:11:42Z"}]
   ```

   Deleting the item instead destroys the ask side of the only stamped pair in orchestra a model
   never wrote: how long a question waits on the user becomes unmeasurable. In planetCraft that made
   `retex verify` return `not-comparable` on the same row for two consecutive programmes — and that
   latency is the entire justification of the tick's notification rule (step 5), 8 to 15 minutes
   when the user knows something is waiting against 2 to 8 hours when they do not. Moving the item
   costs one line and keeps the pair.

   **The non-negotiable half is held more strongly by the move than it was by the deletion**, not
   less: the page renders `pending[]`, so a question that has left it cannot be offered again — the
   invariant is structural instead of resting on the page filtering correctly. Never keep an
   answered item in `pending[]` with a flag on it.

   Two additions the plugin's code earns: `pending[]` is read by **more than the page** — by
   `orchestra ready` (its `WAITING:` line, which reports unanswered items older than thirty
   minutes, oldest first) and by `orchestra tick-gate` (an open item on any row keeps the heartbeat
   awake, whatever that row's status), so an item is load-bearing whether or not a page is open.
   And an item written with no `askedAt` is reported **with no age rather than dropped**, so an old
   row never silently disappears from the very report that exists to find the longest wait.

3. **When answers reach you — by the `orchestra-inbox` hook or by
   `orchestra inbox` — stamp `conductor.inboxSeen`** with the newest timestamp you were shown, in
   the same write that moves the answered `pending[]` items into `answered[]`. Forget it and the
   same answers come
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

**And width is rarely what is actually holding a run back.** A third line stands the launch plan
down for a reason that has nothing to do with capacity:

```
LAUNCHES HELD: 4 ready task(s) wait on 3 owed worker turn(s) (demo/R1, demo/A1, demo/A2) — a warm session pays no brief and a new one pays all of it. Run `orchestra drive`, then `orchestra ready` again.
```

Measured 2026-09-08 in duckJam, twice over: six lines launched at 06:45 were every one refused after
reading their brief while one already-warm session committed nine times in the same window; and at
`--width 40` not one extra line was launchable — every one blocked on a dependency — while
harvesting three resting workers unblocked seven. **Reach for `orchestra drive` before you reach for
`--width`.**

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
   state file, go to `reference/first-run.md`'s Adoption. If `state.json`'s `conductor.session` is not you, you are a
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
   will start. A holder that is provably gone is broken automatically — a dead pid for a tick, and
   for a conductor either a stopped beat or ninety minutes without a write to the register — so
   neither a killed session nor a session that stops conducting can wedge the heartbeat. That second
   half is the same window `yield-check` uses, deliberately: measured 2026-09-06/07 in duckJam, when
   this lock used the beat alone it refused eight heartbeat slots for a session `yield-check` had
   already ruled loose, and three answers the user had typed sat unread for 3 h 35. Arm the answer
   watch before you rely on this: your beat is what proves you are alive, and a conductor that holds
   the lock without beating is one the next tick will correctly break.

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
   RELAUNCH: dome/DW9 [claimed] — the branch is there and no session is — no note on the row — relaunch on the same worktree with `orchestra brief dome/DW9 --relaunch`
   RETIRE: dome/DW6 [claimed] — 732 requests, prefix 707k (booted 36k, threshold 200k), 282790k read so far. Every further request re-reads 707k; a replacement on the same worktree starts near 36k. Run `orchestra retire dome/DW6`.
   driving: arena/PV1 [claimed] — driven turn pid 40798
   owed: 3 worker turn(s) — orchestra drive
   relaunch: 1 live row(s) with no session — dome/DW9
   ```
   **`RELAUNCH:` is an obligation too**, and a newer one: a live row whose branch and worktree are
   there and whose worker is not. Any worker killed by hand, by a reboot or by a stray `claude stop`
   leaves one, and until 2026-09-09 nothing reported it at all — such a row appeared in `ready`, in
   `blocked` and in all three obligations as nothing whatever, while this document told you to
   relaunch it. Relaunch it with the brief the line names, from step 8's launch line; it is not held
   by `LAUNCHES HELD:`, because it is not a new launch.

   **`RETIRE:` is NOT an obligation — it is an offer, and it is measured.** A worker's context only
   grows and every request re-reads the whole of it, so past a point carrying the prefix costs more
   than starting over on the same worktree. `orchestra cost` prints the whole fleet with the reason
   each row is or is not firing; `orchestra retire <key>` drives one wrap-up turn, writes the note
   it produces onto the row, stops the session and leaves the row for the `RELAUNCH:` above. It
   refuses a row being driven, waiting on the user, waiting on the gate, too young, or unmeasurable,
   and it has no `--force`. The threshold, the three guards and the simulation that chose the number
   are in `reference/worker-briefs.md`; you need none of it to act on the line.
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
   hands-on gate, `reference/hands-on-gate.md`) or hand it to `merge_agent`; a question → `pending[]`, and ask the user; still
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
   <time>" — or "You've hit your individual spend limit · … your session limit resets <time>",
   which is the same ceiling in different words — means every turn is refused until that time.
   `drive` prints it as `REFUSED`, writes no receipt, and the row stays owed. Leave the rows
   claimed, note the reset time in `state.json` (the key is `budgetResetAt`, and `orchestra
   tick-gate` stands the heartbeat down until it passes rather than spending a session on a refusal
   already certain), and let the next tick retry. Do not mark workers dead on it.

   **When the refusal kills the TICK itself, you are not there to write that field, and the
   heartbeat now writes it for you.** `templates/tick.sh` reads its own session's transcript back
   through `orchestra tick-outcome`: a slot that conducted nothing and ended on a refusal gets a
   journal line and, for a budget refusal that states a reset this can read, a `budgetResetAt`. You
   will therefore sometimes find that field already set by a slot you never saw, and a `tick` line in
   the journal you did not write. Both are the tool's; leave them. Measured 2026-09-06 in duckJam:
   without this, the 11:13 and 12:13 slots burned two opus sessions on the identical refusal an hour
   apart and left nothing anywhere but one line in `tick.log`.

   And a slot that stands down on that field arms one wake at the reset rather than handing back to
   the hourly grid, so a tick can arrive at any minute of the hour — `(wake)` in `tick.log` marks
   one. Best effort only: the grid is untouched underneath it and is still what guarantees a tick at
   all. On 2026-09-06 the ceiling reopened at 08:10Z and the first worker commit landed at 12:00.
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
   same one: relay verbatim, move the `pending[]` item into `answered[]` with its `answeredAt`,
   journal an `answer`, stamp
   `conductor.inboxSeen` — the journal's third obligation is this same mechanic seen from the
   cursor's side.

   Then process worker messages. Classify both: *blocking* (the worker cannot continue) → relay
   to the user immediately in the decision template (`reference/asking-the-user.md`); *non-blocking* (ready to test, an approval,
   an FYI) → append to that row's `pending` in `state.json`.

   **A review worker reporting a `merge` verdict is the one moment anything writes `subjects`, and
   you are the only writer**: on that report, write the pull request's title in both the forms a
   squash can produce — `<title>` and `<title> (#<N>)` — plus the branch's commit subjects, onto
   that row's `subjects` in `state.json`. No gate runs on a review row, so step 6's recorder never
   sees it; a row that reaches its merge with `subjects: []` can never derive `landed`
   (`reference/pull-request-rows.md`).

   The page is the writer of `.orchestra/inbox.jsonl`, so this command now has something to print:
   the oldest answers nobody has taken yet, whether they answer a `pending[]` item or are a free
   remark. The hook adds a third path when it can fire, but a session's own first turn is exactly
   where it goes blind, so treat it as a bonus rather than a substitute — this command on every
   tick, and step 1's answer watch in between, remain the two paths guaranteed to reach you, and
   all four obligations above stand, the stamp included. An answer posted while nobody was beating
   started nothing and is simply sitting there; this read is what collects it.
5. **Checkpoint.** A checkpoint is the moment you stop trickling questions out one at a time and
   present every pending decision to the user together, grouped and ordered, each in its Decision
   template — the act the journal and the framing pass both mean when they call a landing or a
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

   **A pull-request review row never enters the procedure below.** Its `landed` is DERIVED, from a
   merge the maintainer clicked on GitHub and this checkout has since fetched — so tell the user at
   the checkpoint like any other landing, and then stop. `orchestra land` is never called on a
   review row, no gate runs on one, and nothing in this step deletes its worktree or its ref
   (`reference/pull-request-rows.md`, which says when they do go and what you do own instead).

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
   too: 10 (conflict), 13 (a precondition failed), 16 (killed, no outcome recorded), 17 (the
   MACHINE refused, not the branch — the gate was killed before it reached any verdict, or there
   was no disk left; land again once, and the `attempt N; before this one: …` line says whether it
   already reproduced). **Never
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
   before you act.** Exit 17 is the third case and the tool decides it for you: the gate's own
   process was killed before it judged anything, or the machine had no disk left, and the branch is
   not accused. The two below are the ones still left to your judgement, both inside exit 11. On
   2026-08-26 in planetCraft, MA4 was refused three times and only the first refusal was about MA4:
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
     `orchestra tickets add`. Measured again 2026-09-08 in duckJam, four branches in one day on one
     wall-clock assertion at load 170 (`t-0a1q330`) — read the `attempt N; before this one: …` line
     `await` and `queue-list` print before you believe the third one.

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
   width-capped by "The machine's capacity" above.

   **Re-run `orchestra ready` here, and read `launches` from THAT run.** The plan you read at step 1
   was computed against a fleet you had not yet harvested, and `launches` is EMPTY while any worker
   turn is owed — `LAUNCHES HELD: …` in the text, `launchHeld` in the JSON, naming every row that is
   holding it. That is the tool's rule, not advice: a new worker pays for its whole brief before it
   produces a line, and a session already open and already on the problem pays for nothing. Measured
   2026-09-08 in duckJam — six lines launched at 06:45 were every one refused AFTER reading their
   brief, while one already-warm session committed nine times in the same window — and again from
   the other side: at `--width 40` not one extra line was launchable, all blocked on dependencies,
   and harvesting three resting workers unblocked seven. **Width is rarely the constraint; the
   resting fleet usually is.** If the hold will not lift, it names the row: `orchestra drive` clears
   a stopped worker, and a row whose session or worktree is gone is relaunched here as usual — that
   relaunch is not held, because it is not one of these launches.

   **Claim first, always**, for your own
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
   claude --bg -n orchestra-<project id>-<task slug> --model <model> --dangerously-skip-permissions "$(orchestra brief <key>)"
   ```
   **`orchestra brief <key>` IS the brief — do not compose one.** It renders the whole prompt from
   the row and the config: the task's own excerpt, the `Touches` files already located and sized,
   the spec and plan on disk for this task, the commit the worktree was cut from, `branchTests`,
   `briefExtra`, the project's rules, and the right one of the three models (execution, design,
   review) for the row. `--relaunch` and `--handover <n>` prefix it for the two take-over cases.
   It was a fourteen-row substitution table filled by hand, once per launch, 123 times in duckJam
   alone — and the worker then spent its first four to eleven Bash calls rediscovering what the
   brief could have told it, and re-read that rediscovery for the rest of its life.
   `reference/worker-briefs.md` says what it renders and why; you need it to CHANGE a brief, not
   to send one.

   `<worktrees>` is the `worktrees` config (`orchestra doctor`'s own row; default
   `.orchestra/worktrees`). **A row carrying a `base` is cut from that sha instead of from the main
   branch** — a pull-request review row always carries one, and `reference/pull-request-rows.md`
   says why. The `-b` form is unchanged either way, so `guard-claim` sees the gesture the same.
   **Do not run a dependency install here.** The source project's launch did; a portable protocol
   cannot know whether a fresh worktree needs one, so if the project
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
