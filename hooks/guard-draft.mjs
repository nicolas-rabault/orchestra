#!/usr/bin/env node
// PreToolUse(Bash) guard: a draft roadmap is never staged.
//
// The drafts directory is hidden from git once `orchestra init` has run — online, by the
// `.orchestra/.gitignore` it writes; offline, by the line it appends to this clone's own
// `info/exclude`, never committed — so an ordinary `git add` of a draft is already refused by git
// itself, and the only way past that refusal is `-f`. But a project that has not run `init` yet,
// or has since edited its own exclusion, has no such floor. So, unlike the guard this is spun off
// from in the source project (planetCraft's `guard-local-roadmap.mjs`, which only had the
// gitignore-bypass case to cover and so only ever looked for `-f`), this hook does not require
// `-f` at all: it refuses NAMING a path under `cfg.roadmaps.drafts` on a `git add`, whether or not
// `-f` is present — see `lib/guards/draft.mjs`'s header for the decision itself.
//
// What this cannot catch: `git add -A` (or a bare `git add .`) sweeps a draft into the index
// without ever naming it, and only that exclusion stops that case.
//
// Silent and exit 0 whenever `.orchestra/config.json` is absent (spec §3.1).
import { readPayload, projectFor } from '../lib/guards/payload.mjs';
import { draftAdds } from '../lib/guards/draft.mjs';

const payload = readPayload();
if (!payload) process.exit(0);

const cfg = projectFor(payload.cwd ?? process.cwd());
if (!cfg) process.exit(0);

const command = payload.tool_input?.command ?? '';
if (!command) process.exit(0);

const blocked = draftAdds(command, cfg.roadmaps.drafts);
if (!blocked) process.exit(0);

process.stderr.write(
  `Blocked: \`${blocked}\` stages a draft roadmap, and ${cfg.roadmaps.drafts} is never committed.\n`
  + '\n'
  + "A draft holds one developer's own programme and stays on that machine until it is ready to\n"
  + 'share. If this work should be shared, publish it instead:\n'
  + `  orchestra roadmap publish <path under ${cfg.roadmaps.drafts}>\n`,
);
process.exit(2);
