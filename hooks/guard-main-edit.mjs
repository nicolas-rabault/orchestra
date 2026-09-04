#!/usr/bin/env node
// PreToolUse(Edit|Write|MultiEdit|NotebookEdit) guard: main is integrate-only.
//
// A project running this plugin does its work on a worktree under `cfg.worktrees`, branched from
// the main checkout, and lands it through the merge gate. This blocks a write whose target
// resolves into the MAIN checkout while HEAD is on `cfg.mainBranch` — the mistake is nearly
// always cwd drift mid-session, not intent.
//
// Silent and exit 0 whenever `.orchestra/config.json` is absent (spec §3.1): this plugin is
// installed globally, so a project that has not opted in must see no behaviour at all.
import { statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readPayload, projectFor } from '../lib/guards/payload.mjs';
import { isMainCheckout } from '../lib/guards/mainCheckout.mjs';
import { gitEnv } from '../lib/paths.mjs';

const payload = readPayload();
if (!payload) process.exit(0);

const cfg = projectFor(payload.cwd ?? process.cwd());
if (!cfg) process.exit(0);

const input = payload.tool_input ?? {};
const target = input.file_path || input.notebook_path || '';
if (!target) process.exit(0);

// `git -C` needs a DIRECTORY, and the ordinary case here is an EXISTING file (an Edit on a file
// that is already there) — `target` itself is never a directory then, so the walk must check
// "is this a directory", not merely "does this exist", or it stops on the file itself and `git
// -C <file>` fails, which `isMainCheckout` reads as "not a repository" and wrongly lets the write
// through. A Write can also create a file whose PARENT directories do not exist yet, which is the
// same walk for a different reason. Either way: walk up to the nearest existing ancestor
// DIRECTORY before asking git anything.
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
let dir = target;
while (!isDir(dir)) {
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

const checkout = isMainCheckout(dir, { root: cfg.root });
if (!checkout || checkout.branch !== cfg.mainBranch) process.exit(0);
const { root } = checkout;

// `.orchestra/` is exempt: the register, the journal and the drafts live in the main checkout by
// design (spec §3.2), and the conductor protocol has the conductor editing `state.json` there by
// hand. A guard that blocked that would break the thing it is installed to protect.
if (target === join(root, '.orchestra') || target.startsWith(`${join(root, '.orchestra')}/`)) process.exit(0);

// Untracked scratch in the main checkout is not an integration change. Nothing else is exempt —
// a project-specific carve-out (the source this hook is ported from exempted its own `docs/`) is
// a ruling for that project, and does not travel here.
try {
  execFileSync('git', ['-C', root, 'check-ignore', '-q', target], { stdio: 'ignore', env: gitEnv() });
  process.exit(0); // ignored: untracked scratch, not an integration change
} catch { /* not ignored — fall through to the refusal */ }

const rel = relative(root, target);
process.stderr.write(
  `Blocked: ${rel} is in the MAIN checkout, and main is integrate-only.\n`
  + '\n'
  + `Work on a worktree branched from latest local ${cfg.mainBranch}, and let it be landed through the merge gate:\n`
  + `  git -C ${root} worktree add ${cfg.worktrees}/<name> -b <name> ${cfg.mainBranch}\n`
  + `  # then edit ${cfg.worktrees}/<name>/${rel}\n`
  + '\n'
  + 'If a previous edit already landed here by mistake, revert it in the main checkout first:\n'
  + `  git -C ${root} checkout -- ${rel}\n`,
);
process.exit(2);
