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
import { fakeGhOnPath, foreignClaim } from './helpers/fakeGh.mjs';
import { hookEnv } from './helpers/hookEnv.mjs';
import { loadConfig } from '../lib/config.mjs';
import { roadmapCommand } from '../lib/cli/roadmap.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'guard-bash.mjs');

const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

function runHook(payload, env = {}) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8', env: hookEnv(env),
  });
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

// This project is OFFLINE, and offline `claim` writes nothing (lib/store/files.mjs) because there
// is nobody to tell — so no claim can ever reach the board. Until 2026-09-07 this case asserted
// exit 2, which is the defect written down as an expectation: the conductor claimed the task, the
// guard refused the worktree, and the refusal told it to re-run `orchestra roadmap claim`, the
// command it had just run. The refusal it was standing in for — a claim recorded and held by
// somebody else — is online's, and is asserted below against a board that can actually show one.
test('offline, where no claim can be recorded at all, a FIRST launch is ALLOWED', () => {
  const r = projectWithPublishedTask();
  const res = runHook(bashPayload(r.root, 'git worktree add ../wt -b demo/d1-first-thing main'));
  assert.equal(res.status, 0);
  // Silent: offline EVERY row is such a row, so a warning here would print on every worktree add.
  assert.equal(res.stderr, '');
});

test('starting a task claimed here (a local branch ref already exists) is ALLOWED', () => {
  const r = projectWithPublishedTask();
  r.git('branch', 'demo/d1-first-thing');
  const res = runHook(bashPayload(r.root, 'git worktree add ../wt -b demo/d1-first-thing main'));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

// The one case the guard exists for, and the one this file could not reach until now: ONLINE, where
// an issue's assignee genuinely records a claim, so the board CAN show a task held by somebody else.
// `foreignClaim` (./helpers/fakeGh.mjs) is that board, served by a `gh` on PATH because the hook
// reads its board through a subprocess no injected recorder can reach.
test('online, a task another developer holds is still REFUSED', () => {
  const r = repo({ mode: 'online' });
  const env = fakeGhOnPath(r.root, foreignClaim());
  const res = runHook(bashPayload(r.root, 'git worktree add ../wt -b demo/d1-first-thing main'), env);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /demo\/D1/);
  assert.match(res.stderr, /claimed by someone else/);
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
