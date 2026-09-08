// A `gh` BINARY on PATH, for the suites that spawn a HOOK.
//
// `test/helpers/gh.mjs` is a recorder an in-process store is handed, and it cannot reach these
// tests at all: a hook shells out to `bin/orchestra roadmap board --json`, so the only seam between
// the test and the board a hook actually reads is the PATH that subprocess inherits.
//
// Written inside the fixture repository's own root, so it dies with `makeRepo`'s cleanup and no
// suite has to remember to remove it. Nothing in a board's derivation looks at the working tree —
// `gatherGit` asks git for refs and for main's subjects — so an extra untracked directory changes
// no answer.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRoadmap } from '../../lib/roadmap/parse.mjs';
import { LABELS, renderTaskIssue } from '../../lib/store/github/issues.mjs';
import { ROADMAP } from './fixture.mjs';

// The two calls every `board --json` makes in online mode, and one catch-all. Dispatched on the
// label, which is what tells the task listing from the programme listing (lib/store/github/gh.mjs
// builds both from `issue list`), with a trailing space in the pattern so `--label roadmap ` cannot
// also match a label that merely starts with it.
export function fakeGhOnPath(root, { me = 'nico', taskIssues = [], programmeIssues = [] } = {}) {
  const dir = join(root, '.fake-bin');
  mkdirSync(dir, { recursive: true });
  const tasks = join(dir, 'tasks.json');
  const programmes = join(dir, 'programmes.json');
  writeFileSync(tasks, JSON.stringify(taskIssues));
  writeFileSync(programmes, JSON.stringify(programmeIssues));
  writeFileSync(join(dir, 'gh'), [
    '#!/bin/sh',
    'case "$* " in',
    `  *"api user"*) echo '${me}' ;;`,
    `  *"--label ${LABELS.task} "*) cat '${tasks}' ;;`,
    `  *"--label ${LABELS.programme} "*) cat '${programmes}' ;;`,
    "  *) echo '[]' ;;",
    'esac',
    '',
  ].join('\n'));
  chmodSync(join(dir, 'gh'), 0o755);
  return { PATH: `${dir}:${process.env.PATH}` };
}

// The one board state in which `guard-claim` still refuses, now that a row whose store records no
// claim fails open (`startVerdict`'s `unrecordable`, lib/roadmap/policy.mjs): ONLINE, my own
// roadmap, and a colleague's name on the issue — a claim that really was recorded, by somebody
// else. That is the case the guard exists for, and the only shape that proves it still holds.
//
// The task body is rendered by the SAME `renderTaskIssue` the store publishes with, never typed out
// here: a body this helper wrote itself would keep parsing after the grammar moved, the row would
// quietly leave the board, and every assertion below it would pass against an empty board.
export function foreignClaim({ me = 'nico', holder = 'colleague' } = {}) {
  const issue = renderTaskIssue(parseRoadmap(ROADMAP).tasks[0], 1);
  return {
    me,
    taskIssues: [{
      number: 2,
      title: issue.title,
      body: issue.body,
      state: 'OPEN',
      labels: [{ name: LABELS.task }, { name: LABELS.wip }],
      assignees: [{ login: holder }],
      author: { login: me },
    }],
    // Authored by `me`, so the roadmap is MINE and the refusal under test is the claim. A programme
    // somebody else authored would be refused as `foreign` whatever the assignee said, which is a
    // different rule passing for a different reason.
    programmeIssues: [{
      number: 1,
      title: 'demo — Demo',
      body: '- **Roadmap** demo\n',
      state: 'OPEN',
      labels: [],
      assignees: [],
      author: { login: me },
    }],
  };
}
