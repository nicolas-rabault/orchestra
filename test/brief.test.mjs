// `orchestra brief` — the worker's brief, rendered by code.
//
// The thing under test is not the prose: it is that every fact the brief carries comes from the
// project rather than from whoever typed the launch, because the hand-filled form is what this
// replaces (`lib/register/brief.mjs`'s header has the measurement). So each test asserts a FACT
// reaching the brief, or a fact that must not.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo, ROADMAP, PR_ROADMAP } from './helpers/fixture.mjs';
import { hookEnv } from './helpers/hookEnv.mjs';
import { loadConfig } from '../lib/config.mjs';
import { renderBrief, modelFor, excerptOf } from '../lib/register/brief.mjs';
import { makeStore } from '../lib/store/index.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orchestra');

const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

// A project with `demo/D1` published, plus whatever else the caller wants on disk.
function published(opts = {}, roadmap = ROADMAP) {
  const r = repo(opts);
  mkdirSync(join(r.root, '.orchestra', 'roadmaps'), { recursive: true });
  writeFileSync(join(r.root, '.orchestra', 'roadmaps', 'demo.md'), roadmap);
  return r;
}

const run = (root, args) => spawnSync(process.execPath, [BIN, 'brief', ...args],
  { cwd: root, encoding: 'utf8', env: hookEnv() });

test('the brief names the branch, the task and its excerpt verbatim', () => {
  const r = published();
  const res = run(r.root, ['demo/D1']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /ONLY in this worktree, on branch demo\/d1-first-thing/);
  assert.match(res.stdout, /Task demo\/D1 — First thing/);
  // The excerpt is the canonical task block both stores agree on, so every declared field is in it.
  for (const field of ['Roadmap', 'Order', 'Deps', 'Touches', 'Branch', 'Design', 'Lane'])
    assert.match(res.stdout, new RegExp(`\\*\\*${field}\\*\\*`));
  assert.match(res.stdout, /\*\*Why\.\*\* The player sees the first thing\./);
});

test("the orientation block locates and sizes the row's own Touches files", () => {
  const r = published();
  const res = run(r.root, ['demo/D1']);
  // README.md exists in the fixture and is one line plus its trailing newline.
  assert.match(res.stdout, /README\.md — 2 lines/);
  assert.match(res.stdout, /Your worktree is cut from main at [0-9a-f]{7,} initial/);
});

test('a Touches path that does not exist yet says so, rather than being omitted', () => {
  const r = published({}, ROADMAP.replace('`README.md`', '`src/thing.js`'));
  assert.match(run(r.root, ['demo/D1']).stdout, /src\/thing\.js — does not exist yet/);
});

// `new <path>` is the Touches grammar (docs/roadmap-format.md), not part of the filename. Reading
// it as one is how a real duckJam row came out as `new arena/clocks.py — does not exist yet`.
test('`new <path>` is read as the grammar it is, and names the real path', () => {
  const r = published({}, ROADMAP.replace('`README.md`', '`new src/thing.js`'));
  const out = run(r.root, ['demo/D1']).stdout;
  assert.match(out, /  src\/thing\.js — to create — not there yet, as the row says/);
  assert.doesNotMatch(out, /  new src\/thing\.js/);
});

// The row's assumption being already false is the one thing here worth shouting about: a worker
// that overwrites a file somebody else created has destroyed work nobody asked it to touch.
test('a path declared new that ALREADY exists says so loudly', () => {
  const r = published({}, ROADMAP.replace('`README.md`', '`new README.md`'));
  assert.match(run(r.root, ['demo/D1']).stdout, /README\.md — 2 lines — ALREADY EXISTS, though the row declares it new/);
});

test("the task's own spec and plan on disk are named, found by its id", () => {
  const r = published();
  mkdirSync(join(r.root, 'docs', 'specs'), { recursive: true });
  mkdirSync(join(r.root, 'docs', 'plans'), { recursive: true });
  writeFileSync(join(r.root, 'docs', 'specs', 'd1-first-thing.md'), 'spec\n');
  writeFileSync(join(r.root, 'docs', 'plans', '2026-09-09-d1.md'), 'plan\n');
  // A sibling task's file must NOT be swept in.
  writeFileSync(join(r.root, 'docs', 'specs', 'd2-other.md'), 'other\n');
  const res = run(r.root, ['demo/D1']);
  assert.match(res.stdout, /docs\/specs\/d1-first-thing\.md/);
  assert.match(res.stdout, /docs\/plans\/2026-09-09-d1\.md/);
  assert.doesNotMatch(res.stdout, /d2-other/);
});

test('the orientation block precedes the rule that tells the worker to start from it', () => {
  const r = published();
  const res = run(r.root, ['demo/D1']);
  assert.ok(res.stdout.indexOf('already located and sized') < res.stdout.indexOf('Start from the files named above'),
    'the files must be named before the sentence that points at them');
});

test('branchTests reaches the brief; a project with none is told not to run the full suite', () => {
  const withTests = published({ config: { branchTests: 'uv run pytest -q' } });
  assert.match(run(withTests.root, ['demo/D1']).stdout, /run uv run pytest -q on every iteration/);

  const without = published();
  const res = run(without.root, ['demo/D1']).stdout;
  assert.match(res, /configured no narrower command/);
  assert.doesNotMatch(res, /run  on every iteration/);
});

test('briefExtra is pasted verbatim, and an empty one adds no paragraph', () => {
  const r = published({ config: { briefExtra: 'Docker runs through colima here.' } });
  assert.match(run(r.root, ['demo/D1']).stdout, /Docker runs through colima here\./);
  const plain = run(published().root, ['demo/D1']).stdout;
  assert.doesNotMatch(plain, /\n\n\n/, 'an absent briefExtra must not leave a blank paragraph');
});

test("offline mode's CLAUDE-rules.md is carried; its absence omits the paragraph", () => {
  const r = published();
  writeFileSync(join(r.root, '.orchestra', 'CLAUDE-rules.md'), '## Working with this project\n\n- One rule.\n');
  assert.match(run(r.root, ['demo/D1']).stdout, /- One rule\./);
  assert.doesNotMatch(run(published().root, ['demo/D1']).stdout, /Working with this project/);
});

test('a design row gets the design deliverable, and is told not to write implementation code', () => {
  const r = published({}, ROADMAP.replace('- **Design** no', '- **Design** yes'));
  const res = run(r.root, ['demo/D1']).stdout;
  assert.match(res, /superpowers:brainstorming/);
  assert.match(res, /Do not write implementation code/);
  assert.match(res, /docs\/specs/);
});

test('--relaunch and --handover prefix the brief instead of replacing it', () => {
  const r = published();
  const relaunch = run(r.root, ['demo/D1', '--relaunch']).stdout;
  assert.match(relaunch, /^A previous session worked this task and died/);
  assert.match(relaunch, /Task demo\/D1/, 'the original brief still follows the prefix');

  const handover = run(r.root, ['demo/D1', '--handover', '137']).stdout;
  assert.match(handover, /took this task to 137 turns/);
  assert.match(handover, /Task demo\/D1/);
});

test('the context rule is in every brief, because it is the whole cost of a session', () => {
  const res = run(published().root, ['demo/D1']).stdout;
  assert.match(res, /Keep your own context small/);
  assert.match(res, /Explore subagent/);
});

test('an unknown key is an error naming it, not an empty brief', () => {
  const r = published();
  const res = run(r.root, ['demo/NOPE']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /no published task demo\/NOPE/);
});

test('no key at all is a usage error', () => {
  const res = run(published().root, []);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /needs a task key/);
});

// `modelFor` decides which of the three briefs a row gets, and both halves of the review shape are
// load-bearing: a project may open a roadmap it calls `pr`, and a `PR2` on any other roadmap is an
// ordinary task.
test('modelFor needs BOTH the pr slug and a PR<number> id to call a row a review', () => {
  assert.equal(modelFor({ roadmap: 'pr', id: 'PR91', design: false }), 'review');
  assert.equal(modelFor({ roadmap: 'pr', id: 'A1', design: false }), 'execution');
  assert.equal(modelFor({ roadmap: 'prototypes', id: 'PR2', design: false }), 'execution');
  assert.equal(modelFor({ roadmap: 'demo', id: 'D1', design: true }), 'design');
});

test('a review row is briefed to fetch the PR head and to publish nothing but a pending review', () => {
  const r = published({ config: { pr: { ledger: '.orchestra/pr-log.jsonl', direction: '.orchestra/direction' } } }, PR_ROADMAP);
  const cfg = loadConfig(r.root);
  const store = makeStore(cfg, {}, { destination: 'local' });
  const row = store.list()[0];
  const res = renderBrief(cfg, row, { git: () => '', base: 'abc1234', repo: 'owner/repo' });
  assert.match(res, /reviewing pull request #\d+ on owner\/repo/);
  assert.match(res, /git fetch origin pull\/\d+\/head/);
  assert.match(res, /has moved since abc1234/);
  assert.match(res, /except a PENDING review/);
  // A review row is checked out at the PR's head and never runs the project's dev loop, so it is
  // not handed the orientation block's branch point.
  assert.doesNotMatch(res, /Your worktree is cut from/);
});

test('excerptOf is the same text both stores publish, so the two modes cannot drift', () => {
  const row = { id: 'D1', title: 'First thing', roadmap: 'demo', order: 1, deps: [], touches: ['README.md'], branch: 'demo/d1-first-thing', design: false, lane: null, why: 'W.', acceptance: 'A.' };
  assert.equal(excerptOf(row).split('\n')[0], '### D1 — First thing');
  assert.match(excerptOf(row), /\*\*Acceptance\.\*\* A\./);
});

// The design->execution handoff: the row's `Design` stays `yes` — it is a fact about how the task
// was written — so without this the second session on that worktree is told once more not to write
// implementation code.
test('--model overrides what the row implies, for the design→execution handoff', () => {
  const r = published({}, ROADMAP.replace('- **Design** no', '- **Design** yes'));
  assert.match(run(r.root, ['demo/D1']).stdout, /Do not write implementation code/);
  const handed = run(r.root, ['demo/D1', '--model', 'execution']).stdout;
  assert.doesNotMatch(handed, /Do not write implementation code/);
  assert.match(handed, /You never merge/);
});

test('an unknown --model is refused, not silently ignored', () => {
  const res = run(published().root, ['demo/D1', '--model', 'excution']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /unknown --model "excution"/);
});
