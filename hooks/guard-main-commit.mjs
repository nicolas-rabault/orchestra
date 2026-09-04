#!/usr/bin/env node
// PreToolUse(Bash) guard: main is integrate-only, for COMMITS too.
//
// guard-main-edit.mjs already blocks a write landing in the main checkout, but it dispatches on
// `tool_input.file_path`, and a `git commit` goes through Bash carrying no file path at all — so
// that guard never evaluates it. That gap is not theoretical: on 2026-07-28 in planetCraft, a
// `git commit --amend` meant for a worktree ran in the main checkout because the shell cwd had
// drifted between two calls. It replaced main's tip and swept 34 untracked files into version
// control; nothing but that project's merge gate caught it.
//
// So: block a `git commit` whose effective repository is THIS project's main checkout, on
// `cfg.mainBranch`. `git merge` is deliberately NOT blocked — that is how a landing itself
// reaches main, and blocking it would break every one.
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
// commit to main with `execFileSync('git', …)` directly, never through the Bash tool, so no hook
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
  if (tokens[i] !== 'commit') continue;

  const checkout = isMainCheckout(dir, { root: cfg.root });
  if (!checkout || checkout.branch !== cfg.mainBranch) continue;

  process.stderr.write(
    `Blocked: \`${segment}\` commits to the MAIN checkout on branch ${cfg.mainBranch}, and main is integrate-only.\n`
    + '\n'
    + "This is nearly always cwd drift, not intent — the shell left the worktree between two calls.\n"
    + "Anchor git to the worktree explicitly instead of relying on the shell's cwd:\n"
    + `  git -C ${checkout.root}/${cfg.worktrees}/<name> commit ...\n`
    + '\n'
    + 'No worktree yet:\n'
    + `  git -C ${checkout.root} worktree add ${cfg.worktrees}/<name> -b <name> ${cfg.mainBranch}\n`
    + '\n'
    + `An integration commit that genuinely belongs on ${cfg.mainBranch} overrides with: ORCHESTRA_GATE=1 git commit ...\n`,
  );
  process.exit(2);
}
process.exit(0);
