# The stand-down tick

Read when every row is terminal — the roadmap is finished and this tick has nothing to launch. It
is a different tick from the one in SKILL.md, and it has its own two guards.

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

**THAT QUESTION GOES IN `runAsks[]`, AT THE TOP OF THE REGISTER, AND NEVER ON A ROW.** It is a
question about the RUN, and a run has ended by the time you are asking it: every row is terminal,
which is the one state in which no row can carry a question at all. Written into the last row's
`pending[]` it is invisible — the page drops a roadmap whose every row has finished, correctly, and
the question leaves the screen with the frame. In planetCraft on 2026-09-02, at the end of the
`inertes` roadmap, that is exactly what happened: the item was well formed, the journal had its
`question` line, the ask had its options, every check available said the question existed, and the
user's own words were "je ne vois pas de question sur la page". They were right and the conductor was
wrong to tell them it was there. The previous run's end-of-run question HAD been answered, so the
path works some nights and not others, depending on the order the rows finish in (ticket
`t-0antbtb`).

Same item shape as a row's, plus the roadmap it is about, and the `id` and `askedAt` are as
obligatory here as anywhere:

```json
"runAsks": [{"id":"inertes-standdown-1","roadmap":"inertes","kind":"decision",
             "askedAt":"2026-09-02T23:40:00Z","ask":"…","options":[
  {"letter":"A","text":"work the seven tickets down now"},
  {"letter":"B","text":"leave them for the queue"}]}]
```

It is retired the way a row's item is, into a top-level `runAnswered[]`, keeping its `askedAt` and
gaining an `answeredAt` — and `runAnswered[]` is authority over `runAsks[]` on the page, so an ask
moved and still listed cannot come back for the length of that write.

Two things then hold it up, and neither of them is your vigilance. The page draws `runAsks[]` in its
own frame, docked over the canvas and counted both in the corner list and in the strip — a frame no
row can empty, because it hangs on no row. And **the stand-down gate refuses to stand down while a
run-level ask is unanswered, naming it**: `orchestra tick-gate` prints `run — 1 run-level
question(s) waiting on you: inertes-standdown-1` where it printed `skip nothing to do`, so the
silence this defect used to be is a refusal you can read. That command is also the check worth making
before you tell the user a question is on the page: the instruction used to claim it was there with
no way at all to verify the claim. `orchestra archive --write`, on this same tick, leaves both arrays
exactly where they are — they are structural, like `pending`, and for the same reason.

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
