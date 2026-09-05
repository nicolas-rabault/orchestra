# One monitor for the machine — design

Supersedes the port half of §7 and the whole of §8.3 in
[`2026-09-02-orchestra-plugin-design.md`](./2026-09-02-orchestra-plugin-design.md). Everything else
in that document stands.

## 1. What changes, and why

P4 shipped one monitoring page per project, each on its own allocated port. Four projects on this
machine is four servers, four ports, four browser tabs, and four URLs to remember — and the tab
strip the page already draws is a strip of **developers**, which offline can never hold more than a
single dead `local` pill, because `owner` comes from the GitHub ownership overlay and offline has
none.

So: **one page for the machine**, with the project tab strip one level above the developer strip
that already exists. The developer strip is unchanged — it stays a filter over the selected
project's nodes, drawn the same way, whoever the tab belongs to.

This is a replacement, not an addition. `orchestra monitor` serves the machine; there is no
per-project page any more.

### Decisions recorded at brainstorming (2026-09-04)

- The machine page **replaces** the per-project page. `candidatePort`, `monitor.port`, `pinConflict`
  and the one-page-per-project rule go with it.
- The port is **4380**, probed upward when taken, overridable by `monitorPort` in
  `~/.orchestra/machine.json`.
- `/api/model` carries the **full model for every project**, not a cheap summary — so the project
  tabs carry exact progress counts. The cost is accepted; §4 states what it is and what bounds it.
- `orchestra monitor` becomes a **machine command**, runnable outside any project, and the set of
  projects is the live machine registry **plus the current directory's project** if it has a config
  and is not registered yet.

## 2. The set of projects

A project reaches the page if it is a live entry of `~/.orchestra/instances.json`
(`liveInstances()`), or if the directory `orchestra monitor` was started from has an
`.orchestra/config.json` and is not registered yet — in which case it is recorded on the way, so a
freshly `init`ed project appears immediately, which is exactly when someone wants to look at it.

The set is resolved **per request**, never once at startup: a project that opts in, opts out, or is
deleted while the page is open must follow within one poll. Resolution is
`loadConfigOrThrow(root)` per root, and a root whose config has gone — the project opted out, the
checkout was removed — is **dropped from the set, never thrown out of the handler**. One deleted
checkout may not take the page down for every other project.

`orchestra monitor` therefore carries `machine: true` in the command registry, like
`orchestra instances`: the off switch (§3.1 of the plugin design) does not apply to it, because it
answers about the machine rather than about a project. Started in a directory that is not a git
working tree at all, it serves whatever the registry holds.

## 3. The port

`4380`, bound through the existing `listenOnFreePort` with `pinned: false`, so a machine where
something else already holds 4380 still gets its page on 4381. `~/.orchestra/machine.json` — which
already exists and already holds `maxWorkers` — accepts a `monitorPort` integer that replaces the
4380 default; it is still probed upward, because a page that refuses to start is worse than a page
one port along.

The bound port is recorded in a new **`~/.orchestra/monitor.json`**:

```jsonc
{ "version": 1, "port": 4380, "pid": 51233, "startedAt": "2026-09-04T20:31:43.000Z" }
```

Written on bind and refreshed by the existing five-minute keepalive.

`port` and `monitorPid` **leave the per-project registry entry**. The monitor no longer belongs to a
project and must not write one: a page left open for days stopped refreshing a project's
`updatedAt`, which is the behaviour `lib/machine.mjs`'s own comment on `isLive` already wanted.

**One page per machine** replaces one page per project, and is decided the same way `pageAlreadyUp`
already decides: both legs, never one. `pidAlive(monitor.json.pid)` answers "is that process still
there", `listServers([monitor.json.port])` answers "is a page actually serving"; a recycled pid and
an unrelated process on the port each fail exactly one leg. When `lsof` cannot answer at all
(`ok: false`), nothing is known, so nothing is refused and the bind decides — unchanged from P4's
reasoning, and now harmless, because a second page would bind 4381 and record it, and there is only
one record to flap.

## 4. The model, and what it costs

`createHandler({ projects, port, publicDir })`, where `projects` is a **function** returning the
resolved set (§2) — not an array captured at startup.

```jsonc
{ "machine": { "port": 4380 },
  "projects": [ { "project": { "id": "7f4b8a", "name": "nebula", … }, "nodes": […], "rail": […], … } ] }
```

Each element is exactly today's model, built by today's `buildModel`, for one project. Nothing about
a single project's model changes.

**The cost, stated plainly.** N projects means N board reads, N `git branch`, N `git worktree list`
and N sets of file reads per rebuild, on a single-threaded server. Three things bound it, and only
the third is new:

- `readBoard` already caches per root — 30 s on success, 60 s of backoff after a failure — so N board
  child processes are amortised, not paid every poll.
- Every child already carries a timeout: 2 s for `git` and `lsof`, longer for the board. A project
  whose board hangs costs its own timeout once per backoff window, not the page.
- **One `lsof` for the whole machine, not one per project.** `listServers` already takes a list of
  ports; it is called once with the union of every project's register ports and the result is sliced
  per project. This is the one place where going plural makes the page *cheaper* than N copies of it
  were.

**Resolving the SET itself is not free either, and it is paid on every poll.** `discoverProjects`
(§2) calls `loadConfigOrThrow` once per known root, and that function forks `git rev-parse` TWICE —
once directly, once through `findConfig`'s repository-boundary check — so N projects cost roughly
2*(N+1) child processes just to decide which N projects exist, before a single board is read.
Measured over a 5-project fixture: 12 forks and 123 ms for one `discoverProjects` call. The handler
resolves this set ONCE per request, never once for the etag and again for the body — a second
resolution would double this cost for nothing, and could let the etag describe a different set than
the one the body actually serves.

The etag is the concatenation of each project's `sourceStamp`, so an unchanged machine still answers
304 without rebuilding anything.

## 5. The routes

| Route | Change |
|---|---|
| `GET /` | No `{{project}}` substitution — see §6. |
| `GET /api/model` | Plural, as §4. |
| `POST /api/answer` | Takes `project` — the project **id** — alongside `task`, `pending`, `answer`. |
| `GET /api/image` | Takes `project` alongside `p`. |
| `GET /app.js`, `/style.css`, the shared modules | Unchanged, plus one new shared module (§7). |

`project` is resolved to a root **by id, against the live set** — never a path taken from the client.
An id that is not in the set answers 400 and touches nothing. This is not decoration on
`/api/image`: that route's containment guard resolves `p` against a root, and with several roots in
play a request carrying only `p` would be checked against whichever root the handler happened to
hold. The id is what makes the guard mean something again.

## 6. The title, and a promise P4 made that this breaks

P4 substituted the project's name into the served HTML so that a tab among four was named before a
byte of JavaScript had run, and stayed named if the server never answered again. With one page and
N projects there is no single name to substitute: the server cannot know which project the reader
was last looking at.

So the served title is `orchestra`, and `app.js` writes `<project> — orchestra` on the first poll,
from the project remembered in `localStorage`. **This is a real regression on §7 of the plugin
design and it is recorded here rather than discovered later.** What survives is the reason the
promise existed — telling four tabs apart — which is now moot, because there is one tab.

Two consequences follow and are part of the work: `escapeHtml` and the replacer-function defence
against `$` patterns in `String.replaceAll` become dead code and are removed; the page's project
names now reach the browser only as JSON, rendered through `el()`, which sets `textContent` and
never markup.

## 7. The two strips

A new pure module, **`lib/monitor/projects.mjs`**, decides the level-1 strip from the array of
per-project models: which projects are tabs, in what order, and what each tab's counts and
"waiting on you" badge are. It is unit-tested in node and served verbatim to the browser, exactly as
`tabs.mjs`, `layout.mjs`, `progress.mjs`, `clock.mjs` and `answers.mjs` are — so it joins
`SHARED_MODULES`, and the page and the tests group projects the same way.

Ordering is by name, not by activity, for the same reason `tabsOf` sorts and the corner list sorts:
a strip that reorders itself between two-second polls is unclickable.

`tabs.mjs` does not change. It is applied to the **selected project's** nodes and keeps being the
developer filter it is. `layout.mjs` does not change either: it lays out one project's nodes, and
the canvas still shows one project at a time.

In `index.html`, `#projects` sits above `#tabs` in the header strip.

## 8. Per-project client state — the collision

Three pieces of client state are keyed today in ways that collide the moment a second project is on
screen. Each is a correctness bug, not a cosmetic one:

- **`localStorage["orchestra.monitor.frames"]`** is keyed by roadmap slug. Two projects with a
  roadmap called `lighting` share one stored position. → keyed `<projectId>/<roadmap>`.
- **`answered` and `drafts`** are keyed by `slotOf(nodeKey, itemId)`. Answering `lighting/L2` in
  project A would mark the same slot answered in project B, disabling a question nobody replied to
  and printing a "sent" line under it. → the project id enters the slot.
- **`state.collapsed`, `state.selected`, `state.view`** are single values. → one entry per project,
  so moving between tabs does not lose a frame you collapsed or a view you panned.

The selected project is remembered in `localStorage` too. Without it every reload lands on whichever
project sorts first.

## 9. The registry and the CLI

- **`lib/machine.mjs`** — the monitor's claim (`port`, `monitorPid`) leaves `recordInstance`. The
  monitor writes `monitor.json` instead, and touches a project entry only to register the current
  directory's project when §2 requires it.
- **`lib/cli/monitor.mjs`** — `monitorCommand` becomes machine-wide: resolve the set, bind, record
  `monitor.json`, keepalive, refuse-and-point against `monitor.json`. `instancesCommand` prints the
  one machine URL and its listening state once, above the table, and drops the per-row URL and
  state columns that no longer have a source.
- **`lib/monitor/port.mjs`** — `candidatePort`, `resolvePort` and `pinConflict` are deleted.
  `listenOnFreePort` stays, unchanged. The module keeps its header's promise: it answers "which
  port", never "what serves it".
- **`lib/config.mjs`** — `monitor` leaves `DEFAULTS`.
- **`lib/cli/doctor.mjs`** — the `pinConflict` error goes, and so does the `monitor.port` row in the
  resolved-configuration table, which would otherwise print a key that no longer exists. In their
  place, a **warning** when a config still carries `monitor.port`: `validate` only checks keys that
  are in `DEFAULTS`, so without this the key would be silently inert, which is worse than an error.

## 10. Tests

Rewritten, never deleted — each of these rows asserts something that is still true in a different
shape:

| P4 row | Becomes |
|---|---|
| 1. Two projects serve on different ports | Two projects are two tabs on one page, each named, each with its own model |
| 3. Kill and restart returns the same port | Kill and restart returns the same port (4380) |
| 4. A taken candidate probes upward | A taken 4380 probes upward, and `monitor.json` records what it bound |
| 6. `instances` lists both and says which is listening | `instances` lists both projects and names the one page |
| scope 9. A second monitor points at the first | A second monitor **anywhere on the machine** points at the one page |
| 8. Silent with no config | `monitor` answers from a directory with no config — the machine exception, inverted |

New, and the most important invariant this change introduces:

- **An answer posted with `project: A` lands in A's inbox and not in B's**, and `orchestra inbox` in
  A prints it while `orchestra inbox` in B stays silent.
- `/api/image?project=A&p=…` refuses a path inside B's checkout.
- A project whose config disappears between two polls drops out of the model without a 500.
- `projects.mjs` gets its own unit test — and, unlike `app.js`, it is a module the tests actually
  load.

`test/monitor-port.test.mjs` loses its `candidatePort`/`pinConflict` cases and keeps its
`listenOnFreePort` ones.

## 11. Out of scope

No cross-project graph, no merged rail, no machine-wide search: one project's board at a time,
exactly as today. None of the thirteen findings from the 2026-09-04 page audit are fixed here, not
even the ones in files this change rewrites — they are a separate branch, so that a review of this
one is a review of one idea.
