// Reconciling the shared channel with what landed here.
//
// The status label is a PROJECTION of the board's derivation, never a source. Everything below
// computes the DIFFERENCE and nothing else, so a sync that changes nothing writes nothing — which is
// what makes it safe to run at the end of every landing and on every conductor tick.
import { LABELS } from './issues.mjs';
import { programmeOf } from './ownership.mjs';
import { isLanded } from '../../roadmap/board.mjs';

// The programme checklist, ticked from what actually closed. Two-way on purpose: a reopened issue
// unticks. A checklist that could only ever advance would drift ahead of the truth exactly once, and
// then say so for ever.
//
// Only a line that NAMES an issue is touched, and only at the start of its own line: a `- [ ] A1 — …`
// from a partly published programme stays as written, and prose that happens to contain a checkbox
// mid-sentence is prose.
export function tickChecklist(body, closedNumbers) {
  return String(body ?? '').replace(/^- \[[ xX]\] #(\d+) /gm,
    (_m, n) => `- [${closedNumbers.has(Number(n)) ? 'x' : ' '}] #${n} `);
}

// `review` maps onto `wip` because from outside they are the same fact: somebody is on it. There is
// no third label, and a LANDED row asks for none at all — done is the issue being closed, and a
// status label on a closed issue would be a second and weaker way to say it.
//
// Wanting none is not the same as having nothing to do: an issue published as `status:todo` and
// landed since is carrying a label that now reads as a lie, and stripping it is this function's job.
// That was the gap in the source — `landed` fell through the lookup and the label stayed for ever.
export function planLabels(rows) {
  const wanted = { todo: LABELS.todo, claimed: LABELS.wip, review: LABELS.wip };
  const STATUS = [LABELS.todo, LABELS.wip];
  const out = [];
  for (const r of rows ?? []) {
    if (!r.issue) continue;
    const landed = isLanded(r.status);
    if (!landed && !(r.status in wanted)) continue;
    const want = landed ? null : wanted[r.status];
    const has = r.labels ?? [];
    const stale = STATUS.filter((l) => l !== want && has.includes(l));
    if ((!want || has.includes(want)) && !stale.length) continue;
    out.push({ issue: r.issue, add: want && !has.includes(want) ? [want] : [], remove: stale });
  }
  return out;
}

// A roadmap ends when every one of its tasks is closed, and then its programme issue closes too —
// which is what makes a finished roadmap leave the board.
//
// A programme with NO tasks is one mid-publication, not a finished one: closing it would delete a
// roadmap between its first and second `createIssue`. And a programme whose checklist already
// matches and cannot close asks for nothing, so a tick that changed nothing writes nothing.
export function planProgrammes({ programmeIssues, taskIssues }) {
  const out = [];
  for (const p of programmeIssues ?? []) {
    if (p.state === 'closed') continue;
    const mine = (taskIssues ?? []).filter((t) => programmeOf(t.body) === p.number);
    const closed = new Set(mine.filter((t) => t.state === 'closed').map((t) => t.number));
    const body = tickChecklist(p.body, closed);
    const close = mine.length > 0 && closed.size === mine.length;
    if (!close && body === p.body) continue;
    out.push({ issue: p.number, body, close });
  }
  return out;
}

export function planSync({ rows, programmeIssues = [], taskIssues = [] }) {
  const close = [];
  for (const r of rows) {
    if (!r.issue) continue;
    // Gated on the ISSUE's state, never on the derived status: a task I own derives `landed` from
    // GIT, so a guard on the derived status would suppress the very close it was meant to trigger —
    // measured on the 2026-09-01 migration in planetCraft, 31 issues open and 18 of them provably
    // landed. An absent state closes nothing: a close against an already-shut issue is an error, and
    // being conservative here costs one tick.
    if (r.issueState === 'open' && r.landedHere)
      close.push({ issue: r.issue, key: r.key, subjects: r.subjects ?? [] });
  }
  return {
    close,
    labels: planLabels(rows),
    // Computed against the task states as they are NOW, so a task this run is about to close is
    // still open here and its programme closes on the NEXT sync — one tick or one landing later.
    // Closing it in the same pass would mean acting on a state not yet written, which is the worse
    // of the two: a roadmap that ends a minute late is a cosmetic lag, one that ends on a close that
    // then failed is a lie.
    programmes: planProgrammes({ programmeIssues, taskIssues }),
  };
}

export function applySync(gh, plan) {
  for (const c of plan.close)
    gh.closeIssue(c.issue, `Landed as:\n${c.subjects.map((s) => `- ${s}`).join('\n')}`);
  for (const l of plan.labels ?? [])
    gh.updateIssue(l.issue, { addLabels: l.add, removeLabels: l.remove });
  for (const p of plan.programmes ?? []) {
    gh.updateIssue(p.issue, { body: p.body });
    if (p.close) gh.closeIssue(p.issue, 'Every task on this roadmap has landed.');
  }
}
