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
  });
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
    hasUncommittedTracked: () => false,
    untrackedFiles: () => ['scratch.txt'],
    removeWorktree: () => { calls.push('rm'); return false; },
    deleteBranch: () => { calls.push('del'); return true; },
    provenMerged: () => true,
    unsetUpstream: () => true,
  });
  assert.deepEqual(calls, ['rm', 'del']);
  assert.match(notes[0], /worktree \/w kept .*scratch\.txt/);
});

test('a pinned upstream is proven past, never forced past', () => {
  // The gate rebases, which re-hashes every commit, so `git branch -d` refuses a branch that IS the
  // main branch, testing it against its UPSTREAM instead of HEAD. The answer is not -D: it is to
  // prove what -D would assume, then ask the same lowercase -d again.
  const calls = [];
  let unpinned = false;
  const notes = S.cleanupAfterLanding({
    branch: 'b', worktree: '/w',
    hasUncommittedTracked: () => false,
    untrackedFiles: () => [],
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
    hasUncommittedTracked: () => false,
    untrackedFiles: () => [],
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
