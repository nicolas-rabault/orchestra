# Reviewing pull requests with orchestra — design

Adds a sixth thing this plugin can conduct. Nothing in
[`2026-09-02-orchestra-plugin-design.md`](./2026-09-02-orchestra-plugin-design.md) or
[`2026-09-04-machine-wide-monitor-design.md`](./2026-09-04-machine-wide-monitor-design.md) is
superseded. Two of their mechanisms grow: the register row gains a `base` (§6) and the worker
briefs gain a third form (§7). Both are named there rather than left to be discovered.

## 1. What this is

Two skills exist in `huggingface/leLab` under `.claude/skills/` — `pr-sweep`, which routes every
open pull request into a group with a recommended action and an order, and `pr-triage`, which
deep-reviews one PR and drafts a pending review on GitHub. They work. What they cannot do is run
more than one review at a time, show what is waiting anywhere but in a chat transcript, or let the
maintainer test a PR without checking it out by hand.

Orchestra already does all three for development tasks. So: **a pull request becomes a roadmap
task**, and the conductor runs a review the way it runs anything else — one background worker per
PR, a worktree it can serve from, questions on the monitoring page, and a status derived rather
than written.

Both skills move into this plugin and lose everything specific to one repository.

### Decisions recorded at brainstorming (2026-09-07)

- **The skills become generic and live in the plugin.** `huggingface/leLab` in hard-coded strings,
  `.claude/direction/`, `.claude/pr-state/log.jsonl` and `scan.py` all go.
- **A review task is an ordinary task**: a branch, a worktree, and the same lifecycle. There is no
  second kind of row, no eighth roadmap field, and no third exception to never #5.
- **Orchestra never writes to GitHub.** The worktree exists so the worker can read the PR and serve
  it; the maintainer clicks Merge. `pr-triage`'s first hard rule survives verbatim.
- **`Deps`, `Order` and `Lane` keep their existing meanings** — a real block, the sweep's
  recommended order, and two reviews that must not run at once. An arrow on the page is a block and
  nothing else.
- **The recommendation lives in the title and the `Why`**, and reaches the user as a framing-pass
  question with `options`. No badge, no field.
- **A per-roadmap destination**: the sweep's roadmap publishes to files this checkout keeps to
  itself, never to GitHub, whatever the project's mode. It is a per-roadmap property, not a
  per-project mode — and offline mode's own destination is already exactly that one.
- **One standing roadmap**, slug `pr`, rewritten by each sweep — not one roadmap per sweep.

## 2. Why the existing lifecycle fits without being bent

This was the design's central question and the answer is better than expected: the derivation in
[`lib/roadmap/board.mjs`](../../lib/roadmap/board.mjs) already describes a PR review exactly.

```js
function deriveLocalStatus(task, git, subjects = []) {
  if (subjects.some((s) => git.mainSubjects.has(s))) return 'landed';
  if (task.branch && git.refs.has(task.branch)) return 'claimed';
  return 'todo';
}
```

- `claimed` is "a local ref for this branch exists" — true from the moment the sweep fetches the
  PR's head into `pr<N>-review`.
- `landed` is "a recorded commit subject is in `main`'s subjects" — which becomes true, with no
  action from anyone here, on the first tick after the maintainer merges the PR on GitHub and this
  checkout fetches. A merge commit is not needed and a squash does not break it, because the
  register records the subjects and a squash keeps the PR title as one of them; §7 states the one
  case where it does not.
- `dropped` is already terminal and is what a decline or a dismissal writes.

So the gate is untouched, `orchestra land` is never called on a review row, and never #5 ("git
wins") holds without a new exception. **The single most important consequence: the status of a
review is not something anybody types.** The maintainer merging a PR is what closes its row.

## 3. What is new in the plugin

```
skills/pr-sweep/SKILL.md      the sweep, generic
skills/pr-triage/SKILL.md     the triage, generic
lib/pr/scan.mjs               the gh metadata pass, folded against the ledger
lib/pr/ledger.mjs             one line, one measured clock
lib/cli/pr.mjs                orchestra pr scan | orchestra pr log
```

No new store: `roadmaps.published` already defaults to `.orchestra/roadmaps`, gitignored, and the
file store already commits nothing — §4. Two config keys, because nothing here may hardcode a path:

```jsonc
"pr": { "ledger": ".orchestra/pr-log.jsonl", "direction": ".orchestra/direction" }
```

`pr.direction` is a key rather than a fixed path for one reason, stated here so nobody discovers it
later: **under `.orchestra/` the direction memory is gitignored, so a fresh clone loses everything
the sweep has learned.** That is already true of `.claude/direction/` in leLab today, so this is not
a regression — but a project that wants its principles shared points the key at `docs/direction/`
and they are committed like anything else. The default stays local, because a review run must add
nothing to the repository it is reviewing.

## 4. The local destination

`makeStore` ([`lib/store/index.mjs`](../../lib/store/index.mjs)) resolves a backend from
`cfg.mode`, which makes a destination a property of the PROJECT. A sweep roadmap needs one that is
a property of the ROADMAP: an online project's development roadmaps publish as issues, and its `pr`
roadmap must publish to neither GitHub nor anything the repository carries.

- **There is no third store.** The file store already writes under `roadmaps.published`
  (`.orchestra/roadmaps`, gitignored) and already commits nothing, so `destination: local` selects
  the FILE STORE whatever the project's mode — and in an offline project it selects the store that
  mode already had. Its `claim`, `release`, `openRoadmap`, `reserve`, `sync` and `overlay` need no
  variant: a local roadmap has, by construction, nobody to tell.
- **A draft declares its destination in frontmatter**, next to the `roadmap:` slug that
  [`lib/store/draft.mjs`](../../lib/store/draft.mjs) already reads:

  ```yaml
  roadmap: pr
  destination: local
  ```

  Absent, the destination is the project's mode, which is every roadmap that exists today.
- **`publish` routes on it. Online, `board` and `enrol` union both stores**, so `orchestra roadmap
  board` shows the `pr` roadmap beside the development ones and `orchestra ready` schedules them
  together under one machine budget. Offline there is nothing to union: one store holds both, and
  the `pr` roadmap is one more file beside the development ones. Either way a local roadmap's rows
  carry no overlay, so they derive from git and the register — §2.

`orchestra roadmap board` gains no new line kind. A local roadmap is not `unpublished:` — it is
published, to a place only this machine can see, which is the same thing offline mode already says
about every roadmap it has.

## 5. One standing roadmap

The sweep rewrites `<roadmaps.published>/pr.md` every time it runs. It does not write one roadmap per
sweep, for two reasons that are both load-bearing:

1. A task's key is `<roadmap>/<ID>` and an ID must be unused **by every roadmap**, not just by its
   own. Two sweeps that both file `PR91` collide the moment the second publishes.
2. `publish` already rewrites in place when exactly one file holds the slug
   ([`lib/store/files.mjs`](../../lib/store/files.mjs)), and `enrol` is append-only, so a rewrite
   keeps every register row — its session, its note, its recorded subjects — untouched.

Two rules follow, and neither is enforced by code:

- **A re-sweep carries forward every task still live in the register.** Dropping a task whose
  worker is running orphans that worker: `orchestra ready` stops counting it, the monitor stops
  drawing it, and nothing will collect its report.
- **A re-sweep is what closes a PR that was closed without merging.** Nothing else can see that:
  §2's derivation has no input that changes when a PR closes, so the row would sit `claimed`
  forever. The sweep reconciles the roadmap against GitHub's PR states and writes `dropped`.

### The shape of a task

```
### PR91 — merge: bump npm_and_yarn group across 1 directory

- **Roadmap** pr
- **Order** 1
- **Deps** —
- **Touches** `frontend/package-lock.json`
- **Branch** `pr91-review`
- **Design** no
- **Lane** —

**Why.** Dependabot, green CI, scoped bump. `dependabot-default-merge.md` settles it: merge.

**Acceptance.** PR #91 is merged on GitHub and `git log main` carries its commit subjects.
```

The grammar is unchanged and the lint passes as written: `Branch`'s last segment starts with
`pr91-`, which is what reconciliation matches on.

The three relational fields carry their existing meanings and no others:

| Field | On a PR row |
|---|---|
| `Deps` | reviewing this PR is wasted work until that one is settled — it rebases on it, shares its premise, or waits on the same direction ruling. This is the only thing that draws an arrow on the page |
| `Order` | the sweep's recommended order: settled clears, then small focused fixes batched by author, then PRs whose author has moved, then features, then the PRs that force a direction ruling |
| `Lane` | two reviews that must not run at once |

## 6. The launch, and the one monitor change

The sweep fetches every PR head it files:

```sh
git fetch origin pull/<N>/head
```

and writes the resulting sha on the register row as **`base`**. The tick's launch
(`skills/orchestra/SKILL.md`, "Launch, and the names") then differs from today in exactly one
token:

```sh
git worktree add <worktrees>/<slug> -b pr91-review <base>
```

The `-b` form is unchanged, so `hooks/guard-claim.mjs` sees the gesture exactly as it does for any
other task, and the branch that the derivation in §2 reads into existence is created the same way.
Its verdict differs, and must: a review roadmap is published `destination: local`, whose `claim`
records nothing, so the guard fails open there instead of refusing a row whose store can never show
a claim (§10).

`base` also reaches `invokeCommand`
([`lib/monitor/model.mjs`](../../lib/monitor/model.mjs)), which hardcodes `cfg.mainBranch` as the
base of the copyable launch block. That block is documented as agreeing with the protocol "word for
word on the facts", so a PR row would make it wrong. The fix is `node.base ?? cfg.mainBranch`, and
it generalises honestly: any task that must branch from something other than main was already
mis-served by that line.

**This is the only change to the monitor.** The rest is already there: `Deps` becomes an edge, the
title and the `Why` are on the card, `pending[]` with `options` becomes buttons, `note` carries the
worker's verdict, and the dev server the worker starts is discovered from the row's `port`.

## 7. The worker, and the end of a row

### A third brief

Alongside the execution and design briefs, filled from the same substitution table plus `{pr}` and
`{repo}`:

```
You are reviewing pull request #{pr} on {repo}, in this worktree, checked out at the PR's own head.
Task {task} — {title}. Your roadmap excerpt, verbatim:
{excerpt}
Follow the pr-triage skill exactly; its hard rules are yours. Never publish anything on GitHub
except a PENDING review. Never merge, close, label or assign. Never write a direction principle the
maintainer did not state.
Before anything else: git fetch origin pull/{pr}/head, and say whether it has moved since {base}.
{briefExtra}
Write to me in {language}.
Protocol: <the shared protocol paragraph — report as your FINAL message, messaging back does not
work>.
When this PR ships something a human reads or runs, start the dev server and report the port it
ACTUALLY bound plus its pid: the maintainer tests it themselves at the hands-on gate.
Record your verdict before you stop:
  orchestra pr log {pr} <verdict> --head <sha> --comment <id> --note "…"
```

### The framing pass is the sweep

`pr-sweep` step 4 — the board, then the grouped questions — **is** the framing pass the conductor
protocol already describes: every fork put to the user at once, before any launch, with the answers
recorded on their rows and never re-asked. It is written as `pending[]` items carrying `options`,
so the page renders one button per choice.

Each row then gets **one interruption for its whole life**, and for a PR row that interruption is
the hands-on gate: the maintainer opens the server the worker started and tests the PR. That is the
same budget every other row has, spent on the one thing a human does better than a suite.

### How a row ends

| Verdict | What happens | Status |
|---|---|---|
| `merge` | the maintainer clicks Merge on GitHub; the row carries the PR's commit subjects | `landed`, derived, on a later tick |
| `review` | a pending review is left; the ball is with the maintainer, then the author | `review` until the PR moves |
| `decline` | a direction file is written and a decline note drafted to paste | `dropped` |
| `dismiss` | one ledger line and nothing else | `dropped` |

**The one case §2's derivation cannot see**: a squash-merge whose commit subject the maintainer
edited to something the register never recorded. The row then reads `claimed` after a real merge.
The next sweep catches it — it reads the PR's state from GitHub, not from git — so the failure is
bounded by one sweep interval and is not silent. It is not worth code: recording a second identity
for the same commit would be a second source of truth for a fact GitHub already answers.

## 8. `orchestra pr`

Two subcommands, both modelled on things that already exist here.

- **`orchestra pr scan [--json]`** — the read-only metadata pass over every open PR: size, age,
  idle days, CI, direction flags, shape signals, and the ledger record, each PR already routed into
  a group. Its `gh` calls take an injection seam, the way `lib/store/github/` does, so the tests
  never reach the network. The repository is read from `gh repo view`, never hardcoded.
- **`orchestra pr log <pr> <verdict> --head <sha> --comment <id> [--note "…"]`** — one ledger line,
  appended, with the clock **measured and not typed**. It is `lib/register/journal.mjs` applied to
  a second file, and it exists for the same measured reason: the leLab ledger asks a skill to
  `printf` a JSON object by hand, and the orchestra journal that was written that way had 75% of
  its timestamps ending in `:00` or `:30` and four lines truncated mid-JSON. An unknown verdict is
  refused rather than written, and a file not ending in a newline is repaired before the append.

The ledger format is leLab's, unchanged, because it is already right: append-only, one object per
line, the last line for a PR being its current state, and a watermark (`head`,
`last_other_comment_id`) that is what lets the next sweep tell a PR that moved from one that did
not.

## 9. Tests

- **The local destination** — `board` unions the file and mode stores online; a republish rewrites
  in place and preserves keys; `destination:` frontmatter routes to the file store, and its absence
  falls back to the mode.
- **`orchestra pr log`** — measured clock, refused verdict, missing-newline repair, one complete
  line per append.
- **`orchestra pr scan`** — against a recorded `gh` fixture: grouping, the ledger fold, and a PR
  that moved since its watermark.
- **`invokeCommand`** — with `base` and without, proving the fallback is `cfg.mainBranch`.
- **`orchestra roadmap lint`** — on a real PR task, proving the grammar needed no change.

## 10. What this deliberately does not do

- **No merging, no closing, no labelling, no commenting.** The only write anywhere on GitHub is a
  pending review, which is private to the maintainer. This is `pr-triage`'s first hard rule and it
  is not softened by orchestra having a merge gate.
- **No badge and no eighth roadmap field.** The recommendation is an opinion formed at sweep time,
  not a fact about the task, and the grammar has stayed seven fields by refusing exactly this kind
  of addition.
- **No review of a PR against a base other than its own head.** The worktree is the PR as its
  author wrote it. Rebasing it onto main to see whether it still passes is a different question,
  and answering it would mean writing to a branch this project does not own.
