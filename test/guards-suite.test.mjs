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
