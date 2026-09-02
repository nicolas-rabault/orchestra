import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { makeRepo, ROADMAP } from './helpers/fixture.mjs';
import { loadConfig } from '../lib/config.mjs';
import { makeStore } from '../lib/store/index.mjs';

const repos = [];
function offline() {
  const r = makeRepo({ mode: 'offline' });
  repos.push(r);
  const cfg = loadConfig(r.root);
  return { r, cfg, store: makeStore(cfg) };
}
after(() => repos.forEach((x) => x.cleanup()));

const draft = ({ r, cfg }, text = ROADMAP, slug = 'demo') => {
  const dir = join(r.root, cfg.roadmaps.drafts);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${slug}.md`);
  writeFileSync(p, text);
  return p;
};

test('with nothing published, list and programmes are empty', () => {
  const { store } = offline();
  assert.deepEqual(store.list(), []);
  assert.deepEqual(store.programmes(), []);
});

test('drafts are visible and are NOT tasks', () => {
  const ctx = offline();
  draft(ctx);
  assert.deepEqual(ctx.store.drafts().map((d) => d.slug), ['demo']);
  assert.deepEqual(ctx.store.list(), []);
});

test('publish moves the draft, commits it, and makes its tasks visible', () => {
  const ctx = offline();
  const p = draft(ctx);
  const res = ctx.store.publish(p);
  assert.equal(res.slug, 'demo');
  assert.deepEqual(res.keys, ['demo/D1']);

  const published = join(ctx.r.root, ctx.cfg.roadmaps.published, 'demo.md');
  assert.ok(existsSync(published));
  assert.equal(readFileSync(published, 'utf8'), ROADMAP);
  assert.ok(!existsSync(p), 'the draft is gone');

  const log = execFileSync('git', ['log', '--oneline', '-1'], { cwd: ctx.r.root, encoding: 'utf8' });
  assert.match(log, /roadmap: publish demo/);

  const tracked = execFileSync('git', ['ls-files', ctx.cfg.roadmaps.published], { cwd: ctx.r.root, encoding: 'utf8' });
  assert.match(tracked, /demo\.md/);

  assert.deepEqual(ctx.store.list().map((t) => t.key), ['demo/D1']);
  assert.deepEqual(ctx.store.programmes().map((p2) => p2.slug), ['demo']);
});

test('publish refuses a draft that does not lint, and moves nothing', () => {
  const ctx = offline();
  const p = draft(ctx, ROADMAP.replace('- **Lane** —', '- **Landed** yes'));
  assert.throws(() => ctx.store.publish(p), /status field|missing required field/);
  assert.ok(existsSync(p), 'the draft is still there');
  assert.ok(!existsSync(join(ctx.r.root, ctx.cfg.roadmaps.published, 'demo.md')));
});

test('republishing the same slug updates the file in place', () => {
  const ctx = offline();
  ctx.store.publish(draft(ctx));
  const second = ROADMAP.replace('First thing', 'First thing, revised');
  ctx.store.publish(draft(ctx, second));
  assert.equal(ctx.store.list()[0].title, 'First thing, revised');
});

test('everything is mine, everything is open, and the commands that cannot apply say why', () => {
  const ctx = offline();
  ctx.store.publish(draft(ctx));
  const [p] = ctx.store.programmes();
  assert.equal(p.open, true);
  assert.equal(p.owner, ctx.store.whoami());
  assert.equal(ctx.store.openRoadmap('demo').noop, true);
  assert.match(ctx.store.reserve('demo').why, /one machine/i);
  assert.equal(ctx.store.setStatus('demo/D1', 'landed').noop, true);
  assert.equal(ctx.store.close('demo/D1', { subject: 'x' }).noop, true);
  assert.equal(ctx.store.claim('demo/D1', 'me').ok, true);
});

test('the overlay is EMPTY offline — the board derives from git and the register alone', () => {
  const ctx = offline();
  ctx.store.publish(draft(ctx));
  assert.equal(ctx.store.overlay().size, 0);
});
