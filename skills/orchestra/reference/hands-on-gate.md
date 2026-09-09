# The hands-on gate

Read when a row's acceptance needs a human to look at it — and before you ask anyone to run
anything. It carries the gate itself and the dev-server sweep that keeps a machine from filling up
with servers nobody is watching.

## The hands-on gate

When a worker reports built, first ask what the row actually ships. **If it ships nothing a human
looks at or uses, there is no gate**: it lands once every configured gate is green (`gates`), the
`landing` line goes in the journal, and the checkpoint carries it (never #1) — **except a
pull-request review row, which never lands and runs no gate at all**: nothing here owns that
branch, so the maintainer clicks Merge on GitHub and the row's `landed` derives on its own
(`## Pull-request review rows`). Seven of the sixteen rows of the dev-loop roadmap, in planetCraft,
shipped nothing of the sort, and every one of their approvals was granted unread.

Otherwise: tell the worker to put the thing in front of the user — **with the project's own
command; the worker knows it and you do not need to** — and to report exactly how it is reached.
Two shapes, and the row is one or the other: a project that SERVES something reports the port it
actually bound plus its pid; a CLI, a library, a firmware image or a data pipeline reports the one
command that shows the change, to be run from the worktree. Set the row to `review`, and add a
`pending[]` item — `kind: "hands-on"` — carrying whichever it is: a port goes on the
item's own `port` field, which the card prints beside the kind, and into the chat message's header;
a command goes in the ask itself, where the user can copy it.

**And anything the user must OPEN that is not a localhost port goes on the ROW, in `links[]`** —
`{"label": "…", "url": "…"}`, as many as the row earns. The card draws one button per entry under
`what to open`, beside the dev server, reading `open <label> →`. So **the label is a noun phrase
naming the destination in plain words** — `the staging deploy`, `the CI run`, `the Figma frame`,
`the published report` — never `link`, never `here`, never a bare URL: the button has to say what
it is to somebody who did not read the ask. The card names the host underneath it, which is the
half of the promise the reader can check.

Three rules that come with it, and the first is not new:

- **Never hand out a URL you have not fetched AND READ** (below). A `links[]` entry is a URL you
  are handing out; it is under that rule exactly as an ask's URL is.
- **Only `http` and `https` reach the page.** Anything else is dropped silently by
  `openablesFor` (`lib/monitor/model.mjs`), so a `file://` path you meant as a convenience simply
  does not appear. Say the path in the ask instead.
- **A link outlives the gate; a port does not.** `links[]` is the row's standing context — the
  place the work can be looked at for as long as the row is open — where the `port` on a
  `pending[]` item dies with the question. Put a thing that stays on the row, and a thing that is
  the gate itself in the item.
**The user's validation IS the approval** — do not then ask a second time for the merge; that
second question is the one this roadmap paid for thirteen times over, in planetCraft (see The
framing pass, and the one interruption). What follows validation is step 6's business (see The
tick): record the branch's commit `subjects` in the row BEFORE the hand-off — that is what makes
landed detection work. The hand-off is the two commands above, and a landing deletes the worktree
and the ref — **on a review row there is no hand-off**: nothing lands, the worktree and the ref
stay until the row is terminal, and the subjects to record are the pull request's
(`## Pull-request review rows`).

**Never hand out a URL you have not fetched AND READ**, and never a command you have not run.
For a URL, not `curl` — it cannot reach a localhost server this shell can see listening. Fetch it
and look at the body (`node` here is the PLUGIN's own runtime, always present wherever `orchestra`
runs, and says nothing about what the project is written in):

```sh
node -e 'fetch(process.argv[1],{signal:AbortSignal.timeout(4000)}).then(r=>r.text())
  .then(t=>console.log(t.replace(/\s+/g," ").slice(0,200))).catch(e=>console.log("FAILED",e.message))' <url>
```

The status code is worthless here: in planetCraft the dev server answers 200 with the
application's own entry page for any path at all, so a wrong path looks healthy from every angle
except the one that matters. Measured 2026-08-13 in planetCraft: an ask sent the user to the wrong
path, nothing flagged it, and he lost a whole test run to it. **Any dev server with a catch-all
route does this**, so reading the first 200 characters is the entire check.

**And when a worktree is deleted, kill whatever server it started and close any page open on it,
explicitly.** A server whose directory has been removed keeps serving — which reads as a live page
showing stale code, and is indistinguishable from a working one until someone trusts it. Servers
are killed **by pid**, never by pattern.

**Three rules `branchTests` — the subset gate — cannot enforce for you**, all paid for on
2026-08-14 in planetCraft:

- a branch that is a **new consumer** of a module another in-flight row has just rewritten needs
  the full suite. A dead-code sweep on the main branch removed an export that a branch in flight
  had just started importing; different lines, so git merged both sides happily and produced a
  runtime `TypeError`. Neither the diff nor the dead-code gate could see it — the gate was right on
  main and the branch was right on itself;
- **land an unused-export sweep LAST**, after everything in flight against the same modules;
- a `branchTests` command that selects by import graph can select exactly ONE file for a tool
  nothing imports but its own test. When the subset looks suspiciously small, **say the number out
  loud** and run the full suite instead of trusting it.

### The dev-server sweep

**And sweep for the ones you did not start, once per tick** — killing your own on deletion is not
enough, because the server that hurts is the one nobody remembers launching. A dev server in the
MAIN checkout takes the ticket ledger's queue lock and writes its tickets into main's ledger, which
is what refused a landing on 2026-08-25 in planetCraft: one orphan was found and killed that
afternoon, its worktree deleted that morning, and another was still listening forty hours later,
from the main checkout, when the run was reviewed.

**Run it from the main checkout**, and a second time from `worktrees` if the project puts its
worktrees outside it: a listener is selected by its WORKING DIRECTORY, not by its process name.
The source project matched `node` alone, which is a statement about one toolchain — a Rust, Python
or Go dev server holding a port out of a deleted worktree does exactly the same damage and would
never have appeared. Everything listening from outside this project's trees is somebody else's and
is not printed at all, which is what keeps the machine's own daemons out of the output.

```sh
lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $2"\t"$9}' | sort -u |
while IFS=$'\t' read -r pid addr; do
  case "$(ps -o command= -p "$pid" 2>/dev/null)" in *orchestra*monitor*) continue;; esac
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | grep '^n' | head -1 | cut -c2-)
  case "$cwd" in
    "$PWD")   v="MAIN CHECKOUT -> ask, never kill";;
    "$PWD"/*) [ -d "$cwd" ] && v="WORKTREE -> leave" || v="ORPHAN -> kill";;
    *)        continue;;
  esac
  echo "pid=$pid port=${addr##*:} age=$(ps -o etime= -p $pid|tr -d ' ')  $v"
done
```

Three details, each one a wrong answer the first drafts gave: **skip your own page** — this
plugin's own monitoring page runs from the main checkout and, in planetCraft, had been up eight
days, so without that `case` the sweep reports the conductor's own instrument as a suspect every
hour, and `orchestra instances` is the second way to recognise it, by the port its row for this
project names; `$NF` is `(LISTEN)`, the address is `$9`; and `lsof -Fn` answers `p<pid>`/`f<fd>`/
`n<path>`, so take the first `n` line, not the second line.

**ORPHAN is the only verdict that kills.** A server in the main checkout may be the USER's, so it
becomes a question — a note nobody reads is how one survived forty hours.
