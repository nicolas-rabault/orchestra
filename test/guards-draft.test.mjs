// `draftAdds` is `guard-draft`'s pure decision: does this `git add` NAME a path under the project's
// drafts directory? No `-f` requirement, unlike the source project's `guard-local-roadmap.mjs`
// (planetCraft), which only had to catch the gitignore bypass — the drafts directory here is only
// hidden from git once `orchestra init` has run (online, in `.orchestra/.gitignore`; offline, in
// this clone's own `info/exclude`, never committed), so a project that has not run `init`, or has
// since edited its own exclusion, has no such floor and an ordinary `git add` must be caught too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftAdds } from '../lib/guards/draft.mjs';

const DRAFTS = '.orchestra/drafts';

test('git add of a file under the drafts directory is blocked', () => {
  assert.equal(draftAdds('git add .orchestra/drafts/foo.md', DRAFTS), 'git add .orchestra/drafts/foo.md');
});

test('no -f is required — an ordinary add is blocked just the same', () => {
  assert.equal(draftAdds('git add .orchestra/drafts/foo.md', DRAFTS), 'git add .orchestra/drafts/foo.md');
});

test('-f changes nothing: still blocked', () => {
  assert.equal(draftAdds('git add -f .orchestra/drafts/foo.md', DRAFTS), 'git add -f .orchestra/drafts/foo.md');
});

test('adding the drafts directory itself is blocked', () => {
  assert.equal(draftAdds('git add .orchestra/drafts', DRAFTS), 'git add .orchestra/drafts');
});

test('a quoted path is recognised the same way', () => {
  assert.equal(draftAdds('git add ".orchestra/drafts/foo.md"', DRAFTS), 'git add ".orchestra/drafts/foo.md"');
});

test('a sibling directory sharing a prefix is not caught', () => {
  // ".orchestra/drafts-archive/x.md" must not match a drafts dir of ".orchestra/drafts".
  assert.equal(draftAdds('git add .orchestra/drafts-archive/x.md', DRAFTS), null);
});

test('an unrelated path is not blocked', () => {
  assert.equal(draftAdds('git add src/index.js', DRAFTS), null);
});

test('git add -A sweeps a draft without naming it — this guard cannot catch that', () => {
  assert.equal(draftAdds('git add -A', DRAFTS), null);
});

test('git add . cannot be resolved to a drafts path either', () => {
  assert.equal(draftAdds('git add .', DRAFTS), null);
});

test('a git command that is not "add" is ignored, even mentioning the drafts path', () => {
  assert.equal(draftAdds('git commit -m "edit .orchestra/drafts/foo.md"', DRAFTS), null);
});

test('git -C <dir> add <path> is still recognised', () => {
  assert.equal(
    draftAdds('git -C /repo add .orchestra/drafts/foo.md', DRAFTS),
    'git -C /repo add .orchestra/drafts/foo.md',
  );
});

test('only the offending segment in a chained command is returned', () => {
  assert.equal(
    draftAdds('git add safe.md && git add .orchestra/drafts/x.md', DRAFTS),
    'git add .orchestra/drafts/x.md',
  );
});

test('a project with a different drafts directory is matched on that directory', () => {
  assert.equal(draftAdds('git add docs/local/x.md', 'docs/local'), 'git add docs/local/x.md');
  assert.equal(draftAdds('git add docs/local-extra/x.md', 'docs/local'), null);
});

test('no drafts directory configured never blocks anything', () => {
  assert.equal(draftAdds('git add .orchestra/drafts/foo.md', null), null);
  assert.equal(draftAdds('git add .orchestra/drafts/foo.md', ''), null);
});
