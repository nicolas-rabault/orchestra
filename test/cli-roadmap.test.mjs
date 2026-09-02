// Direct coverage of `roadmapCommand` itself.
//
// `both-modes.test.mjs` passes in full before `lib/cli/roadmap.mjs` even exists — it imports only
// the store, the board and enrol, and drives them directly. `cli.test.mjs`'s two `roadmap`
// invocations both short-circuit before `roadmapCommand` ever runs (the off switch with no config,
// a broken config throwing first). So the file this task exists to create was exercised by
// nothing. This file drives `roadmapCommand` directly, per the brief's own preference — it is
// faster than shelling out to `bin/orchestra`, which already has its own dispatcher-level tests.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, ROADMAP } from './helpers/fixture.mjs';
import { loadConfig } from '../lib/config.mjs';
import { makeStore } from '../lib/store/index.mjs';
import {
  readState, writeState, emptyState, registerRow,
} from '../lib/register/state.mjs';
import { parseRoadmap } from '../lib/roadmap/parse.mjs';
import { LABELS, taskTitle } from '../lib/store/github/issues.mjs';
import { roadmapCommand } from '../lib/cli/roadmap.mjs';

const repos = [];
after(() => repos.forEach((r) => r.cleanup()));

// Captures everything a `roadmapCommand` call writes to stdout, and restores both stdout and
// `process.exitCode` afterwards. `cmdLint` sets the latter as a genuine process-wide side effect —
// leaking it out of one test would flip the exit code of this whole suite's own run.
function capture(fn) {
  const realWrite = process.stdout.write.bind(process.stdout);
  const savedExitCode = process.exitCode;
  let text = '';
  process.stdout.write = (chunk) => { text += chunk; return true; };
  process.exitCode = undefined;
  try {
    fn();
    return { text, exitCode: process.exitCode };
  } finally {
    process.stdout.write = realWrite;
    process.exitCode = savedExitCode;
  }
}

function offlineProject() {
  const r = makeRepo({ mode: 'offline' });
  repos.push(r);
  return { r, cfg: loadConfig(r.root) };
}

// A `gh` recorder that keeps issues in memory, so the online path is exercised with no network —
// the same shape `both-modes.test.mjs` uses, plus `unassign`, which `release` needs and nothing
// there exercised.
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
    unassign: (n, who) => { find(n).assignees = find(n).assignees.filter((x) => x !== who); },
  };
}

function onlineProject(me) {
  const r = makeRepo({ mode: 'online' });
  repos.push(r);
  return { r, cfg: loadConfig(r.root), gh: fakeGh(me) };
}

function writeDraft(root, cfg, name, text) {
  const dir = join(root, cfg.roadmaps.drafts);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
}

// The predicate `enrolInto` hands `enrol` as `foreign`, pinned in both directions: a single case
// would pass against an inverted `open` check just as easily as against the real one.
test('publish enrols a shared task dropped when nobody opened it, todo when they did', () => {
  const { r, cfg, gh } = onlineProject('nico');
  // Two programmes, each authored by someone else — the only way `mine` reads false here, since
  // this process's OWN publish would otherwise be the author of any programme it has to create.
  gh.state.push(
    { number: 1, title: 'demo1 — Demo one', state: 'open', labels: [LABELS.programme], author: 'alice', assignees: [], body: '- **Roadmap** demo1\n' },
    { number: 2, title: 'demo2 — Demo two', state: 'open', labels: [LABELS.programme, 'open'], author: 'alice', assignees: [], body: '- **Roadmap** demo2\n' },
  );
  const draft1 = writeDraft(r.root, cfg, 'demo1.md', ROADMAP.replaceAll('demo', 'demo1'));
  const draft2 = writeDraft(r.root, cfg, 'demo2.md', ROADMAP.replaceAll('demo', 'demo2'));

  capture(() => roadmapCommand({ cfg, args: ['publish', draft1], deps: { gh } }));
  capture(() => roadmapCommand({ cfg, args: ['publish', draft2], deps: { gh } }));

  const rows = readState(cfg.root).tasks;
  const notOpened = rows.find((row) => row.id === 'demo1/D1');
  const opened = rows.find((row) => row.id === 'demo2/D1');
  assert.equal(notOpened.status, 'dropped', 'not mine and not opened — dropped so nothing here ever schedules it');
  assert.equal(opened.status, 'todo', 'not mine, but opened — schedulable, so it enrols todo');
});

test('board prints a correction, an unverified row and an orphan in each direction, each exactly once', () => {
  const { r, cfg } = offlineProject();
  const MULTI = `---
roadmap: multi
---

Multi-task fixture for board rendering.

### D1 — First thing

- **Roadmap** multi
- **Order** 1
- **Deps** —
- **Touches** \`README.md\`
- **Branch** \`multi/d1-first-thing\`
- **Design** no
- **Lane** —

**Why.** w1

**Acceptance.** a1

### D2 — Second thing

- **Roadmap** multi
- **Order** 2
- **Deps** —
- **Touches** \`README.md\`
- **Branch** \`multi/d2-second-thing\`
- **Design** no
- **Lane** —

**Why.** w2

**Acceptance.** a2

### D3 — Third thing

- **Roadmap** multi
- **Order** 3
- **Deps** —
- **Touches** \`README.md\`
- **Branch** \`multi/d3-third-thing\`
- **Design** no
- **Lane** —

**Why.** w3

**Acceptance.** a3
`;
  const draft = writeDraft(r.root, cfg, 'multi.md', MULTI);
  makeStore(cfg).publish(draft);
  const [d1, d2] = parseRoadmap(MULTI).tasks;

  // Hand-built register, not `enrol`'s own output: this pins the board's REPORTING, not
  // enrolment, so each row's status is set directly to the exact disagreement being tested.
  //   demo D1: register says claimed, nothing derives that (no branch ref exists)   -> correction
  //   demo D2: register says landed with no recorded subject                       -> unverified
  //   demo D3: published, no register row at all                                   -> orphan (roadmap-only)
  //   multi/D4: a register row naming no published task                            -> orphan (register-only)
  const state = emptyState(cfg.root);
  state.tasks = [
    registerRow(d1, { roadmapSlug: 'multi', status: 'claimed' }),
    registerRow(d2, { roadmapSlug: 'multi', status: 'landed' }),
    registerRow(
      {
        key: 'multi/D4', order: 4, title: 'Fourth thing', deps: [], touches: [], lane: null, branch: 'multi/d4-fourth-thing', design: false,
      },
      { roadmapSlug: 'multi', status: 'todo' },
    ),
  ];
  writeState(cfg.root, state);

  const { text } = capture(() => roadmapCommand({ cfg, args: ['board'] }));
  const lines = text.split('\n');
  const countOf = (line) => lines.filter((l) => l === line).length;

  assert.equal(countOf('correction: multi/D1: register says claimed, derived todo'), 1);
  assert.equal(countOf('unverified: multi/D2: register says landed and recorded no commit subject — unverified, not todo'), 1);
  assert.equal(countOf('orphan: multi/D4 is in the register and in no roadmap — write a roadmap line for it, then publish'), 1);
  assert.equal(countOf('orphan: multi/D3 is in a roadmap and not in the register — nothing will schedule it; run `orchestra roadmap enrol`'), 1);
});

test('lint on a draft with a status field exits non-zero and names the field', () => {
  const { r, cfg } = offlineProject();
  writeDraft(r.root, cfg, 'demo.md', ROADMAP.replace('- **Lane** —', '- **Landed** yes'));
  const { text, exitCode } = capture(() => roadmapCommand({ cfg, args: ['lint'] }));
  assert.equal(exitCode, 1);
  assert.match(text, /"Landed" is a status field/);
});

test('lint on a clean draft says how many files it checked and that they are clean', () => {
  const { r, cfg } = offlineProject();
  writeDraft(r.root, cfg, 'demo.md', ROADMAP);
  const { text, exitCode } = capture(() => roadmapCommand({ cfg, args: ['lint'] }));
  assert.equal(exitCode, undefined);
  assert.match(text, /lint: 1 file checked, clean/);
});

test('an unknown subcommand throws naming the eight that exist', () => {
  const { cfg } = offlineProject();
  const known = ['lint', 'board', 'publish', 'claim', 'release', 'open', 'reserve', 'enrol'];
  assert.throws(
    () => roadmapCommand({ cfg, args: ['bogus'] }),
    (e) => /unknown subcommand "bogus"/.test(e.message) && known.every((verb) => e.message.includes(verb)),
  );
});

test('release without --force is refused when someone else holds the claim, and --force takes it', () => {
  const { cfg, gh } = onlineProject('nico');
  const task = parseRoadmap(ROADMAP).tasks[0];
  gh.state.push({
    number: 5, title: taskTitle(task), state: 'open', labels: [LABELS.task, LABELS.wip], assignees: ['alice'], author: 'alice',
  });

  assert.throws(
    () => roadmapCommand({ cfg, args: ['release', 'demo/D1'], deps: { gh } }),
    /release refused: demo\/D1 is held by alice.*--force/,
  );
  assert.deepEqual(gh.state.find((i) => i.number === 5).assignees, ['alice']);

  const { text } = capture(() => roadmapCommand({ cfg, args: ['release', 'demo/D1', '--force'], deps: { gh } }));
  assert.match(text, /released demo\/D1/);
  assert.deepEqual(gh.state.find((i) => i.number === 5).assignees, []);
});

test('cmdPublish catches an enrolment failure, reports both halves, and exits non-zero', () => {
  const { r, cfg } = offlineProject();
  const draft = writeDraft(r.root, cfg, 'demo.md', ROADMAP);
  // A register file that does not parse turns `readState` into a throw — `enrolInto` calls it
  // AFTER `store.publish` has already committed the roadmap, which is exactly the moment this
  // task exists to make recoverable rather than confusing.
  mkdirSync(join(r.root, '.orchestra'), { recursive: true });
  writeFileSync(join(r.root, '.orchestra', 'state.json'), '{ not json');

  const { text, exitCode } = capture(() => roadmapCommand({ cfg, args: ['publish', draft] }));
  assert.match(text, /published demo: demo\/D1/);
  assert.match(text, /published, but enrolment failed/);
  assert.match(text, /orchestra roadmap enrol/);
  assert.equal(exitCode, 1);
});
