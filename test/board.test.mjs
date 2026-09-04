import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRoadmap } from '../lib/roadmap/parse.mjs';
import { reconcile, gatherGit, UNVERIFIED, isLanded } from '../lib/roadmap/board.mjs';
import { makeRepo, ROADMAP } from './helpers/fixture.mjs';

const tasks = parseRoadmap(ROADMAP).tasks;
const noGit = { refs: new Set(), mainSubjects: new Set() };
const row = (over = {}) => ({
  id: 'demo/D1', status: 'todo', subjects: [], deps: [], branch: 'demo/d1-first-thing', ...over,
});

test('with no overlay and no branch, a task is todo and schedulable', () => {
  const b = reconcile({ tasks, git: noGit, register: [], overlay: new Map() });
  assert.equal(b.rows[0].status, 'todo');
  assert.equal(b.rows[0].mine, true);
  assert.equal(b.rows[0].schedulable, true);
  assert.deepEqual(b.corrections, []);
});

test('an existing branch ref makes it claimed', () => {
  const git = { refs: new Set(['demo/d1-first-thing']), mainSubjects: new Set() };
  assert.equal(reconcile({ tasks, git, register: [], overlay: new Map() }).rows[0].status, 'claimed');
});

test('a recorded subject on main makes it landed', () => {
  const git = { refs: new Set(), mainSubjects: new Set(['feat: the first thing']) };
  const register = [row({ status: 'landed', subjects: ['feat: the first thing'] })];
  assert.equal(reconcile({ tasks, git, register, overlay: new Map() }).rows[0].status, 'landed');
});

// `landedHere` is the one fact that authorises `sync` to close another party's issue, so it is
// pinned directly here — not only through a consumer's test — or a later edit to
// `deriveLocalStatus` (subject trimming, a log window, a normalisation) could silently start
// closing issues that never landed with every other test still green.
test('landedHere is true only when the SAME derivation that decides status also says landed', () => {
  const git = { refs: new Set(), mainSubjects: new Set(['feat: the first thing']) };
  const register = [row({ status: 'landed', subjects: ['feat: the first thing'] })];
  assert.equal(reconcile({ tasks, git, register, overlay: new Map() }).rows[0].landedHere, true);
  assert.equal(reconcile({ tasks, git: noGit, register: [], overlay: new Map() }).rows[0].landedHere, false);
});

test('landed with NO recorded subject is "landed?", listed separately, never todo', () => {
  const register = [row({ status: 'landed', subjects: [] })];
  const b = reconcile({ tasks, git: noGit, register, overlay: new Map() });
  assert.equal(b.rows[0].status, UNVERIFIED);
  assert.equal(b.unverified.length, 1);
  assert.deepEqual(b.corrections, []);
  assert.equal(isLanded(UNVERIFIED), true);
});

test('a real disagreement between register and derivation is a correction', () => {
  const register = [row({ status: 'claimed', subjects: [] })];
  const b = reconcile({ tasks, git: noGit, register, overlay: new Map() });
  assert.equal(b.corrections.length, 1);
  assert.match(b.corrections[0], /register says claimed, derived todo/);
});

test('an overlay entry that is not mine derives from the overlay, not from git', () => {
  const overlay = new Map([['demo/D1', {
    status: 'claimed', ref: 5, owner: 'someone', open: false, mine: false,
    programme: 1, programmeState: 'open',
  }]]);
  const b = reconcile({ tasks, git: noGit, register: [], overlay });
  assert.equal(b.rows[0].status, 'claimed');
  assert.equal(b.rows[0].mine, false);
  assert.equal(b.rows[0].schedulable, false);
  assert.equal(b.rows[0].issue, 5);
});

test('a roadmap someone opened is schedulable although it is not mine', () => {
  const overlay = new Map([['demo/D1', { status: 'todo', ref: 5, owner: 'someone', open: true, mine: false }]]);
  assert.equal(reconcile({ tasks, git: noGit, register: [], overlay }).rows[0].schedulable, true);
});

test('a shared task the register dropped is "not ours", never a correction', () => {
  const overlay = new Map([['demo/D1', { status: 'claimed', ref: 5, owner: 'someone', open: false, mine: false }]]);
  const register = [row({ status: 'dropped' })];
  const b = reconcile({ tasks, git: noGit, register, overlay });
  assert.equal(b.notMine.length, 1);
  assert.deepEqual(b.corrections, []);
});

// staleIssue's own branch: work landed here (register says landed, with a recorded subject) while
// the shared overlay entry says the task is still open elsewhere (`claimed`, not `landed`). This is
// a correction, and specifically a "closing it is a shared-channel action" one — not a generic
// register-vs-derivation disagreement, not "not ours" (the register never said `dropped`), and not
// "unverified" (the subject WAS recorded).
test('work landed here while its shared overlay entry stayed open is a stale-issue correction', () => {
  const overlay = new Map([['demo/D1', { status: 'claimed', ref: 5, owner: 'someone', open: false, mine: false }]]);
  const register = [row({ status: 'landed', subjects: ['feat: the first thing'] })];
  const b = reconcile({ tasks, git: noGit, register, overlay });
  assert.equal(b.corrections.length, 1);
  assert.match(b.corrections[0], /landed here but issue #5 is still claimed — closing it is a shared-channel action/);
  assert.deepEqual(b.notMine, []);
  assert.deepEqual(b.unverified, []);
});

test('an overlay claim does not mask an unrecorded landing', () => {
  // The register says landed and recorded no subject. Git sees no branch and no subject, so the
  // LOCAL derivation is `todo` — the recording gap. The shared entry, still open and mine, says
  // `claimed`. Reading the gap off the overlay-aware status hides it: the row prints `claimed`,
  // `isLanded` is false, and every task depending on it is blocked by a landing that happened.
  const tasks = [{ key: 'demo/D1', branch: 'demo/d1', deps: [] },
                 { key: 'demo/D2', branch: 'demo/d2', deps: ['demo/D1'] }];
  const git = { refs: new Set(), mainSubjects: new Set() };
  const register = [{ id: 'demo/D1', status: 'landed', subjects: [] }];
  const overlay = new Map([['demo/D1', { status: 'claimed', mine: true, open: true, ref: 7 }]]);
  const b = reconcile({ tasks, git, register, overlay });
  assert.equal(b.rows[0].status, UNVERIFIED);
  assert.equal(b.unverified.length, 1);
  assert.deepEqual(b.rows[1].blockedBy, []);
});

test('offline can never produce a "not ours" line, because the overlay is empty', () => {
  const register = [row({ status: 'dropped' })];
  const b = reconcile({ tasks, git: noGit, register, overlay: new Map() });
  assert.deepEqual(b.notMine, []);
});

// `claimedByMe` has two producers, one per mode, and `startVerdict` refuses the worktree without
// it. Offline there is no overlay entry at all, so the local derivation answers: one machine and one
// register mean a branch ref here is MY claim. Online the store computed it from `gh.me()` and the
// assignees, and its word is the one that counts — a claim held by a colleague on my own roadmap is
// `claimed` and not mine.
test('claimedByMe comes from the overlay entry when there is one, and from the local claim when there is not', () => {
  const git = { refs: new Set(['demo/d1-first-thing']), mainSubjects: new Set() };
  assert.equal(reconcile({ tasks, git, register: [], overlay: new Map() }).rows[0].claimedByMe, true);
  assert.equal(reconcile({ tasks, git: noGit, register: [], overlay: new Map() }).rows[0].claimedByMe, false);

  const held = new Map([['demo/D1', {
    status: 'claimed', ref: 5, owner: 'me', open: false, mine: true, claimedByMe: false,
  }]]);
  const b = reconcile({ tasks, git: noGit, register: [], overlay: held });
  assert.equal(b.rows[0].status, 'claimed');
  assert.equal(b.rows[0].claimedByMe, false);
});

test('deps are OVERWRITTEN with the qualified form and drive depsMet', () => {
  const two = parseRoadmap(ROADMAP.replace('- **Deps** —', '- **Deps** D0')).tasks;
  const b = reconcile({ tasks: two, git: noGit, register: [], overlay: new Map() });
  assert.deepEqual(b.rows[0].deps, ['demo/D0']);
  assert.equal(b.rows[0].depsMet, false);
  assert.deepEqual(b.rows[0].blockedBy, ['demo/D0']);
});

test('orphans are reported in both directions', () => {
  const register = [row({ id: 'demo/ZZ', status: 'todo' })];
  const b = reconcile({ tasks, git: noGit, register, overlay: new Map() });
  assert.deepEqual(b.orphans.inRegisterOnly, ['demo/ZZ']);
  assert.deepEqual(b.orphans.inRoadmapOnly, ['demo/D1']);
});

// gatherGit — exercised against real temporary git repositories. The reconcile tests above hand it
// a synthetic `{ refs, mainSubjects }` object; these prove the function that actually builds one.
const repos = [];
after(() => repos.forEach((r) => r.cleanup()));

test('gatherGit reads the one commit on a fresh repo into mainSubjects, and its branch into refs', () => {
  const r = makeRepo();
  repos.push(r);
  const g = gatherGit(r.root);
  assert.ok(g.refs.has('main'));
  assert.ok(g.mainSubjects.has('initial'));
});

test('gatherGit on a repository with NO commits returns empty sets and does not throw', () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestra-nocommit-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root, stdio: 'ignore' });
    const g = gatherGit(root);
    assert.deepEqual(g.refs, new Set());
    assert.deepEqual(g.mainSubjects, new Set());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('gatherGit finds a subject with no window: the FIRST of 12 commits is still in mainSubjects', () => {
  const r = makeRepo();
  repos.push(r);
  for (let i = 2; i <= 12; i += 1) r.git('commit', '--allow-empty', '-q', '-m', `commit-${i}`);
  const g = gatherGit(r.root);
  assert.ok(g.mainSubjects.has('initial'), 'the first commit must not fall outside any window');
});

test('gatherGit is pinned to mainBranch, not to whatever HEAD happens to be checked out', () => {
  const r = makeRepo();
  repos.push(r);
  r.git('checkout', '-q', '-b', 'other');
  r.git('commit', '--allow-empty', '-q', '-m', 'only-on-other');
  const g = gatherGit(r.root, { mainBranch: 'main' });
  assert.ok(g.mainSubjects.has('initial'));
  assert.ok(!g.mainSubjects.has('only-on-other'));
});
