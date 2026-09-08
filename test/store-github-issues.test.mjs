import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoadmap } from '../lib/roadmap/parse.mjs';
import { ROADMAP } from './helpers/fixture.mjs';
import {
  LABELS, renderTaskBlock, taskTitle, keyFromTitle, renderTaskIssue,
  renderProgrammeIssue, planPublish, publishIssues, mergeProgrammeBody, programmeReport,
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

// ---- a follow-up publish COMPLETES the programme, it does not rewrite it ----
// The night this is taken from: ten tasks published from one file, then an eleventh from a second
// file carrying the same `roadmap:` slug. The programme was re-rendered whole, so its title became
// the second file's H1, its prose the second file's prose, and its eleven checklist lines became
// one. `publish` printed the same line it prints for a first publication, `lint` had passed, and
// `board` reconciles task lines only — so nothing said a word (ticket `t-120tjoq`, issue #120).
const clone = (id, title) => ({ ...task, id, key: `demo/${id}`, title });

const ghOver = (programmes, calls, next = 200) => ({
  ensureLabels: () => {},
  listIssues: ({ labels = [] } = {}) => (labels.includes(LABELS.programme) ? programmes : []),
  createIssue: (i) => { calls.push(['createIssue', i.title]); return next++; },
  updateIssue: (n, i) => calls.push(['updateIssue', n, i]),
  reopenIssue: (n) => calls.push(['reopenIssue', n]),
});

test('publishing one more task completes the programme instead of erasing it', () => {
  const ten = Array.from({ length: 10 }, (_, i) => clone(`D${i + 1}`, `Thing ${i + 1}`));
  const body = [
    '- **Roadmap** demo', '', 'The prose that took a year to agree on.', '', '## Tasks',
    ...ten.map((t, i) => `- [${i < 3 ? 'x' : ' '}] #${120 + i + 1} ${t.id} — ${t.title}`), '',
  ].join('\n');
  const programmes = [{ number: 120, title: 'demo — The whole programme', body, labels: [LABELS.programme], state: 'open' }];
  const calls = [];
  const eleventh = clone('D11', 'The follow-up');

  const res = publishIssues(ghOver(programmes, calls), {
    roadmap: 'demo', title: 'A second file', prose: 'Only this task.', tasks: [eleventh],
  });

  assert.equal(res.programme, 120);
  assert.equal(res.programmeCreated, false);
  assert.equal(res.programmeAdded, 1);

  const edit = calls.find((c) => c[0] === 'updateIssue' && c[1] === 120)[2];
  // The title is not passed at all, so no title edit is issued against the programme.
  assert.equal(edit.title, undefined);
  // The prose the second file would have imposed is nowhere in the body.
  assert.match(edit.body, /The prose that took a year to agree on\./);
  assert.doesNotMatch(edit.body, /Only this task\./);
  // All eleven lines are there, the three ticks survived, and the new one is last.
  assert.equal(edit.body.match(/^- \[[ xX]\] /gm).length, 11);
  assert.equal(edit.body.match(/^- \[x\] /gm).length, 3);
  assert.match(edit.body, /^- \[ \] #\d+ D11 — The follow-up$/m);
});

test('a task already listed is not added twice, and a publish that adds nothing writes nothing', () => {
  const one = clone('D1', 'First thing');
  const body = ['- **Roadmap** demo', '', 'Prose.', '', '## Tasks', '- [ ] #121 D1 — First thing', ''].join('\n');
  const programmes = [{ number: 120, title: 'demo — Programme', body, labels: [LABELS.programme], state: 'open' }];
  const calls = [];

  const res = publishIssues(ghOver(programmes, calls), {
    roadmap: 'demo', title: 'Programme', prose: 'Prose.', tasks: [one],
  });

  assert.equal(res.programmeAdded, 0);
  // The task issue itself is still created; the PROGRAMME is what is left untouched.
  assert.equal(calls.some((c) => c[0] === 'updateIssue' && c[1] === 120), false);
});

test('a programme body with no task section gains one instead of being refused', () => {
  const body = ['- **Roadmap** demo', '', 'Prose a human trimmed.', ''].join('\n');
  const programmes = [{ number: 120, title: 'demo — Programme', body, labels: [LABELS.programme], state: 'open' }];
  const calls = [];

  const res = publishIssues(ghOver(programmes, calls), {
    roadmap: 'demo', title: 'Programme', prose: 'New prose.', tasks: [clone('D1', 'First thing')],
  });

  assert.equal(res.programmeAdded, 1);
  const edit = calls.find((c) => c[0] === 'updateIssue' && c[1] === 120)[2];
  assert.match(edit.body, /Prose a human trimmed\./);
  assert.match(edit.body, /^## Tasks$/m);
  assert.match(edit.body, /^- \[ \] #\d+ D1 — First thing$/m);
});

test('programmeReport distinguishes a created programme from a completed one', () => {
  assert.equal(
    programmeReport({ programme: 9, programmeCreated: true, programmeAdded: 3, reopened: false }),
    'programme #9 created');
  assert.equal(
    programmeReport({ programme: 9, programmeCreated: false, programmeAdded: 1, reopened: false }),
    'programme #9 completed: 1 task line added, title and prose left as they were');
  assert.equal(
    programmeReport({ programme: 9, programmeCreated: false, programmeAdded: 0, reopened: true }),
    'programme #9 completed: nothing to add, title and prose left as they were'
    + ' (reopened — it had closed when its last task landed)');
});
