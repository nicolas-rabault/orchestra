import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoadmap } from '../lib/roadmap/parse.mjs';
import { lintRoadmap, STATUS_FIELDS } from '../lib/roadmap/lint.mjs';
import { ROADMAP } from './helpers/fixture.mjs';

const lint = (text, opts = {}) =>
  lintRoadmap(parseRoadmap(text, { source: 'demo.md' }), { source: 'demo.md', ...opts });

test('the fixture roadmap is clean', () => {
  assert.deepEqual(lint(ROADMAP), []);
});

test('a status field is refused by name, with the reason', () => {
  const v = lint(ROADMAP.replace('- **Lane** —', '- **Landed** yes'));
  assert.equal(v.length, 2); // the status field itself, plus the now-missing Lane
  assert.ok(v.some((x) => /"Landed" is a status field, and status is derived/.test(x.message)));
  assert.ok(STATUS_FIELDS.includes('Landed'));
});

test('a missing roadmap: frontmatter is refused, because publish cannot survive it', () => {
  const v = lint(ROADMAP.replace('---\nroadmap: demo\n---\n', ''));
  assert.ok(v.some((x) => /no `roadmap:` in the frontmatter/.test(x.message)));
});

test('a branch whose last segment does not name its task is refused', () => {
  const v = lint(ROADMAP.replace('demo/d1-first-thing', 'demo/something-else'));
  assert.ok(v.some((x) => /must start with "d1-"/.test(x.message)));
});

test('a bare dep that resolves to nothing is an error; a qualified one is only a warning', () => {
  const bare = lint(ROADMAP.replace('- **Deps** —', '- **Deps** D9'));
  assert.equal(bare.find((x) => /dep "D9"/.test(x.message)).level, 'error');
  const qualified = lint(ROADMAP.replace('- **Deps** —', '- **Deps** other/D9'));
  assert.equal(qualified.find((x) => /dep "other\/D9"/.test(x.message)).level, 'warning');
});

test('Touches naming a file that does not exist is refused', () => {
  const v = lint(ROADMAP, { fileExists: () => false });
  assert.ok(v.some((x) => /Touches "README.md" does not exist/.test(x.message)));
});

test('a key already taken by ANOTHER file is refused', () => {
  const v = lint(ROADMAP, { knownKeys: new Set(['demo/D1']) });
  assert.ok(v.some((x) => /key "demo\/D1" is already taken/.test(x.message)));
});

test('a task with no Why or no Acceptance is refused', () => {
  const v = lint(ROADMAP.replace('**Why.** The player sees the first thing.\n\n', ''));
  assert.ok(v.some((x) => /no paragraph beginning "\*\*Why/.test(x.message)));
});
