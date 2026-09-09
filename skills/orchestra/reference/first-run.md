# First run — onboarding, adoption, preflight

Read when `orchestra doctor` says this project has not opted in, when a tick finds no
`state.json` at all, or before the first `--bg` launch this MACHINE has ever made. A tick on a
project already conducting needs none of it.

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
