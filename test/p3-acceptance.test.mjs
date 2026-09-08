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
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers/fixture.mjs';
import { loadConfig, loadConfigOrThrow } from '../lib/config.mjs';
import { commitLedgers } from '../lib/gate/land.mjs';
import { TRACE } from '../lib/gate/state.mjs';

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

// A branch with a worktree and one commit — the shape a worker leaves behind. `slug` names the
// worktree directory separately from `branch`, so a test that needs two branches at once (the lock
// contention test below) does not collide both worktrees on the same default path.
function branchWith(r, { branch = 'demo/d1', slug = 'd1', file = 'src/a.js', body = 'one\n' } = {}) {
  const wt = join(r.root, '.orchestra', 'worktrees', slug);
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

// A register row naming `branch`, in the shape a landing reads it — shared by every test below that
// needs `recordLandedSubjects` to match and, in online mode, `syncLandedIssue` to fire.
function seedRegisterRow(r, branch) {
  writeFileSync(join(r.root, '.orchestra', 'state.json'), `${JSON.stringify({
    version: 1, root: r.root, adopted: true,
    conductor: { session: null, language: null, inboxSeen: null },
    budgetResetAt: null,
    tasks: [{ id: 'demo/D1', branch, subjects: [], status: 'review' }],
  }, null, 2)}\n`);
}

// A `gh` on PATH that always answers `[]`, so a store's `listIssues` calls succeed with nothing to
// reconcile against — a controlled SUCCESS for `orchestra roadmap sync`'s real subprocess, the
// counterpart to the ordinary case (no fake `gh`) where that subprocess fails for a real reason
// ("no git remotes found" in a repo with none configured). Restores PATH itself, so a failure inside
// `fn` does not leak the fake binary into a later test.
function withFakeGh(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'fake-gh-'));
  writeFileSync(join(dir, 'gh'), '#!/bin/sh\necho \'[]\'\n');
  chmodSync(join(dir, 'gh'), 0o755);
  const savedPath = process.env.PATH;
  process.env.PATH = `${dir}:${savedPath}`;
  try { return fn(); } finally { process.env.PATH = savedPath; rmSync(dir, { recursive: true, force: true }); }
}

// A synchronous sleep for a synchronous test file — the same mechanism lib/gate/land.mjs's own
// `sleepMs` uses, reimplemented here rather than imported: it is one line, and importing production
// code into a test for a busy-wait would be an odd first dependency to add.
const sleepMs = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

// `land --detach` returns as soon as the PARENT has spawned the child and re-stamped the run
// record's pid — not once the child has booted node, run its own `precheck` (which shells out to
// git), and reached `acquire()` to actually become the lock holder. A test that races the foreground
// call immediately after that return is racing a few milliseconds of the parent's own bookkeeping
// against tens of milliseconds of node-boot variance, which a loaded machine can and does lose:
// reproduced under artificial CPU oversubscription at 2 failures in 6 runs, the foreground process
// winning the lock and landing outright. Poll `.orchestra/gate/holder` — the same file `mayTake`
// reads — until it names `branch`, or fail loudly rather than silently restore the race.
function waitUntilHolder(r, branch, { timeoutMs = 5000, intervalMs = 20 } = {}) {
  const path = join(r.root, '.orchestra', 'gate', 'holder');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let text = '';
    try { text = readFileSync(path, 'utf8'); } catch { /* not written yet */ }
    if (text.split('|')[1] === branch) return;
    if (Date.now() >= deadline) {
      throw new Error(`'${branch}' never became the lock holder within ${timeoutMs}ms`
        + ` (holder file: ${JSON.stringify(text)})`);
    }
    sleepMs(intervalMs);
  }
}

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
  //
  // Online, deliberately: `.orchestra/config.json` is a COMMITTED path there (spec
  // docs/specs/2026-09-08-offline-leaves-no-trace-design.md §2's whole point is that offline it
  // stops being one), and `.orchestra` itself matches the offline trace guard's `TRACE` pattern —
  // this test's own change to that path would otherwise be refused by a check it has nothing to do
  // with.
  const r = project([{ name: 'from-main', cmd: 'exit 1' }], { mode: 'online' });
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

// Offline, nothing orchestra produces may enter a commit (spec
// docs/specs/2026-09-08-offline-leaves-no-trace-design.md §4): the repository is shared with
// developers who must not learn the tool exists, and a commit body naming "the merge gate" in the
// shared history of main is exactly that leak, even though this path only fires when a project has
// configured a `ledgers` entry by hand.
test('commitLedgers offline: the message names no tool', () => {
  const r = project([{ name: 'green', cmd: 'true' }], { ledgers: ['ledger.jsonl'] });
  writeFileSync(join(r.root, 'ledger.jsonl'), '{"a":1}\n');
  r.git('add', 'ledger.jsonl');
  r.git('commit', '-q', '-m', 'ledger');
  writeFileSync(join(r.root, 'ledger.jsonl'), '{"a":2}\n');
  assert.equal(commitLedgers(loadConfigOrThrow(r.root)), true);
  const body = r.git('log', '-1', '--format=%B');
  // Two assertions, not one, and neither is redundant with the other. `/merge gate/` pins THIS
  // task's own removal — it is the phrase that named the tool and the only thing that changed here,
  // so it is what actually fails against the old code. `TRACE` pins the branch-wide invariant
  // (spec §5's trace guard, `orchestra|merge_agent`) that every offline trace this whole effort
  // cares about must also satisfy, even though it is narrower than "names no tool" and would not by
  // itself have caught this particular leak. Losing either one loses something a later reader would
  // not get back by re-deriving it.
  assert.doesNotMatch(body, /merge gate/);
  assert.doesNotMatch(body, TRACE);
});

// The counterpart: online there is nothing to hide, and the prose that explains why the ledger
// commit exists (naming the merge gate as the only actor allowed to write main) is worth keeping —
// this task must not touch the online body at all.
test('commitLedgers online: keeps the prose that explains the gate', () => {
  const r = project([{ name: 'green', cmd: 'true' }], { mode: 'online', ledgers: ['ledger.jsonl'] });
  writeFileSync(join(r.root, 'ledger.jsonl'), '{"a":1}\n');
  r.git('add', 'ledger.jsonl');
  r.git('commit', '-q', '-m', 'ledger');
  writeFileSync(join(r.root, 'ledger.jsonl'), '{"a":2}\n');
  commitLedgers(loadConfigOrThrow(r.root));
  assert.match(r.git('log', '-1', '--format=%B'), /merge gate/);
});

// The lock `commitLedgers` was missing (task 2 of P5): a torn write between another writer's
// `git add` and its own read-modify-write of the ledger file. This is the genuine-contention test
// the brief asked for: it proves `commitLedgers` really does take `lib/tickets/lock.mjs`'s lock,
// not merely that a landing succeeds while an unrelated directory happens to exist. A version of
// `commitLedgers` that forgot to call `withQueueLock` would let this run straight through with no
// error at all, so an assertion that it throws — and that it genuinely WAITED for the deadline
// rather than refusing on sight — is what tells the two apart.
test('commitLedgers takes the ticket queue lock, and throws at ITS OWN deadline when another process holds it', () => {
  const r = project([{ name: 'green', cmd: 'true' }], { ledgers: ['reports/x.jsonl'] });
  const cfg = loadConfig(r.root);
  const lockDir = join(r.root, 'reports', '.queue.lock');
  mkdirSync(lockDir, { recursive: true });
  // This test's own process: guaranteed alive for as long as the assertion runs, so the lock
  // cannot be broken as a dead holder's — the only path that would let this call through early.
  writeFileSync(join(lockDir, 'pid'), String(process.pid));

  const start = Date.now();
  assert.throws(
    () => commitLedgers(cfg, { waitMs: 200 }),
    (e) => new RegExp(`held by pid ${process.pid}`).test(e.message),
  );
  assert.ok(Date.now() - start >= 200, 'commitLedgers must wait out its own deadline, not refuse on sight');
  rmSync(lockDir, { recursive: true, force: true });
});

// The companion path: the lock IS held elsewhere when a landing starts — by a process that has
// since died — and the landing must still succeed, because a dead holder is broken automatically
// (the same rule `lib/tickets/lock.mjs`'s own unit test proves in isolation). This is the
// end-to-end wiring: a landing that commits a ledger while its lock is held by a pid nobody can
// still `kill -0`.
test('a landing commits its ledger even though the lock is held elsewhere by a now-dead pid', () => {
  const r = project([{ name: 'green', cmd: 'true' }], { ledgers: ['reports/x.jsonl'] });
  mkdirSync(join(r.root, 'reports'), { recursive: true });
  writeFileSync(join(r.root, 'reports', 'x.jsonl'), '{"a":1}\n');
  r.git('add', '-A');
  r.git('commit', '-q', '-m', 'chore: seed the ledger');
  writeFileSync(join(r.root, 'reports', 'x.jsonl'), '{"a":1}\n{"a":2}\n');

  const lockDir = join(r.root, 'reports', '.queue.lock');
  mkdirSync(lockDir, { recursive: true });
  // A pid no process on this machine can hold: dead on arrival, so the lock is broken and taken
  // rather than waited out.
  writeFileSync(join(lockDir, 'pid'), '999999999');

  const { branch } = branchWith(r);
  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 0, out);
  assert.match(out, /committed 1 ledger file\(s\)/);
  const ledgerSha = r.git('log', '--format=%H', '--grep=ledger', '-1', 'main').trim();
  assert.ok(ledgerSha, `no ledger commit found in:\n${r.git('log', '--oneline', 'main')}`);
});

// Review fix round 1, finding 2. `cfg.ledgers` is empty in every project today, but task 7 of
// this plan makes `orchestra init` propose the ticket file into it — the day two configured
// ledgers land in the SAME directory (this project's own ticket file plus whatever else it keeps
// beside it) is the day `ledgerLockTargets`'s per-directory grouping stops being latent. Locking
// per PATH instead of per directory would nest the identical `withQueueLock` call inside itself —
// same pid, still alive — and wait out the full 30-second production deadline before throwing.
// This proves the grouping holds by proving a landing with two same-directory ledgers finishes
// fast: a self-deadlock cannot finish in under ten seconds when its own timeout is thirty.
test('two ledgers in the same directory take ONE lock, not two nested ones that self-deadlock', () => {
  const r = project([{ name: 'green', cmd: 'true' }], { ledgers: ['reports/x.jsonl', 'reports/y.jsonl'] });
  mkdirSync(join(r.root, 'reports'), { recursive: true });
  writeFileSync(join(r.root, 'reports', 'x.jsonl'), '{"a":1}\n');
  writeFileSync(join(r.root, 'reports', 'y.jsonl'), '{"b":1}\n');
  r.git('add', '-A');
  r.git('commit', '-q', '-m', 'chore: seed two ledgers sharing one directory');
  writeFileSync(join(r.root, 'reports', 'x.jsonl'), '{"a":1}\n{"a":2}\n');
  writeFileSync(join(r.root, 'reports', 'y.jsonl'), '{"b":1}\n{"b":2}\n');

  const { branch } = branchWith(r);
  const start = Date.now();
  const { code, out } = run(r.root, 'land', branch);
  const elapsed = Date.now() - start;
  assert.equal(code, 0, out);
  assert.match(out, /committed 2 ledger file\(s\)/);
  assert.ok(elapsed < 10_000,
    `expected one lock and a fast landing, took ${elapsed}ms — looks like a self-deadlock against the 30s production timeout`);
});

test('land --detach returns 15 at once, and await collects the real code and the gate name', () => {
  const r = project([
    { name: 'slow', cmd: 'sleep 1; echo SLOW-RAN' },
    { name: 'suite', cmd: 'echo "1 test failed" >&2; exit 1' },
  ]);
  const { branch } = branchWith(r);

  const started = run(r.root, 'land', branch, '--detach');
  assert.equal(started.code, 15, started.out);
  assert.match(started.out, /detached — pid \d+/);
  // The caller's own turn is over in milliseconds; the landing is not.
  const waited = run(r.root, 'await', branch, '--for=60');
  assert.equal(waited.code, 11, waited.out);
  assert.match(waited.out, /gate "suite" refused/);   // the queue note, in await's own report
  assert.match(waited.out, /1 test failed/);          // the tail of the log it never watched
  assert.match(waited.out, /full log: .*\.orchestra\/gate\/logs\//);
});

test('await on a branch with no record says how to start one', () => {
  const r = project([{ name: 'green', cmd: 'true' }]);
  branchWith(r);
  const { code, out } = run(r.root, 'await', 'demo/d1', '--for=1');
  assert.equal(code, 1, out);
  assert.match(out, /no detached landing on record/);
  assert.match(out, /land demo\/d1 --detach/);
});

test('a second --detach on a running landing does not start a second one', () => {
  const r = project([{ name: 'slow', cmd: 'sleep 3' }]);
  const { branch } = branchWith(r);
  assert.equal(run(r.root, 'land', branch, '--detach').code, 15);
  const again = run(r.root, 'land', branch, '--detach');
  assert.equal(again.code, 15, again.out);
  assert.match(again.out, /already landing — pid \d+/);
  run(r.root, 'await', branch, '--for=60');
});

test('a landing records its commit subjects on the register row that named the branch', () => {
  // THE WHOLE PATH, in a scratch repository, because the write is wrapped in a catch that can turn a
  // programming error into one warning line — which is exactly how the source shipped a landing that
  // exited 0 while the register was never written, for two days and every landing.
  const r = project([{ name: 'green', cmd: 'true' }]);
  const { branch } = branchWith(r);
  seedRegisterRow(r, branch);

  assert.equal(run(r.root, 'land', branch).code, 0);
  const state = JSON.parse(readFileSync(join(r.root, '.orchestra', 'state.json'), 'utf8'));
  assert.deepEqual(state.tasks[0].subjects, ['feat: the branch does a thing']);
  assert.equal(state.tasks[0].status, 'landed');
});

test('an unwritable register does not stop a landing that has already merged', () => {
  const r = project([{ name: 'green', cmd: 'true' }]);
  const { branch } = branchWith(r);
  writeFileSync(join(r.root, '.orchestra', 'state.json'), 'not json at all');
  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 0, out);
  assert.match(out, /landed, but the register was not updated/);
  assert.deepEqual(branches(r), ['main']);
});

test('queue-list prints a held entry with its note, and reaps an entry whose branch is gone', () => {
  const r = project([{ name: 'suite', cmd: 'exit 1' }]);
  const { branch } = branchWith(r);
  assert.equal(run(r.root, 'land', branch).code, 11);

  const held = run(r.root, 'queue-list');
  assert.equal(held.code, 0, held.out);
  assert.match(held.out, /held\s+.*demo\/d1.*gate "suite" refused/);

  // The branch goes; so does the entry — the same liveness argument the lock already makes, and the
  // reason there is no `drop` verb (spec §2's list has three).
  r.git('worktree', 'remove', '--force', join(r.root, '.orchestra', 'worktrees', 'd1'));
  r.git('branch', '-D', branch);
  const after = run(r.root, 'queue-list');
  assert.match(after.out, /merge queue: empty/);
});

// Branch review, I4: acceptance row 4 — "a second `land` on a held branch is refused by the lock,
// not by running twice" — had no assertion, on the stated theory that a single-process test cannot
// observe contention. It can: two branches, one detached landing holding the lock behind a slow
// gate, and a second FOREGROUND `land` with a short `--wait` that must time out against the lock
// itself, not against a second run of anything.
test('a second land on a held branch is refused by the LOCK, not by running twice', () => {
  const r = project([{ name: 'slow', cmd: 'sleep 5' }]);
  const { branch: holder } = branchWith(r, { branch: 'demo/d1', slug: 'd1', file: 'src/a.js' });
  const { branch: waiter } = branchWith(r, { branch: 'demo/d2', slug: 'd2', file: 'src/b.js' });

  const started = run(r.root, 'land', holder, '--detach');
  assert.equal(started.code, 15, started.out);
  // Do not race the foreground call against the detached child's own boot — see waitUntilHolder.
  waitUntilHolder(r, holder);

  const { code, out } = run(r.root, 'land', waiter, '--wait=2');
  assert.equal(code, 12, out);
  // `mayTake`'s own reason string, printed once by `acquire` — this is the LOCK speaking, not a
  // second `land` colliding with a queue record.
  assert.match(out, /waiting — landing demo\/d1/);
  assert.match(out, /still waiting after 2s — run land again/);
  // The waiter never touched the branch it could not get a turn for.
  assert.ok(branches(r).includes(waiter));

  run(r.root, 'await', holder, '--for=60');
});

// Branch review, item 2: a worktree git's OWN registry still names, but whose directory is gone —
// deleted by hand rather than through `git worktree remove` — used to reach an unguarded
// `git -C <gone path> …` a few steps later and crash with an undocumented exit 1 and a raw `fatal:
// cannot change to …`, leaving the queue entry `landing` with no live process to reap it.
test('a worktree registered but missing on disk is a precondition, not a crash', () => {
  const r = project([{ name: 'green', cmd: 'true' }]);
  const { branch, wt } = branchWith(r);
  rmSync(wt, { recursive: true, force: true });
  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 13, out);
  assert.match(out, /registered but its directory is gone/);
  assert.doesNotMatch(out, /fatal: cannot change to/);
});

// Branch review, item 9: a gate killed by a signal with no `gate.timeout` configured used to blame a
// timeout that was never set — `gate "x" refused (killed after undefineds)` — because the real
// timeout case (`ETIMEDOUT`) and a plain signal death shared one branch.
test('a gate killed by a signal with no timeout configured names the signal, not "undefined"', () => {
  const r = project([{ name: 'suicide', cmd: 'kill -TERM $$' }]);
  const { branch } = branchWith(r);
  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 11, out);
  // The "why" travels in the queue note (mark's third argument), not in `land`'s own printed
  // line — same place the red-gate acceptance test above reads it from.
  const queue = JSON.parse(readFileSync(join(r.root, '.orchestra', 'gate', 'queue.json'), 'utf8'));
  assert.match(queue.entries[0].note, /gate "suicide" refused \(killed by SIGTERM\)/);
  assert.doesNotMatch(queue.entries[0].note, /undefined/);
});

// Branch review, item 6: the positive control for the shared-channel write, mirroring "an
// unwritable register does not stop a landing" above — both best-effort writes after the
// fast-forward must never change the exit code. No fake `gh` on PATH, so the real `gh` fails for a
// real reason (a scratch repository has no remote), exercising the actual failure path rather than
// an inspection of it.
test('online: a landing whose sync could not reach gh still exits 0, and says so', () => {
  const r = project([{ name: 'green', cmd: 'true' }], { mode: 'online' });
  const { branch } = branchWith(r);
  seedRegisterRow(r, branch);

  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 0, out);
  assert.match(out, /landed, but the shared channel was not synced/);
  assert.deepEqual(branches(r), ['main']);
});

// Branch review, item 10: a no-op sync ("sync: nothing to do") and a real one ("sync: closed …")
// used to print the SAME generic "synced the shared channel" line — indistinguishable successes.
// The child's own report is captured (spawnSync pipes by default) and was thrown away; this proves
// it now reaches the line the parent prints.
test("online: a successful sync echoes the child's own report, not a generic message", () => {
  const r = project([{ name: 'green', cmd: 'true' }], { mode: 'online' });
  const { branch } = branchWith(r);
  seedRegisterRow(r, branch);

  const { code, out } = withFakeGh(() => run(r.root, 'land', branch));
  assert.equal(code, 0, out);
  assert.match(out,
    /synced the shared channel for 'demo\/D1' — sync: closed nothing; 0 label change\(s\); 0 programme\(s\) updated/);
});

// The trace guard (spec §5): offline, nothing orchestra produces may enter a commit, because the
// repository is shared with developers who must not learn the tool exists. `main` is the only
// branch ever pushed and `land` the only way in, so this is the last place the invariant can be
// made true rather than hoped for.
//
// The gate must run before ANY configured gate, not merely before the fast-forward: a refusal is
// free, a suite is minutes. Proven here by giving the project a gate that would leave a mark
// (`touch gate-ran`) and asserting that mark never appears.
test('land offline: a branch whose commit message names the tool is refused before any gate runs', () => {
  const r = project([{ name: 'suite', cmd: 'touch gate-ran' }]);
  const wt = join(r.root, '.orchestra', 'worktrees', 'feat');
  r.git('worktree', 'add', '-q', '-b', 'feat', wt, 'main');
  writeFileSync(join(wt, 'a.txt'), 'a\n');
  execFileSync('git', ['-C', wt, 'add', 'a.txt']);
  execFileSync('git', ['-C', wt, 'commit', '-q', '-m', 'chore: land via orchestra']);

  const before = r.git('rev-parse', 'main').trim();
  const { code, out } = run(r.root, 'land', 'feat');
  assert.equal(code, 11, out);                                    // S.EXIT.refused
  assert.match(out, /offline-trace/);
  assert.match(out, /commit [0-9a-f]{7}/);
  assert.equal(existsSync(join(wt, 'gate-ran')), false);           // refused BEFORE the gate ran
  assert.equal(r.git('rev-parse', 'main').trim(), before);         // main never moved
});

// The other of the three inputs `offlineTraces` is handed: an ADDED line in the diff, not a commit
// message. Named by file and line so the reword this refusal demands is mechanical.
test('land offline: an added line that names the tool is refused, naming file and line', () => {
  const r = project([]);
  const wt = join(r.root, '.orchestra', 'worktrees', 'feat');
  r.git('worktree', 'add', '-q', '-b', 'feat', wt, 'main');
  writeFileSync(join(wt, 'notes.md'), 'one\ntwo\nrun orchestra land\n');
  execFileSync('git', ['-C', wt, 'add', 'notes.md']);
  execFileSync('git', ['-C', wt, 'commit', '-q', '-m', 'docs: notes']);

  const { code, out } = run(r.root, 'land', 'feat');
  assert.equal(code, 11, out);
  assert.match(out, /notes\.md:3/);
});

// The positive control: a branch with nothing to hide lands normally in offline mode. Without this,
// a broken guard that refused every offline landing would pass every test above.
test('land offline: a clean branch lands normally', () => {
  const r = project([]);
  const { branch } = branchWith(r, { file: 'a.txt', body: 'a\n' });
  const { code, out } = run(r.root, 'land', branch);
  assert.equal(code, 0, out);
});

// Online mode is unchanged (spec §5, "skipped entirely when cfg.mode !== 'offline'"): online
// publishes GitHub issues, visibility is the point there, and the very branch refused above must
// land untouched.
test('land online: the same offending branch lands — online has nothing to hide', () => {
  const r = project([], { mode: 'online' });
  const wt = join(r.root, '.orchestra', 'worktrees', 'feat');
  r.git('worktree', 'add', '-q', '-b', 'feat', wt, 'main');
  writeFileSync(join(wt, 'a.txt'), 'a\n');
  execFileSync('git', ['-C', wt, 'add', 'a.txt']);
  execFileSync('git', ['-C', wt, 'commit', '-q', '-m', 'chore: land via orchestra']);

  const { code, out } = run(r.root, 'land', 'feat');
  assert.equal(code, 0, out);
});
