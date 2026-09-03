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
import { makeFakeGh } from './helpers/gh.mjs';
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

function onlineProject(me) {
  const r = makeRepo({ mode: 'online' });
  repos.push(r);
  return { r, cfg: loadConfig(r.root), gh: makeFakeGh({ me }) };
}

function writeDraft(root, cfg, name, text) {
  const dir = join(root, cfg.roadmaps.drafts);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
}

// Shared by the two tests below: three roadmaps, each under its own programme, covering every
// combination the `foreign` predicate and the board's ownership rendering care about.
//   demo1 — authored by someone else ('alice'), never opened      -> not mine, not schedulable here
//   demo2 — authored by someone else ('alice'), opened            -> not mine, but schedulable
//   demo3 — authored by the CALLING identity ('nico'), never opened -> mine, always schedulable
function publishThreeRoadmaps() {
  const { r, cfg, gh } = onlineProject('nico');
  gh.state.push(
    { number: 1, title: 'demo1 — Demo one', state: 'open', labels: [LABELS.programme], author: 'alice', assignees: [], body: '- **Roadmap** demo1\n' },
    { number: 2, title: 'demo2 — Demo two', state: 'open', labels: [LABELS.programme, 'open'], author: 'alice', assignees: [], body: '- **Roadmap** demo2\n' },
    { number: 3, title: 'demo3 — Demo three', state: 'open', labels: [LABELS.programme], author: 'nico', assignees: [], body: '- **Roadmap** demo3\n' },
  );
  const draft1 = writeDraft(r.root, cfg, 'demo1.md', ROADMAP.replaceAll('demo', 'demo1'));
  const draft2 = writeDraft(r.root, cfg, 'demo2.md', ROADMAP.replaceAll('demo', 'demo2'));
  const draft3 = writeDraft(r.root, cfg, 'demo3.md', ROADMAP.replaceAll('demo', 'demo3'));
  capture(() => roadmapCommand({ cfg, args: ['publish', draft1], deps: { gh } }));
  capture(() => roadmapCommand({ cfg, args: ['publish', draft2], deps: { gh } }));
  capture(() => roadmapCommand({ cfg, args: ['publish', draft3], deps: { gh } }));
  return { cfg, gh };
}

// The predicate `enrolInto` hands `enrol` as `foreign`, pinned on BOTH its clauses: `demo1`/`demo2`
// alone pin `open`, but leave `o.mine === false` unpinned — drop that clause and both still pass,
// because the predicate then reads "any unopened roadmap is foreign" and `demo2` (opened) is
// unaffected either way. `demo3` is what catches it: MY OWN roadmap, never opened, would then
// enrol `dropped` too — a terminal status nothing here would ever schedule, which is exactly the
// failure this module's own header records happening three times in the source project (22, 15,
// 28 tasks silently unscheduled, each caught only by a human reading the board).
test('publish enrols not-mine+unopened dropped, not-mine+opened todo, and mine+unopened todo', () => {
  const { cfg } = publishThreeRoadmaps();
  const rows = readState(cfg.root).tasks;
  const notMineNotOpened = rows.find((row) => row.id === 'demo1/D1');
  const notMineOpened = rows.find((row) => row.id === 'demo2/D1');
  const mineNotOpened = rows.find((row) => row.id === 'demo3/D1');
  assert.equal(notMineNotOpened.status, 'dropped', 'not mine and not opened — dropped so nothing here ever schedules it');
  assert.equal(notMineOpened.status, 'todo', 'not mine, but opened — schedulable, so it enrols todo');
  assert.equal(mineNotOpened.status, 'todo', 'mine and never opened — openness only ever gates someone ELSE\'s roadmap');
});

// `cmdBoard` renders `b.notMine` as `not ours:` lines, and nothing else exercises that rendering
// through `roadmapCommand` — only `board.test.mjs` pins `reconcile()`'s array directly. `demo1/D1`
// is exactly the shape `notOurs` requires: a shared task (published, so the overlay has an entry)
// whose register row the earlier enrolment already dropped on purpose.
test('board reports a shared task the register dropped as "not ours", not a correction', () => {
  const { cfg, gh } = publishThreeRoadmaps();
  const { text } = capture(() => roadmapCommand({ cfg, args: ['board'], deps: { gh } }));
  const lines = text.split('\n');
  const notOursLines = lines.filter((l) => l.startsWith('not ours:'));
  assert.equal(notOursLines.length, 1);
  assert.match(notOursLines[0], /^not ours: demo1\/D1: shared, owned elsewhere \(issue #\d+\) — dropped here on purpose, derived todo$/);
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

// `board` and `publish` both used to list drafts themselves, deriving the slug as
// `basename(f, '.md')` — a THIRD copy of the rule `lib/store/draft.mjs` exists to hold, and the one
// that regresses to the filename. A draft named `zzz-notes.md` whose frontmatter says
// `roadmap: demo` was printed as `unpublished: zzz-notes`, a roadmap name that will never exist:
// publishing it produces `demo`. Both now go through `store.drafts()`, the twelfth interface method.
test('board names an unpublished draft by its frontmatter slug, never by its filename', () => {
  const { r, cfg } = offlineProject();
  writeDraft(r.root, cfg, 'zzz-notes.md', ROADMAP);
  const { text } = capture(() => roadmapCommand({ cfg, args: ['board'] }));
  assert.match(text, /^unpublished: demo is a draft — nobody else can see it$/m);
  assert.doesNotMatch(text, /zzz-notes/);
});

// The default target of a bare `publish` must be a decided draft, not whichever one the filesystem
// happened to hand back first: `store.drafts()` sorts, and this pins which draft that picks.
test('publish with no path takes the first draft in sorted order, and publishes its own slug', () => {
  const { r, cfg } = offlineProject();
  writeDraft(r.root, cfg, 'zzz-notes.md', ROADMAP.replaceAll('demo', 'zeta'));
  writeDraft(r.root, cfg, 'alpha-notes.md', ROADMAP.replaceAll('demo', 'alpha'));
  const { text } = capture(() => roadmapCommand({ cfg, args: ['publish'] }));
  assert.match(text, /published alpha: alpha\/D1/);
});
