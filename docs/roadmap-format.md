# The roadmap task format

A roadmap is prose plus a block of these per task. Read this page before writing one — it is the
whole contract. `lib/roadmap/parse.mjs` reads the grammar; `lib/roadmap/lint.mjs` enforces the
rules on this page. Both name the task and the field when something is wrong, so fix the block, not
the reader.

## 1. The task block

```
### N2 — Cache the parsed manifest between runs

- **Roadmap** startup
- **Order** 2
- **Deps** N1
- **Touches** `src/manifest.js`, `src/cache.js`
- **Branch** `startup/n2-manifest-cache`
- **Design** no
- **Lane** —

**Why.** Plain language, what is different for whoever uses this project.

**Acceptance.** How you know it landed, and with which instrument.
```

A heading (`### <ID> — <title>`), the seven fields in any order, then the two required paragraphs.
`—` (U+2014, an em dash) is the explicit way to write "none" — never leave a field blank, and never
type a hyphen or an empty string where a field admits none.

## 2. The fields

| Field | Says | `—` means | Why you write it |
|---|---|---|---|
| **Roadmap** | which roadmap this task belongs to | never — every task is on one | so the block still says what it's part of if it's pasted into a chat, a PR, or another file, without the reader having to go find out |
| **Order** | where this task sits in the roadmap's own sequence | you haven't slotted it in yet | lets you insert a task between two existing ones without renumbering the file, and gives a board something to sort by that reflects how the roadmap wants to be read, not the order tasks happened to be typed |
| **Deps** | the task IDs that must land before this one starts (`<ID>` in this file, `<roadmap>/<ID>` in another) | nothing blocks it | this is the only thing that lets a scheduler — human or automated — know two tasks can't run at once, or that starting this one early would be wasted work |
| **Touches** | the files this task expects to change, comma-separated, backtick-quoted; write `new` before a path that doesn't exist yet | (in practice, almost nothing touches nothing — but it's legal) | so a reader knows where this task will be working. **It blocks nothing.** Two tasks declaring the same file run side by side and the conflict is resolved wherever branches land |
| **Branch** | the branch this task will land on, backtick-quoted | never — every task lands somewhere | lets anyone find the work without asking, and lets a board later match a landed branch back to the task it closed. Only the branch's own name has to start with the task's id — the prefix in front of it is yours to choose, and it should name what the branch actually touches, not which roadmap asked for it |
| **Design** | whether this task needs a design pass before implementation, `yes` or `no` | never — this is always known before a task is written | decides who picks the task up first and how much prose has to exist before the diff does; writing it down makes that a fact instead of a conversation |
| **Lane** | which serial lane a task belongs to, if any | it isn't in one — it can run alongside anything | some tasks genuinely cannot coexist — two that both rewrite the same skill's prose, say, where the merge has no honest resolution. A shared Lane name tells an orchestrator running many tasks at once: never run two of these together. With `Deps`, it is the **only** declarative blocker left, and it is for a FUNCTIONAL collision — never a textual one |

## 3. The key

A task's key is `<roadmap>/<ID>` — the field alone is only unique within its own file. Pick an ID
that hasn't been used by any roadmap, not just not used by this one: two roadmaps that both declare
`D1` collide the moment either is published, and there is no suffix to invent your way out of it
after the fact.

## 4. There is no status field

Not `Status`, `State`, `Landed`, `Done`, `Progress`, `Session`, `Owner`, or `Claimed`. Status is
derived — git for a local task, the issue for a shared one. Writing one is a lint error, not a
style choice: whichever of those fields you reach for, the linter already knows where to look
instead.

## 5. Drafting and publishing

A project's drafts directory (`roadmaps.drafts` in `.orchestra/config.json`, `.orchestra/drafts` by
default) is where a roadmap is written and linted; a draft never gets committed. It does not exist
for anyone else — or for orchestra — until `orchestra roadmap publish` has published it, and the
drafting file is deleted then. What publishing produces depends on the project's mode: markdown
under `roadmaps.published` offline — excluded from this clone, and never committed by orchestra
itself — GitHub issues online. The grammar and the lint are the same either way, and `orchestra
roadmap board` lists an unpublished draft under `unpublished:` so it cannot be mistaken for work
anybody can see.

A published roadmap is **nominative**: only its owner's orchestra may take its tasks, until the
owner runs `orchestra roadmap open <roadmap>`. Ownership is the programme issue's author (online)
or the machine that published it (offline), and is not something a task declares — which is why
there is no field for it.

## 6. Why and Acceptance

Two paragraphs, required, in this order:

- **Why.** What is different, once this task lands, for whoever uses what this project produces —
  a reader, an operator, a caller of its API, a player. Not what the code does: what changes on the
  other side of it.
- **Acceptance.** The instrument that will show it: a test, a benchmark figure, a screenshot pair,
  a command's output before and after. Name the thing someone would look at to agree the task is
  done, not a description of doneness.

If you can't point at what would change or what would show it, the task isn't ready to write down
yet — it's still an idea.

## 7. Checking your work

```
orchestra roadmap lint
```

Run it before you consider a roadmap finished. It reports every violation on this page, by task and
line.
