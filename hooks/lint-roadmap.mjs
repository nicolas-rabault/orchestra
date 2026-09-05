#!/usr/bin/env node
// PostToolUse(Edit|Write) hook: lint a roadmap the moment it is written, and report.
//
// Refuses nothing — Claude Code has already applied the edit by the time a PostToolUse hook runs —
// but a non-zero exit here feeds its stderr back to the model as a correction, which is the
// mechanism the source project (planetCraft) uses to get a malformed roadmap fixed without a human
// reading the lint output first; that behaviour is kept as-is.
//
// It matches on the roadmap's FORMAT, not on a directory: a `.md` file under `cfg.roadmaps.drafts`
// or `cfg.roadmaps.published`, or any `.md` whose frontmatter declares a `roadmap:` key — so a
// roadmap written somewhere unexpected is still checked. The frontmatter test is bounded by the
// closing `---`: an unbounded search would scan the whole file, and a body line beginning
// "roadmap:" — which any document discussing this system has, this file's own header included —
// would classify that document as a roadmap and block an edit to it.
//
// The drift this stops is measured: on 2026-08-11, in planetCraft, the same three fields (order,
// dependencies, touched files) were written four different ways across five roadmaps, all by one
// skill, because nothing looked.
//
// Silent and exit 0 whenever `.orchestra/config.json` is absent (spec §3.1).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readPayload, projectFor } from '../lib/guards/payload.mjs';

const ORCHESTRA_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orchestra');

const payload = readPayload();
if (!payload) process.exit(0);

const cfg = projectFor(payload.cwd ?? process.cwd());
if (!cfg) process.exit(0);

const path = payload.tool_input?.file_path ?? '';
if (!path.endsWith('.md')) process.exit(0);

let text = '';
try { text = readFileSync(path, 'utf8'); } catch { process.exit(0); }

// Bounded by the closing `---` — see the header above for what an unbounded search would break.
const frontmatter = /^\uFEFF?\s*---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
const declaresRoadmap = frontmatter ? /^roadmap:\s*\S/m.test(frontmatter[1]) : false;

const under = (dir) => {
  if (!dir) return false;
  const abs = resolve(cfg.root, dir);
  const target = resolve(path);
  return target === abs || target.startsWith(`${abs}/`);
};

const isRoadmap = under(cfg.roadmaps.drafts) || under(cfg.roadmaps.published) || declaresRoadmap;
if (!isRoadmap) process.exit(0);

let out = '';
let failed = false;
try {
  out = execFileSync(process.execPath, [ORCHESTRA_BIN, 'roadmap', 'lint', path], {
    cwd: payload.cwd ?? process.cwd(), encoding: 'utf8',
  });
} catch (e) {
  failed = true;
  out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
}
if (!failed) process.exit(0);

process.stderr.write(
  `The roadmap you just wrote does not match the format:\n\n${out}\n`
  + 'Fix the lines above. Every field is on its own line, and there is no status field — status is\n'
  + 'derived from git (and from the shared channel in online mode), never written by hand.\n',
);
process.exit(2);
