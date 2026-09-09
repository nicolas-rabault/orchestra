#!/usr/bin/env node
// The ONE PreToolUse(Bash) guard. Four decisions, one process.
//
// It was four hooks — one file per rule, each its own `node` — and that shape was paid for on
// every Bash call an agent makes anywhere on the machine, which is nearly every call it makes at
// all: measured 2026-09-09 across duckJam's 123 worker sessions, 11 439 of 12 518 tool calls were
// Bash, so four hooks meant 45 768 node processes, each re-reading the same stdin, re-loading the
// same config and re-running the same `git rev-parse` to answer the same question. One process
// costs 130-220 ms of that; four cost four times the machine, on a machine forty workers share.
//
// So the rules are functions here, not files, and they run CHEAPEST FIRST. An ordinary `grep` —
// the overwhelming majority of what reaches this hook — now leaves after two regex passes and no
// subprocess at all. The two rules that cost something run only when the command's own text says
// they must: a `git commit`/`git merge` before anything asks git where it is, a `worktree add -b`
// before anything asks the roadmap board who claimed what.
//
// Each rule's own reasoning stays with it, in the header of its block below. What they share is
// here: the payload is read once, the config is loaded once, and the FIRST refusal wins — nothing
// below a refusal runs, because the command is already stopped.
//
// Silent and exit 0 whenever `.orchestra/config.json` is absent (spec §3.1): this plugin is
// installed globally, so a project that has not opted in must see no behaviour at all.
import { execFileSync } from 'node:child_process';
import { readPayload, projectFor } from '../lib/guards/payload.mjs';
import { draftAdds } from '../lib/guards/draft.mjs';
import { bareSuiteRun } from '../lib/guards/suite.mjs';
import { claimedBranches } from '../lib/guards/claim.mjs';
import { startVerdict } from '../lib/roadmap/policy.mjs';
import { segments, stripEnv, envAssigned } from '../lib/guards/segments.mjs';
import { isMainCheckout } from '../lib/guards/mainCheckout.mjs';
import { ORCHESTRA_BIN } from '../lib/guards/orchestraBin.mjs';

const payload = readPayload();
if (!payload) process.exit(0);

const cwd = payload.cwd ?? process.cwd();
const cfg = projectFor(cwd);
if (!cfg) process.exit(0);

const command = payload.tool_input?.command ?? '';
if (!command) process.exit(0);

// A draft roadmap is never staged.
//
// The drafts directory is hidden from git once `orchestra init` has run — online, by the
// `.orchestra/.gitignore` it writes; offline, by the line it appends to this clone's own
// `info/exclude`, never committed — so an ordinary `git add` of a draft is already refused by git
// itself, and the only way past that refusal is `-f`. But a project that has not run `init` yet,
// or has since edited its own exclusion, has no such floor. So, unlike the guard this is spun off
// from in the source project (planetCraft's `guard-local-roadmap.mjs`, which only had the
// gitignore-bypass case to cover and so only ever looked for `-f`), this rule does not require
// `-f` at all: it refuses NAMING a path under `cfg.roadmaps.drafts` on a `git add`, whether or not
// `-f` is present — see `lib/guards/draft.mjs`'s header for the decision itself.
//
// What this cannot catch: `git add -A` (or a bare `git add .`) sweeps a draft into the index
// without ever naming it, and only that exclusion stops that case.
//
// First because it is the cheapest: one regex over the command text, no environment, no
// subprocess.
function draft() {
  const blocked = draftAdds(command, cfg.roadmaps.drafts);
  if (!blocked) return null;
  return `Blocked: \`${blocked}\` stages a draft roadmap, and ${cfg.roadmaps.drafts} is never committed.\n`
    + '\n'
    + "A draft holds one developer's own programme and stays on that machine until it is ready to\n"
    + 'share. If this work should be shared, publish it instead:\n'
    + `  orchestra roadmap publish <path under ${cfg.roadmaps.drafts}>\n`;
}

// A bare invocation of the project's own `suite` gate is the merge gate's run, not a dev-loop
// check.
//
// In the source project this was ported from (planetCraft), the full suite was ~2300 tests across
// 289 files and saturated a shared machine for minutes whenever an agent ran it out of habit
// instead of its narrower dev-loop command — so that project's version of this rule carried a
// table of runner regexes (`npm test`, `npm t`, `vitest`) because its suite command was hardcoded
// and never varied. This plugin is generalised, not ported: the project already told us its suite
// command (`cfg.gates.find((g) => g.name === 'suite').cmd`), so the rule is exact instead of
// guessed — see `lib/guards/suite.mjs`'s header for the decision itself.
//
// No gate named `suite` means this rule has nothing to guard, and `orchestra doctor` says so on
// its own row rather than leaving the silence to be discovered: measured 2026-09-09, duckJam names
// its only gate `pytest` and had therefore never once been guarded.
//
// The environment: `orchestra land` (`lib/gate/land.mjs`'s `gateEnv`) runs the configured `suite`
// gate as a child stamped with `ORCHESTRA_FULL_SUITE=1`, so a project whose `suite` gate is itself
// an agent session gets a session whose hooks inherit the marker — refusing that agent's own Bash
// calls would refuse the very run the gate exists to perform. Read the same two ways `mainCommit`
// reads `ORCHESTRA_GATE` (that block's own header has the fuller reasoning); the segment-text
// reader lives in `bareSuiteRun` itself.
function fullSuite() {
  if (process.env.ORCHESTRA_FULL_SUITE === '1') return null;
  const gate = cfg.gates.find((g) => g.name === 'suite');
  if (!gate) return null;

  const blocked = bareSuiteRun(command, gate.cmd);
  if (!blocked) return null;

  const alt = cfg.branchTests
    ? `Run what your branch affects instead:\n  ${cfg.branchTests}\n`
    : 'This project has not configured `branchTests` — narrow the run yourself (a file, a `-t` pattern, `--changed`).\n';

  return `Blocked: \`${blocked}\` is a bare run of this project's suite gate (\`${gate.cmd}\`), not a dev-loop check.\n`
    + '\n'
    + alt
    + '\n'
    + 'The suite gate itself runs once per landing, through `orchestra land`. Override here with:\n'
    + `  ORCHESTRA_FULL_SUITE=1 ${blocked}\n`;
}

// Main is integrate-only, for COMMITS and MERGES.
//
// `guard-main-edit.mjs` already blocks a write landing in the main checkout, but it dispatches on
// `tool_input.file_path`, and neither a `git commit` nor a `git merge` carries a file path at all —
// so that guard never evaluates either. The commit half of the gap is not theoretical: on
// 2026-07-28 in planetCraft, a `git commit --amend` meant for a worktree ran in the main checkout
// because the shell cwd had drifted between two calls. It replaced main's tip and swept 34
// untracked files into version control; nothing but that project's merge gate caught it.
//
// So: block a `git commit` OR a `git merge` whose effective repository is THIS project's main
// checkout, on `cfg.mainBranch`. A landing's own fast-forward merge is never at risk from this
// rule: `lib/gate/land.mjs` runs it with `execFileSync('git', …)`, never through the Bash tool, so
// no PreToolUse hook has ever fired on it — not in this plugin, and not in the source project this
// was ported from, whose "`git merge` is deliberately not blocked" reasoning does not survive
// scrutiny here: nothing was ever relying on this hook to LET a landing's merge through, because
// this hook never saw it in the first place. What this rule actually sees is an AGENT typing `git
// merge` on `cfg.mainBranch` by hand, which "main is integrate-only" forbids exactly as much as a
// hand-typed commit does — the only thing allowed to merge into `cfg.mainBranch` is `orchestra
// land`. Conflict resolution during a landing happens in the branch's own worktree, where `gitDir
// !== commonDir` already lets every git call there through untouched.
//
// `git merge --abort`/`--continue`/`--quit` are exempt: they act on a merge already in progress and
// never merge anything INTO a branch, so blocking a recovery action would make a bad state worse.
//
// The override is `ORCHESTRA_GATE=1`, read TWO ways, because a PreToolUse hook fires on the
// agent's Bash command and receives that command as TEXT — it does not inherit the environment of
// an `orchestra land` process running elsewhere on the machine:
//   - the segment's own text — an `ORCHESTRA_GATE=1` assignment on the command line, the only
//     form a human or an agent can actually type, matching the explicit-override idiom this
//     plugin already uses for `ORCHESTRA_FULL_SUITE=1`.
//   - the hook's own environment — `process.env.ORCHESTRA_GATE === '1'` disarms the rule for the
//     whole session. Not decoration: `lib/gate/land.mjs` runs every configured gate as a child
//     under this marker, so a project whose `gates` entry is itself an agent session gets a
//     session whose hooks inherit it — and refusing THAT agent's commits would refuse the
//     landing the gate exists to perform.
// Neither reader covers the gate's own writes: `lib/gate/land.mjs` and `lib/store/files.mjs`
// write to main with `execFileSync('git', …)` directly, never through the Bash tool, so no hook
// ever fires on those calls in the first place — the marker was never what let the gate write to
// main; nothing was ever going to stop it.
//
// Third, not first, because it is the first rule that can cost a subprocess: `isMainCheckout` asks
// git where a directory is, and it is reached only by a command whose own text carries a `git
// commit` or `git merge`.
function mainCommit() {
  if (process.env.ORCHESTRA_GATE === '1') return null;

  // A recovery action on a merge already in progress, never a merge INTO anything — see above.
  const MERGE_RECOVERY = new Set(['--abort', '--continue', '--quit']);

  // `cd` inside the command changes where a LATER segment's git runs, and cwd drift is the whole
  // failure mode here — so follow it rather than trusting the session cwd alone.
  let dir0 = cwd;

  for (const segment of segments(command)) {
    if (envAssigned(segment, 'ORCHESTRA_GATE')) continue;

    const tokens = stripEnv(segment).split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;

    if (tokens[0] === 'cd' && tokens[1]) {
      dir0 = tokens[1].startsWith('/') ? tokens[1] : `${dir0}/${tokens[1]}`;
      continue;
    }
    if (tokens[0] !== 'git') continue;

    // Walk git's own options to find the subcommand, capturing -C's directory on the way.
    let dir = dir0;
    let i = 1;
    while (i < tokens.length && tokens[i].startsWith('-')) {
      if (tokens[i] === '-C' && tokens[i + 1]) { dir = tokens[i + 1]; i += 2; continue; }
      i += 1;
    }
    const verb = tokens[i];
    if (verb === 'merge' && MERGE_RECOVERY.has(tokens[i + 1])) continue;
    if (verb !== 'commit' && verb !== 'merge') continue;

    const checkout = isMainCheckout(dir, { root: cfg.root });
    if (!checkout || checkout.branch !== cfg.mainBranch) continue;

    const how = verb === 'merge'
      ? `Only \`orchestra land <branch>\` may merge into ${cfg.mainBranch} — land the branch through the merge gate:\n  orchestra land <branch>\n`
      : "This is nearly always cwd drift, not intent — the shell left the worktree between two calls.\n"
        + "Anchor git to the worktree explicitly instead of relying on the shell's cwd:\n"
        + `  git -C ${checkout.root}/${cfg.worktrees}/<name> commit ...\n`
        + '\n'
        + 'No worktree yet:\n'
        + `  git -C ${checkout.root} worktree add ${cfg.worktrees}/<name> -b <name> ${cfg.mainBranch}\n`;

    return `Blocked: \`${segment}\` ${verb === 'merge' ? 'merges into' : 'commits to'} the MAIN checkout on branch ${cfg.mainBranch}, and main is integrate-only.\n`
      + '\n'
      + how
      + '\n'
      + `An integration ${verb} that genuinely belongs on ${cfg.mainBranch} overrides with: ORCHESTRA_GATE=1 git ${verb} ...\n`;
  }
  return null;
}

// You do not start a shared task you have not claimed.
//
// "Taken instantly, and everyone notified" cannot rest on an agent's discipline. It has to be that
// THE GESTURE WHICH STARTS THE WORK IS THE GESTURE WHICH POSTS THE CLAIM. `git worktree add -b
// <branch>` is that gesture, and it is the only one, because every change in a project running
// this plugin goes through a worktree (spec §3).
//
// The verdict is `startVerdict` (`lib/roadmap/policy.mjs`), unchanged and already unit-tested;
// this block owns only the wording, and locating the board. The board comes from this plugin's own
// CLI, at `lib/guards/orchestraBin.mjs`'s `ORCHESTRA_BIN` — resolved from that module's own file
// location, never from an environment variable (`CLAUDE_PLUGIN_ROOT` included is not guaranteed to
// be set in a hook's environment), and shared with `lint-roadmap.mjs`, the only other hook that
// shells out to the CLI.
//
// It FAILS OPEN when the board is unreachable, or when its JSON parses to a shape that is not a
// board (`null`, `{}`, a bare number...): a network outage or a broken store must not stop work —
// blocking on an unreachable channel is worse than the duplicated effort it would prevent. A
// warning goes to stderr and the command proceeds.
//
// It FAILS OPEN, through `startVerdict`, on a row no shared channel carries (`shared: false` on the
// board row) — offline, and a `destination: local` roadmap in any mode — for the same reason: there
// is nobody to record a claim with, so the board can never show one and this rule was refusing the
// worktree for a task the conductor HAD just claimed. Measured on 2026-09-07: `pr/PR91` blocked one
// second after `orchestra roadmap claim pr/PR91` printed `claimed pr/PR91`, and the wording told the
// conductor to re-run the command it had just run. Silently, unlike the unreachable board above:
// offline EVERY row is such a row, and a warning on every worktree add is noise on the ordinary
// path, not news. What stops a second start there is git refusing a branch name it already has.
//
// It FAILS CLOSED on a board served from cache (`board.stale`): a cached board is telling you, in
// as many words, that what it knows is out of date, and `startVerdict`'s own `stale` branch already
// refuses on that. No store in THIS plugin caches a board today — `orchestra roadmap board --json`
// either reaches its backend (git, and GitHub in online mode) or the command fails outright, which
// is the FAILS OPEN case above, not this one — so `board.stale` is always absent here and this
// branch is wired but unreached. It stays rather than being dropped: `startVerdict`'s `stale`
// reason is already written and tested, and a rule that dropped the field would have to be edited
// again the day a cache lands. One expression is not just-in-case code; an unwritten path is.
//
// LAST, because it is the only rule that can cost a whole subprocess of this plugin's own CLI —
// and a `board --json` in online mode reaches the network. Do no string work past finding no
// branch: a command with no `worktree add -b` must never pay for it.
function claim() {
  const branches = claimedBranches(command);
  if (!branches.length) return null;

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
    return null;
  }
  // The parse can succeed on a shape that is not a board (`null`, `{}`, a bare number...). Reading
  // `.rows` off that without this check is the same unchecked-network-output mistake the try above
  // exists to prevent, just one property access later — so it fails open the same way, in one check.
  if (!Array.isArray(board?.rows)) {
    process.stderr.write(
      `warning: could not read the roadmap board (its JSON has no \`rows\` array), so the claim on \`${branches.join(', ')}\` was not checked.\n`,
    );
    return null;
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
    // A branch matching no row is an ordinary fix or study and is none of this rule's business.
    const row = board.rows.find((r) => r.branch === branch);
    if (!row) continue;
    const verdict = startVerdict(row, { stale: board.stale ?? null });
    if (verdict.ok) continue;
    return say[verdict.reason](branch, row);
  }
  return null;
}

for (const rule of [draft, fullSuite, mainCommit, claim]) {
  const refusal = rule();
  if (refusal) { process.stderr.write(refusal); process.exit(2); }
}
process.exit(0);
