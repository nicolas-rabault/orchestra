# Worker briefs and handoffs

`orchestra brief <key> --json` renders the prompt and selects runtime, role, model and thinking.
Use its output; do not compose another brief. Plain `brief` prints only the prompt.

The prompt contains this task's canonical excerpt (including Scope), actual Touches sizes,
the current main commit, matching spec/plan paths, project rules, branchTests, briefExtra,
report language, progress/notify commands and the runtime's reporting protocol.
Document matching uses ID boundaries: D1 does not load D10. Start with these paths and read
ranges; use bounded searches. Delegated research returns conclusions, not full transcripts.
Acceptance plus Scope determines completion; no polishing pass after the stated check passes.

The role is computed once in `lib/register/workerPolicy.mjs`: pr/PR<number> is review,
Design yes is design, otherwise execution. Claude execution/review default to Sonnet with
medium effort, design to Opus with high effort. Native Codex defaults remain inherited unless
configured. `workerModels` and `workerThinking` configure runtime/role pairs; the host validates
model availability. Preserve a live session's actual model on the row. Do not escalate silently.

## Design to execution

A design worker commits a bounded spec and plan with its recommended approach. It does not
implement. Adopt that recommendation only within the already authorized scope. An unresolved
product decision still needs the user; follow the question reference.

When complete, launch a fresh execution session on the same worktree using:

```sh
orchestra brief <key> --model execution --json
```

The override is required: the roadmap's Design remains yes. Record the new identity and the
returned execution model/effort. Preserve task history and autoResumes; replacing a session
never expands its task or replenishes its budget.

## Resume limits

`ready --compact` reports `limited` when the task used maxAutoResumes (default three).
`drive` refuses another generic nudge, for both runtimes, even when explicitly named.
Claude reserves a nudge before spawn; native Codex counts it after a successful dispatch is
recorded. Preparation alone is not dispatch. A failed Claude start counts conservatively to
avoid retry loops. Undelivered real relays remain deliverable and do not reset the counter.

Inspect the latest report and branch. Move finished work to the gate. Split oversized remaining
work or identify a concrete remaining step. Only then may the conductor explicitly renew with
`drive --renew <key> --reason="remaining step and verification"`. The command journals the
reason, resets the counter and launches nothing. Never renew repeatedly to keep a row active.

The limit bounds generic resumes, not API requests inside a turn or wall-clock duration.
The brief asks workers to stop after two failed approaches and targets about 30 minutes per
result; those are instructions, not transport-enforced timeouts.

## Context retirement and dead sessions

`orchestra cost` measures Claude transcript prefixes; `ready` reports RETIRE from that evidence.
Default retireAt remains 200000 tokens. Retirement requires at least twenty requests, a prefix
above twice its own boot, and a stopped worker not waiting for a user or gate. These guards
avoid replacing a session that would immediately need replacing again.

`orchestra retire <key>` drives one wrap-up, saves its non-empty DONE/NEXT/FILES/TRAPS note,
then stops the session. It never launches the replacement. If wrap-up fails, retain the session.
`ready` then reports RELAUNCH unless the resume budget requires inspecting the task first.
Use `brief <key> --handover <turns>` for that replacement, carrying the saved note. Verify dirty
work and the prior writer's absence; reuse the worktree and continue from the handoff.
For a dead session without retirement, use `--relaunch` and inspect git status and branch commits.

Codex usage is unmeasured without native evidence. Its handoff uses a native wrap-up message,
verified note and a replacement independent task, subject to host authorization. Never call
Claude retire/stop against a Codex UUID, and never archive a running task to simulate stopping it.
Read reference/codex.md for native identity, observation and delivery requirements.
