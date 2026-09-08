#!/bin/sh
# The orchestra heartbeat's tick. Rendered by `orchestra install-heartbeat` (lib/cli/heartbeat.mjs)
# into <project root>/.orchestra/tick.sh — hidden from git, online by the `.orchestra/.gitignore`
# `orchestra init` writes and offline by the line it appends to this clone's own `info/exclude`,
# never committed either way — with this project's root and the absolute path this plugin's own
# `bin/orchestra` was installed at. Both are baked in as literal values below rather than
# re-derived from this script's own location, so the tick needs nothing from where it happens to be
# run from.
#
# Installed as a LaunchAgent (macOS, templates/heartbeat.plist) or a systemd user timer (Linux,
# templates/heartbeat.service + templates/heartbeat.timer) — deliberately NOT a crontab entry: a
# crontab entry runs outside the user's login session and cannot read the login keychain. On the
# night of 2026-08-12/13 in planetCraft every cron tick died on "Not logged in" — eight consecutive
# ticks, seven hours frozen. An agent or a user-session timer runs inside the login session and
# sees the keychain.
set -u

ROOT="__ROOT__"
BIN="__BIN__"
DIR="$ROOT/.orchestra"
LOG="$DIR/tick.log"
mkdir -p "$DIR"

# The plugin is installed into a cache directory whose path carries the plugin's OWN version, so a
# version bump moves $BIN and silently orphans every agent installed before it — the rendered
# ProgramArguments/ExecStart line still names the old path. Checked first, before anything else
# tries to run it, so the failure is one loud line an hour rather than an hourly silent no-op.
if [ ! -f "$BIN" ]; then
  echo "== tick $(date -u '+%Y-%m-%dT%H:%M:%SZ') not run: $BIN no longer exists (the orchestra plugin moved — likely a version bump); re-run \`orchestra install-heartbeat\` from the new install to point this project's agent at it again ==" >> "$LOG"
  exit 0
fi

# The agent's environment is minimal — claude and node live outside /usr/bin:/bin, and the tick
# session inherits this environment for everything it spawns.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

cd "$ROOT" || { echo "== tick $(date -u '+%Y-%m-%dT%H:%M:%SZ') not run: cannot enter $ROOT ==" >> "$LOG"; exit 0; }

# One conductor at a time — this tick, the next tick, AND an interactive /orchestra, which takes
# the same lock. `orchestra lock` (lib/register/lock.mjs) is the single implementation every
# caller shares; it records who holds it and breaks a holder that is provably gone (a dead pid, or
# a conductor whose beat has stopped) rather than waiting out a blind timer.
HELD="$("$BIN" lock acquire --kind tick --pid $$ 2>/dev/null)" || {
  # Exit 0 rather than 1: another conductor holding the lock is the system working, not failing.
  echo "== tick $(date -u '+%Y-%m-%dT%H:%M:%SZ') not run: ${HELD:-lock held} ==" >> "$LOG"
  exit 0
}
trap '"$BIN" lock release --kind tick --pid $$ >/dev/null 2>&1' EXIT
STAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# WHO fired this tick: the agent (ORCHESTRA_TRIGGER=agent, set by the plist/service) or a hand-run
# tick (unset here, read as "manual"). Without this the log cannot tell the two apart, and that is
# not hypothetical: asked in planetCraft on 2026-08-14 whether the heartbeat survives sleep,
# fourteen tick lines could not answer, because the ones that mattered were indistinguishable from
# ones a human had triggered by hand.
TRIGGER="${ORCHESTRA_TRIGGER:-manual}"

# Keep the log bounded.
[ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 1000000 ] && tail -c 500000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"

# Should this tick run at all, and should it hold the machine awake? Decided in
# lib/register/tick.mjs, which is unit-tested; the shell only reads the verb, and the exit code is
# deliberately NOT the channel (lib/cli/tick.mjs) — a gate that cannot answer must not be able to
# silence the heartbeat, and `set -e` here would turn a non-zero exit into exactly that. So this
# reads the line's FIRST WORD only, and nothing checks $?.
GATE="$("$BIN" tick-gate 2>/dev/null)" || GATE=""
[ -n "$GATE" ] || GATE="run gate-unavailable"
case "$GATE" in
  skip*) echo "== tick $STAMP ($TRIGGER) not run: ${GATE#skip } ==" >> "$LOG"; exit 0 ;;
esac

# Work is in flight, so keep the machine from sleeping under it — self-renewing (each hourly tick
# with work pushes the window out), self-expiring 90 minutes after the last one that had work, gone
# entirely once the roadmap ends and the ticks stop asking. Closing the lid still wins.
# `caffeinate` is macOS-only. On a system without it this is a silent no-op, not a failure — the
# Linux path has no equivalent wired in here yet, and that gap is real: see the README.
case "$GATE" in
  *hold-awake*)
    if command -v caffeinate >/dev/null 2>&1; then
      pgrep -f 'caffeinate -dimsu -t 5400' >/dev/null 2>&1 || (caffeinate -dimsu -t 5400 &) 2>/dev/null
    fi
    ;;
esac

{
  echo "== tick $STAMP ($TRIGGER) =="
  # Never conduct beside a live conductor. `orchestra tick-gate` already stood this tick down for
  # one, off the same beat — but it decided well above here, before the caffeinate step, and a
  # conductor that started in that window would be conducted over. This asks again at the last
  # moment (lib/register/wake.mjs) and, unlike the gate, records the handback where it can be found
  # later: a gate `skip` reaches tick.log only.
  "$BIN" yield-check
  [ $? -eq 10 ] && exit 0
  # `env -u`, never a bare `claude`. A tick started from inside a Claude Code session inherits
  # CLAUDE_CODE_CHILD_SESSION=1 and dies on "Failed to authenticate: OAuth session expired and
  # could not be refreshed" (an older build said "Not logged in · Please run /login"). THE MESSAGE
  # LIES: the keychain is fine. A negative control run in planetCraft on 2026-09-01, at the same
  # instant and with the same keychain, showed the bare form fail and this line answer OK — that
  # project's tick log holds 30 of those deaths across the two wordings. A tick fired by the timer
  # inherits no such variable, so this only ever bit a tick started by hand.
  env -u CLAUDE_CODE_CHILD_SESSION claude -p --dangerously-skip-permissions --model opus "/orchestra tick"
} >> "$LOG" 2>&1
