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
