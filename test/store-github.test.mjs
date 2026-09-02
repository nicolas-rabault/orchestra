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
  return {
    calls,
    state,
    gh: {
      me: () => me,
      ensureLabels: () => calls.push(['ensureLabels']),
      listIssues: ({ labels = [] } = {}) =>
        state.filter((i) => labels.every((l) => i.labels.includes(l))),
      createIssue: (i) => { const n = next++; state.push({ number: n, ...i, state: 'open', assignees: [] }); calls.push(['create', i.title]); return n; },
      updateIssue: (n, i) => { calls.push(['update', n]); Object.assign(state.find((x) => x.number === n), i); },
      reopenIssue: (n) => { calls.push(['reopen', n]); state.find((x) => x.number === n).state = 'open'; },
      closeIssue: (n) => { calls.push(['close', n]); state.find((x) => x.number === n).state = 'closed'; },
      addLabel: (n, l) => state.find((x) => x.number === n).labels.push(l),
      removeLabel: () => {},
      assign: (n, who) => state.find((x) => x.number === n).assignees.push(who),
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
    status: 'claimed', ref: 5, owner: 'nico', open: false, mine: true,
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
