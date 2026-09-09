// Review round 1, finding 2: "a refusal nobody exercises is a refusal nobody can trust." The two
// committed unit suites (guards-segments, guards-main) test the PURE decisions; neither one ever
// runs `hooks/guard-main-edit.mjs` or `hooks/guard-main-commit.mjs` as the process Claude Code
// actually spawns. That gap is not theoretical: the `existsSync`-versus-`isDirectory` bug in
// guard-main-edit's ancestor walk hit the single most ordinary case (editing an EXISTING tracked
// file in the main checkout) and was found only by running the hook by hand — nothing in the
// repository would have caught it coming back. This file spawns each hook exactly as the harness
// does: a JSON payload on stdin, nothing on argv, judged on exit code and stderr.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers/fixture.mjs';
import { hookEnv } from './helpers/hookEnv.mjs';

const HOOKS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks');
const EDIT_HOOK = join(HOOKS_DIR, 'guard-main-edit.mjs');
const COMMIT_HOOK = join(HOOKS_DIR, 'guard-bash.mjs');

const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

// The exact invocation shape a PreToolUse hook receives: the payload as JSON on stdin, an
// environment it may or may not carry ORCHESTRA_GATE in, nothing on argv. `hookEnv` and not a bare
// `process.env`: the ambient one carries the gate's own off switches when the suite runs inside a
// landing, which would disarm the very guard these rows assert refuses.
function runHook(hookPath, payload, env = {}) {
  return spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: hookEnv(env),
  });
}

const editPayload = (cwd, filePath) => ({ cwd, tool_input: { file_path: filePath } });
const commitPayload = (cwd, command) => ({ cwd, tool_input: { command } });

// ---------------------------------------------------------------------------------------------
// guard-main-edit
// ---------------------------------------------------------------------------------------------

// The regression test for the bug this review round found: `target` itself EXISTS here (the
// ordinary case — an Edit on a file already in the tree), which is exactly what defeated the
// first `existsSync`-based ancestor walk.
test('guard-main-edit: an existing tracked file in the main checkout on main is REFUSED', () => {
  const r = repo();
  const res = runHook(EDIT_HOOK, editPayload(r.root, join(r.root, 'README.md')));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /MAIN checkout/);
  assert.match(res.stderr, /integrate-only/);
});

test('guard-main-edit: a new file whose parent directories do not exist yet is REFUSED, not misread as "not a repository"', () => {
  const r = repo();
  const target = join(r.root, 'brand', 'new', 'file.js');
  const res = runHook(EDIT_HOOK, editPayload(r.root, target));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /MAIN checkout/);
});

test('guard-main-edit: a file in a linked worktree is ALLOWED', () => {
  const r = repo();
  const wt = join(r.root, 'wt');
  r.git('worktree', 'add', '-q', wt, '-b', 'side');
  const res = runHook(EDIT_HOOK, editPayload(wt, join(wt, 'README.md')));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

test('guard-main-edit: a path under .orchestra/ is ALLOWED', () => {
  const r = repo();
  const res = runHook(EDIT_HOOK, editPayload(r.root, join(r.root, '.orchestra', 'config.json')));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

// Branch review, finding 2: `test/helpers/fixture.mjs`'s `makeRepo` realpaths its root, so every
// other test in this file hands the hook an already-canonical path — structurally blind to the one
// input shape that defeats the raw string compare at guard-main-edit.mjs's `.orchestra/` exemption.
// This test builds an UNRESOLVED symlinked ancestor on purpose: `linkDir` is a symlink to the real
// repo, so `git -C linkDir rev-parse --git-common-dir` (what `root` is built from) returns the
// REAL, canonical path, while a payload built from `linkDir` itself — exactly what a project living
// under a symlinked directory (an aliased volume, a symlinked ~/Projects, or macOS's own
// /tmp -> /private/tmp) hands this hook in the ordinary case — does not.
test('guard-main-edit: a path under .orchestra/ reached through a symlinked ancestor is still ALLOWED', () => {
  const r = repo();
  const linkDir = mkdtempSync(join(tmpdir(), 'orchestra-link-'));
  rmSync(linkDir, { recursive: true, force: true }); // clear the placeholder — symlinkSync needs the name free
  symlinkSync(r.root, linkDir);
  try {
    const target = join(linkDir, '.orchestra', 'config.json');
    const res = runHook(EDIT_HOOK, editPayload(linkDir, target));
    assert.equal(res.status, 0);
    assert.equal(res.stderr, '');
  } finally {
    unlinkSync(linkDir); // removes the symlink itself — rmSync's EISDIR check follows it into r.root
  }
});

test('guard-main-edit: a gitignored path is ALLOWED', () => {
  const r = repo();
  writeFileSync(join(r.root, '.gitignore'), 'scratch/\n');
  mkdirSync(join(r.root, 'scratch'));
  const res = runHook(EDIT_HOOK, editPayload(r.root, join(r.root, 'scratch', 'notes.txt')));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

test('guard-main-edit: a main checkout whose HEAD is not cfg.mainBranch is ALLOWED', () => {
  const r = repo();
  r.git('checkout', '-q', '-b', 'feature');
  const res = runHook(EDIT_HOOK, editPayload(r.root, join(r.root, 'README.md')));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

// ---------------------------------------------------------------------------------------------
// guard-main-commit
// ---------------------------------------------------------------------------------------------

test('guard-main-commit: a git commit in the main checkout on main is REFUSED', () => {
  const r = repo();
  const res = runHook(COMMIT_HOOK, commitPayload(r.root, 'git commit -m x'));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /MAIN checkout/);
  assert.match(res.stderr, /integrate-only/);
});

test('guard-main-commit: an ORCHESTRA_GATE=1 prefix on the segment is ALLOWED', () => {
  const r = repo();
  const res = runHook(COMMIT_HOOK, commitPayload(r.root, 'ORCHESTRA_GATE=1 git commit -m x'));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

test("guard-main-commit: ORCHESTRA_GATE=1 in the hook's own environment is ALLOWED", () => {
  const r = repo();
  const res = runHook(COMMIT_HOOK, commitPayload(r.root, 'git commit -m x'), { ORCHESTRA_GATE: '1' });
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

test('guard-main-commit: a commit anchored by -C to a linked worktree is ALLOWED', () => {
  const r = repo();
  const wt = join(r.root, 'wt');
  r.git('worktree', 'add', '-q', wt, '-b', 'side');
  const res = runHook(COMMIT_HOOK, commitPayload(r.root, `git -C ${wt} commit -m x`));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

// Review round 1, finding 1: `git merge` on main must be refused too — a landing's own merge
// never goes through this hook (it runs via `execFileSync`, never the Bash tool), so what this
// guard actually sees is an agent merging into main by hand, which is exactly what "main is
// integrate-only" forbids.
test('guard-main-commit: a git merge on main is REFUSED', () => {
  const r = repo();
  r.git('branch', 'side');
  const res = runHook(COMMIT_HOOK, commitPayload(r.root, 'git merge side'));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /MAIN checkout/);
  assert.match(res.stderr, /orchestra land/);
});

test('guard-main-commit: git merge --abort is a recovery action, not a merge, and is ALLOWED', () => {
  const r = repo();
  const res = runHook(COMMIT_HOOK, commitPayload(r.root, 'git merge --abort'));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});
