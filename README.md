# Orchestra

A Claude Code plugin that conducts a project's development with background worker sessions, a monitoring page, and a one-at-a-time merge gate. Roadmaps live on GitHub or as local markdown files.

**Two modes:**
- **Online:** Roadmaps published as GitHub issues in any repository
- **Offline:** Roadmaps stored as markdown files under `.orchestra/roadmaps`, excluded from this
  clone and never committed

For the full design and specification, see [docs/specs/2026-09-02-orchestra-plugin-design.md](docs/specs/2026-09-02-orchestra-plugin-design.md).

## Install

```sh
claude plugin marketplace add nicolas-rabault/orchestra
claude plugin install orchestra@orchestra
```

The repository is private, so `add` clones it with whatever git credentials the machine already
carries — a `gh auth login` over HTTPS is enough. A local checkout serves as a marketplace just as
well, which is how to develop the plugin: `claude plugin marketplace add ~/Projects/orchestra`.

Nothing to build and nothing to install alongside it: every module imports only node builtins, and
a test enforces that.

## Opt a project in

```sh
orchestra init --mode offline   # or --mode online, if roadmaps should be GitHub issues
```

`offline` keeps roadmaps as markdown under `.orchestra/roadmaps` — excluded from this clone, and
**never committed by orchestra itself**: offline mode is one machine, one register, one owner, so a
roadmap is this checkout's working state rather than something the repository carries. A project
that wants its roadmaps shared points `roadmaps.published` at a committed directory
(`docs/roadmaps`, say) and commits them itself; `publish` writes the file and stops there either
way. `online` publishes them as GitHub issues and needs the `gh` CLI.

`init` always writes `.orchestra/config.json` (detecting a build system and proposing gates where
it can, asking rather than guessing at everything it cannot). What it does with the project's hard
rules depends on the mode: online, it appends them to `CLAUDE.md` (creating the file if there is
none) and writes a committed `.orchestra/.gitignore`; offline, it writes them to
`.orchestra/CLAUDE-rules.md` instead — excluded from this clone, like the rest of `.orchestra/` —
and touches `CLAUDE.md` only to remove a block a previous online `init` left there. Run
`orchestra init --detect --json` first to see what it would propose without writing anything, and
`orchestra doctor` afterwards to see the resolved configuration with every defaulted key marked.

**The absence of `.orchestra/config.json` is the plugin's off switch.** In a project that has not
opted in, every command exits 0 and prints nothing, so the plugin is safe to install globally. The
three exceptions are `doctor`, `orchestra instances`, which answers about the machine rather than
about a project, and `orchestra init` itself, which is the command that writes the file in the
first place.

The config's most important key is `gates`, the merge gate's own checklist for a landing. **A gate
is a shell command and nothing more**, so the plugin has no opinion about what the project is
written in — this one happens to be Rust:

```jsonc
{
  "mode": "offline",
  "gates": [
    { "name": "lint",  "cmd": "cargo clippy -- -D warnings" },
    { "name": "suite", "cmd": "cargo test" },
    { "name": "visual", "cmd": "make gate-visual",
      "skipWhenAllPathsMatch": ["docs/**", "**/*.md", "tests/**"] }
  ],
  "pr": { "ledger": ".orchestra/pr-log.jsonl", "direction": ".orchestra/direction" }
}
```

`pr.ledger` is the append-only record of what was reviewed, at which head and with what verdict;
`pr.direction` is the directory holding the principles a decline writes down. Both default under
`.orchestra/`, which git never sees either way: offline, `init` excludes the whole directory in this
clone; online, both paths are in the `.orchestra/.gitignore` `init` writes. So **a review run adds
nothing to the repository it is reviewing** — which is the founding constraint of the whole feature.
An online project initialised before those two entries existed does not have them: `git check-ignore
.orchestra/pr-log.jsonl .orchestra/direction/` says whether yours does, and adding the two missing
lines to `.orchestra/.gitignore` by hand is the repair (`init` refuses on a project that already has
a config, and `--force` would rewrite that config too).
A fresh clone therefore starts with no memory, deliberately. A project that would rather share its
principles points `pr.direction` at `docs/direction` and commits them like anything else, which is
the reason it is a key rather than a fixed path.

Gates run in the order written — cheapest first is the project's own call, not a rule this plugin
enforces — and `skipWhenAllPathsMatch` skips a gate only when every changed path matches one of its
globs; an unreadable or empty diff runs the gate rather than skip it. `init` proposes a `suite`
gate from whichever of `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod` or a Makefile
`test:` target it finds, plus a `deadcode` or `lint` gate ahead of it where `package.json` names
one; adding `visual`, or anything a detector cannot see, is by hand afterwards. A project it
recognises nothing in still adopts orchestra — it just lands with no gate until one is written in.

Then, once, per project:

```sh
orchestra install-heartbeat
```

## What works today

The roadmap layer, the register and the machine budget, the protocol that drives them, the merge
gate and `roadmap sync`, one monitoring page for the whole machine and `orchestra instances`, the
guard hooks, `orchestra init`, the ticket queue and the heartbeat — every phase of the extraction
has landed:

- **`/orchestra`** — the conductor protocol: the nevers, the journal, the framing pass, the nine
  steps of a tick, the hands-on gate, and the worker briefs as templates a project fills from its
  own config (`briefExtra` is where it pastes its own hard rules).
- **`/roadmap`** — the skill: the grammar, the board, and the nine roadmap subcommands.
- **`orchestra doctor`** — the resolved configuration, and how a project with no config is told
  what to write. It also warns when a config still carries a leftover `monitor.port` key, which
  nothing reads any more now that one page serves the whole machine.
- **`orchestra roadmap <lint|board|publish|enrol|claim|release|open|reserve|sync>`**. A roadmap may
  declare `destination: local` in its frontmatter and then publishes under `roadmaps.published`
  whatever the mode is — visible to this machine only, which is what a pull-request sweep uses.
- **`orchestra pr <scan|log>`** — `scan` is the read-only metadata pass over every open pull
  request, each one routed into a group and folded against the ledger, `--json` for the machine-
  readable form; `log` appends one ledger record (`review`, `merge`, `decline`, `dismissed`) with
  the clock measured and an unknown verdict refused. **Neither writes anything on GitHub**, and
  nothing in this plugin ever does beyond a pending review a person submits themselves.
- **`/pr-sweep` and `/pr-triage`** — the two skills that carry the judgement: the sweep routes every
  open PR, publishes the batch as a `destination: local` roadmap and asks the framing questions; the
  triage deep-reviews one PR and drafts a **pending** review. The conductor runs the rows, one
  background worker per pull request on a worktree cut from its own head.
- **`orchestra journal|inbox|beat|lock|watch-answers|watch-workers`** — the register: one line with
  a measured clock, the answers a user posted on the page, who holds the baton, one conductor at a
  time, and the conductor's two watches — answers within seconds, and an `OWED:` line when a worker
  is stopped on a live row or a relay is written and not delivered.
- **`orchestra ready|drive|tick-gate|tick-outcome|yield-check`** — the launch plan, the resume cycle,
  whether a heartbeat should tick at all, what the slot it spent actually bought, and whether this
  session should hand the baton back. `tick-outcome` reads the tick's own transcript back: a slot
  that conducted nothing and ended on the account ceiling is journalled, and the reset time the
  message states in plain language becomes the `budgetResetAt` that stands the next slot down —
  otherwise the same refusal is re-earned an hour later, twice measured. `ready` names
  what the tick owes its workers first (`UNDELIVERED:`, `IDLE:`) and proposes NO launch while one is
  owed (`LAUNCHES HELD:`) — a warm session pays no brief and a new one pays all of it — then budgets
  its launches against every other orchestra on this machine (`~/.orchestra/machine.json`,
  `maxWorkers`, default 8).
  `drive` resolves both lines: it stops the background registration, resumes each session in its
  worktree with the row's own relay at the head of the nudge, detached so the turn survives the
  600-second ceiling, and writes the relay's receipt only when that turn has returned — a
  `deliveredAt` written by any other hand is not delivery.
- **`orchestra monitor`** — one monitoring page for the whole machine, runnable from any directory:
  the register as a graph, the journal and the user's answers as one rail, the screenshots a
  question names, and a box to answer in, with a project tab strip above it for every project the
  machine registry (or the current directory) names. It serves in the foreground on 127.0.0.1,
  opens a browser unless given `--no-open`, and if the page is already up anywhere it prints that
  URL and exits rather than binding a second one. `--no-open` is its only flag: the port has one
  source of truth, `4380` by default, overridable by `monitorPort` in `~/.orchestra/machine.json`,
  probed upward for a free one, and the port **actually bound** — with the pid that bound it — is
  what `~/.orchestra/monitor.json` records, so the page keeps the same URL across restarts. The
  page is the only writer of `.orchestra/inbox.jsonl`. It starts nothing: an answer posted on it
  reaches a live conductor through that session's `watch-answers` loop within seconds, and
  otherwise waits in the inbox for the next tick.
- **`orchestra instances`** — the one page's URL (or why there is none) above a table of every
  orchestra registered on this machine, in the order its row prints them: name, id, mode, worker
  count, a truncated conductor session id, how long since its last beat, how long since it reported
  itself, and its root. Like `doctor` and `monitor`, it answers without a project config.
- **`orchestra archive|archive-images`** — move a finished run's prose out of the register, and
  sweep the photographs under `.orchestra/images/` that nothing live still names.
- **`orchestra land <branch> [--detach] | await <branch> [--for=N] | queue-list`** — the merge gate:
  one branch at a time behind a lock, the project's own `gates` run in order in the rebased
  worktree, a fast-forward, and the worktree and ref deleted. `--detach` and `await` exist because a
  landing outlives the 600-second ceiling on an agent's tool call; the outcome is on disk, so any
  session can collect it. A refusing gate returns 11 **and names itself**; a gate whose own process
  was killed before it reached any verdict — or a machine with no disk left — returns 17 instead, so
  a branch is never charged for a suite that never judged it. Every passage appends one line to
  `.orchestra/gate/attempts.jsonl`, and `await` and `queue-list` print the history back: `runs/` is
  one file per branch and answers "what is happening now", the ledger answers "how many times, and
  why".
- **`orchestra roadmap sync`** — online: close what landed, move the `status:` labels, tick each
  programme's checklist, close a finished roadmap. Offline it does nothing, and that is correct:
  there is nowhere to write a status.
- **`merge_agent`** — the agent that runs the gate, resolves a conflict and reports. Nothing else
  should land a branch.
- **The guard hooks** (`hooks/hooks.json`) — `guard-main-edit` and `guard-main-commit` keep main
  integrate-only (the second refuses `git commit` **and** `git merge` on it too, `--abort` /
  `--continue` / `--quit` exempted, overridden by `ORCHESTRA_GATE=1`); `guard-full-suite` refuses a
  bare invocation of the `suite` gate; `guard-draft` keeps a roadmap draft off `git add`;
  `guard-claim` refuses a `git worktree add -b <branch>` the board does not show claimed by you,
  failing open when the channel is unreachable, and open too on a row no channel carries — offline,
  and a `destination: local` roadmap in any mode, where a claim is recorded nowhere and demanding
  one demands what that store cannot produce — and closed on a cached board; `lint-roadmap` reports
  a roadmap format issue after every edit; `orchestra-inbox` injects an unread answer into a live
  interactive session. Every one of them exits 0 and silent with no `.orchestra/config.json`.
- **`orchestra init [--mode online|offline] [--force] | --detect [--json]`** — see "Opt a project
  in" above.
- **`orchestra tickets <list|add|close|show>`** — the ticket ledger at `cfg.tickets.file`
  (`.orchestra/tickets.jsonl` by default), upserted on a coarse fingerprint, behind a
  30-second-then-throw queue lock shared with the merge gate's own ledger commit.
- **`orchestra install-heartbeat [--print]`** — one launchd agent (macOS) or systemd user timer
  (Linux) per project, labelled `com.orchestra.<id>`, refusing a label already held by a different
  project's checkout. **The systemd path is written from the launchd path's own shape and is not
  exercised by any test in this plugin** — verify it by hand. Never a crontab entry: a cron job runs
  outside the login session and cannot read the login keychain.

A conductor launches its workers with the harness's own `claude --bg`; there is no launcher in the
plugin, and `ready` produces a plan rather than executing one. Those launches, and the heartbeat's
own hourly tick, need a one-time interactive acceptance of `claude --dangerously-skip-permissions`
granted once on this machine. **`doctor` does not check for that acceptance, deliberately**: there
is no documented file whose content states whether it was granted, and a `doctor` row that guessed
would read as a check while checking nothing. `init` prints the step as a reminder instead, and the
`orchestra` skill's own preflight proves it on a throwaway session before planning any launch.

---

Extracted from `planetCraft` at commit `86bf8412`.
