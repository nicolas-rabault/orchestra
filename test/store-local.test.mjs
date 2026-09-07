// The local destination: a roadmap that is PUBLISHED — enrolled, scheduled, on the board — and that
// no other machine can see. Offline mode publishes exactly there already; what needs proving is
// that an ONLINE project reaches the same store when a roadmap asks for it, without a `gh` in
// sight.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, PR_ROADMAP } from './helpers/fixture.mjs';
import { loadConfig } from '../lib/config.mjs';
import { makeStore } from '../lib/store/index.mjs';

const repos = [];
after(() => repos.forEach((r) => r.cleanup()));

function project(mode = 'offline') {
  const r = makeRepo({ mode });
  repos.push(r);
  const cfg = loadConfig(r.root);
  mkdirSync(join(r.root, cfg.roadmaps.drafts), { recursive: true });
  return { r, cfg };
}

const draft = (cfg, r, text) => {
  const p = join(r.root, cfg.roadmaps.drafts, 'pr.md');
  writeFileSync(p, text);
  return p;
};

test('online mode reaches the file store for a local destination, and commits nothing', () => {
  const { r, cfg } = project('online');
  // No gh adapter was injected and none is needed: the destination decided the backend before the
  // mode did.
  const store = makeStore(cfg, {}, { destination: 'local' });
  const before = r.git('rev-parse', 'HEAD').trim();

  const res = store.publish(draft(cfg, r, PR_ROADMAP));

  assert.equal(res.slug, 'pr');
  assert.deepEqual(store.list().map((t) => t.key), ['pr/PR91']);
  assert.ok(existsSync(join(r.root, cfg.roadmaps.published, 'pr.md')));
  // The draft is consumed exactly as it is for any other publish.
  assert.ok(!existsSync(join(r.root, cfg.roadmaps.drafts, 'pr.md')));
  assert.equal(r.git('rev-parse', 'HEAD').trim(), before);
  // And nothing is left staged, either: a local publish must not smuggle a file into somebody
  // else's next commit.
  assert.equal(r.git('diff', '--cached', '--name-only').trim(), '');
});

test('offline, the local destination and the mode are the same store', () => {
  const { r, cfg } = project();
  makeStore(cfg, {}, { destination: 'local' }).publish(draft(cfg, r, PR_ROADMAP));
  // One directory, one store: the sweep roadmap is one more file beside the development ones,
  // which is why `board` must not ask both (Task 4).
  assert.deepEqual(makeStore(cfg).list().map((t) => t.key), ['pr/PR91']);
});

test('a republish rewrites in place and keeps the keys', () => {
  const { r, cfg } = project();
  makeStore(cfg, {}, { destination: 'local' }).publish(draft(cfg, r, PR_ROADMAP));
  const again = PR_ROADMAP.replace('Dependabot, green CI', 'Dependabot, green CI, rebased');
  const res = makeStore(cfg, {}, { destination: 'local' }).publish(draft(cfg, r, again));

  assert.deepEqual(res.keys, ['pr/PR91']);
  const text = readFileSync(join(r.root, cfg.roadmaps.published, 'pr.md'), 'utf8');
  assert.match(text, /green CI, rebased/);
  // One file, never a sibling: the sweep rewrites this roadmap every time it runs.
  assert.deepEqual(readdirSync(join(r.root, cfg.roadmaps.published)), ['pr.md']);
});
