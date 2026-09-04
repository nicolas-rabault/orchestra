# Orchestra

A Claude Code plugin that conducts a project's development with background worker sessions, a monitoring page, and a one-at-a-time merge gate. Roadmaps live on GitHub or as committed markdown.

**Two modes:**
- **Online:** Roadmaps published as GitHub issues in any repository
- **Offline:** Roadmaps stored as committed markdown files

For the full design and specification, see [docs/specs/2026-09-02-orchestra-plugin-design.md](docs/specs/2026-09-02-orchestra-plugin-design.md).

## Install

```sh
claude plugin marketplace add ~/Projects/orchestra
claude plugin install orchestra@orchestra
```

Nothing to build and nothing to install alongside it: every module imports only node builtins, and
a test enforces that.

## Opt a project in

Write one committed file, `.orchestra/config.json`, holding the one required key:

```json
{ "mode": "offline" }
```

`offline` keeps roadmaps as committed markdown; `online` publishes them as GitHub issues and needs
the `gh` CLI. Everything else has a default — run `orchestra doctor` in the project to see the
resolved configuration with every defaulted key marked.

**The absence of that file is the plugin's off switch.** In a project that has not opted in, every
command except `doctor` exits 0 and prints nothing, so the plugin is safe to install globally.

The config's most important key is `gates`, the merge gate's own checklist for a landing:

```jsonc
{
  "mode": "offline",
  "gates": [
    { "name": "deadcode", "cmd": "npm run knip" },
    { "name": "suite",    "cmd": "npm test" },
    { "name": "visual",   "cmd": "npm run gate:visual",
      "skipWhenAllPathsMatch": ["docs/**", "**/*.md", "tests/**"] }
  ]
}
```

Gates run in the order written — cheapest first is the project's own call, not a rule this plugin
enforces — and `skipWhenAllPathsMatch` skips a gate only when every changed path matches one of its
globs; an unreadable or empty diff runs the gate rather than skip it.

## What works today

Phase 1 shipped the roadmap layer, phase 2a the register and the machine budget, phase 2b the
protocol that drives them, phase 3 the merge gate and `roadmap sync`:

- **`/orchestra`** — the conductor protocol: the nevers, the journal, the framing pass, the nine
  steps of a tick, the playtest gate, and the worker briefs as templates a project fills from its
  own config (`briefExtra` is where it pastes its own hard rules).
- **`/roadmap`** — the skill: the grammar, the board, and the nine roadmap subcommands.
- **`orchestra doctor`** — the resolved configuration, and the only command that answers in a
  project with no config.
- **`orchestra roadmap <lint|board|publish|enrol|claim|release|open|reserve|sync>`**.
- **`orchestra journal|inbox|beat|lock|watch-answers`** — the register: one line with a measured
  clock, the answers a user posted on the page, who holds the baton, and one conductor at a time.
- **`orchestra ready|tick-gate|yield-check`** — the launch plan, whether a heartbeat should tick at
  all, and whether this session should hand the baton back. `ready` budgets its launches against
  every other orchestra on this machine (`~/.orchestra/machine.json`, `maxWorkers`, default 8).
- **`orchestra archive|archive-images`** — move a finished run's prose out of the register, and
  sweep the photographs under `.orchestra/images/` that nothing live still names.
- **`orchestra land <branch> [--detach] | await <branch> [--for=N] | queue-list`** — the merge gate:
  one branch at a time behind a lock, the project's own `gates` run in order in the rebased
  worktree, a fast-forward, and the worktree and ref deleted. `--detach` and `await` exist because a
  landing outlives the 600-second ceiling on an agent's tool call; the outcome is on disk, so any
  session can collect it. A refusing gate returns 11 **and names itself**.
- **`orchestra roadmap sync`** — online: close what landed, move the `status:` labels, tick each
  programme's checklist, close a finished roadmap. Offline it does nothing, and that is correct:
  there is nowhere to write a status.
- **`merge_agent`** — the agent that runs the gate, resolves a conflict and reports. Nothing else
  should land a branch.

A conductor launches its workers with the harness's own `claude --bg`; there is no launcher in the
plugin, and `ready` produces a plan rather than executing one.

Not yet: the monitoring page and `orchestra instances` (4), the guard hooks, `orchestra init`, the
ticket queue and the heartbeat (5). Until the page exists nothing writes `.orchestra/inbox.jsonl`,
so a conductor takes its answers from the conversation. See the spec's phase table (§15).

---

Extracted from `planetCraft` at commit `86bf8412`.
