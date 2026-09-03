import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, ROADMAP } from './helpers/fixture.mjs';
import { loadConfig } from '../lib/config.mjs';
import { makeStore } from '../lib/store/index.mjs';
import { LABELS, taskTitle } from '../lib/store/github/issues.mjs';
import { parseRoadmap } from '../lib/roadmap/parse.mjs';

const repos = [];
const task = parseRoadmap(ROADMAP).tasks[0];

// A recorder in place of the `gh` CLI: every store method is exercised with no network.
function fakeGh({ issues = [], me = 'nico' } = {}) {
  const calls = [];
  const state = issues.map((i) => ({ labels: [], assignees: [], state: 'open', body: '', ...i }));
  let next = 200;
  const find = (n) => state.find((x) => x.number === n);
  return {
    calls,
    state,
    gh: {
      me: () => me,
      ensureLabels: () => calls.push(['ensureLabels']),
      listIssues: ({ labels = [] } = {}) =>
        state.filter((i) => labels.every((l) => i.labels.includes(l))),
      createIssue: (i) => { const n = next++; state.push({ number: n, ...i, state: 'open', assignees: [] }); calls.push(['create', i.title]); return n; },
      updateIssue: (n, i) => { calls.push(['update', n]); Object.assign(find(n), i); },
      reopenIssue: (n) => { calls.push(['reopen', n]); find(n).state = 'open'; },
      closeIssue: (n) => { calls.push(['close', n]); find(n).state = 'closed'; },
      addLabel: (n, l) => find(n).labels.push(l),
      // A real removal, not a no-op: `reserve` and `release` are read back by later assertions,
      // and a stub that always succeeds silently is exactly how their own bugs went untested.
      removeLabel: (n, l) => { const i = find(n); i.labels = i.labels.filter((x) => x !== l); },
      assign: (n, who) => { calls.push(['assign', n, who]); find(n).assignees.push(who); },
      unassign: (n, who) => { calls.push(['unassign', n, who]); const i = find(n); i.assignees = i.assignees.filter((x) => x !== who); },
      listComments: () => [],
      addComment: () => {},
    },
  };
}

function online(fake) {
  const r = makeRepo({ mode: 'online' });
  repos.push(r);
  const cfg = loadConfig(r.root);
  return { r, cfg, store: makeStore(cfg, { gh: fake.gh }) };
}
after(() => repos.forEach((x) => x.cleanup()));

test('list reads task issues back through the SAME parser', () => {
  const f = fakeGh({
    issues: [{
      number: 5, title: taskTitle(task), labels: [LABELS.task],
      body: `### D1 — First thing\n\n- **Roadmap** demo\n- **Order** 1\n- **Deps** —\n- **Touches** \`README.md\`\n- **Branch** \`demo/d1-first-thing\`\n- **Design** no\n- **Lane** —\n\n**Why.** w\n\n**Acceptance.** a\n\nProgramme: #1\n`,
    }],
  });
  const { store } = online(f);
  const rows = store.list();
  assert.deepEqual(rows.map((t) => t.key), ['demo/D1']);
  assert.equal(rows[0].ref, 5);
});

test('the overlay reports status, owner and openness — and it is NOT empty', () => {
  const f = fakeGh({
    me: 'nico',
    issues: [
      { number: 1, title: 'demo — Demo', labels: [LABELS.programme], author: 'nico', body: '- **Roadmap** demo\n' },
      { number: 5, title: taskTitle(task), labels: [LABELS.task, LABELS.wip], assignees: ['nico'], body: 'Programme: #1\n' },
    ],
  });
  const { store } = online(f);
  const o = store.overlay();
  assert.equal(o.size, 1);
  assert.deepEqual(o.get('demo/D1'), {
    status: 'claimed', ref: 5, owner: 'nico', open: false, mine: true, claimedByMe: true,
    programme: 1, programmeState: 'open',
  });
});

test('a closed issue reads landed whoever owns it', () => {
  const f = fakeGh({
    me: 'nico',
    issues: [
      { number: 1, title: 'demo — Demo', labels: [LABELS.programme], author: 'someone', body: '- **Roadmap** demo\n' },
      { number: 5, title: taskTitle(task), labels: [LABELS.task], state: 'closed', body: 'Programme: #1\n' },
    ],
  });
  assert.equal(online(f).store.overlay().get('demo/D1').status, 'landed');
});

test("another developer's roadmap is not mine, and openRoadmap adds exactly one label", () => {
  const f = fakeGh({
    me: 'nico',
    issues: [
      { number: 1, title: 'demo — Demo', labels: [LABELS.programme], author: 'someone', body: '- **Roadmap** demo\n' },
      { number: 5, title: taskTitle(task), labels: [LABELS.task], body: 'Programme: #1\n' },
    ],
  });
  const { store } = online(f);
  assert.equal(store.overlay().get('demo/D1').mine, false);
  store.openRoadmap('demo');
  assert.ok(f.state.find((i) => i.number === 1).labels.includes('open'));
});

test('publish lints the draft, refuses a bad one, and never calls gh for it', () => {
  const f = fakeGh();
  const ctx = online(f);
  const dir = join(ctx.r.root, ctx.cfg.roadmaps.drafts);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'demo.md');
  writeFileSync(p, ROADMAP.replace('- **Lane** —', '- **Landed** yes'));
  assert.throws(() => ctx.store.publish(p), /status field|missing required field/);
  assert.deepEqual(f.calls, []);
});

test('publish creates the issues and deletes the draft', () => {
  const f = fakeGh();
  const ctx = online(f);
  const dir = join(ctx.r.root, ctx.cfg.roadmaps.drafts);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'demo.md');
  writeFileSync(p, ROADMAP);
  const res = ctx.store.publish(p);
  assert.deepEqual(res.keys, ['demo/D1']);
  assert.deepEqual(ctx.store.drafts(), []);
  assert.ok(f.calls.some((c) => c[0] === 'create' && c[1] === 'demo/D1 — First thing'));
});

// claim/release lifecycle — entirely uncovered before this round, which is how a release that left
// the GitHub assignee behind (assign is `--add-assignee`, which only ever ADDS) shipped unnoticed.
//
// `me: 'alice'` here, deliberately: a plain `release` only gives up a claim the CALLER holds (see
// the force test below), so exercising "release, then someone else claims" needs the releaser to
// be the same identity that claimed it.
test('claim, release, then a DIFFERENT user claims — release must free the assignee, not just the label', () => {
  const f = fakeGh({ me: 'alice', issues: [{ number: 5, title: taskTitle(task), labels: [LABELS.task] }] });
  const { store } = online(f);
  assert.deepEqual(store.claim('demo/D1', 'alice'), { ok: true });
  assert.deepEqual(store.release('demo/D1'), { ok: true });
  const result = store.claim('demo/D1', 'bob');
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(f.state.find((i) => i.number === 5).assignees, ['bob']);
});

// The refusal a plain `release` was missing: without it, `release` freed ANY assignee, so it
// already released somebody else's claim silently — the exact thing `--force` was meant to gate.
test('release refuses a claim held by someone else, and --force takes it anyway', () => {
  const f = fakeGh({
    me: 'nico',
    issues: [{ number: 5, title: taskTitle(task), labels: [LABELS.task, LABELS.wip], assignees: ['alice'] }],
  });
  const { store } = online(f);
  assert.deepEqual(store.release('demo/D1'), { ok: false, holder: 'alice' });
  assert.deepEqual(f.state.find((i) => i.number === 5).assignees, ['alice']);
  assert.deepEqual(store.release('demo/D1', { force: true }), { ok: true });
  assert.deepEqual(f.state.find((i) => i.number === 5).assignees, []);
});

test('claim on a task already held by someone else fails, naming the holder', () => {
  const f = fakeGh({
    issues: [{ number: 5, title: taskTitle(task), labels: [LABELS.task], assignees: ['alice'] }],
  });
  const { store } = online(f);
  assert.deepEqual(store.claim('demo/D1', 'bob'), { ok: false, holder: 'alice' });
});

test('close closes the issue, and the overlay then reports it landed', () => {
  const f = fakeGh({
    me: 'nico',
    issues: [
      { number: 1, title: 'demo — Demo', labels: [LABELS.programme], author: 'nico', body: '- **Roadmap** demo\n' },
      { number: 5, title: taskTitle(task), labels: [LABELS.task], body: 'Programme: #1\n' },
    ],
  });
  const { store } = online(f);
  assert.deepEqual(store.close('demo/D1'), { noop: false });
  assert.equal(store.overlay().get('demo/D1').status, 'landed');
});

test('reserve removes the open label that openRoadmap added', () => {
  const f = fakeGh({
    issues: [{ number: 1, title: 'demo — Demo', labels: [LABELS.programme], body: '- **Roadmap** demo\n' }],
  });
  const { store } = online(f);
  store.openRoadmap('demo');
  assert.ok(f.state.find((i) => i.number === 1).labels.includes('open'));
  store.reserve('demo');
  assert.ok(!f.state.find((i) => i.number === 1).labels.includes('open'));
});

test('whoami, programmes and drafts read the same shapes the offline store returns', () => {
  const f = fakeGh({
    me: 'nico',
    issues: [{ number: 1, title: 'demo — Demo', labels: [LABELS.programme], author: 'nico', body: '- **Roadmap** demo\n' }],
  });
  const { store, r, cfg } = online(f);
  assert.equal(store.whoami(), 'nico');

  const [p] = store.programmes();
  assert.equal(p.slug, 'demo');
  assert.equal(p.owner, 'nico');
  assert.equal(p.open, false);
  assert.equal(p.state, 'open');
  assert.equal(p.ref, 1);

  // The filename disagrees with the frontmatter on purpose: drafts() must read the slug the same
  // way publish() does, or a draft can be listed under one name and published under another.
  const dir = join(r.root, cfg.roadmaps.drafts);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'foo.md'), ROADMAP);
  const [d] = store.drafts();
  assert.equal(d.slug, 'demo');
  assert.equal(d.path, join(dir, 'foo.md'));
});

test('a `# ` heading in a draft becomes the programme title and is not duplicated into the prose', () => {
  const f = fakeGh();
  const ctx = online(f);
  const dir = join(ctx.r.root, ctx.cfg.roadmaps.drafts);
  mkdirSync(dir, { recursive: true });
  const headed = ROADMAP.replace(/^(---[\s\S]*?---\n\n)/, '$1# Demo Title\n\n');
  const p = join(dir, 'demo.md');
  writeFileSync(p, headed);
  ctx.store.publish(p);
  const programme = f.state.find((i) => i.labels?.includes(LABELS.programme));
  assert.equal(programme.title, 'demo — Demo Title');
  assert.ok(!programme.body.includes('# Demo Title'));
});

test('a headingless draft still publishes, titled by its own slug', () => {
  const f = fakeGh();
  const ctx = online(f);
  const dir = join(ctx.r.root, ctx.cfg.roadmaps.drafts);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'demo.md');
  writeFileSync(p, ROADMAP);
  ctx.store.publish(p);
  const programme = f.state.find((i) => i.labels?.includes(LABELS.programme));
  assert.equal(programme.title, 'demo — demo');
});
