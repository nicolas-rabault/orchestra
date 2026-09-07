---
name: pr-sweep
description: Sweep every open pull request on the repository you are standing in, recommend what to do with each one and in what order, publish the batch as an orchestra roadmap the conductor can run, and ask the maintainer the decisions only they can make. Runs a cheap metadata pass, folds it against the local ledger to spot PRs that changed since the maintainer last looked, and stops at the published roadmap plus the framing questions. Use when the user says /pr-sweep, "check all the PRs", "what needs my attention", "triage everything", or asks for a PR round-up.
---

# PR sweep

Route every open PR, and come to the maintainer with a plan, not a list.

Deep review of a single PR is `pr-triage`. This skill decides which PRs deserve that, in
what order, recommends a verdict for each, and remembers the answers so the maintainer is
never asked the same thing twice.

**It no longer runs the reviews itself.** It publishes them as a roadmap, one task per pull
request, and the conductor (`skills/orchestra/SKILL.md`) launches one background worker per row on a
worktree cut from the PR's own head. So a review is an ordinary task: it has a branch, a status
nobody types, a card on the monitoring page, and one interruption for its whole life. This skill
stops at the published roadmap and the framing questions.

**Be opinionated.** A board with no recommendation on it just moves the work back onto the
maintainer. Every PR gets a recommended action and a one-line reason, even when your
confidence is low, in which case say so and ask.

Every command below is `orchestra <subcommand>`, which means
`"${CLAUDE_PLUGIN_ROOT}/bin/orchestra" <subcommand>`, and `bin/orchestra` at the root of the
plugin's own directory when `CLAUDE_PLUGIN_ROOT` is unset. **`orchestra doctor` first, always**: it
gives you `root`, `worktrees`, `roadmaps.drafts`, `roadmaps.published` and `pr.direction`, and
nothing in this skill hardcodes a path or a repository name.

## Hard rules

Every `pr-triage` hard rule applies here too, plus:

1. **Never publish anything on GitHub.** The scan is read-only. The only write allowed
   anywhere in this flow is a **pending** review, created by `pr-triage`. Orchestra having a merge
   gate does not soften this: `orchestra land` is never run on a review row, and the maintainer
   clicks Merge themselves.
2. **Never merge, close, label, or assign.** Not even on a `merge` verdict.
3. **Never hand-write the ledger.** Every record goes through `orchestra pr log`: it takes the
   clock itself, refuses an unknown verdict, writes one complete line per append and repairs a
   missing trailing newline before the next one. Review workers append concurrently, and a
   hand-built `printf` or a read-modify-write loses records — `lib/pr/ledger.mjs`'s header says why
   the file is append-only and why the last line for a PR is its state.
4. **No `—` character** in anything for GitHub or for the maintainer to paste. Inside a roadmap it
   is the opposite: `—` (U+2014) is the grammar's own word for "none" and a field that has none
   must carry it.
5. **Do not launch, and do not let anything launch, a review the maintainer did not approve.**
   Publishing the roadmap is not launching it; the batch confirmation in step 6 is what decides
   which rows the conductor may take, and step 8 is where a row it did not approve is closed.
6. **Never write a direction principle the maintainer did not state.** Declines you
   reason out yourself may write one (that is `pr-triage`'s job). Answers to direction
   questions are the maintainer's words, recorded, not your inference.

## Step 1: scan

**Preflight, before anything writes.** The ledger and the direction memory must be IGNORED by git,
or this sweep adds them to the repository it is reviewing:

```sh
git check-ignore <pr.ledger> <pr.direction>/      # both paths must come back
```

`git check-ignore` prints the paths that ARE ignored and exits 0 when ANY of them is, so the exit
code proves nothing: read the output and require BOTH lines. If either is missing, this project ran
`orchestra init` before those two entries existed in the `.orchestra/.gitignore` that `init` writes.
**Add the two missing lines to that file yourself** — `pr-log.jsonl` and `direction/`, one per line,
matching the two defaults — and check again. Do NOT reach for `orchestra init` to repair it: it
refuses outright on a project that already has a config, and `--force` rewrites `config.json` from
the template plus detection, which drops every key the project added by hand. Two ignore lines are
not worth a lost configuration.

Skip this and the sweep's own ledger and every principle it learns sit in `git status` as untracked,
one `git add .` from the commit this whole flow exists not to make. A project that has moved
`pr.direction` out from under `.orchestra/` on purpose (`docs/direction`, committed) is answering a
different question: check the ledger alone there.

```sh
orchestra pr scan --json
```

Read-only throughout. Three `gh` calls for the board — the repository's name, your login, the open
pull requests — plus one per PR for the comment watermark, which has no batch form. It prints
`{repo, open, rows}`, and every row carries:

| Field | What it is |
|---|---|
| `number`, `title`, `author` | the PR |
| `bot` | the author's login ends in `[bot]` |
| `adds`, `dels`, `files` | the diff |
| `size` | `small` (≤100 lines changed), `medium`, `huge` (>1000). Measured on the DIFF, never on the file count |
| `ci` | `pass`, `fail`, `pending`, or `none` — and `none` (no checks configured at all) is not the same claim as green |
| `ageDays`, `idleDays` | since it was opened, since it last moved |
| `headRefOid`, `lastOtherCommentId` | the watermark as it stands NOW |
| `record` | the ledger's last line for this PR, or `null` |
| `moved` | the watermark differs from `record` |
| `group` | where the routing put it |

**The scan ROUTES; it does not RECOMMEND.** It has no opinion about direction, no shape signals and
no notion of what this project wants — folding the direction files against these rows is step 2, and
it is yours. The nine groups, and exactly what each one means:

| Group | Means |
|---|---|
| `ci-fail` | `ci` is `fail`. **Checked first**, so a failing check outranks every other group, including a merge you were waiting to click |
| `settled` | a bot's PR nobody has looked at |
| `quick-win` | a `small` PR nobody has looked at |
| `new` | any other PR nobody has looked at |
| `author-moved` | you looked, and the head or a comment from somebody other than you has changed since |
| `declined-author-responded` | the same, on a PR you declined |
| `ready-for-your-merge` | you decided `merge` and nothing has changed: yours to click |
| `waiting-on-author` | you decided `review` and nothing has changed |
| `silent` | you declined or dismissed it and nothing has changed |

Two facts about `moved` that decide how you read the board, both true of this implementation and
neither of them obvious:

- **A PR with no ledger record has not moved**, by construction. That is not "nothing happened", it
  is "nobody has looked", which is a different fact and has its own three groups.
- **A comment alone resurfaces a declined PR.** `moved` is true when the head differs OR when
  somebody other than the maintainer has commented since, and either one sends a declined PR to
  `declined-author-responded`. The maintainer's own activity never counts as movement.

Then read `<pr.direction>/DIRECTION.md` and every file it indexes — `pr.direction` from
`orchestra doctor`, resolved against its `root` row. You cannot recommend anything without them, and
its **Open questions** section is your question backlog.

If the scan fails, fix the scan (`lib/pr/scan.mjs` routes, `lib/pr/gh.mjs` shells out). Do not fall
back to hand-running `gh` calls over twenty PRs, that is how state gets lost.

## Step 2: form a recommendation for every PR

Use the direction files first, then the signals. Where a direction file decides it, cite
the file and treat it as settled.

| Situation | Recommend |
|---|---|
| `bot`, `ci` pass, scoped bump | **merge**, per the project's own bot-dependency principle where it has one |
| a direction principle rejects the whole premise | **decline**, cite the file |
| `size` `small` + focused + a `fix(` or `refactor(` title | **review**, cheap and probably mergeable |
| substantial feature, no direction conflict | **review** |
| `size` `huge` and unfocused, several unrelated concerns in one branch | **review** asking for a split, or **decline** if the premise is also wrong |
| high `idleDays` + already reviewed + author silent | **dismiss**, nothing new to say |
| `ci` `fail` | **review**, but lead with the failure |
| the verdict hinges on an undecided direction question | **ask**, do not guess |

Confidence matters. Split your recommendations into:

- **settled**: a direction file or an obvious signal decides it. Batch these.
- **needs your call**: you have a recommendation but the maintainer should confirm.
- **blocked on direction**: you cannot honestly recommend until they rule. These become
  questions in step 6.

## Step 3: order the work

Recommend an explicit order and say why. Default ordering, best first:

1. **Zero-cost clears.** Direction-settled merges and declines, and stale dismissals.
   They cost the maintainer one confirmation and shrink the board immediately.
2. **Small focused fixes, batched by author.** Cheapest real reviews, and they unblock a
   contributor who is waiting. Four small PRs from one author is one context, review them
   together.
3. **`author-moved`.** Someone acted on the maintainer's review and is waiting on a reply.
   Slowest thing to leave rotting, socially.
4. **Substantial features with no direction conflict.**
5. **Direction-settling PRs.** Big, or they force a ruling that outlives the PR. Do these
   when the maintainer has attention to spend, and get the ruling first (step 6) because
   the answer may decide several PRs at once.

Deviate when the facts say so, and say why you deviated. A `ci-fail` on a one-line PR
still goes early. A three-day-old PR from a first-time contributor beats a 52-day-old one
from someone who has gone quiet.

That order becomes the `Order` field of every task in step 5.

## Step 4: the board

Actionable groups first, recommendation on every row, informational groups collapsed to
counts and numbers.

```
20 open, 1 in ledger, 4 direction files

DO FIRST, settled by direction (2)
  #91  dependabot   CI pass   npm_and_yarn bump          -> MERGE   dependabot rule
  #82  dependabot   CI pass   setup-node 6.4 to 7.0      -> MERGE   dependabot rule

QUICK WINS, 4 small fixes from octocat (4)
  #89  +43/-1    close the log file if inference fails   -> REVIEW  focused, likely mergeable
  #87  +77/-2    only flag an update when behind         -> REVIEW
  ...

AUTHOR MOVED, they are waiting on you (2)
  #64  monalisa   new commits since your review          -> REVIEW  re-read the 4 points you raised
  #59  hubot      new replies since your review          -> REVIEW  one file, probably a reply not a rework

BLOCKED ON YOUR RULING (1)
  #81  octodev     +9339/-4223  a second hardware target alongside the first
       needs the second-target question answered first

waiting on author (4)   #73 #72 #68 #14
silent (1)              #40 declined
```

Name the recommended order in one line under the board.

## Step 5: write the roadmap

**One standing roadmap, slug `pr`, rewritten by every sweep.** Not one roadmap per sweep: a task's
key is `<roadmap>/<ID>` and an ID must be unused by EVERY roadmap, so two sweeps that both file
`PR91` collide the moment the second publishes.

Draft it at `<roadmaps.drafts>/pr.md` (`orchestra doctor`'s row, `.orchestra/drafts` by default):

```
---
roadmap: pr
destination: local
---

Two paragraphs of your own: what this sweep found, and the order it recommends.

### PR91 — merge: bump npm_and_yarn group across 1 directory

- **Roadmap** pr
- **Order** 1
- **Deps** —
- **Touches** `frontend/package-lock.json`
- **Branch** `pr91-review`
- **Design** no
- **Lane** —

**Why.** Dependabot, green CI, scoped bump. `dependabot-default-merge.md` settles it: merge.

**Acceptance.** PR #91 is merged on GitHub and `git log main` carries one of the subjects the row
records: a commit subject, the PR title, or that title with ` (#91)` appended.
```

- **`destination: local`** is what keeps this roadmap off the issue tracker in an online project. It
  publishes to `<roadmaps.published>` — gitignored, committed by nothing — whatever the project's
  mode. Omit it and an online project files a public issue per pull request, which is the one
  outcome this whole flow must not produce.
- **One task per PR you are filing**, and you file a PR when you are recommending an ACTION on it:
  `merge`, `review`, `decline` or `dismiss`. The informational groups (`waiting-on-author`,
  `silent`) get no row; they stay counts under the board.
- **The ID is `PR<number>`** and the branch's last segment must start with `pr<number>-`, so
  `pr91-review`. That prefix is what a re-sweep and the reconciliation both match on.
- **The recommended verdict is the title's prefix** (`merge:`, `review:`, `decline:`, `dismiss:`)
  and its reason is the `Why`. There is no field for it, and adding one is exactly what the seven
  field names have stayed seven by refusing.
- **`Order`** is step 3's order. **`Deps`** only for a REAL block — reviewing this PR is wasted work
  until that one is settled, because it rebases on it, shares its premise, or waits on the same
  ruling. It is the only thing that draws an arrow on the monitoring page. **`Lane`** for two
  reviews that must not run at the same time. **`Design`** is always `no`.
- **`Touches` is the field that will fail your lint.** Every path it names must EXIST in this
  checkout, or be written `new <path>`; a PR's newly added files do not exist here. Name the paths
  the PR changes that this checkout already has, prefix the rest with `new `, and write `—` when
  that leaves nothing. It blocks nothing either way.
- **`Why`** carries the recommendation and the reason, citing the direction file by name when one
  settles it. **`Acceptance`** names the instrument: for a merge, the PR merged and one of the
  row's recorded subjects on main — its commit subjects, its title, and that title with ` (#<N>)`
  appended, which is what GitHub's default squash actually writes; for a review, the pending review
  drafted and the verdict in the ledger.

Then:

```sh
orchestra roadmap lint <roadmaps.drafts>/pr.md
orchestra roadmap publish <roadmaps.drafts>/pr.md
```

`publish` lints again and refuses on any error, rewrites `<roadmaps.published>/pr.md` in place,
deletes the draft, and enrols a register row for every task. **A rewrite keeps every existing
register row untouched** — its session, its note, its recorded subjects — because `enrol` is
append-only and returns a known row by identity.

### The two rules a re-sweep must not break

Neither is enforced by code. Both cost a running worker if you get them wrong.

- **Carry forward every task still live in the register.** Read the register itself before you
  draft — `<root>/.orchestra/state.json`, not the board, because the board prints the DERIVED status
  and you need the written one — and write a task for every row
  whose status is not `landed` and not `dropped` — even a PR that has since gone quiet, even one
  you would not file today. Dropping a task whose worker is running orphans that worker:
  `orchestra ready` stops counting it, the monitoring page stops drawing it, and nothing will ever
  collect its report.
- **Reconcile against GitHub, and write `dropped` for a PR closed without merging.** This sweep is
  the ONLY thing that can see that. The status derivation has no input that changes when a PR
  closes, so such a row sits `claimed` for ever otherwise. A row whose PR is no longer in
  `orchestra pr scan`'s open list, and whose recorded subjects are not on main, is a PR that was
  closed unmerged: set its register row's `status` to `dropped`, drop the task from the rewritten
  roadmap, delete its worktree and its `pr<N>-review` ref, and say so at the checkpoint.

### The fetch, and `base`

**After `publish`** — publish is what creates the rows — fetch every PR you filed and record the sha
it came back with:

```sh
git fetch origin "pull/$N/head" && git rev-parse FETCH_HEAD
```

Write that sha as **`base`** on that task's row in the MAIN checkout's `.orchestra/state.json` —
`orchestra doctor`'s `root` row, as an absolute path, because `cd` persists between shell calls and
a register written after a `cd` into a worktree writes the wrong file. `base` is the one key nothing
else writes: `registerRow` does not create it, and no subcommand sets it.

It is what makes the conductor's launch cut the worktree from the PR's own head rather than from
main. Without it the worker reviews your main branch and reports on nothing.

## Step 6: the framing questions

This is the conductor protocol's **framing pass**, done here: every fork put to the maintainer at
once, before any launch, with the answers recorded on their rows and never re-asked.

Use `AskUserQuestion`. **Direction questions first**, before anything else, because an
answer can decide several PRs and change your own recommendations.

Ask a direction question only when all three hold:

- no direction file answers it
- the answer changes the verdict on at least one open PR
- it is a project-direction call, not something you could verify by reading code

Write each one as a real decision with grounded options: what taking it costs, what
refusing it costs, and which PRs each answer settles. Cap at 4 per call, most consequential
first. `DIRECTION.md`'s **Open questions** section is the standing backlog, pull from it.

Then ask the batch confirmation, with your recommended selection as the first option.
Offer at least: run the recommended batch, run everything actionable, pick a subset, or
board only.

For a PR where your own recommendation is weak, ask about that one specifically rather
than burying it in a batch.

Text replies still work if the maintainer prefers typing: `<numbers>`, `all`, `none`,
`dismiss <numbers>`, `decline <numbers>`, `merge <numbers>`, and combinations.

**Every one of these questions is also a `pending[]` item on its row**, per the conductor
protocol's journal obligations, and that is not optional: the monitoring page shows exactly the
pending items and nothing else, so a question asked only in chat does not exist there. Each item
carries `id` (`"pr91-framing-1"`), `askedAt` taken from `date -u '+%Y-%m-%dT%H:%M:%SZ'` and never
typed, `ask`, and **`options` as an array of `{letter, text}` copied verbatim from the choice you
just put to the maintainer, in the language you are speaking to them**. The page draws one button
per option and draws none when the item carries none. A direction question that belongs to no single
PR goes on the row it most changes, or is journalled as a tick-level `question` line with `task` `-`.
Withdraw an item the moment its question dies.

## Step 7: record direction answers

Every direction answer becomes a principle, immediately, before any review runs. It is
the whole reason the sweep gets smarter.

1. Write `<pr.direction>/<kebab-slug>.md` in the `pr-triage` direction format, in the
   maintainer's terms, not yours.
2. Add the index line to `<pr.direction>/DIRECTION.md` under **Principles**.
3. If the question came from **Open questions**, remove it from there. A question that is
   now answered must not be asked again.
4. Re-decide any PR that was blocked on it, and say out loud what changed.
5. **If a re-decision changes a task's recommended verdict, rewrite the roadmap** — steps 5's
   draft, lint and publish again, in place. The roadmap is standing and rewriting it is cheap; a
   worker launched against a verdict the maintainer has just overruled is not.

Write the answers onto their rows as `decisions: [{q, answer, at}]` as well. Those are binding and
are never re-asked.

## Step 8: hand over

**No subagents, and no launches.** The conductor takes it from here. `orchestra ready` COMPUTES
the plan and prints it — it starts nothing: a `todo` row reaches the ready set only once every dep
it names has landed and its lane is free, and the machine's budget then caps how many of them are
listed. The conductor's own step 8 is what launches one background session per row with the review
brief. Say plainly in your report that this is what happens next, and how many rows are waiting.

**A row the maintainer settled at the framing pass needs no worker, and it already has a row**,
because step 5 published one before the questions were asked. Every one of these cases is the same
two gestures — log the verdict, set the register row's `status` to `dropped` — and the second is not
optional: a row left `todo` is a row `orchestra ready` will launch.

- **Took it off the batch.** No ledger line (nothing was decided), row `dropped`.
- **`dismiss`.** The cheap escape hatch: it must cost one word.
  ```sh
  orchestra pr log <N> dismissed --head <headRefOid> --comment <lastOtherCommentId> --note "why"
  ```
- **`merge`, settled on the spot with no review wanted.**
  ```sh
  orchestra pr log <N> merge --head <headRefOid> --comment <lastOtherCommentId> --note "why"
  ```
  Tell them it is theirs to click. This row ends `dropped` rather than `landed`, and that is honest:
  nothing reviewed it and nothing recorded its title, in either of its squashed forms, or its
  commit subjects, so there is nothing for the derivation to find on main. The next scan will show
  the PR gone from the open list once they have clicked.

Both `--head` and `--comment` come from the scan, never refetched: the watermark must record what
was actually looked at, not what the PR looks like a minute later.

A `merge` the maintainer wants CONFIRMED is not this case — it is the ordinary one. Its row keeps
its worker, the conductor records the PR's title in both the forms a squash can write — `<title>`
and `<title> (#<N>)` — plus its commit subjects on the row (protocol step 4, and
`## Pull-request review rows` for why the title is the load-bearing half), and it then
reads `landed` on its own once the maintainer clicks and this checkout has fetched main. Nobody
types that status.

For everything else, the row's worker follows `pr-triage` and logs its own verdict.

## How the watermark drives the next sweep

A PR counts as moved if `headRefOid` differs from the recorded `head`, or if a comment
from someone other than the maintainer is newer than the recorded `last_other_comment_id`. The
maintainer's own activity never counts.

- `decline` plus any movement, a comment included, lands in `declined-author-responded`.
- `dismissed` plus any movement lands in `author-moved`.
- `merge` stays in `ready-for-your-merge` until the maintainer clicks it, after which the PR is
  closed and leaves the open list entirely.
- **No record at all is not movement.** There is no fallback to a published review's `submitted_at`:
  a PR nobody has logged is routed by its shape (`settled`, `quick-win`, `new`), and that is the
  honest answer rather than a guess about what a review from six weeks ago covered.

## Step 9: assert completion

Confirm every open PR is accounted for: rows you filed, plus the informational groups,
checked against the scan's `open` count.

If any PR ended in neither, list those numbers and say the sweep is incomplete. Never
claim the sweep is done when it is not.
