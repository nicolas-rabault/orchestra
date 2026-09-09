# What is not here yet

Read when you are about to reach for something and want to know whether this plugin has it. It
changes no step of a tick.

## What is not here yet

The single roll-call of what remains a genuine limitation or a deliberate **Never**, now that every
command this plugin ships actually exists.

- **A limitation, not an absence: `orchestra roadmap sync`.** It exists (see The tick, step 7);
  offline it does nothing, and that is correct (spec §4.1) — there is nowhere to write a status.
- **A limitation, not an absence: `ledgers` defaults to empty.** `orchestra init` proposes the
  ticket file (`.orchestra/tickets.jsonl`) into it for a fresh project, but nothing forces a project
  to keep it there. The gate commits what that key lists at the head of every landing; with nothing
  listed it commits nothing, and a conductor's `postLanding` remains the way a branch gets any OTHER
  main-branch ledger written.
- **A limitation, not an absence: the monitoring page sees only the ports orchestra recorded.** It
  asks `lsof` about the `port` written on a register row and on each `pending[]` item, and about
  nothing else — a band of the machine's ports was one project's own toolchain and does not travel
  to a project whose dev server lives somewhere else entirely. So a dev server on a port no
  register row names is invisible to the page. That question is answered by the dev-server sweep
  below, which is a shell procedure and not the page's job.
  **A port is not the only thing the card can offer to open**, though: `what to open` draws a
  button for every entry in the row's `links[]` as well, and derives one more for a pull-request
  review row from the row id and `origin` — see The hands-on gate. What it will never do is guess.
- **Never wire an answer's delivery to CREATE a conductor instead of to REACH the live one.** The
  page never does: when a beat under a minute old belongs to a live pid, it says so and that
  session's `orchestra watch-answers` loop hands over the answer within seconds; otherwise it says
  the answer is in the inbox and the next tick will read it, and it starts nothing itself. An
  answer typed while nobody is beating therefore waits. Where `orchestra install-heartbeat` is
  installed for this project, that wait has a floor of one heartbeat slot; where it is not, the
  wait ends only when a person runs a tick by hand. Either way it still waits, and that wait is
  the whole cost, paid deliberately: wiring the delivery of an answer to CREATE a conductor
  instead of to REACH the live one cost six conductor identities in half an hour on 2026-08-13 in
  planetCraft, two `merge_agent` runs twelve seconds apart on one branch, and three answers left
  unread because the register kept naming a reader that had already died. See `### The answer
  net, and what has no net under it yet` for what still cannot be covered.
- **Never propose a cron entry for the heartbeat.** `orchestra install-heartbeat` renders a launchd
  agent (macOS) or a systemd user timer (Linux) — never a crontab entry, because a cron job runs
  outside the login session and cannot read the login keychain: every tick died on `Not logged in`,
  eight consecutive ticks, seven hours lost, on the night of 2026-08-12/13 in planetCraft.
- **Never**: a retrospective tool (spec §13 — its metrics belong to the source project).
