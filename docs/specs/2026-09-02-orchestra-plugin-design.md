# Orchestra as a portable Claude Code plugin — design

Status: approved 2026-09-02. Supersedes nothing; this repository starts here.

## 1. What this is, and where it comes from

`planetCraft` grew an autonomous development ecosystem over roughly a month: a **conductor**
(orchestra) that runs one background worker session per ready roadmap task, a **monitoring page**
that lets a human answer a worker's question from a browser, a **merge gate** that lands exactly one
branch at a time behind a lock, a **roadmap grammar** whose status is always derived and never
written, and a set of **hooks** that hold the rules a prompt cannot. Every rule in it was paid for:
the protocol document carries its own measurements, dated, because a rule without its evidence gets
"simplified" away by the next reader.

That ecosystem is worth having in other projects. This spec describes extracting it into a Claude
Code **plugin** that any project can install, with orchestra running in one of two modes:

- **online** — roadmaps live as GitHub issues, as they do in `planetCraft` today;
- **offline** — roadmaps are markdown files and nothing else.

### Decisions recorded at brainstorming (2026-09-02)

1. **Packaging: a Claude Code plugin.** Not a bare skill and not a vendored template. The decisive
   argument is hooks: the hard rules (main is integrate-only, never the bare full suite, never an
   unclaimed task) are held by the machine, and a plugin is the only artifact that carries skills,
   agents and hooks together into an arbitrary project.
2. **Offline storage: gitignored draft → gitignored publish.** A roadmap is drafted in a gitignored
   directory and `publish` moves it to `.orchestra/roadmaps/<slug>.md`, gitignored in its turn, and
   commits nothing. Same grammar, same `lint`, same `board` as online. Offline mode is one machine,
   one register, one owner, so a roadmap is that checkout's own working state and the repository
   carries none of it; a project that wants its roadmaps shared points `roadmaps.published` at a
   committed directory and commits them itself.
3. **Scope: core plus the ticket queue.** Core is orchestra, the monitor, the merge gate, roadmap in
   both modes, the hooks and the worker briefs; the ticket queue comes with it so the stand-down
   tick's S1/S2 sweep works out of the box. The execution queue (multi-machine routing) and retex
   stay behind, exposed as optional configuration.
4. **`planetCraft` is a deliberate fork.** It keeps its own copy and this plugin diverges from it. A
   fix here will not reach it, and a fix there will not reach here. What that buys is the freedom to
   change shape — the configuration seam and the two modes below rewrite paths a live conductor is
   reading hourly, and doing that to a running system was the risk not taken.

## 2. Shape

```
orchestra/
  .claude-plugin/plugin.json
  .claude-plugin/marketplace.json
  bin/orchestra                     one entry point; every subcommand dispatches from here
  lib/
    config.mjs                      the only place that knows about the target project
    paths.mjs                       main-checkout resolution and the project id (§3.2, §8.1)
    machine.mjs                     ~/.orchestra: the instance registry, ports, the worker budget
    store/{index,github,files}.mjs  online / offline backends behind one interface
    roadmap/                        parse, lint, board, publish, claim, enrol, sync
    register/                       state.json, journal, inbox, lock, beat, ready, tick-gate, archive
    gate/                           merge queue: lock, rebase, gates, ff-merge, cleanup
    monitor/                        the page and its server
    tickets/                        the ticket ledger
  skills/orchestra/SKILL.md         the conductor protocol
  skills/roadmap/SKILL.md           the roadmap grammar and CLI
  agents/merge_agent.md
  hooks/hooks.json  hooks/*.mjs
  templates/                        config.json, CLAUDE-rules.md, heartbeat.plist, heartbeat.service
  test/                             node:test
  README.md
```

**Zero npm dependencies, enforced.** The sources this is extracted from already import nothing but
node builtins; that becomes an invariant here, checked by a test. The target project installs
nothing, adds no npm script, and needs no `package.json`: every call is
`${CLAUDE_PLUGIN_ROOT}/bin/orchestra <subcommand>`. A Rust, Python or Go project works, provided
node is on the machine.

**One CLI, not fifteen paths.** `planetCraft`'s protocol names `node tools/orchestra/journal.mjs`,
`npm run roadmap -- board`, `node tools/merge-queue.mjs land` and a dozen others. Here it is
`orchestra journal`, `orchestra roadmap board`, `orchestra land`. Subcommands:

```
orchestra init                        write .orchestra/config.json and the gitignore
orchestra roadmap <lint|board|publish|claim|release|open|reserve|enrol|sync>
orchestra ready [--json]              the launch plan
orchestra journal <kind> <task> <text>
orchestra inbox                       answers the user posted on the page
orchestra lock <acquire|release>
orchestra beat | orchestra yield-check | orchestra tick-gate
orchestra watch-answers <session>     the two-second loop that makes an answer arrive in seconds
orchestra archive [--write] | orchestra archive-images [--write]
orchestra land <branch> [--detach] | orchestra await <branch> [--for=N] | orchestra queue-list
orchestra monitor                     serve the page
orchestra tickets <list|add|close|show>
orchestra instances                   every orchestra on this machine: project, port, mode, alive
orchestra install-heartbeat
orchestra doctor                      what is configured, what is missing, what mode
```

**The plugin is shared, so its own code, skills and docs are in English.** What it *says to the
user* follows `language` in the project's config. That is the exact inversion of `planetCraft`'s
rule, and it is written into the plugin's own contributing notes so it is not rediscovered.

## 3. The configuration seam

### 3.1 `.orchestra/config.json` — committed

One file in the target project. Everything that was hardcoded becomes a line in it.

```jsonc
{
  "name": "planetCraft",                      // what a human calls this project; shown on the page
  "mode": "offline",                          // "offline" | "online"
  "language": "français",                     // seeds conductor.language in the register
  "mainBranch": "main",
  "worktrees": ".orchestra/worktrees",
  "roadmaps": { "drafts": ".orchestra/drafts", "published": ".orchestra/roadmaps" },
  "docs": { "specs": "docs/specs", "plans": "docs/plans", "results": "docs/results" },

  "branchTests": "npm run test:branch",       // what a worker runs each iteration
  "gates": [                                  // the merge gate's stages, in order, cheapest first
    { "name": "deadcode", "cmd": "npm run knip" },
    { "name": "suite",    "cmd": "npm test" },
    { "name": "visual",   "cmd": "npm run gate:visual",
      "skipWhenAllPathsMatch": ["docs/**", "**/*.md", "tests/**"] }
  ],
  "ledgers": [".orchestra/tickets.jsonl"],    // tracked files the gate commits at the head of a landing
  "queue": null,                              // or e.g. "bash tools/queue.sh work --local {label} -- {cmd}"

  "monitor": { "port": "auto" },              // "auto" allocates and remembers one; a number pins it
  "tickets": { "file": ".orchestra/tickets.jsonl" },
  "briefExtra": ""                            // project-specific hard rules pasted into every worker brief
}
```

Defaults are supplied for every key except `mode`; `orchestra init` proposes the rest by detecting
`package.json`, `Makefile`, `Cargo.toml`, `pyproject.toml` or `go.mod`, and **asks rather than
guessing** for anything it did not find. `orchestra doctor` prints the resolved configuration and
names every key that fell back to a default.

**The absence of this file is the plugin's off switch.** Every hook, and every subcommand except
`init`, `doctor` and `instances` (which are machine-level and answer without a project), is a
silent no-op when `.orchestra/config.json` is not found. That is what makes the plugin safe to
install globally: in a project that has not opted in, it does nothing at all.

### 3.2 Runtime state, and where it resolves

Beside the config, gitignored by an `.orchestra/.gitignore` that `init` writes:

```
.orchestra/state.json  journal.jsonl  inbox.jsonl  archive.jsonl
.orchestra/conductor.beat.json  tick.lock  drafts/  worktrees/  images/
```

**Runtime state always resolves to the main checkout, never to the worktree the caller is standing
in.** `git worktree add` copies no untracked file, so a worker's worktree has no register, no journal
and no drafts; a tool that resolved them relative to `cwd` would silently create a second, empty set.
`lib/paths.mjs` resolves the main checkout from `git rev-parse --git-common-dir` and every runtime
path hangs off that. The *config* is the opposite: it is committed, so the worktree's own copy is
correct and is the one used — which also means a branch can change a gate and have that gate apply to
its own landing.

## 4. The two modes

### 4.1 The seam is a domain interface, not an imitation of GitHub

`planetCraft`'s `github.mjs` is already the single injectable place that talks to GitHub, but it
speaks *issues, labels, assignees*. Making a markdown backend impersonate those would be the wrong
seam: the file store would spend its life faking a vocabulary it has no use for. The interface is
lifted one level, to roadmap concepts:

```js
Store = {
  whoami(),                      // github login | git config user.name
  programmes(),                  // [{ slug, owner, open, state, ref }]
  list(),                        // [{ key, roadmap, id, title, fields, why, acceptance, state, status, claimedBy, ref }]
  publish(draftPath),            // -> { slug, keys }
  claim(key, who),               // -> { ok: true } | { ok: false, holder }
  release(key, { force }),
  sync(rows),                    // -> { noop, why } | { closed, labels, programmes }
  openRoadmap(slug), reserve(slug),
}
```

`ref` is the issue number online and the file path offline. Every roadmap command is written once,
against this interface.

|  | **online** (`GithubStore`) | **offline** (`FileStore`) |
|---|---|---|
| canonical text | one programme issue plus one issue per task | `.orchestra/roadmaps/<slug>.md`, gitignored |
| `publish` | creates/updates the issues, deletes the draft | moves the draft to `roadmaps.published`, and makes no git write at all |
| status | derived from the issue (`status:` labels, open/closed) | derived from git and the register |
| ownership, `open`, `reserve` | the programme issue's author; an `open` label | one machine: everything is yours. The commands explain why they do nothing and exit 0 |
| `claim` | assignee plus a claim stamp, visible to every other machine | a register row plus the branch ref — *the interlock that actually held*, by the protocol's own account |
| `sync` | closes issues, moves `status:` labels, ticks the programme checklist | **does nothing, and that is correct**: there is nowhere to write a status |

Two consequences worth stating rather than discovering:

- **The "never write a status anywhere" invariant becomes structural offline.** There is no field to
  write one into. Online it remains a rule a human can break.
- **The protocol's never #5 collapses.** Online it reads "git wins for a local task; a closed issue
  wins for a shared one, because another developer's commit never reaches your main". Offline every
  task is local, so it is simply "git wins", with no exception to remember.

### 4.2 What offline cannot do

"Is somebody already working on this" has an answer **for this machine only**. That question is the
entire reason `planetCraft` moved to GitHub. The `roadmap` skill says so in the offline section, and
`orchestra doctor` prints it under the mode line, because it is the one thing a user could
reasonably assume and be wrong about.

### 4.3 What does not change between modes

The grammar (`docs/roadmap-format.md`, ported verbatim), `lint`, the seven fields, `**Why.**` and
`**Acceptance.**`, the `<roadmap>/<ID>` key, the em dash for "none", the absence of a status field,
the draft/published boundary, and `board`'s four kinds of line — `correction:`, `unverified:`,
`orphan:`, `unpublished:` (plus `not ours:`, which online adds and offline never emits).

### 4.4 One deliberate divergence

A register row's `roadmap` field is the **slug** in both modes, never a file path. In `planetCraft`
it is a path, which forced the rule "copying the slug into the path field is wrong, not a shortcut",
and left the path pointing at a draft that `publish` had deleted. The slug is what both stores
already key on.

## 5. The merge gate, made portable

The shape is kept exactly: one process from the lock to the fast-forward, `--detach` to outlive its
caller, `await` to collect it in bounded chunks. That shape is not a `planetCraft` quirk — it answers
a 600-second tool-call ceiling that exists in every project, and a subagent's inability to wait on a
background job.

A landing is: acquire the lock → commit the dirty tracked files listed in `ledgers` → rebase onto
`mainBranch` → **run each configured gate in order** → `merge --ff-only` → delete the worktree and
the ref → record the outcome on disk.

**`gates` replaces the hardcoded knip/suite/visual sequence.** Each entry is `{ name, cmd, cwd?,
timeout?, skipWhenAllPathsMatch? }`, run in the declared order in the rebased worktree. The plugin
never reorders them; putting the cheap gate first is the project's call, as it is today.

`skipWhenAllPathsMatch` is the portable form of `touchesRender`: the gate is skipped **only when
every changed path matches one of the globs**. It is deliberately wrong in one direction — an
unreadable diff, an empty diff, or a path shape nobody has thought about runs the gate. A needless
run costs minutes; a missed run lets through the defect the gate exists to catch. Globs support `**`,
`*` and literals, implemented in-tree because the plugin takes no dependency.

### Exit codes

| Code | Meaning | What `merge_agent` does |
|---|---|---|
| 0 | landed; worktree and ref deleted | report it |
| 10 | conflict; the rebase was aborted, the paths are named | resolve, then `land` again |
| 11 | a gate refused; main untouched | STOP. Report the gate's name and its captured output |
| 12 | still queued, or still landing | run the same `await` again |
| 13 | a precondition failed | report exactly what it named |
| 15 | `land --detach` started it | run `await` |
| 16 | killed, no outcome recorded | check `queue-list` and the log before re-running |

**14 is folded into 11.** `planetCraft` distinguishes "knip red" from "suite red", but
`merge_agent`'s action is identical in both cases — stop and report — and the gate's name now travels
in the outcome, which is strictly more information than a second code was.

The gate sets `ORCHESTRA_GATE=1` in its own environment; the commit and merge hooks below read it,
so the gate can write to main while nothing else can.

## 6. The register and the conductor

`lib/register/` is a port of `tools/orchestra/` with three changes and no re-derivation:

1. path constants come from the config;
2. the register row's `roadmap` is a slug (§4.4);
3. `ready.mjs` no longer reads `Touches` — files stopped blocking on 2026-09-01 and the field is
   documentation for the reader and for `merge_agent`.

`skills/orchestra/SKILL.md` is rewritten project-neutral. **The port is mechanical, section by
section — the rules are not re-derived, and their measurements are kept with their dates.** A rule
whose evidence has been stripped reads as an opinion and gets optimised away; that is precisely how
several of them were paid for twice. Where a measurement names `planetCraft`, it is attributed to
"the project this protocol comes from" rather than implied of the reader's.

The sections that must survive the port, because each one is a failure already paid for: the nevers;
the journal's four keys and the tool that takes the clock; `pending[]` with `id`, `options` and
`askedAt`, and the rule that a question not in `pending[]` does not exist; the shared `inboxSeen`
cursor and the stolen-stamp failure; the framing pass and the one interruption per row; the resume
cycle and the fact that `SendMessage` does not wake a `--bg` worker; the two distinct 600-second
ceilings; exit code and CLI status both being non-evidence with the filesystem as the only witness;
undelivered relays as an obligation; the decision template and the picture rule; the hands-on gate
and never handing out an unfetched URL; the dev-server sweep; the conductor beat and the lock; the
stand-down tick with its ticket sweep and its archiving.

Worker briefs become templates over `{branch} {task} {title} {excerpt} {language} {branchTests}
{specsDir} {plansDir} {briefExtra}`. `briefExtra` is where a project pastes its own hard rules — it
is the replacement for the brief's current appeals to `planetCraft`'s subject map.

## 7. The monitor

Ported as-is, reading `.orchestra/` instead of `.claude/orchestra/`. Image paths named in an ask are
resolved against the main checkout, the worktrees directory and `.orchestra/images/`, as they are
today. `orchestra monitor` replaces `npm run monitor`.

The page is machine-wide, serving every project on this machine at once through a project tab strip
above the developer strip that already existed — see `2026-09-04-machine-wide-monitor-design.md`,
which supersedes the rest of this section. In particular, the per-project name once proposed here
for the header and the `<title>` ("so a browser with four of these tabs open is readable") does not
survive one page replacing four: there is one tab now, its `<title>` is the tool's name alone, and
the project the reader is looking at is written by the page's own JavaScript on the first poll,
never substituted into the served HTML.

## 8. Several projects on one machine

One conductor per project is the point of a portable plugin, so several will run side by side and
each will want a page. What follows is what stops them colliding. The good news first: the register,
the journal, the inbox, the tick lock, the conductor beat, the worktrees and the ticket ledger all
live **under the project**, so they are isolated by construction and need nothing. Six things are
not, and each is a real collision.

### 8.1 Project identity

Two fields, both derived once by `init` and then stable:

- **`name`** — what a human calls it, default the main checkout's directory name. It is what the page
  shows and what a notification leads with.
- **`id`** — a short hash of the main checkout's **absolute path**, not of the name. Two checkouts of
  the same repository, and two projects that happen to share a directory name, must not collide; the
  path is the only thing that is unique. Never stored in the config (it is derived, and a config
  copied to another machine would carry a wrong one) — computed on demand by `lib/paths.mjs`.

`id` is what namespaces everything machine-wide below.

### 8.2 The machine registry

`~/.orchestra/instances.json`, the one file outside any project. One entry per orchestra that has
run here:

```jsonc
{ "id": "a3f19c", "name": "planetCraft", "root": "/Users/…/planetCraft",
  "mode": "online",
  "conductorSession": "…", "beatAt": "2026-09-02T18:41:07Z", "workers": 3 }
```

The page's own port lives elsewhere: `~/.orchestra/monitor.json` records the one machine-wide page,
never a per-project entry here — see `2026-09-04-machine-wide-monitor-design.md`.

It is **advisory, never authority**: the truth about a project stays inside that project, exactly as
`state.json` and git are the truth today. An entry whose `root` no longer exists, or whose pids are
dead and whose beat is stale, is reaped on the next write — the same liveness argument the tick lock
already makes. `orchestra instances` prints the table, above the one line naming the machine's
single page — the table answers "which projects are registered here", not "which page is which":
there is one page now, not one per project.

Writes are last-writer-wins on a whole-file rewrite through a temp file and a rename, with one lock
directory beside it. Contention is a handful of writes an hour, so nothing more is warranted.

### 8.3 Ports

Superseded. There is one page for the whole machine now, not one per project, and with it one port
rather than a per-project allocation — see `2026-09-04-machine-wide-monitor-design.md` for what
replaced this section.

### 8.4 Worker session names

`claude --bg -n orchestra-<id>` collides the moment two projects have a task called `S3`, and the
symptom is bad: `SendMessage` addresses by name, and `claude agents --json` is matched by name and
cwd. Names become **`orchestra-<project id>-<task id>`**, which stays far inside `SendMessage`'s
200-character address limit.

Two related rules survive the port unchanged and are now load-bearing for isolation as well: a worker
is matched by **cwd equal to its worktree path**, and the worktrees directory is per project.

### 8.5 The heartbeat, one per project

One LaunchAgent (or systemd timer) **per project**, labelled `com.orchestra.<id>`, rendered from the
template with that project's root. `install-heartbeat` refuses to overwrite an agent whose label
belongs to a different root, and `doctor` lists the installed agents against the registry so an
orphan — a project deleted while its heartbeat lived on — is visible rather than mysterious.

`caffeinate`, which a tick holds while work is in flight, is per tick and needs nothing; several are
harmless.

### 8.6 The machine's capacity

This is the collision that does not announce itself. Each conductor caps its own launches at a width
of 8; four conductors is thirty-two worker sessions and a machine that stops answering. `planetCraft`
solves this with an execution queue that is explicitly not being ported (§13).

The portable answer is smaller and advisory: `~/.orchestra/machine.json` carries `maxWorkers`
(default 8), each conductor publishes its live worker count into the registry, and the launch planner
caps this tick at `min(projectWidth, maxWorkers − workers held by other live instances)`. A conductor
that is held to zero says so in its journal and in its tick line rather than launching anyway.

**Stated plainly, because it is a real limit**: this budgets *sessions*, not CPU. It does not order
two full test suites that start together, which is what an execution queue does. A project that needs
that configures `queue`, and the fleet routing stays where it is.

### 8.7 The wrong-project guard

`cd` persists between Bash calls, and a conductor that has just launched a worker is one relative
path away from writing another project's register — a failure already recorded once, inside a single
project, and strictly more likely with several. So: `state.json` carries the `root` it was created
for, and every subcommand that writes it compares that against the root resolved from `cwd`. A
mismatch is a **hard error naming both paths**, never a warning and never a silent write.

## 9. Tickets

`tools/tickets.mjs` ported to `lib/tickets/`, ledger path from `tickets.file`, its queue lock beside
it, `withQueueLock`'s 30-second-then-throw behaviour preserved — the stand-down tick depends on that
throw being a recorded error rather than a deadlock. `errorFingerprint` and everything else that
reads `planetCraft`'s `src/` is dropped; the ledger's shape is unchanged.

## 10. Hooks

`hooks/hooks.json`, every command `node "${CLAUDE_PLUGIN_ROOT}/hooks/<name>.mjs"`. **Every one exits
0 and silent when `.orchestra/config.json` is absent.**

| Hook | Event | Refuses |
|---|---|---|
| `guard-main-edit` | PreToolUse Edit\|Write\|MultiEdit\|NotebookEdit | a write in the main checkout while HEAD is `mainBranch` |
| `guard-main-commit` | PreToolUse Bash | `git commit` / `git merge` on `mainBranch`, unless `ORCHESTRA_GATE=1` |
| `guard-full-suite` | PreToolUse Bash | a bare invocation of the gate named `suite`; override `ORCHESTRA_FULL_SUITE=1` |
| `guard-claim` | PreToolUse Bash | `git worktree add -b <branch>` for a task the board does not show claimed by you |
| `guard-draft` | PreToolUse Bash | `git add` of anything under `roadmaps.drafts` |
| `lint-roadmap` | PostToolUse Edit\|Write | nothing; lints a roadmap or draft after an edit and reports |
| `orchestra-inbox` | UserPromptSubmit | nothing; injects answers newer than `conductor.inboxSeen` |

`guard-claim` fails **open** when the channel is unreachable (a warning, not a block) and fails
**closed** on a board served from cache — a cached board is telling you, in as many words, that what
it knows is out of date. Offline it reads the register, where a claim is a row.

`guard-measure` is not ported: it guards the execution queue, which is not part of this plugin.

## 11. `orchestra init`

Driven by the `orchestra` skill so it can ask; backed by `orchestra init --detect --json`, which
reports what it found without writing. It:

1. writes `.orchestra/config.json` — mode asked, gates proposed from the detected build system,
   everything it could not detect asked rather than guessed;
2. writes `.orchestra/.gitignore`;
3. appends `templates/CLAUDE-rules.md` to the project's `CLAUDE.md` (or creates it) — the rules the
   hooks cannot hold: work happens on a worktree, a dev agent never merges, run the tests your change
   affects, what is committed is English;
4. prints the two steps it cannot take: `orchestra install-heartbeat`, and the one-time interactive
   acceptance of `claude --dangerously-skip-permissions` that `--bg` launches require.

## 12. The heartbeat

`templates/heartbeat.plist` (launchd, macOS) and `templates/heartbeat.service` + `.timer` (systemd
user, Linux), rendered by `orchestra install-heartbeat` with the project path and a project id.

The launchd path is ported and tested. **The systemd path is written from the same shape and is not
tested; the README says so** rather than implying it works. The reason launchd is used at all is
recorded with it: a crontab entry runs outside the login session and cannot read the keychain, so
every cron tick dies on `Not logged in` — eight consecutive ticks did, and seven hours were lost.

## 13. Explicitly not portable

- **The multi-machine execution queue.** `queue` in the config is an optional command template
  (`{label}`, `{cmd}`); unset, a gate runs directly. The fleet table, the bench's bare repository and
  the pinning rules stay in `planetCraft`.
- **retex.** Its contract is that a recommendation must name a metric the tool computes and a
  threshold that metric can fail; those metrics are `planetCraft`'s. The stand-down tick's retex step
  runs only if a `capabilities.retex` command is configured, and is skipped silently otherwise.
- **The visual gate, the clocks, the council, the hands-on gate.** Project instruments. The visual
  gate survives only as an example `gates` entry in the README.

## 14. Testing

`node:test`, no dependency. A `test/no-dependencies.test.mjs` asserts that no file under `lib/`,
`bin/` or `hooks/` imports anything but a node builtin or a relative path — the invariant that makes
the plugin installable anywhere.

`test/helpers/fixture.mjs` builds a throwaway git repository in a temp directory with a config, a
couple of commits and a roadmap. **The board, lint and publish suites are table-driven over both
modes** and assert the same observable behaviour, which is the sharpest statement of what "two modes"
means: `GithubStore` is tested with an injected recorder in place of `gh`, exactly as today;
`FileStore` is tested against the real temp repository.

The gate is tested against a fixture with two fake gates, one green and one red, asserting exit 0 and
exit 11 with the gate's name in the outcome.

The multi-project rules of §8 are tested with **two** fixtures and a temporary `HOME`, so the machine
registry under test is never the developer's own: distinct ids for two checkouts sharing a directory
name, port allocation that survives a restart and steps around a taken port, a launch plan capped by
another instance's live workers, and a write refused when the register's `root` is not the resolved
one.

## 15. Phases

| Phase | Contents | Acceptance |
|---|---|---|
| P1 | `config`, `paths` (including the project `id` and the wrong-project guard), `bin/orchestra`, `Store` and both backends, `roadmap` (parse, lint, board, publish, enrol, claim) | one fixture per mode passes the **same** board/lint/publish suite; a subcommand run against a register whose `root` is another fixture fails naming both paths |
| P2 | register: journal, inbox, lock, beat, ready, tick-gate, archive; the machine registry and the worker budget; `skills/orchestra` ported neutral; briefs templated | the fixture adopts, ticks and round-trips its register; the section checklist of §6 is present; two fixtures ticking together never exceed `maxWorkers` between them |
| P3 | the gate driven by `gates`; `agents/merge_agent.md` | a branch lands in the fixture with two fake gates; the red one returns 11 naming itself |
| P4 | the monitor, port allocation, `orchestra instances` | two fixtures serve at once on different ports, each page naming its own project; killing one and restarting it returns the same port |
| P5 | hooks, `init`, tickets, heartbeat templates, README | `init` on a bare repository produces a project that ticks; each hook is a silent no-op without a config; `install-heartbeat` refuses a label held by another root |

## 16. Risks

- **The protocol document is 1031 lines of hard-won rules and the port could quietly drop one.**
  Mitigated by §6's explicit checklist of sections that must survive, and by porting section by
  section rather than rewriting from memory.
- **A fork means divergence.** Accepted deliberately (decision 4). The README records which commit of
  `planetCraft` the extraction was taken from, so a later diff is at least possible.
- **The plugin is installed globally and could disturb a project that never opted in.** Mitigated by
  the single off switch: no `.orchestra/config.json`, no behaviour (§3.1), asserted by a test per
  hook.
- **`--bg` worker launches depend on a one-time interactive permission acceptance** that no tool can
  grant itself. `init` prints it; `doctor` checks for it; the skill's preflight proves it on a
  throwaway session before planning any launch, as it does today.
- **The machine registry is advisory and can lie.** A conductor killed with `-9` leaves its worker
  count behind until the entry is reaped, which under-budgets every other project for a few minutes.
  That is the safe direction — it launches too little, never too much — and it is the reason the
  registry is nowhere allowed to be authority over a project's own state (§8.2).
- **The worker budget counts sessions, not load.** Four projects each running one full test suite is
  within budget and can still saturate the machine (§8.6). A project that cares configures `queue`.
