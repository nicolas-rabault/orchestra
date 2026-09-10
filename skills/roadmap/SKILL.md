---
name: roadmap
description: Draft, lint, publish and manage project roadmaps using orchestra. Use for roadmap requests, adding or claiming tasks, filing bugs, and viewing the board.
---

# Roadmaps: the smallest requested result

Use `"${CLAUDE_PLUGIN_ROOT}/bin/orchestra"` (or this plugin's `bin/orchestra` when unset).
Run `orchestra doctor` first. If the project has not opted in, follow its initialization instructions.

## Understand before drafting

Extract the user's intended result, ambition (fix, prototype, production change), and explicit constraints.
Read only the files needed to resolve that intent. Clarify only an ambiguity that materially changes
behavior, effort or acceptance. Otherwise state a conservative assumption and proceed.

Default to **one task**, one observable result, about **30 minutes of focused work** with a targeted
check. This is a sizing target, not a promise. Split only when independent results or necessary
prerequisites make that task too large. Do not create design, infrastructure, cleanup, documentation,
benchmark or test-platform tasks unless requested or indispensable to the result. Keep unrequested
requirements explicitly excluded. A prototype stays a prototype; a bug stays a targeted correction.

Use existing verification tools. Acceptance names both the check and its expected result.
Scope says what to implement, what to exclude, and where to stop. Stop after acceptance passes;
future improvements require another request. If uncertainty prevents sizing, define a short discovery
with a concrete answer as its output, rather than hiding an open-ended investigation inside a build.
Set design true only for an unresolved consequential design decision, not routine implementation.

## Generate a draft

Read `docs/roadmap-format.md` when you need the Markdown contract. Prefer structured JSON to
hand-written blocks. Write a JSON file and run:

```sh
orchestra roadmap draft /path/to/input.json
```

Example:

```json
{
  "roadmap": "copy-link",
  "intent": "Add a copy-link button to the existing screen.",
  "outcome": "The button copies the current link.",
  "excluded": ["Sharing service", "New UI framework"],
  "tasks": [{
    "id": "CP1",
    "title": "Copy the current link",
    "why": "Users can paste the current link elsewhere.",
    "acceptance": "Click the button; inspect that the clipboard contains the current URL.",
    "scope": "Add the button to the existing screen. Stop after the clipboard check. No sharing service.",
    "touches": ["src/screen.js"]
  }]
}
```

Required top-level keys: roadmap, intent, outcome, excluded (array), tasks.
Optional destination: `local`. Required task keys: id, title, why, acceptance, scope.
Optional task keys: touches, deps (default empty arrays), design (default false), lane (slug).
All text is non-empty and single-line. Slugs use lowercase letters, digits and hyphens.
IDs start with a letter, contain at most 12 alphanumeric characters, and are unique ignoring case.
The command derives order and branch. It rejects unknown keys, more than 8 tasks, more than 5
Touches per task, or more than 180 words across Why, Acceptance and Scope. Paths stay inside the
repository; prefix a new path with `new `. Dependencies may reference later tasks; lint checks them.
These structural checks cannot prove that a task has one objective: review its ambition yourself.

The command writes and lints `<roadmaps.drafts>/<slug>.md`, refuses overwrites, and never publishes
or launches workers. Present the draft and assumptions; publishing requires user intent to publish.

## Lifecycle

- `lint [path…]`: validate drafts without network access.
- `board [--json]`: inspect derived state, including unpublished drafts and corrections.
- `publish <path>`: publish to the configured destination and enrol tasks. Offline/local writes
  local Markdown; online creates issues. A published-but-unenrolled result names its recovery command.
- `enrol`: register missing published tasks; safe to repeat.
- `claim <key>` / `release <key>`: claim before work; never take someone else's closed roadmap.
- `open <slug>` / `reserve <slug>`: change online roadmap availability.
- `sync`: reconcile online status with landed work.
- `runtime <slug> [claude|codex|inherit]`: select runtime for future workers.

Never write status fields. Fix reported derivation/register disagreements at their source.
Offline ownership answers concern this machine only. Drafting ends at the draft; it does not conduct it.
