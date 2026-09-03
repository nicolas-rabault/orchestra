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

## The journal (three mechanical obligations, no decision)

A monitoring page reads three files; you write two of them and it writes the third. Never read
the page's state as authority — `state.json` and git remain the truth. **The journal costs one
`orchestra journal` call per event, always** — that is the price of the page having a history the
first time it is opened, whether or not it ever is. **The inbox side costs nothing until someone
has answered from the page** — no `id`, no stamp, no hook read, before that first answer exists.

1. **Append one line to `.orchestra/journal.jsonl` per event** — that file, and never
   `inbox.jsonl`, which is the page's file (phase 4) and the one thing you never write. One writer
   per file is what makes this lock-free; two writers is the only way it can corrupt. Create
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

   **Those four keys, copied exactly — `ts`, `kind`, `task`, `text` — and no others.** Phase 4's
   page reads them by name and shows nothing else. Written 2026-08-12 in planetCraft, into
   `inbox.jsonl`, by a conductor that meant well:
   `{"kind":"answer","at":…,"task":"C2","item":…,"answer":…,"action":…}` — wrong file, and
   `at`/`item`/`action`/`answer` are not keys the page knows, so the line was read as the USER's
   own words, quoted back to them as if they had said what the conductor did. If you recognise
   that shape in what you were about to write: it is `ts` not `at`, `text` not `action`, the item
   id belongs in `state.json`'s `pending[]` and not here, and the file is `journal.jsonl`.

   `kind` is `launch` · `question` · `answer` · `report` · `landing` · `note` · `tick` · `ruling`
   (that last one is a decision you took instead of asking — see The framing pass); `task` is
   the row id (`null` for a line about the tick itself). For `question` (the Decision Template's
   body), `answer` (the user's reply you relayed), `report` and `landing`, `text` is a sentence
   you already wrote for the user — the append is free. For `launch`, `tick` and `note`, nothing
   already exists to reuse: write one short line for the journal alone — a launch names the
   task, its branch and its model; a tick names what changed this tick, or nothing at all if
   nothing did; a note is anything else worth recording. Skipping a line degrades the page's
   left panel and nothing else — never skip a `question` or an `answer`, which is what the user
   reads back.

2. **Write an `id` on every `pending[]` item you append** — `"<lowercased row id>-<kind>-<n>"`,
   e.g. `"c2-playtest-1"`. Without it the page falls back to hashing the row id, kind and ask —
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
   {"id":"c2-playtest-1","kind":"playtest","askedAt":"2026-08-13T17:57:00Z","ask":"…","options":[
     {"letter":"A","text":"keep the snap"},{"letter":"B","text":"loosen it to 2 blocks"}]}
   ```

   The page offers one button per option, and it offers NOTHING when the item carries none: it
   never invents a choice, because a button the user clicks is sent back as their decision. Every
   `ask` in the register today is a one-sentence summary with no options in it at all, so today
   the page shows a free-text box and nothing else, on every question. An item that genuinely
   puts no choice — a playtest instruction, an FYI — carries no `options`, and that is correct.

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

   Two additions the plugin's code earns: the page is phase 4, and `pending[]` is already read
   **today**, before the page exists — by `orchestra ready` (its `WAITING:` line, which reports
   unanswered items older than thirty minutes, oldest first) and by `orchestra tick-gate` (an open
   item on any row keeps the heartbeat awake, whatever that row's status). And an item written
   with no `askedAt` is reported **with no age rather than dropped**, so an old row never silently
   disappears from the very report that exists to find the longest wait.

3. **When answers reach you — by phase 5's `orchestra-inbox` hook, once it exists, or by
   `orchestra inbox` — stamp `conductor.inboxSeen`** with the newest timestamp you were shown, in
   the same write that clears the answered `pending[]` items. Forget it and the same answers come
   back next tick — a repeated relay, never a lost one. The stamp is a single shared watermark, so
   it says only "somebody has read this far": never stamp past a batch you have not actually
   relayed to its worker.

   **But that cursor is SHARED and has no owner, so a forgotten stamp is the safe failure and a
   stolen one is the dangerous failure.** The hook only shows you answers newer than `inboxSeen`,
   whoever wrote it. If another session read the inbox first and stamped, your user's answers are
   consumed and you will never be told they existed. Measured 2026-08-12 in planetCraft: a second
   conductor stamped `20:10:33.311Z`, and FIVE answers — a design ruling, a failed playtest, a
   merge approval, a launch ruling and a question — were never delivered to the conductor the user
   was actually talking to. A worker sat fifty minutes on a verdict that had already arrived, and
   three others were launched against a "keep the box quiet" nobody had read. **So: whenever
   `inboxSeen` is ahead of the last value YOU wrote, do not trust the hook — read
   `.orchestra/inbox.jsonl` yourself and re-derive which of its lines answer items still in
   `pending[]`.** The file is append-only and cheap; the cursor is the only lossy part. The same
   applies the moment a user says anything like "I answered that on the page": open the file, do
   not argue with it.

   The four-hour grace rule narrows the dangerous window — it recovers an answer to an item still
   open in `pending[]` — but it does not cover a free remark, which targets no item at all: once
   the cursor is past it, nothing recovers it.

   **And stamp only once the action the answer AUTHORISES has completed** — not when you decide to
   take it, not when you announce it. For a merge approval that means after `merge_agent` has
   returned. Measured 2026-08-13 in planetCraft: X2's merge was approved at 13:17:20, the cursor
   was stamped to exactly that instant, the hand-off was written in the journal — and it never
   happened, because the conductor's session ended before merge_agent existed. The approval was
   consumed and the action was lost; it surfaced four hours later only because a human asked what
   had become of it. An unstamped answer costs you one repeated relay. A stamped-but-unacted
   answer costs the user their decision, silently, and silence is the worse of the two failures.
