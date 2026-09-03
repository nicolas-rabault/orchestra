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

This is phase 1 of five. It ships the roadmap layer:

- **`/roadmap`** — the skill: the grammar, the board, and the eight subcommands below.
- **`orchestra doctor`** — the resolved configuration, and the only command that answers in a
  project with no config.
- **`orchestra roadmap <lint|board|publish|enrol|claim|release|open|reserve>`**.

Not yet: the conductor and its worker sessions, the merge gate, the monitoring page, the guard
hooks, `orchestra init`, and `roadmap sync`. See the spec's phase table (§14) for the order they
arrive in, and the plan's closing section for what phase 1 deliberately left out.

---

Extracted from `planetCraft` at commit `86bf8412`.
