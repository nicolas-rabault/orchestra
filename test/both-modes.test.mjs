// P1's acceptance. Every assertion here runs against BOTH modes, which is the sharpest available
// statement of what "two modes" means: same grammar, same lint, same board, same enrolment. Where
// the two genuinely differ — a status written to an issue, an owner who is somebody else — the
// difference is asserted explicitly at the bottom rather than left to be discovered.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, ROADMAP } from './helpers/fixture.mjs';
import { loadConfig } from '../lib/config.mjs';
import { makeStore } from '../lib/store/index.mjs';
import { reconcile, gatherGit } from '../lib/roadmap/board.mjs';
import { enrol } from '../lib/roadmap/enrol.mjs';
import { LABELS, taskTitle } from '../lib/store/github/issues.mjs';
import { parseRoadmap } from '../lib/roadmap/parse.mjs';

const repos = [];
after(() => repos.forEach((r) => r.cleanup()));

// A `gh` recorder that keeps issues in memory, so the online store is exercised with no network.
function fakeGh(me = 'nico') {
  const state = [];
  let next = 100;
  const find = (n) => state.find((i) => i.number === n);
  return {
    state,
    me: () => me,
    ensureLabels: () => {},
    listIssues: ({ labels = [] } = {}) => state.filter((i) => labels.every((l) => i.labels.includes(l))),
    createIssue: (i) => { const n = next++; state.push({ number: n, state: 'open', assignees: [], author: me, ...i }); return n; },
    updateIssue: (n, i) => Object.assign(find(n), i),
    reopenIssue: (n) => { find(n).state = 'open'; },
    closeIssue: (n) => { find(n).state = 'closed'; },
    addLabel: (n, l) => { if (!find(n).labels.includes(l)) find(n).labels.push(l); },
    removeLabel: (n, l) => { find(n).labels = find(n).labels.filter((x) => x !== l); },
    assign: (n, who) => find(n).assignees.push(who),
  };
}

function project(mode) {
  const r = makeRepo({ mode });
  repos.push(r);
  const cfg = loadConfig(r.root);
  const gh = mode === 'online' ? fakeGh() : null;
  const store = makeStore(cfg, gh ? { gh } : {});
  const dir = join(r.root, cfg.roadmaps.drafts);
  mkdirSync(dir, { recursive: true });
  const draftPath = join(dir, 'demo.md');
  writeFileSync(draftPath, ROADMAP);
  return { r, cfg, store, gh, draftPath };
}

for (const mode of ['offline', 'online']) {
  test(`[${mode}] a draft is invisible until it is published`, () => {
    const p = project(mode);
    assert.deepEqual(p.store.list(), []);
    assert.deepEqual(p.store.drafts().map((d) => d.slug), ['demo']);
  });

  test(`[${mode}] publish makes exactly one task visible, keyed the same way`, () => {
    const p = project(mode);
    const res = p.store.publish(p.draftPath);
    assert.equal(res.slug, 'demo');
    assert.deepEqual(res.keys, ['demo/D1']);
    assert.deepEqual(p.store.list().map((t) => t.key), ['demo/D1']);
    assert.deepEqual(p.store.drafts(), []);
  });

  test(`[${mode}] a published task round-trips the whole grammar`, () => {
    const p = project(mode);
    p.store.publish(p.draftPath);
    const t = p.store.list()[0];
    const src = parseRoadmap(ROADMAP).tasks[0];
    for (const field of ['id', 'title', 'key', 'order', 'branch', 'design', 'lane', 'why', 'acceptance']) {
      assert.deepEqual(t[field], src[field], `${field} differs in ${mode}`);
    }
    assert.deepEqual(t.deps, src.deps);
    assert.deepEqual(t.touches, src.touches);
  });

  test(`[${mode}] publish refuses a draft that does not lint and changes nothing`, () => {
    const p = project(mode);
    writeFileSync(p.draftPath, ROADMAP.replace('- **Lane** —', '- **Landed** yes'));
    assert.throws(() => p.store.publish(p.draftPath), /status field/);
    assert.deepEqual(p.store.list(), []);
    assert.deepEqual(p.store.drafts().map((d) => d.slug), ['demo']);
  });

  test(`[${mode}] the board derives todo for a fresh task and reports no correction`, () => {
    const p = project(mode);
    p.store.publish(p.draftPath);
    const b = reconcile({
      tasks: p.store.list(),
      git: gatherGit(p.r.root, { mainBranch: p.cfg.mainBranch }),
      register: [],
      overlay: p.store.overlay(),
    });
    assert.equal(b.rows.length, 1);
    assert.equal(b.rows[0].status, 'todo');
    assert.equal(b.rows[0].schedulable, true);
    assert.deepEqual(b.corrections, []);
  });

  test(`[${mode}] a published task with no register row is an orphan the board names`, () => {
    const p = project(mode);
    p.store.publish(p.draftPath);
    const b = reconcile({
      tasks: p.store.list(),
      git: gatherGit(p.r.root, { mainBranch: p.cfg.mainBranch }),
      register: [],
      overlay: p.store.overlay(),
    });
    assert.deepEqual(b.orphans.inRoadmapOnly, ['demo/D1']);
  });

  test(`[${mode}] enrolment closes that orphan, and is append-only`, () => {
    const p = project(mode);
    p.store.publish(p.draftPath);
    const { state } = enrol({ tasks: [] }, p.store.list(), { at: '2026-09-02T10:00:00Z', host: 'testbox' });
    const b = reconcile({
      tasks: p.store.list(),
      git: gatherGit(p.r.root, { mainBranch: p.cfg.mainBranch }),
      register: state.tasks,
      overlay: p.store.overlay(),
    });
    assert.deepEqual(b.orphans.inRoadmapOnly, []);
    assert.deepEqual(b.orphans.inRegisterOnly, []);
  });
}

test('[offline] the overlay is empty and every command that cannot apply says so', () => {
  const p = project('offline');
  p.store.publish(p.draftPath);
  assert.equal(p.store.overlay().size, 0);
  assert.equal(p.store.openRoadmap('demo').noop, true);
  assert.equal(p.store.setStatus('demo/D1', 'claimed').noop, true);
});

test('[online] the overlay carries the issue, and claim turns it wip for everyone', () => {
  const p = project('online');
  p.store.publish(p.draftPath);
  assert.equal(p.store.claim('demo/D1', 'nico').ok, true);
  const entry = p.store.overlay().get('demo/D1');
  assert.equal(entry.status, 'claimed');
  assert.ok(p.gh.state.find((i) => i.labels.includes(LABELS.wip)));
  assert.ok(p.gh.state.some((i) => i.title === taskTitle(parseRoadmap(ROADMAP).tasks[0])));
});
