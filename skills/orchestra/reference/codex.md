# Codex desktop sessions

This is the Codex transport for the same conductor protocol. Read it before the tick in Codex.
It overrides Claude commands and Claude-only tool names in the main skill, not the project's
decisions or acceptance criteria. Never execute `claude` against a Codex task identifier.

## One independent task per worker

Use the desktop app's `create_thread`, `send_message_to_thread`, `wait_threads`, `read_thread`
and `list_threads` tools. The user must have requested independent tasks (for example by asking
to launch orchestra's worker sessions). If the host forbids creating tasks without explicit
authorization, honor that boundary. Do not substitute `spawn_agent`, a fork, or a CLI process.
The conductor and every worker have distinct native thread UUIDs. A worker may delegate its
own bounded subtasks; those sub-agents are not rows in orchestra's register.

Before creation, call `list_projects` and select the correct project and host. Claim the row
first. For new repository work, create a native worktree from the row's requested branch/base;
use the returned worktree path, not an invented path. For an explicitly authorized migration,
use the existing worktree's saved project with `environment: {type: "local"}` so dirty work is
preserved. If that worktree is not a saved project, resolve that before dispatch; never silently
start on main. Keep the session title `orchestra-<project id>-<task slug>`.

The prompt carries `orchestra brief <key> --relaunch --runtime codex` (or the ordinary brief
with `--runtime codex` for a fresh row),
the existing handoff, and any undelivered `relay.text` verbatim. Use `--model execution` for the
design-to-execution handoff. The labels `opus` and `fable` name Claude models only: omit the
native create tool's model override unless the user chose a Codex model. Tell the worker to
report in its final message, and to leave state.json and landings to the conductor.

Creation is asynchronous. Do not put a queued `clientThreadId` in state.json. Resolve it to a
ready `threadId` first, then register the native identity:

```
orchestra codex attach <key> <threadId> --host=local
```

This preserves `previousSession`, writes `runtime: "codex"`, `session` and `hostId`, and removes
the obsolete ad-hoc `codexWorker` field. Do not mark a worker running merely because it was
created. Get a fresh `wait_threads` snapshot, read its report, then record the observation.

## Observe and resume

Use bounded `wait_threads` calls (up to eight workers together). Reuse each returned cursor as
`afterCursor`; a timeout is an observation, not a failure. Prefer snapshots over rereading whole
conversations. Record the observation with:

```
orchestra codex observe <key> <snapshot.json>
```

The file contains `threadId`, `hostId`, `observedAt` from the clock, and `status`:

- `running`: the native turn is in progress, with no approval/input flag.
- `needs-input`: the native task is waiting on approval or user input. Relay the question using
  the main protocol and its pending-item rules. Never auto-approve another task's request.
- `completed`: the latest native turn completed successfully. This does not mean the roadmap
  task is finished: read the final report and verify claimed work on disk before changing status.
- `unknown`: native lookup failed, the state is ambiguous, or the turn failed/interrupted.

Include the real latest `turnId` and `startedAt` when available (normalize Unix seconds to ISO).
Observations expire after five minutes. `ready` then prints `REFRESH`, holds new launches and
does not invent a running or stopped process. Refresh from the native app, never from Claude's
process list. The monitor shows these native observations and their uncertainty.

For an idle native worker, `orchestra drive <key>` emits an outbound JSON object instead of
running Claude. Save it verbatim. Call `send_message_to_thread` with exactly its `arguments`,
then add `acceptedAt` from the successful call's clock (and its `turnId` if supplied) to that
object and run:

```
orchestra codex dispatched <key> <outbound.json>
```

Do not retry an ambiguous dispatch automatically: inspect the native task first to avoid sending
the same work twice. The CLI does not itself invoke app tools and cannot infer delivery.

On a later successful completion, include that `dispatchId` and the matching native `turnId` in
the observation. If the send tool supplied no turn id, completion needs a native `startedAt`
at or after `acceptedAt`. No proof means no receipt: leave the relay owed and investigate. The
command stamps a receipt only for a completed, matching turn and the unchanged exact relay.
An old completed snapshot, a creation result, an approval wait or a model refusal is not delivery.
For a migration's first brief, verify its work directly; if no dispatch evidence exists, explicitly
relay the pending message through this cycle rather than inventing a receipt.

`drive` may emit both Claude reports and Codex outbound objects on a mixed fleet. Process both.
Do not treat an exit code as evidence that native dispatch occurred. Codex cost is unmeasured
unless native usage evidence is available; never read its UUID from Claude's transcript store.
Native retirement is a wrap-up message, a verified handoff, and a replacement independent task.
Do not archive an active task to simulate stopping it: obtain an explicit stop at a turn boundary,
or use the host's native interrupt capability when available, before transferring its worktree.

## Conductor and scheduled ticks

Record `conductor.runtime: "codex"` and the full native conductor UUID. The legacy launchd/systemd
timer is a Claude transport. `tick-gate` skips a Codex-owned project unless invoked with
`ORCHESTRA_RUNTIME=codex`; `budgetRuntime` scopes a refusal to its originating runtime (legacy
entries default to Claude). A Claude budget refusal must not stop native Codex work.

Use a native **thread heartbeat automation** attached to the conductor for recurring orchestra
ticks. Inspect existing automations and update rather than duplicate. The prompt must rehydrate
the project and this skill, poll real worker tasks, read the inbox, drive owed native turns, apply
the normal gates, and remain quiet unless something meaningful changes or the user must act.
Use the app automation tool, not a shell cron or the Claude `install-heartbeat` command.
The heartbeat must check the inbox every minute (`FREQ=MINUTELY;INTERVAL=1`). Update an existing
conductor heartbeat instead of adding a second one. Keep full roadmap ticks hourly when nothing
has changed: first run `orchestra inbox`, and exit silently when it is empty and the last full
tick is less than an hour old. Store that full-tick timestamp as `conductor.lastFullTickAt` only
after a complete tick. Missing timestamps require a full tick. Inbox checks do not advance it.
A scheduled tick must release the conductor lock when done, just like an interactive tick.

Codex desktop does not provide Claude's persistent `Monitor` tool or `SendMessage` semantics.
Do not start a detached loop and claim it wakes this conversation: it does not. Poll inbox during
active ticks and use the minute heartbeat between turns. The UserPromptSubmit inbox hook only
injects answers when a turn starts; it cannot wake an idle conductor. Never present that hook
alone as automatic delivery. A minute schedule is polling, not instantaneous notification;
host availability and scheduler delays still apply.

On every wake, process monitor answers BEFORE routine reporting. An answer is already a user
instruction: never wait for a chat message or ask whether to relay it. Acquire the native lock,
relay each answer verbatim to its independent worker with the native task tool, move its pending
item to answered (preserve askedAt, add answeredAt), journal an answer, and advance inboxSeen
only through the answers actually handled. On failed or ambiguous dispatch, do not acknowledge
the answer: inspect the worker before retrying. Human acceptance continues to the configured
landing gates without another merge approval. Publish new questions in pending and the journal
in the same turn; a final worker report or a chat-only question is not a monitor question.
Take `orchestra lock acquire --kind conductor --session <threadId> --runtime codex`.
Keep the tick lock only during the tick, and never fabricate a live process beat. A native lock
uses a conservative four-hour lease when no process heartbeat exists; release it at the end of
every tick. A crashed native holder may delay another conductor until expiry; do not declare
it dead merely because Claude cannot see it. The native
heartbeat replaces the timer, not the journal, inbox watermark or human-look gate.

Claude hooks are not assumed to execute in Codex. Apply claims, serialized land/await gates and
worktree ownership checks explicitly. All deployments, external messages and approvals remain
subject to the host's permissions. Keep Claude's existing path available for Claude projects.

## Migration checklist

Save the original row, readable conversation, full transcript and dirty work before stopping the
old session. Preserve user answers verbatim. Confirm the old worker stopped; no two workers may
write the same tree. Create and observe the replacement, attach its actual native identity, and
journal the handoff. A finished row waiting for a dependent landing needs no replacement worker.
Do not delete the old transcript or erase the old session's provenance. A runtime migration is
not a reset of its work, claims, acceptance criteria or human review.
