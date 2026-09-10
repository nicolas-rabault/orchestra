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
design-to-execution handoff. Read model and thinking from `orchestra brief <key> --runtime codex --json`. Omit null
values from native tool arguments. Non-null values are explicit project choices; forward them
only when authorized and supported by the host. Claude model aliases never select a Codex model. Tell the worker to
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

Use event-driven `wait_threads` while conducting: wait for worker completion or attention,
with a bounded wait of at most 60 seconds, then process the result and check the monitor inbox.
Use up to eight workers together and reuse each returned cursor as `afterCursor`. A multi-worker
wait can return only the first changed worker: do not infer the other workers' state from it.
A timeout is an observation, not a failure. Do not return to an hourly schedule while known
worker completions or accepted user answers still need action. Prefer snapshots over rereading whole
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

Include `turnId` from `latestTurn.id` and `startedAt` from the native snapshot (Unix seconds
or ISO). A dispatch requires a fresh completed baseline; a needs-input flag may be an active
approval and does not authorize resuming or approving it.
Observations expire after five minutes. `ready` then prints `REFRESH`, holds new launches and
does not invent a running or stopped process. Refresh from the native app, never from Claude's
process list. The monitor shows these native observations and their uncertainty.

A `LIMIT` row needs report inspection and a bounded remaining step before explicit budget renewal.
Attaching a replacement preserves its counter. For an idle native worker, `orchestra drive <key>` emits an outbound JSON object instead of
running Claude. Save it verbatim. Call `send_message_to_thread` with exactly its `arguments`,
then add `acceptedAt` from the successful call's clock (and its `turnId` if supplied) to that
object and run:

```
orchestra codex dispatched <key> <outbound.json>
```

Do not retry an ambiguous dispatch automatically: inspect the native task first to avoid sending
the same work twice. The CLI does not itself invoke app tools and cannot infer delivery.

Keep the outbound's `preparedAt` and baseline unchanged when recording dispatch. On a later
successful completion, include its `dispatchId` and the native `turnId` and `startedAt` in the
observation. If the send tool supplied no turn id, receipt requires a different turn from the
pre-send completed baseline, starting no earlier than the preparation second. Comparing with
acceptedAt alone is wrong: the turn can start before the tool returns and native timestamps
have second precision. Serialize sends to each worker: this baseline proof assumes no concurrent
sender starts another turn between the snapshot and the send. If that is uncertain, inspect the
actual turn history before acknowledging. No proof means no receipt: leave the relay owed and investigate. The
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
Use event delivery as the primary path. After verifying `codex queue` wakes the existing native
conductor on this host, record `conductor.eventTransport: "codex-queue"`. The monitoring server
queues a wake after saving an answer, a completed landing queues a wake after recording its
outcome, and each worker calls `orchestra notify <task-key>` immediately before its final report
or question. These signals address the existing conductor UUID; they never create a session.
The notification is only a wake: read the inbox and native report/gate evidence as authority.
A worker signal may arrive before its final message: wait for that turn to complete before
consuming its report. Never respond to a wake by sending another wake.

Keep one hourly native heartbeat as recovery for lost events, a stopped monitor or an unavailable
queue command. If event transport is unavailable on a host, use a minute heartbeat temporarily
and say why; do not pretend queue acceptance is proof of consumption. Preserve the inbox and
report on a delivery failure and let recovery reconcile them. The monitor distinguishes a queued
wake from a consumed answer. Do not retry ambiguous queue submissions blindly.

On every wake, process monitor answers BEFORE routine reporting. An answer is already a user
instruction: never wait for a chat message or ask whether to relay it. Acquire the native lock,
relay each answer verbatim to its independent worker with the native task tool, move its pending
item to answered (preserve askedAt, add answeredAt), journal an answer, and advance inboxSeen
only through the answers actually handled. On failed or ambiguous dispatch, do not acknowledge
the answer: inspect the worker before retrying. Human acceptance continues to the configured
landing gates without another merge approval. Publish new questions in pending and the journal
in the same turn; a final worker report or a chat-only question is not a monitor question.

Use native completion waits while active rather than waiting for the recovery schedule. Claude
keeps its Monitor answer/worker watches; workers of either engine use notify to wake a Codex
conductor. Codex queue wake was observed on this host after a short delay: an immediate idle
snapshot is not evidence of failure. Do not start a separate app-server daemon to imitate the
native desktop endpoint. Keep full reconciliation timestamps as conductor.lastFullTickAt only
after completing a full tick, never merely after an inbox check.

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
