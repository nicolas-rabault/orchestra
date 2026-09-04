// `sync` is the only command that writes to the shared channel off what git says landed, so its
// failure mode is destructive: a task closed that never landed. Tested with the recorder, never a
// network — `test/helpers/gh.mjs` is the one GitHub simulation every suite here shares.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickChecklist, planLabels, planProgrammes, planSync } from '../lib/store/github/sync.mjs';
import { LABELS } from '../lib/store/github/issues.mjs';
import { UNVERIFIED } from '../lib/roadmap/board.mjs';

test('the checklist ticks and UNTICKS from what actually closed', () => {
  // Two-way on purpose: a reopened issue unticks. A checklist that could only ever advance would
  // drift ahead of the truth exactly once, and then say so for ever.
  const body = '## Tasks\n- [ ] #11 D1 — one\n- [x] #12 D2 — two\n- [ ] D3 — unpublished\n';
  const out = tickChecklist(body, new Set([11]));
  assert.match(out, /- \[x\] #11 D1/);
  assert.match(out, /- \[ \] #12 D2/);
  // A line naming no issue is left exactly as written: a partly published programme is not a lie.
  assert.match(out, /- \[ \] D3 — unpublished/);
});

test('a landed task wants NO status label, and a stale one is stripped', () => {
  // That was the gap in the source: `landed` fell through the wanted-label lookup and an issue
  // published as `status:todo` kept carrying it after it landed, where it now reads as a lie.
  assert.deepEqual(planLabels([{ issue: 7, status: 'landed', labels: [LABELS.todo] }]),
    [{ issue: 7, add: [], remove: [LABELS.todo] }]);
  // `review` maps onto `wip`: from outside they are the same fact, somebody is on it.
  assert.deepEqual(planLabels([{ issue: 8, status: 'review', labels: [LABELS.todo] }]),
    [{ issue: 8, add: [LABELS.wip], remove: [LABELS.todo] }]);
  // A sync that changes nothing writes nothing — which is what makes it safe to run at the end of
  // every landing and on every tick.
  assert.deepEqual(planLabels([{ issue: 9, status: 'todo', labels: [LABELS.todo] }]), []);
  assert.deepEqual(planLabels([{ issue: 10, status: 'landed', labels: [] }]), []);
});

test('an unverified row keeps its status:todo — the derivation is not landed, so the label is not a lie', () => {
  // Gated on the STRICT status, never on `isLanded` (which also admits UNVERIFIED): a status label
  // is a projection of the derivation, and 22 of 41 landed rows in planetCraft carried no recorded
  // subject at all — stripping the label here would leave an open issue with no `status:` label and
  // nothing having closed it, findable only through a local `unverified:` line.
  assert.deepEqual(planLabels([{ issue: 14, status: UNVERIFIED, labels: [LABELS.todo] }]), []);
  // And `planSync` never closes it either: `landedHere` is false for exactly the same reason.
  const plan = planSync({
    rows: [{ key: 'demo/D4', issue: 14, issueState: 'open', status: UNVERIFIED, labels: [LABELS.todo],
      landedHere: false, subjects: [] }],
    programmeIssues: [], taskIssues: [],
  });
  assert.deepEqual(plan.close, []);
  assert.deepEqual(plan.labels, []);
});

test('a programme closes only when it has tasks and every one of them is closed', () => {
  const programmeIssues = [{ number: 1, state: 'open', body: '## Tasks\n- [ ] #11 D1 — one\n' }];
  const closedAll = planProgrammes({
    programmeIssues,
    taskIssues: [{ number: 11, state: 'closed', body: 'Programme: #1\n' }],
  });
  assert.equal(closedAll[0].close, true);
  assert.match(closedAll[0].body, /- \[x\] #11/);

  // A programme with NO tasks is one mid-publication, not a finished one: closing it would delete a
  // roadmap between its first and second issue creation.
  assert.deepEqual(planProgrammes({ programmeIssues, taskIssues: [] }), []);
  // A closed programme is never revisited.
  assert.deepEqual(planProgrammes({
    programmeIssues: [{ ...programmeIssues[0], state: 'closed' }],
    taskIssues: [{ number: 11, state: 'closed', body: 'Programme: #1\n' }],
  }), []);
});

test('a task closes only on subjects the register recorded AND main carries', () => {
  const rows = [
    { key: 'demo/D1', issue: 11, issueState: 'open', status: 'landed', labels: [],
      landedHere: true, subjects: ['feat: one'] },
    // Landed by somebody else: their commit never reaches this machine's main, and their own
    // machine closes their own issue.
    { key: 'demo/D2', issue: 12, issueState: 'open', status: 'landed', labels: [],
      landedHere: false, subjects: [] },
    // Already closed: a close against a shut issue is an error, and being conservative costs a tick.
    { key: 'demo/D3', issue: 13, issueState: 'closed', status: 'landed', labels: [],
      landedHere: true, subjects: ['feat: three'] },
  ];
  const plan = planSync({ rows, programmeIssues: [], taskIssues: [] });
  assert.deepEqual(plan.close, [{ issue: 11, key: 'demo/D1', subjects: ['feat: one'] }]);
});

test("a row with no issue is not the shared channel's business", () => {
  const plan = planSync({
    rows: [{ key: 'demo/D1', issue: null, status: 'landed', landedHere: true, subjects: ['x'] }],
    programmeIssues: [], taskIssues: [],
  });
  assert.deepEqual(plan.close, []);
  assert.deepEqual(plan.labels, []);
});
