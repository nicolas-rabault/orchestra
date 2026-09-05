// `bareSuiteRun` is `guard-full-suite`'s pure decision: is this segment a run of the project's own
// `suite` gate with NOTHING narrowing it? Unlike the source project (planetCraft), which guessed at
// a runner from a fixed table (`npm test`, `npm t`, `vitest`) because its suite command never
// varied, this plugin is TOLD the suite command (`cfg.gates.find(g => g.name === 'suite').cmd`), so
// the match is exact — a token-for-token prefix, not a regex guess.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bareSuiteRun } from '../lib/guards/suite.mjs';

test('a bare run of the exact suite command is blocked', () => {
  assert.equal(bareSuiteRun('npm test', 'npm test'), 'npm test');
});

test('a multi-word suite command matches token-for-token', () => {
  assert.equal(bareSuiteRun('npm run test', 'npm run test'), 'npm run test');
});

test('a sibling script is not the suite command, even sharing a prefix', () => {
  // "npm run test:branch" must never be caught by a suite command of "npm run test" — a naive
  // string-prefix check (rather than a token-for-token one) would get this wrong.
  assert.equal(bareSuiteRun('npm run test:branch', 'npm run test'), null);
});

test('a narrowing file path lets the run through', () => {
  assert.equal(bareSuiteRun('npm test tests/foo.test.js', 'npm test'), null);
});

test('a narrowing -t pattern lets the run through', () => {
  assert.equal(bareSuiteRun("npm test -t 'name'", 'npm test'), null);
});

test('a narrowing --changed flag lets the run through', () => {
  assert.equal(bareSuiteRun('npm test --changed main', 'npm test'), null);
});

test('report-shaping noise flags do not count as narrowing', () => {
  assert.equal(bareSuiteRun('npm test --silent --reporter=dot --no-color', 'npm test'), 'npm test --silent --reporter=dot --no-color');
});

test('a bare "--" separator with nothing after it is noise, not narrowing', () => {
  assert.equal(bareSuiteRun('npm test --', 'npm test'), 'npm test --');
});

test('"--" followed by a real argument narrows the run', () => {
  assert.equal(bareSuiteRun('npm test -- tests/foo.test.js', 'npm test'), null);
});

test('a leading env assignment does not hide the bare run', () => {
  assert.equal(bareSuiteRun('CI=1 npm test', 'npm test'), 'CI=1 npm test');
});

test('ORCHESTRA_FULL_SUITE=1 on the segment is the override', () => {
  assert.equal(bareSuiteRun('ORCHESTRA_FULL_SUITE=1 npm test', 'npm test'), null);
});

test('only the bare segment in a chained command is blocked', () => {
  assert.equal(
    bareSuiteRun('npm test -- tests/foo.test.js && npm test', 'npm test'),
    'npm test',
  );
});

test('no gate cmd (empty or missing) never blocks anything', () => {
  assert.equal(bareSuiteRun('npm test', ''), null);
  assert.equal(bareSuiteRun('npm test', null), null);
  assert.equal(bareSuiteRun('npm test', undefined), null);
});

test('a command that never mentions the suite command at all is untouched', () => {
  assert.equal(bareSuiteRun('git status', 'npm test'), null);
});

// A configured `suite` cmd carrying its OWN leading env assignment (e.g. `{ name: 'suite', cmd:
// 'CI=1 npm test' }`) must not disarm the guard. `stripEnv` was applied to the CHECKED command but
// not to `suiteCmd` itself, so the two token lists could never become equal again once `suiteCmd`
// carried a prefix — a silently-disarmed guard, the worst failure shape a guard has, since it reads
// exactly like a working one in the config and in `doctor`. Both sides must go through the same
// normalisation.
test('a suite cmd with its own leading env assignment still blocks a bare run of it', () => {
  assert.equal(bareSuiteRun('CI=1 npm test', 'CI=1 npm test'), 'CI=1 npm test');
});

test('a suite cmd with a leading env assignment blocks a bare run under a DIFFERENT env prefix too', () => {
  // stripEnv strips ANY leading assignment, not just a matching one — the configured cmd's own
  // prefix is not part of the identity being matched, only what command it actually runs.
  assert.equal(bareSuiteRun('FOO=2 npm test', 'CI=1 npm test'), 'FOO=2 npm test');
});

test('a suite cmd with a leading env assignment still lets a narrowed run through', () => {
  assert.equal(bareSuiteRun('FOO=2 npm test -- tests/foo.test.js', 'CI=1 npm test'), null);
});
