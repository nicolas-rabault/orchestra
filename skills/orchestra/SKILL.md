---
name: orchestra
description: Conduct published project roadmaps using independent Claude or Codex worker sessions. Use for /orchestra or when the user asks to orchestrate roadmaps or launch their workers.
---

# Orchestra

Run this plugin's `bin/orchestra` from the project. Use `CLAUDE_PLUGIN_ROOT` when available.
The CLI decides readiness, ordering, capacity, runtime, model, briefs and resume limits.
Use its output directly. The conductor interprets reports and user intent; it does not invent
extra tasks, acceptance criteria, model upgrades or repeated verification.

## Read only what this tick needs

| Condition | Reference |
|---|---|
| First use, absent configuration/register, first Claude background worker | `reference/first-run.md` |
| Any Codex conductor or worker | `reference/codex.md` |
| A question or choice needs the user | `reference/asking-the-user.md` |
| A result needs a human look or a server | `reference/asking-the-user.md` and `reference/hands-on-gate.md` |
| A pull-request row is actionable | `reference/pull-request-rows.md` |
| Design handoff, missing session or retirement | `reference/worker-briefs.md` |
| All rows are terminal | `reference/stand-down.md` |
| Unsure whether a capability exists | `reference/not-here-yet.md` |

Read a reference once, then retain its decision. Start with `ready --compact`; use full JSON,
a transcript range or a detailed board only to resolve a specific uncertainty. Never paste all
roadmaps or conversation history into a worker. Its generated brief carries its task and Scope.

## Bound the work and its cost

A task delivers its stated acceptance within its stated scope. Once verified, move it to the
landing/review path; no extra worker turn to reconfirm the same result. A partial report names
DONE, NEXT, FILES, TRAPS. A blocker names the failed approaches and the missing fact.

`LIMIT` means the scripted automatic-resume budget is exhausted (default three nudges per task,
across replacement sessions). Inspect the latest report and the branch. Finish already-complete
work, or narrow/split the remaining result using the roadmap skill. If a specific bounded step
still fits the original acceptance, record that step with:

```sh
orchestra drive --renew <key> --reason="specific remaining work and verification"
```

Renewal writes an audit note and launches nothing. Never renew merely because the row remains
open. Real undelivered relays may still be delivered at the limit; they do not replenish it.
A running turn is never killed by this budget. The 30-minute task size is a planning target,
not an engine-enforced timeout. Report this distinction when asked about guarantees.

Models come from `orchestra brief <key> --json` and the launch plan. Defaults are Sonnet for
Claude execution/review, Opus for design, and the user's native defaults for Codex. Project
`workerModels` and `workerThinking` can select each runtime/role explicitly. Forward Codex
`model`/`thinking` only when non-null and authorized by the host; otherwise omit them. A model
unavailable on the host is a configuration issue: do not silently upgrade or switch engines.
Existing sessions retain their actual selected model. A routine implementation is `Design no`.
A design worker produces a bounded recommendation; execution uses `--model execution`.

## Tick

1. **Yield, then acquire.** Run `orchestra doctor` at first entry and after configuration changes.
   Run `orchestra yield-check` before recording a replacement conductor or starting watches;
   exit 10 means hand back immediately. Acquire the conductor lock with the full session UUID
   and `--runtime claude|codex`. Do not conduct without the lock. Record that same runtime and
   full UUID on `conductor`; use runtime-specific liveness evidence.
2. **Read state and inbox.** Read `.orchestra/state.json`, then `orchestra inbox`. Process user
   answers before routine reporting. Run `orchestra ready --compact`; apply its corrections to
   the register. Git proves local landings; the shared issue overlay proves other owners' work.
   Refresh unknown native snapshots instead of treating them as dead sessions.
3. **Consume reports and answers.** A final worker message is evidence to inspect, not proof of
   landing. If done, record exact commit subjects and move to review/landing. If partial, drive
   within the budget. If blocked on a material user choice, publish the question. Keep a real
   answer verbatim in the row's `relay.text` with `writtenAt`; `drive` owns its delivery receipt.
   Run `orchestra drive --for=30` for owed work. Claude runs detached turns; Codex emits outbound
   JSON for native dispatch. Follow `reference/codex.md` for dispatch and observation receipts.
   Exit 12 means turns continue; wait for results. Never send a second turn over a running one.
4. **Review and land.** Read the human-look reference before presenting a visible/usable change
   or starting its server. Honour existing user authorization. Once the required look and
   configured gates are satisfied, use `orchestra land <branch>` and `orchestra await <branch>`.
   A detached/queued landing is not a successful merge. Resume a `STALLED` landing with the same
   command and inspect its result. Never cherry-pick or manually merge around the gate. Re-run
   tests only for relevant changes, failures or unresolved evidence. Clean up only the worker
   and server pids belonging to the finished row.
5. **Sync and launch.** Run `orchestra roadmap sync`, then recompute `orchestra ready --compact`.
   Launch new tasks only from `launches`, at its capacity. Process `relaunch` separately on
   the existing worktree; a verified design handoff also uses that tree. Both preserve the budget. `LAUNCHES HELD` means resolve owed work first.
   Claim each row with `orchestra roadmap claim <key>`. Respect roadmap ownership, functional
   dependencies and lanes. Touches does not serialize tasks. Each worker needs an independent
   session and isolated worktree; never write into another live worker's tree.
6. **Persist and release.** Journal meaningful changes, save the register while preserving
   unknown fields and fresh worker receipts, then release the conductor lock with the same
   UUID. Keep it only for the tick. A `LIMIT`, user question or gate wait is a valid resting
   state; it is not an instruction to send another generic nudge. Run `ready --compact` once
   to ensure no actionable report or answer was lost. End quietly if nothing meaningful changed.

## Worker creation

`roadmap runtime <slug> claude|codex|inherit` configures future workers. Existing sessions keep
their engine. A mixed fleet processes both transports. Never pass a Codex UUID to Claude.

Get `orchestra brief <key> --json` once. It contains the prompt, role, model and thinking.
Use its prompt exactly. Add only a verified worktree location and an undelivered user relay.
Use `--relaunch` or `--handover <turns>` for an existing tree and `--model execution` when a
completed design moves to implementation. Preserve the handoff and budget across replacements.

For Claude, create the declared branch/worktree from its correct base, then launch there:

```sh
claude --bg -n orchestra-<project id>-<task slug> --model <model> --effort <thinking> --dangerously-skip-permissions "<generated prompt>"
```

Pass the prompt through a structured argument or safe shell quoting; shell interpolation is not
JSON escaping. Record the actual full session UUID, sessionName, model, thinking and `claimed`
status. Find the UUID in `claude agents --json`; never guess from a truncated identifier. The
worker reports in its final message. `orchestra drive` handles subsequent resumes and receipts.
Do not install project dependencies speculatively; the worker follows the project's bootstrap.
For an absent session, verify no writer remains before reusing its tree. Preserve dirty work.

For Codex, follow the native reference: authorized independent task creation, correct project
and worktree, resolved thread UUID, attachment and fresh observation. A queued clientThreadId
is not a session. Internal sub-agents do not replace independent roadmap workers. Use native
wait cursors and compact snapshots; read history only when a report needs clarification.

## Monitor, questions and journal

`orchestra instances` shows the shared monitor URL. If absent, start `orchestra monitor --no-open`
detached, then query the actual bound URL; do not assume a port. Keep the monitor independent
of any one tick. A listening monitor is not proof that a conductor consumed an answer.

Write one `orchestra journal <kind> <key|-> "<text>"` per meaningful event: launch, note, question,
answer, landing or tick. Use the supported kinds shown by the CLI. Reports/questions use the
project language; committed material and grammar use English.

Questions live in row `pending[]`, or `runAsks[]` for the run, with a unique stable `id`, `kind`,
`ask`, `askedAt`, choices and recommendation where useful. Publish the pending item and journal
question in the same tick. A chat-only question is invisible on the page. Read the question
reference for its exact shape and framing. Workers may journal progress; only the conductor
changes the register. Keep implementation details out of the user's decision.

On an answer, preserve the exact ask and answer in `answered[]`, add `answeredAt`, and remove
it from `pending[]`; use `runAnswered[]` for run-level answers. Preserve original timestamps.
Advance `conductor.inboxSeen` only through answers actually handled. Failed or ambiguous native
delivery requires inspection before acknowledging. Never fabricate delivery stamps. A user
answer already authorizes the resulting action; do not ask for it again.

## Wakeups and stopping

Claude uses persistent Monitor tools for `orchestra watch-answers <full uuid>` and
`orchestra watch-workers`, once each. Their events trigger a tick. Use the existing heartbeat
installation as recovery; do not install a second scheduler. Codex uses native completion waits,
worker `notify` events and a thread heartbeat; see the native reference. Do not poll completed
workers or repeatedly read unchanged logs. Never wake a conductor in response to its own wake.

`RETIRE` is measured Claude context evidence; `cost` explains it. Codex transcript cost is
unmeasured unless native evidence exists. Both engines obey resume limits and carry compact
handoffs. Do not infer token use from runtime duration or read Codex UUIDs from Claude storage.
At completion, follow stand-down once. Do not create follow-up work just to keep the run alive.
