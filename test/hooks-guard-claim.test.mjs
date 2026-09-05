// `hooks/guard-claim.mjs` run as a real process. `test/guards-claim.test.mjs` covers the pure
// extraction (`claimedBranches`); `test/policy.test.mjs` already covers `startVerdict`'s three
// refusals directly. This file covers the wiring between them: locating `bin/orchestra` from the
// hook's own file location, reading a real board, and failing open when that board is unreachable.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo, ROADMAP } from './helpers/fixture.mjs';
import { loadConfig } from '../lib/config.mjs';
import { roadmapCommand } from '../lib/cli/roadmap.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'guard-claim.mjs');

const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

function runHook(payload) {
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });
}

const bashPayload = (cwd, command) => ({ cwd, tool_input: { command } });

// Silences roadmapCommand's own stdout (`out()` writes straight to process.stdout) while it
// publishes the fixture roadmap for a test's setup.
function silently(fn) {
  const realWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try { fn(); } finally { process.stdout.write = realWrite; }
}

// One published task (`demo/D1`, branch `demo/d1-first-thing`), the ROADMAP fixture every other
// suite in this repository already shares.
function projectWithPublishedTask() {
  const r = repo();
  const cfg = loadConfig(r.root);
  const draftsDir = join(r.root, cfg.roadmaps.drafts);
  mkdirSync(draftsDir, { recursive: true });
  const draftPath = join(draftsDir, 'demo.md');
  writeFileSync(draftPath, ROADMAP);
  silently(() => roadmapCommand({ cfg, args: ['publish', draftPath] }));
  return r;
}

test('starting an unclaimed task\'s branch is REFUSED', () => {
  const r = projectWithPublishedTask();
  const res = runHook(bashPayload(r.root, 'git worktree add ../wt -b demo/d1-first-thing main'));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /demo\/D1/);
  assert.match(res.stderr, /orchestra roadmap claim/);
});

test('starting a task claimed here (a local branch ref already exists) is ALLOWED', () => {
  const r = projectWithPublishedTask();
  r.git('branch', 'demo/d1-first-thing');
  const res = runHook(bashPayload(r.root, 'git worktree add ../wt -b demo/d1-first-thing main'));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

test('a branch matching no roadmap row is none of this guard\'s business — ALLOWED', () => {
  const r = projectWithPublishedTask();
  const res = runHook(bashPayload(r.root, 'git worktree add ../wt -b totally-unrelated'));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

test('a command with no worktree add -b never touches the board at all — ALLOWED', () => {
  const r = projectWithPublishedTask();
  const res = runHook(bashPayload(r.root, 'git status'));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

// A config whose `mode` fails validation parses fine for the hook's own `projectFor` (which never
// validates), so the hook proceeds to spawn `bin/orchestra roadmap board --json` — which DOES
// validate, and fails. This is a hermetic way to exercise "the board is unreachable" without a
// network or a real GitHub token: the hook must fail OPEN, warn, and let the command through.
test('the board being unreachable FAILS OPEN, with a warning', () => {
  const r = repo({ config: { mode: 'not-a-real-mode' } });
  const res = runHook(bashPayload(r.root, 'git worktree add ../wt -b some-branch'));
  assert.equal(res.status, 0);
  assert.match(res.stderr, /warning/);
  assert.match(res.stderr, /some-branch/);
});

test('no config: silent and exit 0', () => {
  const res = runHook(bashPayload('/', 'git worktree add ../wt -b some-branch'));
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, '');
});
