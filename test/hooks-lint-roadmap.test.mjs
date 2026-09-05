// `hooks/lint-roadmap.mjs` run as a real process. It refuses nothing, but a non-zero exit feeds
// its stderr back to the model as a correction — the mechanism that gets a malformed roadmap
// fixed. Not named in the task's own file list, but written anyway: the frontmatter test's
// boundedness (a body line beginning "roadmap:" must NOT classify a document as a roadmap) is
// exactly the kind of regex trap that reads as correct until it is actually run.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  writeFileSync, mkdirSync, mkdtempSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo, ROADMAP } from './helpers/fixture.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'lint-roadmap.mjs');

const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

function runHook(payload) {
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });
}

const editPayload = (cwd, filePath) => ({ cwd, tool_input: { file_path: filePath } });

function write(root, relPath, text) {
  const p = join(root, relPath);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return p;
}

test('a well-formed roadmap under the drafts directory reports nothing', () => {
  const r = repo();
  const p = write(r.root, '.orchestra/drafts/demo.md', ROADMAP);
  const res = runHook(editPayload(r.root, p));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

test('a malformed roadmap under drafts is REPORTED (non-zero exit, violations on stderr)', () => {
  const r = repo();
  const broken = ROADMAP.replace('- **Roadmap** demo\n', ''); // drop a required field
  const p = write(r.root, '.orchestra/drafts/demo.md', broken);
  const res = runHook(editPayload(r.root, p));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /does not match the format/);
  assert.match(res.stderr, /Roadmap/);
});

test('a .md file OUTSIDE drafts/published that declares `roadmap:` in its frontmatter is still checked', () => {
  // Deliberately MALFORMED: a well-formed fixture here could not tell "classified and linted
  // clean" apart from "never classified at all" — both read as exit 0 with empty stderr. Dropping
  // a required field means only correct classification (via the frontmatter, since this path is
  // outside drafts/published) AND linting together produce the refusal this test checks for.
  const r = repo();
  const broken = ROADMAP.replace('- **Roadmap** demo\n', '');
  const p = write(r.root, 'somewhere/unexpected.md', broken);
  const res = runHook(editPayload(r.root, p));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /does not match the format/);
  assert.match(res.stderr, /Roadmap/);
});

test('a document merely DISCUSSING roadmaps in its body, with no frontmatter, is NOT classified as one', () => {
  const r = repo();
  const text = '# Notes\n\nThis document explains that a task line has a `roadmap: <slug>` field.\n';
  const p = write(r.root, 'somewhere/notes.md', text);
  const res = runHook(editPayload(r.root, p));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

test('a body line beginning "roadmap:" AFTER a closing --- is not mistaken for frontmatter', () => {
  // The exact trap the header warns about: this document's OWN frontmatter (between the two `---`
  // lines) is `title: plan`, with no `roadmap:` key — but its body, further down, happens to start
  // a line with the literal text "roadmap:" (a task field, being discussed, not declared). An
  // UNBOUNDED search would scan straight past the closing `---` and find that line anyway, wrongly
  // classifying a document that merely discusses the system as a roadmap itself.
  const r = repo();
  const text = '---\ntitle: plan\n---\n\nA task field looks like this:\nroadmap: demo\n';
  const p = write(r.root, 'somewhere/plan.md', text);
  const res = runHook(editPayload(r.root, p));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

test('a non-.md file is ignored', () => {
  const r = repo();
  const p = write(r.root, 'src/index.js', 'export const x = 1;\n');
  const res = runHook(editPayload(r.root, p));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

test('no config: silent and exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orchestra-lint-noconfig-'));
  try {
    const p = write(dir, 'x.md', '# x\n');
    const res = runHook(editPayload('/', p));
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
    assert.equal(res.stderr, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
