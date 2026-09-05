#!/usr/bin/env node
// PreToolUse(Bash) guard: main is integrate-only, for COMMITS and MERGES.
//
// guard-main-edit.mjs already blocks a write landing in the main checkout, but it dispatches on
// `tool_input.file_path`, and neither a `git commit` nor a `git merge` carries a file path at all —
// so that guard never evaluates either. The commit half of the gap is not theoretical: on
// 2026-07-28 in planetCraft, a `git commit --amend` meant for a worktree ran in the main checkout
// because the shell cwd had drifted between two calls. It replaced main's tip and swept 34
// untracked files into version control; nothing but that project's merge gate caught it.
//
// So: block a `git commit` OR a `git merge` whose effective repository is THIS project's main
// checkout, on `cfg.mainBranch`. A landing's own fast-forward merge is never at risk from this
// guard: `lib/gate/land.mjs` runs it with `execFileSync('git', …)`, never through the Bash tool, so
// no PreToolUse hook has ever fired on it — not in this plugin, and not in the source project this
// was ported from, whose "`git merge` is deliberately not blocked" reasoning does not survive
// scrutiny here: nothing was ever relying on this hook to LET a landing's merge through, because
// this hook never saw it in the first place. What this hook actually sees is an AGENT typing `git
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
//   - the hook's own environment — `process.env.ORCHESTRA_GATE === '1'` disarms the guard for the
//     whole session. Not decoration: `lib/gate/land.mjs` runs every configured gate as a child
//     under this marker, so a project whose `gates` entry is itself an agent session gets a
//     session whose hooks inherit it — and refusing THAT agent's commits would refuse the
//     landing the gate exists to perform.
// Neither reader covers the gate's own writes: `lib/gate/land.mjs` and `lib/store/files.mjs`
// write to main with `execFileSync('git', …)` directly, never through the Bash tool, so no hook
// ever fires on those calls in the first place — the marker was never what let the gate write to
// main; nothing was ever going to stop it.
//
// Silent and exit 0 whenever `.orchestra/config.json` is absent (spec §3.1).
import { readPayload, projectFor } from '../lib/guards/payload.mjs';
import { segments, stripEnv, envAssigned } from '../lib/guards/segments.mjs';
import { isMainCheckout } from '../lib/guards/mainCheckout.mjs';

const payload = readPayload();
if (!payload) process.exit(0);

const cfg = projectFor(payload.cwd ?? process.cwd());
if (!cfg) process.exit(0);

if (process.env.ORCHESTRA_GATE === '1') process.exit(0);

const command = payload.tool_input?.command ?? '';
if (!command) process.exit(0);

// `cd` inside the command changes where a LATER segment's git runs, and cwd drift is the whole
// failure mode here — so follow it rather than trusting the session cwd alone.
let cwd = payload.cwd ?? process.cwd();

// A recovery action on a merge already in progress, never a merge INTO anything — see the header.
const MERGE_RECOVERY = new Set(['--abort', '--continue', '--quit']);

for (const segment of segments(command)) {
  if (envAssigned(segment, 'ORCHESTRA_GATE')) continue;

  const tokens = stripEnv(segment).split(/\s+/).filter(Boolean);
  if (!tokens.length) continue;

  if (tokens[0] === 'cd' && tokens[1]) {
    cwd = tokens[1].startsWith('/') ? tokens[1] : `${cwd}/${tokens[1]}`;
    continue;
  }
  if (tokens[0] !== 'git') continue;

  // Walk git's own options to find the subcommand, capturing -C's directory on the way.
  let dir = cwd;
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

  process.stderr.write(
    `Blocked: \`${segment}\` ${verb === 'merge' ? 'merges into' : 'commits to'} the MAIN checkout on branch ${cfg.mainBranch}, and main is integrate-only.\n`
    + '\n'
    + how
    + '\n'
    + `An integration ${verb} that genuinely belongs on ${cfg.mainBranch} overrides with: ORCHESTRA_GATE=1 git ${verb} ...\n`,
  );
  process.exit(2);
}
process.exit(0);
