#!/usr/bin/env node
// PreToolUse(Bash) guard: you do not start a shared task you have not claimed.
//
// "Taken instantly, and everyone notified" cannot rest on an agent's discipline. It has to be that
// THE GESTURE WHICH STARTS THE WORK IS THE GESTURE WHICH POSTS THE CLAIM. `git worktree add -b
// <branch>` is that gesture, and it is the only one, because every change in a project running
// this plugin goes through a worktree (spec §3).
//
// The verdict is `startVerdict` (`lib/roadmap/policy.mjs`), unchanged and already unit-tested; this
// file owns only the wording, and locating the board. The board comes from this plugin's own CLI,
// found from THIS hook's own file location — `hooks/` sits beside `bin/` in the plugin, and no
// environment variable (`CLAUDE_PLUGIN_ROOT` included) is guaranteed to be set in a hook's
// environment.
//
// It FAILS OPEN when the board is unreachable, or when its JSON parses to a shape that is not a
// board (`null`, `{}`, a bare number...): a network outage or a broken store must not stop work —
// blocking on an unreachable channel is worse than the duplicated effort it would prevent. A
// warning goes to stderr and the command proceeds.
//
// It FAILS CLOSED on a board served from cache (`board.stale`): a cached board is telling you, in
// as many words, that what it knows is out of date, and `startVerdict`'s own `stale` branch already
// refuses on that. No store in THIS plugin caches a board today — `orchestra roadmap board --json`
// either reaches its backend (git, and GitHub in online mode) or the command fails outright, which
// is the FAILS OPEN case above, not this one — so `board.stale` is always absent here and this
// branch is wired but unreached. It stays rather than being dropped: `startVerdict`'s `stale`
// reason is already written and tested, and a hook that dropped the field would have to be edited
// again the day a cache lands. One expression is not just-in-case code; an unwritten path is.
//
// Do no string work past finding no branch: a command with no `worktree add -b` must never pay for
// a `board --json` subprocess.
//
// Silent and exit 0 whenever `.orchestra/config.json` is absent (spec §3.1).
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPayload, projectFor } from '../lib/guards/payload.mjs';
import { claimedBranches } from '../lib/guards/claim.mjs';
import { startVerdict } from '../lib/roadmap/policy.mjs';

const ORCHESTRA_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orchestra');

const payload = readPayload();
if (!payload) process.exit(0);

const cfg = projectFor(payload.cwd ?? process.cwd());
if (!cfg) process.exit(0);

const command = payload.tool_input?.command ?? '';
if (!command) process.exit(0);

const branches = claimedBranches(command);
if (!branches.length) process.exit(0);

const cwd = payload.cwd ?? process.cwd();
let board;
try {
  const out = execFileSync(process.execPath, [ORCHESTRA_BIN, 'roadmap', 'board', '--json'], {
    cwd, encoding: 'utf8', timeout: 20_000,
  });
  board = JSON.parse(out);
} catch (e) {
  process.stderr.write(
    `warning: could not read the roadmap board (${String(e.message ?? e).split('\n')[0]}), so the claim on \`${branches.join(', ')}\` was not checked.\n`,
  );
  process.exit(0);
}
// The parse can succeed on a shape that is not a board (`null`, `{}`, a bare number...). Reading
// `.rows` off that without this check is the same unchecked-network-output mistake the try above
// exists to prevent, just one property access later — so it fails open the same way, in one check.
if (!Array.isArray(board?.rows)) {
  process.stderr.write(
    `warning: could not read the roadmap board (its JSON has no \`rows\` array), so the claim on \`${branches.join(', ')}\` was not checked.\n`,
  );
  process.exit(0);
}

const say = {
  foreign: (branch, row) =>
    `Blocked: \`${branch}\` is the branch of ${row.key}, on ${row.owner ?? 'another developer'}'s roadmap.\n`
    + '\n'
    + `A roadmap is nominative: only its owner may take its tasks. Ask ${row.owner ?? 'them'} to open it to\n`
    + 'everyone, or pick another task:\n'
    + `  orchestra roadmap open ${row.key.split('/')[0]}\n`,

  stale: (branch, row) =>
    `Blocked: the roadmap board is stale (cached at ${board.stale}), so it cannot say whether ${row.key}\n`
    + 'is already claimed.\n'
    + '\n'
    + 'Finish what is in flight; start nothing new until `orchestra roadmap board` reaches its backend\n'
    + 'again.\n',

  unclaimed: (branch, row) =>
    `Blocked: \`${branch}\` is the branch of task ${row.key}, and it is not claimed by you.\n`
    + '\n'
    + 'Claim it first — that records the claim and lets everyone see it taken:\n'
    + `  orchestra roadmap claim ${row.key}\n`
    + '\n'
    + (row.status === 'claimed'
      ? 'It is currently claimed by someone else. Pick another task, or ask them.\n'
      : 'Then re-run your worktree command.\n'),
};

for (const branch of branches) {
  // A branch matching no row is an ordinary fix or study and is none of this guard's business.
  const row = board.rows.find((r) => r.branch === branch);
  if (!row) continue;
  const verdict = startVerdict(row, { stale: board.stale ?? null });
  if (verdict.ok) continue;
  process.stderr.write(say[verdict.reason](branch, row));
  process.exit(2);
}
process.exit(0);
