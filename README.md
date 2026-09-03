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

## What works today

Phase 1 shipped the roadmap layer; phase 2a shipped the register and the machine budget:

- **`/roadmap`** — the skill: the grammar, the board, and the eight roadmap subcommands.
- **`orchestra doctor`** — the resolved configuration, and the only command that answers in a
  project with no config.
- **`orchestra roadmap <lint|board|publish|enrol|claim|release|open|reserve>`**.
- **`orchestra journal|inbox|beat|lock|watch-answers`** — the register: one line with a measured
  clock, the answers a user posted on the page, who holds the baton, and one conductor at a time.
- **`orchestra ready|tick-gate|yield-check`** — the launch plan, whether a heartbeat should tick at
  all, and whether this session should hand the baton back. `ready` budgets its launches against
  every other orchestra on this machine (`~/.orchestra/machine.json`, `maxWorkers`, default 8).
- **`orchestra archive|archive-images`** — move a finished run's prose out of the register, and
  sweep the photographs under `.orchestra/images/` that nothing live still names.

Not yet: the conductor's protocol document and the worker briefs (2b), the merge gate (3), the
monitoring page and `orchestra instances` (4), the guard hooks, `orchestra init`, the ticket queue
and the heartbeat (5), and `roadmap sync`. There is **no launcher**: `ready` produces a plan, and
nothing here spawns a session to execute it. See the spec's phase table (§15).

---

Extracted from `planetCraft` at commit `86bf8412`.
