# Offline leaves no trace — design

Extends §3.1 (the off switch and `init`), §5 (the merge gate) and §11 (onboarding) of
[`2026-09-02-orchestra-plugin-design.md`](./2026-09-02-orchestra-plugin-design.md). Nothing there is
superseded: offline mode gains an invariant it never stated.

## 1. What changes, and why

Offline mode's own claim is one machine, one register, one owner. The repository, though, is
shared — and today an offline project's git history and working tree announce that orchestra is in
use. That was never intended; it was simply never a requirement. It is one now:

> **In offline mode, nothing orchestra produces may enter a commit.** A developer cloning the
> repository must not be able to tell that orchestra is used.

Measured rather than assumed — `orchestra init --mode offline` in a throwaway repository on
2026-09-08, then `git status` and `git add -A -n`:

| # | trace | reaches other developers? |
|---|-------|---------------------------|
| 1 | `.orchestra/config.json`, `.orchestra/.gitignore` | untracked, but **nothing ignores them**. The `.gitignore` `init` writes lives *inside* `.orchestra/` and lists sub-paths, so it can never ignore its own parent. `git status` shows the directory; `git add -A` takes it |
| 2 | the `## Working with orchestra` block `init` appends to `CLAUDE.md`, naming `merge_agent` and `orchestra land` | **yes** — `CLAUDE.md` is committed |
| 3 | `ledgers: [".orchestra/tickets.jsonl"]`, written unconditionally by `detect()` | **yes** — `commitLedgers` (`lib/gate/land.mjs`) commits that file to the main branch at every landing |
| 4 | that commit's message: `chore(ledger): … Committed by the merge gate` | **yes**, in shared history |
| 5 | a worker naming orchestra in a commit message, a spec or a plan | **yes**, by accident |

Branches and worktrees do not leak: offline never pushes, and `land` rebases and fast-forwards, so
there is no merge commit carrying a branch name into history.

### Decisions recorded at brainstorming (2026-09-08)

- The guarantee is about **commits**, not about the working tree. `.orchestra/` stays where it is
  and becomes invisible to git. An untracked file never reaches another clone.
- The rules block reaches agents **through the worker brief**, not through a file the repository
  carries. The plugin's own hooks already enforce what the block describes.
- A guard **refuses**, so the invariant is true rather than hoped for. It lives in the **merge
  gate**, not in a `PreToolUse` hook — see §5.
- No escape hatch for a project whose vocabulary legitimately holds the word. If that ever bites,
  the refusal message is precise enough to act on, and a config key can be added then.
- **Online mode is unchanged.** It publishes GitHub issues; visibility is the point there.

## 2. The exclusion leaves the repository

`init --mode offline` stops writing `.orchestra/.gitignore` — a committed file that could not ignore
its own directory anyway — and instead appends one anchored line to the per-clone exclude file:

```
/.orchestra/
```

written to `<git common dir>/info/exclude`. Git neither commits nor transmits that file, so the
exclusion is real for this checkout and invisible everywhere else.

Verified on a throwaway repository: with that line present, `git status --porcelain` is empty,
`git add -A -n` selects nothing, and — the case worth checking rather than assuming — the exclusion
**also applies inside a linked worktree**, whose `$GIT_DIR` is `.git/worktrees/<name>` and not the
common dir. `git worktree add .orchestra/worktrees/<slug>` into an excluded directory is accepted
silently.

`lib/paths.mjs` gains `gitCommonDir(cwd)`, exported from the `git rev-parse
--path-format=absolute --git-common-dir` call `mainCheckout` already makes; `mainCheckout` becomes
its one-line caller. The append is idempotent on an exact line match, and creates `info/` if a repo
somehow lacks it.

The line covers `/.orchestra/` and nothing else, because that is what `init` writes. A project that
later repoints `roadmaps.published` at `docs/roadmaps` has deliberately chosen to commit its
roadmaps — `lib/config.mjs` already says so — and this design does not second-guess it.

`GITIGNORE` in `lib/cli/init.mjs`, and the reasoning comment above it, stay for online mode, which
still commits `.orchestra/config.json`.

Three pieces of prose describe the old behaviour and have to follow, or `init` reports something it
did not do: `successMessage`'s `wrote <…/.gitignore>` line becomes the exclude line it actually
appended; `usageText`'s `--mode offline` blurb and `lib/cli/doctor.mjs`'s `NO_CONFIG` both say
"gitignored" and should say excluded from this clone and never committed.

## 3. The ticket ledger is not a ledger offline

`detect()` proposes `ledgers: [DEFAULTS.tickets.file]` unconditionally, which is what makes
`.orchestra/tickets.jsonl` a **committed** file. Offline, the ticket queue is local working state
like everything else under `.orchestra/`, so `detect()` returns `ledgers: []` in that mode and
`--detect` reports it.

Nothing downstream breaks, and the existing comment in `init.mjs` explains why: without the path in
`ledgers`, `commitLedgers` commits nothing, and "the first branch that touches the ticket file is
refused by the clash check instead". Offline that clash cannot happen either — the file is excluded
from git, so no branch can touch it in git's terms. The two halves agree.

`detect()` therefore needs the mode, which today it does not take. It gains an options argument
(`detect(root, { mode })`); called without one — `--detect` before any mode is chosen — it keeps
proposing the ledger, which is the online answer and the conservative one.

## 4. The ledger commit message

Only reachable offline if a project configures a `ledgers` entry by hand, but *"Committed by the
merge gate, which is the only actor allowed to write the main branch"* in shared history is exactly
the leak being forbidden. `commitLedgers` already holds `cfg`, so the body is chosen on `cfg.mode`:
offline gets a neutral sentence naming no tool, online keeps today's prose, which is useful there.

## 5. The trace guard, in the merge gate

**Why the gate and not a hook.** The main branch is the only branch that will ever be pushed, and
`orchestra land` is the only way into it. The gate sees the real commits and the real diff; a
`PreToolUse` hook sees only the text an agent typed, and so misses `git commit -a`, an alias, a
script, or any commit made outside the Bash tool. The gate is where the invariant can be made true.
The cost, stated plainly: the refusal arrives **late**, after the branch is written — which is what
§6 exists to soften.

**Where in the landing.** Immediately after the rebase and before the first gate runs: after,
because the rebase is what makes the commits and the diff "the change as the main branch will
receive it" — the landing sequence already reads `changed` at that point for the same reason; and
before, because refusing costs nothing and a suite costs minutes.

**The decision is pure, the git calls are not.** `lib/gate/land.mjs` opens with "Nothing here
decides anything. Every decision worth a test is in ./state.mjs", so the matcher goes in
`lib/gate/state.mjs`:

```js
export const TRACE = /orchestra|merge_agent/i;
export function offlineTraces({ paths, commits, diff }) // → [{ where, text }]
```

`land.mjs` supplies the three inputs, all against the rebased branch:

- `paths` — `git diff --name-only <main>...<branch>`, so a force-added file under `.orchestra/`
  cannot slip past the exclusion.
- `commits` — `git log --format=%H%x00%B%x00 <main>..<branch>`, every message the fast-forward
  will carry. The trailing NUL is what makes a multi-paragraph body splittable; `%B` alone is not.
- `diff` — `git diff <main>...<branch>`, of which only **added** lines are scanned (`^\+`, never
  the `+++` header), located by the `+++ b/<path>` in force. A deletion that removes the word is
  not a trace, which matters for §6's removal of the `CLAUDE.md` block.

Refusal follows the shape a refusing gate already uses a few lines below: `mark(p, branch, 'held',
…)` with a reason naming `offline-trace`, then `return S.EXIT.refused`. Stderr lists each offending
place as `<file>:<line>` or `commit <short sha>` with the matching text, capped at the first ten
with a count of the rest. The check is skipped entirely when `cfg.mode !== 'offline'`.

## 6. The rules reach agents through the brief

`init --mode offline` no longer touches `CLAUDE.md`. It writes the same
`templates/CLAUDE-rules.md` content to `.orchestra/CLAUDE-rules.md` — inside the excluded directory,
never committed — and the conductor's brief step in `skills/orchestra/SKILL.md` includes that
file's content when it exists. One template, two deliveries: appended to `CLAUDE.md` online,
carried by the brief offline.

`templates/CLAUDE-rules.md` gains one rule, which is the early warning §5 refuses late on:

> **Nothing that is committed names orchestra** — not a commit message, not a spec, not a plan, not
> a comment. The work is the project's; the tool that scheduled it is not part of the record.

**Flipping online → offline.** `init --force --mode offline` finds the block already in `CLAUDE.md`,
and possibly already committed. It removes the block from the file — a working-tree edit — and
prints what it cannot do: the deletion has to be committed by hand (with a message that names
nothing), and history still holds the block. It likewise finds paths under `.orchestra/` that are
already **tracked** and prints the exact `git rm --cached` for them rather than running it: an
untracking is a deletion someone must commit, and orchestra writing that commit is the very thing
this design forbids.

## 7. What `doctor` makes observable

Offline projects get one `trace` row, so the invariant is checkable instead of believed. It reports
clean, or names each failure:

- `/.orchestra/` missing from `<git common dir>/info/exclude`
- anything `git ls-files` returns that matches `TRACE`
- the rules block still present in `CLAUDE.md`

Online, the row is absent.

## 8. What this does not cover

- A commit made by a human directly on the main branch, outside the gate. No hook and no process
  sees it.
- History that already holds a trace. `doctor` reports it, `init` names it, and neither rewrites it.
- A project whose own vocabulary holds the word: the guard refuses it, by decision. The refusal
  names the file and line, so the reword is mechanical.

## 9. Tests

- **`init` offline, end to end** (`test/init.test.mjs`): writes `/.orchestra/` to the exclude file
  and no `.orchestra/.gitignore`, leaves `CLAUDE.md` absent, writes `.orchestra/CLAUDE-rules.md`,
  and reports `ledgers: []`. Appending twice adds one line.
- **`detect`**: `{ mode: 'offline' }` yields `ledgers: []`; no mode, and online, keep the ticket
  ledger.
- **The flip**: `init --force --mode offline` over an online project removes the `CLAUDE.md` block
  and names both the uncommitted deletion and the tracked `.orchestra/` paths.
- **`offlineTraces`** (`test/gate-state.test.mjs`): pure, over a fixed diff and log — a matching
  commit message, a matching added line, a matching path, an added line that only *removes* the
  word, and a clean branch.
- **The gate refuses** (`test/p3-acceptance.test.mjs` or its own): a real repository, a real branch,
  a landing refused with `EXIT.refused` and the offending location on stderr, before any gate runs;
  the same branch lands once reworded; the same branch lands unchanged in online mode.
- **The whole promise** (`test/both-modes.test.mjs`): an offline project taken through `init`, a
  worker commit and a landing, asserting `git ls-files` matches nothing against `TRACE` and no
  commit message on the main branch does either.

## 10. Out of scope

Online mode. Rewriting history that already carries a trace. Renaming the `.orchestra/` directory
itself — it never leaves the machine. Hiding orchestra from someone with access to this checkout,
which offline mode's "one machine, one owner" already assumes away.
