import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoadmap } from '../lib/roadmap/parse.mjs';
import { ROADMAP } from './helpers/fixture.mjs';
import {
  LABELS, renderTaskBlock, taskTitle, keyFromTitle, renderTaskIssue,
  renderProgrammeIssue, planPublish, publishIssues,
} from '../lib/store/github/issues.mjs';

const task = parseRoadmap(ROADMAP).tasks[0];

test('a rendered task block re-parses to the same task — one grammar, two channels', () => {
  const round = parseRoadmap(`---\nroadmap: demo\n---\n\n${renderTaskBlock(task)}`);
  assert.deepEqual(round.errors, []);
  const t = round.tasks[0];
  assert.equal(t.key, task.key);
  assert.equal(t.title, task.title);
  assert.equal(t.branch, task.branch);
  assert.deepEqual(t.touches, task.touches);
  assert.equal(t.why, task.why);
  assert.equal(t.acceptance, task.acceptance);
});

test('the title is the idempotence key and round-trips', () => {
  assert.equal(taskTitle(task), 'demo/D1 — First thing');
  assert.equal(keyFromTitle(taskTitle(task)), 'demo/D1');
});

test('a new task issue is born labelled status:todo, and there is no status:done', () => {
  const i = renderTaskIssue(task, 7);
  assert.deepEqual(i.labels, [LABELS.task, LABELS.todo]);
  assert.match(i.body, /^Programme: #7$/m);
  assert.equal(LABELS.done, undefined);
});

test('planPublish matches on the title, so publishing twice updates', () => {
  const existing = [{ number: 12, title: taskTitle(task), labels: [LABELS.task] }];
  const plan = planPublish({ roadmap: 'demo', tasks: [task], existing });
  assert.deepEqual(plan.create, []);
  assert.deepEqual(plan.update.map((u) => u.number), [12]);
});

test('planPublish ignores a task belonging to another roadmap', () => {
  const foreign = { ...task, roadmap: 'other', key: 'other/D1' };
  const plan = planPublish({ roadmap: 'demo', tasks: [foreign], existing: [] });
  assert.deepEqual(plan.create, []);
  assert.deepEqual(plan.update, []);
});

test('publishIssues creates the programme first, then rewrites it with the task numbers', () => {
  const calls = [];
  let next = 100;
  const gh = {
    ensureLabels: (n) => calls.push(['ensureLabels', n]),
    listIssues: () => [],
    createIssue: (i) => { calls.push(['createIssue', i.title]); return next++; },
    updateIssue: (n, i) => calls.push(['updateIssue', n, i.title]),
    reopenIssue: (n) => calls.push(['reopenIssue', n]),
  };
  const res = publishIssues(gh, { roadmap: 'demo', title: 'Demo', prose: 'Prose.', tasks: [task] });
  assert.equal(res.programme, 100);
  assert.deepEqual(res.created, ['demo/D1']);
  assert.equal(calls[1][1], 'demo — Demo');            // the programme is created first
  assert.equal(calls[2][1], 'demo/D1 — First thing');  // then the task
  assert.equal(calls[3][0], 'updateIssue');            // then the programme is rewritten
  assert.equal(calls[3][1], 100);
});

// `publishIssues` carried its own byte-identical copy of the programme match until a review found
// the pair; it calls `programmeForRoadmap` now, so the anchoring is pinned once for both readers.
// A programme is found by its `- **Roadmap** <slug>` line, whole and on its own line: publishing
// `light` must not reach the `lighting` programme, in publish exactly as in `open`/`reserve`.
function programmeRecorder(programmes) {
  const created = [];
  let next = 200;
  return {
    created,
    gh: {
      ensureLabels: () => {},
      listIssues: ({ labels = [] } = {}) => (labels.includes(LABELS.programme) ? programmes : []),
      createIssue: (i) => { created.push(i.title); return next += 1; },
      updateIssue: () => {},
      reopenIssue: () => {},
    },
  };
}

test('publishIssues finds an existing programme by the same anchored match open/reserve use', () => {
  const programmes = [{
    number: 7, title: 'lighting — Lighting', state: 'open', labels: [LABELS.programme],
    body: '- **Roadmap** lighting\n\n## Tasks\n',
  }];
  const lighting = { ...task, roadmap: 'lighting', key: 'lighting/D1' };

  const same = programmeRecorder(programmes);
  const res = publishIssues(same.gh, {
    roadmap: 'lighting', title: 'Lighting', prose: 'p', tasks: [lighting],
  });
  assert.equal(res.programme, 7);
  assert.deepEqual(same.created, ['lighting/D1 — First thing']);

  const prefix = programmeRecorder(programmes);
  const other = publishIssues(prefix.gh, {
    roadmap: 'light', title: 'Light', prose: 'p', tasks: [{ ...task, roadmap: 'light', key: 'light/D1' }],
  });
  assert.notEqual(other.programme, 7);
  assert.ok(prefix.created.includes('light — Light'));
});
