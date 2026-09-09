# Pull-request review rows

Read when this tick has a row on the standing `pr` roadmap. Nothing here applies to any other row.

## Pull-request review rows

A sixth thing this protocol conducts, and it is not a sixth KIND of row: a pull request is an
ordinary task. Spec: `docs/specs/2026-09-07-pr-review-in-orchestra-design.md`. The `pr-sweep` skill
writes the roadmap and `pr-triage` is what its workers follow.

**What one is.** A row on the standing `pr` roadmap, published `destination: local` so it reaches
neither the issue tracker nor anything the repository carries. Its ID is `PR<number>`, its branch is
`pr<number>-review`, and its register row carries **`base`** — the sha of the pull request's own
head, fetched by the sweep (`git fetch origin pull/<N>/head`). `base` is the only field on that row
no command writes.

**The launch differs in exactly one token**, and step 8's launch line names it:

```sh
git worktree add <worktrees>/<slug> -b <branch> <base>
```

`<base>` instead of the project's main branch. The `-b` form is unchanged, so `guard-claim` sees the
gesture exactly as it does for anything else — but a review roadmap is published `destination:
local`, where a claim is recorded nowhere, so the guard lets the launch through rather than demand
evidence that store cannot produce (`startVerdict`'s `unrecordable`, `lib/roadmap/policy.mjs`).
`orchestra roadmap claim` comes first exactly as it does for anything else — the guard is the
backstop, not the mechanism — and the worktree is the pull request as its author wrote it. **A row
with no `base` is not launchable**: cutting from main would give the worker your own code to review.
Say so and fetch it rather than launching anyway.

Everything else is the protocol you already run. The framing pass IS the sweep's own step 6 — the
board, then the grouped questions, with `options` on every `pending[]` item — so a review row
arrives with its forks already answered. Its one interruption, **when it has one**, is the hands-on
gate: a pull request that ships something a human looks at or uses gets the same treatment as any
other such row — the maintainer opens the server the worker started and tries the PR themselves. A
pull request that ships nothing of the sort gets no interruption at all, exactly as
`## The hands-on gate` says of everything else; its verdict and its pending review are reported at
the checkpoint like any other report. The review brief's own dev-server line is conditional for
this reason.

**The card links out to the pull request on its own, and you write nothing to make it.** The page
reads the number off the row id (`PR<number>`, the branch as fallback) and the repository out of
this checkout's `origin`, and draws `open the pull request on GitHub →` under `what to open`
(`pullRequestUrl`, `lib/monitor/model.mjs`). So **do not put the pull request in `links[]`** — a
hand-written copy collapses onto the derived button anyway, deduplicated by URL, and writing it is
work that buys nothing. `links[]` on a review row is for everything else the maintainer should be
able to open: a preview deployment the PR builds, the run that failed.

**How a row ends.** Never by anything anybody types.

| The worker's verdict | What happens | Status |
|---|---|---|
| `merge` | the maintainer clicks Merge on GitHub; one of the row's recorded subjects — the PR title, with and without ` (#<N>)` — reaches main | `landed`, derived, on a later tick |
| `review` | a pending review is left; the ball is with the maintainer, then the author | `review` until the PR moves |
| `decline` | a direction file is written and a decline note drafted to paste | `dropped` |
| `dismissed` | one ledger line and nothing else | `dropped` |

The ledger's word is `dismissed`, not `dismiss`: `orchestra pr log` accepts `review`, `merge`,
`decline` and `dismissed`, and refuses anything else rather than writing it.

Three mechanical consequences, each verified against the derivation and none of them obvious:

- **`landed` needs two things you own.** First, the row's `subjects` must carry **the pull
  request's TITLE IN BOTH ITS SQUASHED FORMS — `<title>` and `<title> (#<N>)` — alongside the
  branch's commit subjects**, written at the moment step 4 names: the worker's `merge` verdict. No
  gate runs on a review row, so nothing else will ever write them. Both forms, because
  `deriveLocalStatus` matches an exact string and **GitHub's DEFAULT squashed subject is the title
  with the number appended**; a repository whose `squash_merge_commit_title` is set the other way
  writes the title alone. Recording both costs one array element and is right either way, where
  recording one misses `deriveLocalStatus`'s match on the ordinary squash merge, not on the edge
  case below. Second, THIS checkout's main must have fetched the merge — `gatherGit` reads local
  refs and nothing fetches for you. Until both hold, a merged PR still reads `claimed`.
- **`dropped` is terminal and stops the scheduler** (`orchestra ready` skips it, `orchestra archive`
  files the row away), but the board derives from git, which has no `dropped` to derive: so
  `orchestra roadmap board` prints one `correction:` line for such a row until the next sweep drops
  the task or `archive` takes the row. That is noise, not a disagreement. Say so at the checkpoint;
  do not "fix" the row by changing its status back.
- **Delete the worktree and the `pr<number>-review` ref only once the row is TERMINAL** — `dropped`
  after a `decline` or a `dismissed`, or `landed` once the merge has derived. No gate runs on a
  review row, so nothing else will delete them, and a leftover ref on a terminal row keeps the board
  deriving `claimed` and collides with the next sweep's fetch of the same PR.
  **On `merge` before it has landed, and on `review`, the ref is load-bearing and stays.** It is
  what `deriveLocalStatus` reads as `claimed`, so deleting it early is precisely what manufactures a
  phantom relaunch: `reconcileTasks` sees the ref gone, writes the row back to `todo` with
  `ref gone; check worktree before relaunch`, `computeReadySet` admits it to the ready set, and the
  tick prints a `launch:` line for a pull request the maintainer has already been asked about. A
  second worker then drafts a second pending review on a PR that already has one.

**The one thing you never do: merge the pull request, or run `orchestra land` on a review row.** The
gate is for branches this project owns. `pr-triage`'s first hard rule is the worker's and it is
yours: the only write anywhere on GitHub is a PENDING review, private to the maintainer. No merge,
no close, no label, no assignee, no comment. Orchestra having a merge gate does not soften it.

**The squash-merge hole, stated rather than discovered.** Recording the title in both its forms is
what makes an ORDINARY squash derivable: GitHub's default squashed subject is the PR title with
` (#<N>)` appended, a repository configured the other way writes the title alone, and the row
carries both so neither configuration has to be known. What is left is narrower — a squash whose
subject the maintainer REWROTE in the merge
box is a subject the register never recorded, so §2's derivation cannot see the merge and the row
reads `claimed` after a real one. The next sweep catches it — it reads the pull
request's state from GitHub, not from git — so the failure is bounded by one sweep interval and is
never silent. It is deliberately not worth code: recording a second identity for the same commit
would be a second source of truth for a fact GitHub already answers.
