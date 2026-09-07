// `rollup` decides `ci`, and `ci-fail` is the group the sweep checks FIRST — it outranks every
// other, a merge the maintainer was waiting to click included. Until this file only its `pass`
// branch had ever been reached, indirectly, through the scan command's own test.
//
// The payloads below are `gh pr list --json statusCheckRollup`'s two real element shapes. A GitHub
// Actions check is a `CheckRun` carrying `status` + `conclusion`; a third-party reporter is a
// `StatusContext` carrying `state` and no conclusion at all. `rollup` reads `conclusion || state`,
// which is why both have to be here: a rollup tested only on one of them proves nothing about the
// other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollup } from '../lib/pr/gh.mjs';

const checkRun = (over = {}) => ({
  __typename: 'CheckRun',
  name: 'test',
  workflowName: 'CI',
  status: 'COMPLETED',
  conclusion: 'SUCCESS',
  startedAt: '2026-09-07T10:00:00Z',
  completedAt: '2026-09-07T10:04:00Z',
  detailsUrl: 'https://github.com/o/r/actions/runs/1',
  ...over,
});

const statusContext = (over = {}) => ({
  __typename: 'StatusContext',
  context: 'ci/circleci',
  state: 'SUCCESS',
  targetUrl: 'https://circleci.com/gh/o/r/1',
  startedAt: '2026-09-07T10:00:00Z',
  ...over,
});

// The exact shape of a check still running: `status` is IN_PROGRESS and `conclusion` is the EMPTY
// STRING, never absent. `rollup` never reads `status` — the empty conclusion is the whole signal,
// which is why `''` is in its pending list and why removing it would silently make a running check
// read as green.
test('a check still running is pending, not green', () => {
  assert.equal(rollup([checkRun({ status: 'IN_PROGRESS', conclusion: '' })]), 'pending');
  assert.equal(rollup([checkRun(), checkRun({ status: 'QUEUED', conclusion: '' })]), 'pending');
});

test('a third-party StatusContext reporting FAILURE is a fail, with no conclusion field anywhere', () => {
  const payload = [statusContext({ state: 'FAILURE' })];
  assert.equal(Object.hasOwn(payload[0], 'conclusion'), false, 'a StatusContext has no conclusion');
  assert.equal(rollup(payload), 'fail');
});

// Failure is checked before pending, deliberately: a suite that has already failed does not become
// undecided because a second job is still running.
test('one failure outranks everything else in the rollup', () => {
  assert.equal(rollup([checkRun(), checkRun({ conclusion: 'TIMED_OUT' }), checkRun({ status: 'IN_PROGRESS', conclusion: '' })]), 'fail');
  assert.equal(rollup([statusContext(), checkRun({ conclusion: 'CANCELLED' })]), 'fail');
});

// `none` is a PR with no checks configured at all, and the sweep's own table says it is not the
// same claim as green. `gh` omits the field entirely on such a PR, so both spellings arrive here.
test('no checks at all is none, whether the field is empty or absent', () => {
  assert.equal(rollup([]), 'none');
  assert.equal(rollup(undefined), 'none');
  assert.equal(rollup(null), 'none');
});

test('every check that reported having passed is a pass, across both shapes', () => {
  assert.equal(rollup([checkRun(), statusContext()]), 'pass');
});

// The current mapping, pinned so that changing it is a decision somebody takes rather than a side
// effect. NEUTRAL and SKIPPED reading as green is right: neither is a failure and neither is
// outstanding. ACTION_REQUIRED is the one worth an argument — it is GitHub asking a human to do
// something before the check can conclude — and it is flagged rather than changed here, because
// `ci-fail` is the group that outranks every other and moving a conclusion into it changes what a
// sweep puts in front of the maintainer first.
test('ACTION_REQUIRED, NEUTRAL and SKIPPED all read as pass today', () => {
  assert.equal(rollup([checkRun({ conclusion: 'NEUTRAL' })]), 'pass');
  assert.equal(rollup([checkRun({ conclusion: 'SKIPPED' })]), 'pass');
  assert.equal(rollup([checkRun({ conclusion: 'ACTION_REQUIRED' })]), 'pass');
});
