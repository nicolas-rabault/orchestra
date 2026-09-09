// `hooks/guard-draft.mjs` run as a real process. `test/guards-draft.test.mjs` covers the pure
// decision (`draftAdds`); this covers the wiring — reading `cfg.roadmaps.drafts`, the off switch,
// and the refusal's wording.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers/fixture.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'guard-bash.mjs');

const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

function runHook(payload) {
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });
}

const bashPayload = (cwd, command) => ({ cwd, tool_input: { command } });

test('staging a draft (default drafts dir) is REFUSED', () => {
  const r = repo();
  const res = runHook(bashPayload(r.root, 'git add .orchestra/drafts/foo.md'));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /\.orchestra\/drafts/);
  assert.match(res.stderr, /orchestra roadmap publish/);
});

test('a project with a configured drafts dir is refused on THAT path', () => {
  const r = repo({ config: { roadmaps: { drafts: 'docs/local', published: 'docs/roadmaps' } } });
  const res = runHook(bashPayload(r.root, 'git add docs/local/x.md'));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /docs\/local/);
});

test('-f changes nothing: still refused', () => {
  const r = repo();
  const res = runHook(bashPayload(r.root, 'git add -f .orchestra/drafts/foo.md'));
  assert.equal(res.status, 2);
});

test('adding an unrelated file is ALLOWED', () => {
  const r = repo();
  const res = runHook(bashPayload(r.root, 'git add src/index.js'));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

test('git add -A is not caught (documented limitation) — ALLOWED', () => {
  const r = repo();
  const res = runHook(bashPayload(r.root, 'git add -A'));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

test('no config: silent and exit 0', () => {
  const res = runHook(bashPayload('/', 'git add .orchestra/drafts/foo.md'));
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, '');
});
