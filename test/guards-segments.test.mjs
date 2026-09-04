// The shell-splitting rule every command guard shares (task 3's brief, and P5's `segments.mjs`
// header): where one shell command ends and the next begins, and how to read a leading
// `NAME=value` assignment off the front of one without the rest of the guard doing string work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segments, stripEnv, envAssigned } from '../lib/guards/segments.mjs';

test('segments splits on ; && || and |', () => {
  assert.deepEqual(segments('a; b && c || d | e'), ['a', 'b', 'c', 'd', 'e']);
});

test('segments splits on a bare newline', () => {
  assert.deepEqual(segments('git status\ngit log'), ['git status', 'git log']);
});

test('segments drops empty segments from doubled separators and trims each one', () => {
  assert.deepEqual(segments('git status;;   ;  git log  '), ['git status', 'git log']);
});

// The paragraph this module pays for itself with: a backslash-newline is a shell line
// CONTINUATION, not a command boundary. A plain `\n` split would cut `git -C <path> \` and
// `commit -m x` into two segments that neither one alone matches — silently letting a
// main-checkout commit through.
test('a backslash-newline continuation is ONE segment, not two', () => {
  const command = 'git -C /tmp/repo \\\n  commit -m x';
  // Expressed as string surgery independent of segments' own regex, so this is a real check that
  // ONLY the backslash+newline pair disappears — not a restatement of the implementation.
  const expectedJoined = command.replace('\\\n', '').trim();
  assert.deepEqual(segments(command), [expectedJoined]);
});

// The shell removes the backslash and the newline TOGETHER, as one unit — joining with nothing,
// not a space. A join that inserted a space here would turn a word split mid-token into two
// tokens, which is a different (and wrong) command.
test('the backslash-newline join inserts nothing, not a space', () => {
  assert.deepEqual(segments('wor\\\nktree'), ['worktree']);
});

test('a command with no continuation and no separator is one segment', () => {
  assert.deepEqual(segments('git commit -m x'), ['git commit -m x']);
});

test('stripEnv removes one leading NAME=value assignment', () => {
  assert.equal(stripEnv('ORCHESTRA_GATE=1 git commit -m x'), 'git commit -m x');
});

test('stripEnv removes several leading assignments in order', () => {
  assert.equal(stripEnv('FOO=1 BAR=2 git commit -m x'), 'git commit -m x');
});

test('stripEnv leaves a command with no leading assignment untouched', () => {
  assert.equal(stripEnv('git commit -m x'), 'git commit -m x');
});

test('stripEnv does not strip past the command word', () => {
  // "x=1" here is an argument, not a leading assignment — there is no command word before it.
  assert.equal(stripEnv('git commit -m x=1'), 'git commit -m x=1');
});

test('envAssigned finds a leading ORCHESTRA_GATE=1 assignment', () => {
  assert.equal(envAssigned('ORCHESTRA_GATE=1 git commit -m x', 'ORCHESTRA_GATE'), true);
});

test('envAssigned finds it among several leading assignments, in any position', () => {
  assert.equal(envAssigned('FOO=1 ORCHESTRA_GATE=1 BAR=2 git commit', 'ORCHESTRA_GATE'), true);
});

test('envAssigned is false when the name is not assigned at all', () => {
  assert.equal(envAssigned('FOO=1 git commit -m x', 'ORCHESTRA_GATE'), false);
});

test('envAssigned is false when the value is not exactly "1"', () => {
  assert.equal(envAssigned('ORCHESTRA_GATE=0 git commit', 'ORCHESTRA_GATE'), false);
  assert.equal(envAssigned('ORCHESTRA_GATE=true git commit', 'ORCHESTRA_GATE'), false);
});

test('envAssigned does not match the name appearing after the command word', () => {
  // Only LEADING assignments count — an argument that happens to look like one is not an override.
  assert.equal(envAssigned('git commit -m ORCHESTRA_GATE=1', 'ORCHESTRA_GATE'), false);
});
