// P3's acceptance (spec §15): "a branch lands in the fixture with two fake gates; the red one
// returns 11 naming itself." Driven through `bin/orchestra`, so what is asserted is what a person
// can type.
//
// WHAT IT CANNOT PROVE, said here rather than discovered later: it never observes two processes
// racing for a turn, so it does not test the lock under contention. That is `mayTake`'s own unit
// test (test/gate-state.test.mjs), where a process can be killed on paper.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers/fixture.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orchestra');
const repos = [];
after(() => repos.forEach((r) => r.cleanup()));

// `spawnSync`, not `execFileSync`: every assertion below is about an EXIT CODE, and execFileSync
// throws on a non-zero one, which would turn "the gate refused with 11" into a test error.
const run = (cwd, ...args) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

function project(gates, extra = {}) {
  const r = makeRepo({ name: 'gatefix', config: { gates, ...extra } });
  repos.push(r);
  return r;
}

// A branch with a worktree and one commit — the shape a worker leaves behind.
function branchWith(r, { branch = 'demo/d1', file = 'src/a.js', body = 'one\n' } = {}) {
  const wt = join(r.root, '.orchestra', 'worktrees', 'd1');
  r.git('worktree', 'add', '-q', '-b', branch, wt, 'main');
  mkdirSync(dirname(join(wt, file)), { recursive: true });
  writeFileSync(join(wt, file), body);
  execFileSync('git', ['-C', wt, 'add', '-A'], { encoding: 'utf8' });
  execFileSync('git', ['-C', wt, 'commit', '-q', '-m', 'feat: the branch does a thing'],
    { encoding: 'utf8' });
  return { wt, branch };
}

const log = (r, n = 5) => r.git('log', '--format=%s', `-${n}`, 'main').trim().split('\n');
const branches = (r) => r.git('for-each-ref', '--format=%(refname:short)', 'refs/heads')
  .trim().split('\n');

test('a branch lands through two green gates, in the order they are configured', () => {
  const r = project([
    { name: 'first', cmd: 'echo FIRST-RAN' },
    { name: 'second', cmd: 'echo SECOND-RAN' },
  ]);
  const { branch, wt } = branchWith(r);

  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 0, out);
  // The order is the project's call and the plugin never reorders it.
  assert.ok(out.indexOf('FIRST-RAN') < out.indexOf('SECOND-RAN'), out);
  assert.match(out, /landed 'demo\/d1' on main/);
  // The commit is on main, and both the worktree and the ref are gone.
  assert.ok(log(r).includes('feat: the branch does a thing'), log(r).join('|'));
  assert.deepEqual(branches(r), ['main']);
  assert.equal(r.git('worktree', 'list').includes(wt), false);
});

test('the red gate returns 11 naming itself, and the main branch does not move', () => {
  const r = project([
    { name: 'green', cmd: 'echo fine' },
    { name: 'suite', cmd: 'echo "3 tests failed" >&2; exit 1' },
  ]);
  const { branch, wt } = branchWith(r);
  const before = r.git('rev-parse', 'main').trim();

  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 11, out);
  // NAMING ITSELF is the acceptance: exit 11 folds the source's 14, and the gate's name is what
  // replaces the second number.
  assert.match(out, /gate 'suite' refused/);
  assert.match(out, /3 tests failed/);
  assert.equal(r.git('rev-parse', 'main').trim(), before);
  // Held, not lost: the branch and its worktree survive for its author.
  assert.ok(branches(r).includes(branch));
  assert.ok(r.git('worktree', 'list').includes(wt));
  // And the outcome is on disk, naming the gate, for a session that was not watching.
  const queue = JSON.parse(readFileSync(join(r.root, '.orchestra', 'gate', 'queue.json'), 'utf8'));
  assert.equal(queue.entries[0].state, 'held');
  assert.match(queue.entries[0].note, /gate "suite" refused/);
});

test('a gate whose globs cover every changed path is skipped, and says so', () => {
  const r = project([
    { name: 'visual', cmd: 'exit 1', skipWhenAllPathsMatch: ['docs/**', '**/*.md'] },
  ]);
  const { branch } = branchWith(r, { file: 'docs/notes.md', body: 'a note\n' });
  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 0, out);
  assert.match(out, /gate 'visual' skipped/);
});

test('one uncovered path runs the gate the others would have skipped', () => {
  const r = project([
    { name: 'visual', cmd: 'echo "the frames moved" >&2; exit 1',
      skipWhenAllPathsMatch: ['docs/**', '**/*.md'] },
  ]);
  const { branch } = branchWith(r, { file: 'src/a.js', body: 'code\n' });
  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 11, out);
  assert.match(out, /gate 'visual' refused/);
});

test('a branch that does not exist is a precondition, not a queue place', () => {
  const r = project([{ name: 'green', cmd: 'true' }]);
  const { code, out } = run(r.root, 'land', 'demo/never');
  assert.equal(code, 13, out);
  assert.match(out, /no such branch 'demo\/never'/);
});

test("the gates that judge a branch are the branch's own", () => {
  // Spec §3.2: the config is committed, so a branch that changes a gate has that gate applied to
  // its own landing. Everything else — mainBranch, ledgers, queue — comes from the invoking config,
  // because a branch that could add a path to `ledgers` could make the gate commit it onto main.
  const r = project([{ name: 'from-main', cmd: 'exit 1' }]);
  const { branch, wt } = branchWith(r);
  const cfg = JSON.parse(readFileSync(join(wt, '.orchestra', 'config.json'), 'utf8'));
  cfg.gates = [{ name: 'from-branch', cmd: 'echo BRANCH-GATE' }];
  writeFileSync(join(wt, '.orchestra', 'config.json'), `${JSON.stringify(cfg, null, 2)}\n`);
  execFileSync('git', ['-C', wt, 'commit', '-qam', 'chore: this branch brings its own gate'],
    { encoding: 'utf8' });

  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 0, out);
  assert.match(out, /BRANCH-GATE/);
  assert.doesNotMatch(out, /from-main/);
});

test('a landing with no gates configured still rebases, merges and cleans up', () => {
  // `gates` defaults to []. A project that has configured none is not a project whose landings are
  // refused; it is a project whose gate list is empty, and the fast-forward is still serialised.
  const r = project([]);
  const { branch } = branchWith(r);
  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 0, out);
  assert.match(out, /no gates configured/);
  assert.deepEqual(branches(r), ['main']);
});

test('an uncommitted tracked file in the worktree stops the landing before anything moves', () => {
  const r = project([{ name: 'green', cmd: 'true' }]);
  const { branch, wt } = branchWith(r);
  writeFileSync(join(wt, 'src', 'a.js'), 'uncommitted\n');
  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 13, out);
  assert.match(out, /uncommitted changes/);
  assert.ok(branches(r).includes(branch));
});

// Fix round 1, Ruling 5: `commitLedgers` used to `git commit` with no pathspec, so anything else
// staged in the main checkout at the time — an agent's own `git add` that never got committed, say
// — was swept into a commit whose message names only the ledgers. `--only` is what makes the
// function's own claim (it commits only the paths it owns) true.
test('a dirty configured ledger is committed alone; something else staged in the main checkout is not swept in', () => {
  const r = project([{ name: 'green', cmd: 'true' }], { ledgers: ['reports/x.jsonl'] });
  // A tracked ledger the project's own tooling writes, and an unrelated tracked file with a staged
  // change nobody committed — both dirty in the main checkout before `land` runs.
  mkdirSync(join(r.root, 'reports'), { recursive: true });
  writeFileSync(join(r.root, 'reports', 'x.jsonl'), '{"a":1}\n');
  writeFileSync(join(r.root, 'unrelated.txt'), 'before\n');
  r.git('add', '-A');
  r.git('commit', '-q', '-m', 'chore: seed the ledger and an unrelated file');

  writeFileSync(join(r.root, 'reports', 'x.jsonl'), '{"a":1}\n{"a":2}\n');
  writeFileSync(join(r.root, 'unrelated.txt'), 'staged by hand, never committed\n');
  r.git('add', '-A');

  const { branch } = branchWith(r);
  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 0, out);
  assert.match(out, /committed 1 ledger file\(s\)/);

  const ledgerSha = r.git('log', '--format=%H', '--grep=ledger', '-1', 'main').trim();
  assert.ok(ledgerSha, `no ledger commit found in:\n${r.git('log', '--oneline', 'main')}`);
  const ledgerFiles = r.git('show', '--name-only', '--format=', ledgerSha).trim().split('\n');
  assert.deepEqual(ledgerFiles, ['reports/x.jsonl']);

  // The unrelated file is still staged, exactly as it was left — the ledger commit did not reach
  // past its own pathspec to sweep it in.
  const status = r.git('status', '--porcelain', '--', 'unrelated.txt');
  assert.match(status, /^M {2}unrelated\.txt/);
});
