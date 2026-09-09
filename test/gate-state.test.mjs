// The gate's decisions, tested where they are decidable: no repository, no processes, no clock.
// Liveness is injected, so a process can be killed on paper — which is the only way the turn order
// and the reaping are testable at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../lib/gate/state.mjs';

test('an unreadable queue record reads as empty, never as a crash', () => {
  // A truncated or hand-edited file must not wedge every landing on this machine: the record is a
  // convenience, the lock is what protects the main branch.
  assert.deepEqual(S.parseState('{ not json'), S.EMPTY);
  assert.deepEqual(S.parseState(''), S.EMPTY);
  assert.deepEqual(S.parseState('{"entries":"nope"}'), S.EMPTY);
  // An entry with no branch is not an entry.
  assert.equal(S.parseState('{"entries":[{"branch":"a"},{"note":"x"}]}').entries.length, 1);
});

test('upsert keeps enqueuedAt across a second land of the same branch', () => {
  // `land` runs more than once for one branch by design: exit 10 sends the agent away to resolve a
  // conflict and it comes back. `queue-list` shows how long a branch has really been trying.
  const one = S.upsertEntry(S.EMPTY, { branch: 'a', worktree: '/w/a', at: 100 }).state;
  const two = S.upsertEntry(one, { branch: 'a', worktree: '/w/a2', at: 900 }).state;
  assert.equal(two.entries.length, 1);
  assert.equal(two.entries[0].enqueuedAt, 100);
  assert.equal(two.entries[0].worktree, '/w/a2');
  assert.equal(two.entries[0].state, 'queued');
});

test('an unknown entry state throws instead of being written', () => {
  const s = S.upsertEntry(S.EMPTY, { branch: 'a', worktree: '/w', at: 1 }).state;
  assert.throws(() => S.setEntryState(s, 'a', 'wibble'), /unknown entry state/);
  assert.equal(S.setEntryState(s, 'a', 'held', 'gate "suite" refused').entries[0].note,
    'gate "suite" refused');
});

test('queue-list reaps an entry whose branch ref is gone, and keeps one that exists', () => {
  // The same liveness argument the pid-held lock makes, and the reason there is no `drop` verb.
  let s = S.upsertEntry(S.EMPTY, { branch: 'gone', worktree: '/w/1', at: 1 }).state;
  s = S.upsertEntry(s, { branch: 'here', worktree: '/w/2', at: 2 }).state;
  const reaped = S.dropVanished(s, (b) => b === 'here');
  assert.deepEqual(reaped.entries.map((e) => e.branch), ['here']);
});

test('a waiter line with pid 0 is dropped rather than read', () => {
  // `process.kill(0, 0)` targets the process GROUP and always succeeds, so a malformed line read as
  // pid 0 would be alive for ever and hold the queue shut.
  const list = S.parseWaiters('0|a|10\n7|b|11\nrubbish\n');
  assert.deepEqual(list, [{ pid: 7, branch: 'b', epoch: 11 }]);
  assert.equal(S.formatWaiters(list), '7|b|11\n');
  assert.equal(S.formatWaiters([]), '');
});

test('reaping is by injected liveness, in both directions', () => {
  const list = [{ pid: 1, branch: 'a', epoch: 1 }, { pid: 2, branch: 'b', epoch: 2 }];
  assert.deepEqual(S.reapWaiters(list, (p) => p === 2), [list[1]]);
  assert.equal(S.reapHolder(list[0], () => false), null);
  assert.equal(S.reapHolder(list[0], () => true), list[0]);
  assert.equal(S.reapHolder(null, () => true), null);
});

test('a holder blocks everyone, and the turn is decided among live waiters', () => {
  const holder = { pid: 9, branch: 'x', epoch: 1 };
  assert.deepEqual(S.mayTake({ holder, waiters: [], pid: 3 }),
    { ok: false, reason: 'landing x', ahead: 1 });
  const waiters = [{ pid: 3, branch: 'a', epoch: 20 }, { pid: 4, branch: 'b', epoch: 10 }];
  assert.equal(S.mayTake({ holder: null, waiters, pid: 4 }).ok, true);
  assert.deepEqual(S.mayTake({ holder: null, waiters, pid: 3 }),
    { ok: false, reason: '1 ahead', ahead: 1 });
  assert.equal(S.mayTake({ holder: null, waiters, pid: 99 }).reason, 'not registered as a waiter');
});

test('two land calls in the same second are broken by pid, never both at the head', () => {
  // Epochs are seconds, so a tie is ordinary. Without the tiebreak both read themselves as the head
  // and two landings run at once, which is the entire bug this queue exists to prevent.
  const waiters = [{ pid: 8, branch: 'a', epoch: 5 }, { pid: 3, branch: 'b', epoch: 5 }];
  assert.equal(S.mayTake({ holder: null, waiters, pid: 3 }).ok, true);
  assert.equal(S.mayTake({ holder: null, waiters, pid: 8 }).ok, false);
});

test('the exit table is the interface merge_agent branches on, and it has no 14', () => {
  assert.deepEqual(S.EXIT, {
    ok: 0, usage: 1, conflict: 10, refused: 11, busy: 12, precondition: 13, started: 15, vanished: 16,
    machine: 17,
  });
});

// 11 and 17 name different ACTORS, which is the whole reason 17 exists beside a number that already
// means "refused". `gateOutcome` is where that is decided.
test('a gate reaches a verdict, or it is killed before it can — and those are not the same refusal', () => {
  assert.deepEqual(S.gateOutcome({ name: 'suite', status: 1 }),
    { actor: 'branch', exit: S.EXIT.refused, note: 'gate "suite" refused' });
  // A signal that reaches this process.
  assert.equal(S.gateOutcome({ name: 'suite', status: null, signal: 'SIGKILL' }).exit, S.EXIT.machine);
  // And the one that does not, because the gate runs under a shell: 128+N, signal null.
  assert.equal(S.gateOutcome({ name: 'suite', status: 134 }).exit, S.EXIT.machine);
  assert.match(S.gateOutcome({ name: 'suite', status: 137 }).note, /killed by SIGKILL/);
  // 128+N is a convention, not a guarantee. An unlisted number stays the branch's refusal rather
  // than being read as a signal on the strength of arithmetic.
  assert.equal(S.gateOutcome({ name: 'suite', status: 133 }).exit, S.EXIT.refused);
  assert.equal(S.gateOutcome({ name: 'suite', status: 128 }).exit, S.EXIT.refused);
  // A timeout stays the branch's: a hang and a loaded machine look identical, and reading a hang as
  // the machine's sends the agent to land it again for ever.
  assert.equal(S.gateOutcome({ name: 'suite', status: null, signal: 'SIGTERM', errorCode: 'ETIMEDOUT', timeout: 600 }).exit,
    S.EXIT.refused);
});

test('a machine with no room refuses the landing before it accuses the branch', () => {
  assert.match(S.diskRefusal(200 * 1024 * 1024, '/w'), /0\.20 GiB free.*not at fault/s);
  assert.equal(S.diskRefusal(S.MIN_FREE_BYTES, '/w'), null);
  // A filesystem that could not be asked runs the landing: a check that cannot answer must not
  // become a check that refuses.
  assert.equal(S.diskRefusal(null, '/w'), null);
});

test('the attempt ledger answers how many times a branch tried, and what each try came to', () => {
  const at = (n) => new Date(Date.parse('2026-09-08T10:00:00.000Z') + n * 60_000).toISOString();
  const entries = [
    { branch: 'a/one', startedAt: at(0), endedAt: at(4), exit: 11, note: 'gate "suite" refused' },
    { branch: 'b/two', startedAt: at(5), endedAt: at(6), exit: 0, note: '' },
    { branch: 'a/one', startedAt: at(7), endedAt: at(9), exit: 17, note: 'gate "suite" was killed by SIGKILL' },
    { branch: 'a/one', startedAt: at(10), endedAt: at(14), exit: 0, note: '' },
  ];
  const s = S.attemptSummary(entries, 'a/one');
  assert.equal(s.count, 3);
  assert.equal(s.refusals, 2);
  assert.deepEqual(s.outcomes.map((o) => o.exit), [11, 17, 0]);
  assert.equal(s.outcomes[0].seconds, 240);
  assert.equal(S.attemptSummary(entries, 'c/none'), null);

  const line = S.attemptHistoryLine(s);
  assert.match(line, /^attempt 3; before this one: exit 11 \(gate "suite" refused\) after 240s, exit 17/);
  // A first attempt is not a history.
  assert.equal(S.attemptHistoryLine(S.attemptSummary(entries, 'b/two')), null);
  assert.equal(S.attemptHistoryLine(null), null);
});

test('only the configured ledger paths are committed, and they are sorted', () => {
  // An ALLOWLIST of exact paths, never a pattern: the exemption exists because these are files the
  // gate itself may commit, and "any .jsonl" would quietly extend that claim to a data file a
  // branch is genuinely authoring.
  const dirty = ['src/a.js', '.orchestra/tickets.jsonl', 'docs/notes.jsonl'];
  assert.deepEqual(S.ledgerPathsToCommit(dirty, ['.orchestra/tickets.jsonl', 'docs/notes.jsonl']),
    ['.orchestra/tickets.jsonl', 'docs/notes.jsonl']);
  assert.deepEqual(S.ledgerPathsToCommit(dirty, []), []);
});

test('only a dirty file the branch also changes can clash', () => {
  // The only thing a landing does to the main working tree is `merge --ff-only`, which writes
  // exactly the paths the branch changed. A dirty tracked file outside that set cannot be touched.
  assert.deepEqual(S.clashingPaths(['a', 'b', 'c'], ['c', 'a']), ['a', 'c']);
  assert.deepEqual(S.clashingPaths(['a'], ['b']), []);
});

test('offlineTraces: a clean branch has nothing', () => {
  assert.deepEqual(S.offlineTraces({
    paths: ['src/a.js'],
    commits: [{ sha: 'abc1234def', body: 'feat: a thing\n\nA body.\n' }],
    diff: '+++ b/src/a.js\n@@ -1,0 +1,1 @@\n+const a = 1;\n',
  }), []);
});

test('offlineTraces: a commit message names the tool', () => {
  const found = S.offlineTraces({ commits: [{ sha: 'abc1234def', body: 'chore: run orchestra land\n' }] });
  assert.equal(found.length, 1);
  assert.equal(found[0].where, 'commit abc1234');
});

test('offlineTraces: an added line names the tool, located in the new file', () => {
  const diff = [
    '+++ b/docs/plan.md',
    '@@ -1,2 +1,4 @@',
    ' context one',
    ' context two',
    '+a plain line',
    '+scheduled by orchestra',
    '',
  ].join('\n');
  const found = S.offlineTraces({ diff });
  assert.deepEqual(found, [{ where: 'docs/plan.md:4', text: 'scheduled by orchestra' }]);
});

test('offlineTraces: a REMOVED line is not a trace — deleting the block is the fix, not the crime', () => {
  const diff = '+++ b/CLAUDE.md\n@@ -1,2 +1,1 @@\n context\n-## Working with orchestra\n';
  assert.deepEqual(S.offlineTraces({ diff }), []);
});

test('offlineTraces: a force-added path under the excluded directory', () => {
  const found = S.offlineTraces({ paths: ['.orchestra/tickets.jsonl'] });
  assert.deepEqual(found, [{ where: 'path .orchestra/tickets.jsonl', text: '.orchestra/tickets.jsonl' }]);
});

test('offlineTraces: merge_agent counts, and the match is case-insensitive', () => {
  assert.equal(S.offlineTraces({ commits: [{ sha: 'f00ba12345', body: 'hand to Merge_Agent' }] }).length, 1);
});

// Final review, Important 3: `TRACE` used to be a plain substring, which refused not the tool's
// name but every English word containing it — so a container-orchestration, CI, data-pipeline or
// music project could land nothing that touched `src/orchestrator.ts`, with no config key to turn
// the refusal off. Both halves are pinned here, because narrowing the pattern too far would be the
// worse failure: it is what makes the whole invariant true.
test('TRACE matches the tool\'s own identifiers, in every shape it writes them', () => {
  for (const s of ['orchestra land', 'run orchestra', 'orchestra-a1b2', '.orchestra/config.json',
    'hand it to merge_agent', 'the merge_agents queue']) {
    assert.match(s, S.TRACE);
  }
});

test('TRACE does not match an English word that merely contains it', () => {
  for (const s of ['src/orchestrator.ts', 'docs/orchestration/pipeline.md',
    'feat: orchestrate the workers', 'a well-orchestrated release', 'Orchestral suite in D']) {
    assert.doesNotMatch(s, S.TRACE);
  }
});

test('offlineTraces: a path in a project whose own vocabulary contains the word is not a trace', () => {
  // The consequence the pattern exists to avoid, at the level that actually refused the landing:
  // `paths` alone was enough to hold every branch touching an orchestration directory.
  assert.deepEqual(S.offlineTraces({
    paths: ['src/orchestrator.ts', 'docs/orchestration/pipeline.md'],
    commits: [{ sha: 'abc1234def', body: 'feat: orchestrate the workers\n' }],
    diff: '+++ b/src/orchestrator.ts\n@@ -1,0 +1,1 @@\n+// a well-orchestrated release\n',
  }), []);
});

test('offlineTraces: the +++ header itself is not an added line', () => {
  // Otherwise every file under the excluded directory would be reported twice, once as a path and
  // once as its own diff header.
  assert.deepEqual(S.offlineTraces({ diff: '+++ b/.orchestra/x\n@@ -0,0 +1 @@\n+ok\n' }), []);
});

// Fix round 1, the Important finding: a `+` (added) marker followed by content starting with
// `++ ` renders identically to a `+++ b/<path>` FILE HEADER. A 4-character prefix test on the raw
// line cannot tell them apart — only tracking whether the scanner is INSIDE a hunk can, because a
// real header can never occur there. Confirmed against the shipped code before this fix: the trace
// below was silently dropped, never even tested against TRACE.
test('offlineTraces: an added line beginning with "++ " is content, not a file header', () => {
  const diff = '+++ b/real-file.txt\n@@ -1,1 +1,2 @@\n context1\n+++ orchestra scheduled this\n';
  assert.deepEqual(S.offlineTraces({ diff }),
    [{ where: 'real-file.txt:2', text: '++ orchestra scheduled this' }]);
});

// Same finding, second half: misreading that line as a header also REASSIGNED `file` to garbage
// sliced from its own text, so the NEXT added line in the same hunk was reported against that
// garbage path instead of the real one — confirmed against the shipped code before this fix.
test('offlineTraces: a later added line in the same hunk is still attributed to the real path', () => {
  const diff = [
    '+++ b/real-file.txt',
    '@@ -1,1 +1,3 @@',
    ' context1',
    '+++ orchestra scheduled this',
    '+scheduled by orchestra again',
    '',
  ].join('\n');
  assert.deepEqual(S.offlineTraces({ diff }), [
    { where: 'real-file.txt:2', text: '++ orchestra scheduled this' },
    { where: 'real-file.txt:3', text: 'scheduled by orchestra again' },
  ]);
});

test('offlineTraces: a full real git diff shape still locates the trace correctly', () => {
  // `diff --git`, `index`, and `--- a/<path>` all precede `+++ b/<path>` in real `git diff`
  // output. None of them is a hunk, so all three must be skipped without ending up read as one.
  const diff = [
    'diff --git a/f.js b/f.js',
    'index 0000000..1111111 100644',
    '--- a/f.js',
    '+++ b/f.js',
    '@@ -1,1 +1,2 @@',
    ' context',
    '+run by orchestra',
    '',
  ].join('\n');
  assert.deepEqual(S.offlineTraces({ diff }), [{ where: 'f.js:2', text: 'run by orchestra' }]);
});

test('a glob matches within a segment, and ** spans segments including none', () => {
  const m = (g, p) => S.globToRegExp(g).test(p);
  assert.equal(m('docs/**', 'docs/a.md'), true);
  assert.equal(m('docs/**', 'docs/x/y/z.md'), true);
  assert.equal(m('docs/**', 'src/a.md'), false);
  assert.equal(m('**/*.md', 'README.md'), true);           // ** matches ZERO directories
  assert.equal(m('**/*.md', 'docs/x/a.md'), true);
  assert.equal(m('**/*.md', 'docs/a.txt'), false);
  assert.equal(m('tests/*.js', 'tests/a.js'), true);
  assert.equal(m('tests/*.js', 'tests/deep/a.js'), false); // * never crosses a slash
  assert.equal(m('package.json', 'package.json'), true);
  assert.equal(m('package.json', 'packageXjson'), false);  // the dot is a literal, not "any char"
});

test('a gate is skipped only when EVERY changed path matches, and never on doubt', () => {
  const gate = { name: 'visual', cmd: 'x', skipWhenAllPathsMatch: ['docs/**', '**/*.md'] };
  assert.equal(S.gateSkipped(gate, ['docs/a.md', 'README.md']), true);
  assert.equal(S.gateSkipped(gate, ['docs/a.md', 'src/x.js']), false);
  // Deliberately wrong in one direction: an unreadable diff and an empty one both RUN the gate. A
  // needless run costs minutes; a missed run lets through the defect the gate exists to catch.
  assert.equal(S.gateSkipped(gate, null), false);
  assert.equal(S.gateSkipped(gate, []), false);
  // A gate that declares no globs is never skipped.
  assert.equal(S.gateSkipped({ name: 'suite', cmd: 'x' }, ['docs/a.md']), false);
});

test('the worktree and the branch are two independent cleanups', () => {
  // They used to be one if/else chain, so any failure on the worktree side meant `branch -d` was
  // never ATTEMPTED and the merged branch survived as a dead ref — twice in a row on 2026-08-19 in
  // planetCraft, both deleted by hand afterwards.
  const calls = [];
  const notes = S.cleanupAfterLanding({
    branch: 'b', worktree: '/w',
    dirtyFiles: () => [],
    removeWorktree: () => { calls.push('rm'); return false; },
    deleteBranch: () => { calls.push('del'); return true; },
    provenMerged: () => true,
    unsetUpstream: () => true,
  });
  assert.deepEqual(calls, ['rm', 'del']);
  assert.match(notes[0], /worktree \/w kept — git refused/);
});

test('a dirty worktree is removed anyway, and the note names what went with it', () => {
  // The landing's precondition proved this tree clean under the lock; only the rebase and the gates
  // have written to it since. Keeping it for a coverage report kept the landed branch alive with it.
  const notes = S.cleanupAfterLanding({
    branch: 'b', worktree: '/w',
    dirtyFiles: () => ['coverage.txt', 'src/a.js'],
    removeWorktree: () => true,
    deleteBranch: () => true,
    provenMerged: () => true,
    unsetUpstream: () => true,
  });
  assert.deepEqual(notes,
    ['worktree /w removed with 2 uncommitted file(s) the gates left behind: coverage.txt, src/a.js']);
});

test('a pinned upstream is proven past, never forced past', () => {
  // The gate rebases, which re-hashes every commit, so `git branch -d` refuses a branch that IS the
  // main branch, testing it against its UPSTREAM instead of HEAD. The answer is not -D: it is to
  // prove what -D would assume, then ask the same lowercase -d again.
  const calls = [];
  let unpinned = false;
  const notes = S.cleanupAfterLanding({
    branch: 'b', worktree: '/w',
    dirtyFiles: () => [],
    removeWorktree: () => true,
    deleteBranch: () => { calls.push('del'); return unpinned; },
    provenMerged: () => true,
    unsetUpstream: () => { unpinned = true; calls.push('unpin'); return true; },
  });
  assert.deepEqual(calls, ['del', 'unpin', 'del']);
  assert.deepEqual(notes, []);
});

test('a branch that is not the main branch tip is reported, not forced', () => {
  const notes = S.cleanupAfterLanding({
    branch: 'b', worktree: '/w',
    dirtyFiles: () => [],
    removeWorktree: () => true,
    deleteBranch: () => false,
    provenMerged: () => false,
    unsetUpstream: () => true,
  });
  assert.match(notes[0], /refused 'branch -d b' and it is not the main branch's tip/);
});

test('the recorded exit wins over liveness in both directions', () => {
  // A finished run whose pid has been recycled onto another process must not read as alive, and one
  // that recorded its code microseconds before dying must not read as vanished.
  const run = { branch: 'b', pid: 5, startedAt: 100, log: '/l', exit: 11, endedAt: 160 };
  assert.deepEqual(S.runVerdict({ run, alive: true, nowSec: 900 }),
    { state: 'finished', exit: 11, elapsed: 60 });
  assert.deepEqual(S.runVerdict({ run: { ...run, exit: null, endedAt: null }, alive: false, nowSec: 200 }),
    { state: 'vanished', exit: S.EXIT.vanished, elapsed: 100 });
  assert.deepEqual(S.runVerdict({ run: { ...run, exit: null, endedAt: null }, alive: true, nowSec: 200 }),
    { state: 'running', exit: S.EXIT.busy, elapsed: 100 });
  assert.deepEqual(S.runVerdict({ run: null, alive: false, nowSec: 1 }),
    { state: 'unknown', exit: S.EXIT.usage });
  assert.equal(S.parseRun('{ broken'), null);
  assert.equal(S.parseRun('{"pid":1}'), null);
});

test('a run file is named so a human can recognise the branch in an ls', () => {
  assert.equal(S.runSlug('feat/a b'), 'feat_a_b');
  assert.equal(S.runSlug('demo/d1-first'), 'demo_d1-first');
});

// Fix round 1, Finding 1: the seed `detach` writes BEFORE the fork has `pid: null` — the sliver
// between that write and the one that stamps the child's real pid. Without this case, `alive(null)`
// (computed by the caller, not this function) is false, so a seed fell into the `!alive` branch
// below and read as `vanished` — a landing that had not even spawned yet was reported as killed.
test("a pre-fork seed (pid null) reads as running, whatever liveness the caller computed for it", () => {
  const seed = { branch: 'b', pid: null, startedAt: 100, log: '/l', exit: null, endedAt: null };
  // The caller cannot get a true liveness answer for a pid that does not exist yet — `alive(null)`
  // throws and is caught as `false` — so this asserts the decision holds even if a caller somehow
  // passed `true`: the pid check must come before `alive` is consulted at all, not merely produce
  // the same answer as `!alive` would have.
  assert.deepEqual(S.runVerdict({ run: seed, alive: false, nowSec: 100 }),
    { state: 'running', exit: S.EXIT.busy, elapsed: 0 });
  assert.deepEqual(S.runVerdict({ run: seed, alive: true, nowSec: 100 }),
    { state: 'running', exit: S.EXIT.busy, elapsed: 0 });
  // A real, dead pid is unaffected: `vanished` still fires exactly as it did before this fix.
  const real = { ...seed, pid: 5 };
  assert.deepEqual(S.runVerdict({ run: real, alive: false, nowSec: 100 }),
    { state: 'vanished', exit: S.EXIT.vanished, elapsed: 0 });
});

// Fix round 1, rider: `ownsRun` moved here from lib/gate/run.mjs, where it was a pure decision
// sitting in an effects file. Three cases, no race: the pre-fork sliver (pid null), the caller's own
// claim, and a claim already held by somebody else.
test('ownsRun: a null pid is claimable by anyone, a set pid only by itself', () => {
  assert.equal(S.ownsRun({ pid: null }, 123), true);
  assert.equal(S.ownsRun({ pid: 123 }, 123), true);
  assert.equal(S.ownsRun({ pid: 999 }, 123), false);
  assert.equal(S.ownsRun(null, 123), false);
});

// Branch review, cost of Ruling 8: reading every null-pid record as `running` FOREVER traded a
// self-healing coincidence for a permanent wedge. If the parent dies between the seed write and the
// pid stamp, the record must eventually stop reading as `running` with no liveness check possible —
// or `land --detach` is blocked for that branch until a human deletes the run file by hand.
test('a pre-fork seed within the grace still reads as running; past it, it reads as vanished again', () => {
  const seed = { branch: 'b', pid: null, startedAt: 100, log: '/l', exit: null, endedAt: null };
  // One tick under the grace: unaffected by this fix, exactly like the sliver test above.
  assert.deepEqual(
    S.runVerdict({ run: seed, alive: false, nowSec: 100 + S.PRE_FORK_GRACE_SEC - 1 }),
    { state: 'running', exit: S.EXIT.busy, elapsed: S.PRE_FORK_GRACE_SEC - 1 },
  );
  // At the grace: the parent has had three orders of margin over an ordinary spawn (milliseconds)
  // to stamp a real pid. A seed still unstamped at this age almost certainly means the parent died
  // in between, so this reads as `vanished` again — as it did before Ruling 8 — rather than wedging
  // `land --detach` on this branch forever.
  assert.deepEqual(
    S.runVerdict({ run: seed, alive: false, nowSec: 100 + S.PRE_FORK_GRACE_SEC }),
    { state: 'vanished', exit: S.EXIT.vanished, elapsed: S.PRE_FORK_GRACE_SEC },
  );
  // Liveness is irrelevant either side of the grace: a pid that does not exist yet has no honest
  // liveness answer, so this must not depend on what the caller happened to pass for `alive`.
  assert.equal(
    S.runVerdict({ run: seed, alive: true, nowSec: 100 + S.PRE_FORK_GRACE_SEC }).state, 'vanished',
  );
});

test('the main branch is rebased onto its upstream only when the upstream really moved', () => {
  // The upstream's ABSENCE is the off switch: a project whose main branch tracks nothing never
  // reaches a fetch, which is what leaves a repository with no remote exactly as it was.
  assert.equal(S.syncMainDecision({ upstream: null, behind: 3, dirty: false }), 'skip');
  // Not behind is the ordinary case during a run, and it must cost nothing and change nothing —
  // including when the main checkout is dirty, which the landing has always tolerated.
  assert.equal(S.syncMainDecision({ upstream: 'origin/main', behind: 0, dirty: true }), 'skip');
  assert.equal(S.syncMainDecision({ upstream: 'origin/main', behind: 2, dirty: false }), 'rebase');
  // A rebase needs a clean tree. Refusing is the narrowing this sync knowingly costs: it happens
  // only when the upstream moved, and the message has to name the fix.
  assert.equal(S.syncMainDecision({ upstream: 'origin/main', behind: 2, dirty: true }), 'refuse');
});

// LP6, 2026-09-08 in duckJam: the gate merged LP2, its process died before releasing, and LP6 sat
// `queued` for two hours with nothing naming it. `held` and `blocked` are the record doing its job
// and must never be reported this way — they are waiting for a person, on purpose.
test('a queued or landing entry with no live process is a stall; a held or blocked one is not', () => {
  const entries = [
    { branch: 'a/queued-alone', state: 'queued' },
    { branch: 'b/landing-dead', state: 'landing' },
    { branch: 'c/queued-waiting', state: 'queued' },
    { branch: 'd/held', state: 'held' },
    { branch: 'e/blocked', state: 'blocked' },
    { branch: 'f/landing-live', state: 'landing' },
  ];
  const holder = { pid: 10, branch: 'f/landing-live', epoch: 1 };
  const waiters = [{ pid: 11, branch: 'c/queued-waiting', epoch: 2 }];
  assert.deepEqual(S.stalledEntries({ entries, holder, waiters }).map((e) => e.branch),
    ['a/queued-alone', 'b/landing-dead']);
  // No holder and no waiters at all: every queued or landing entry is a stall.
  assert.deepEqual(S.stalledEntries({ entries, holder: null, waiters: [] }).map((e) => e.branch),
    ['a/queued-alone', 'b/landing-dead', 'c/queued-waiting', 'f/landing-live']);
});
