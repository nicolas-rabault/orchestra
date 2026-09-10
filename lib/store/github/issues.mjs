// A roadmap becomes issues: one programme issue, one task issue per task.
//
// The block is rendered byte-for-byte re-parseable on purpose. That is what makes ONE grammar and
// TWO channels true rather than aspirational: reading a shared roadmap is parsing issue bodies
// with the same parser that reads a local file, so there is no second format to keep in step.
//
// Idempotence is matched on the TITLE key (`<roadmap>/<ID> — …`), never on body text or on a
// stored number, so publishing twice updates and a partially failed publish is resumable.
import { EMPTY } from '../../roadmap/parse.mjs';
import { programmeForRoadmap } from './ownership.mjs';

// `claimed` was renamed to `status:wip` — renamed IN PLACE on GitHub with `gh label edit --name`,
// so every issue that carried it kept it and no migration touched an issue body.
//
// There is deliberately no `status:done`. Done is the issue being CLOSED: a done label on an open
// issue would be a lie, and on a closed one a second and weaker way of saying what the state
// already says. Two ways to spell the same fact is how they start disagreeing.
export const LABELS = {
  programme: 'roadmap',
  task: 'task',
  todo: 'status:todo',
  wip: 'status:wip',
  open: 'open',
};

const listOr = (xs, quote) => (xs.length ? xs.map((x) => (quote ? `\`${x}\`` : x)).join(', ') : EMPTY);

export function renderTaskBlock(t) {
  return [
    `### ${t.id} — ${t.title}`,
    '',
    `- **Roadmap** ${t.roadmap}`,
    `- **Order** ${t.order ?? EMPTY}`,
    `- **Deps** ${listOr(t.deps, false)}`,
    `- **Touches** ${listOr(t.touches, true)}`,
    `- **Branch** \`${t.branch}\``,
    `- **Design** ${t.design ? 'yes' : 'no'}`,
    `- **Lane** ${t.lane ?? EMPTY}`,
    '',
    `**Why.** ${t.why}`,
    '',
    `**Acceptance.** ${t.acceptance}`,
    '',
    ...(t.scope !== undefined ? [`**Scope.** ${t.scope}`, ''] : []),
  ].join('\n');
}

export const taskTitle = (t) => `${t.key} — ${t.title}`;
export const keyFromTitle = (title) => title.split(' — ')[0].trim();

export function renderTaskIssue(t, programmeNumber) {
  return {
    title: taskTitle(t),
    body: `${renderTaskBlock(t)}\nProgramme: #${programmeNumber}\n`,
    // `status:todo` is written at creation rather than implied by the absence of a label: "no
    // label" and "never synced" would otherwise be the same picture on a board whose whole job is
    // to say, live, what nobody has started yet.
    labels: [LABELS.task, LABELS.todo],
  };
}

const checklistLine = (t, numbers) => {
  const n = numbers[t.key];
  return `- [ ] ${n ? `#${n} ` : ''}${t.id} — ${t.title}`;
};

// The grammar of one checklist line, and the ONLY reader of it besides `tickChecklist` in sync.mjs
// — which rewrites the mark in place and so pins the same shape. Capture 1 is the issue number when
// the line carries one, capture 2 the task id.
const CHECKLIST_LINE = /^- \[[ xX]\] (?:#(\d+) )?(\S+) — /;

export function renderProgrammeIssue({ roadmap, title, prose, tasks, numbers }) {
  const checklist = tasks.map((t) => checklistLine(t, numbers));
  return {
    title: `${roadmap} — ${title}`,
    body: [`- **Roadmap** ${roadmap}`, '', prose, '', '## Tasks', ...checklist, ''].join('\n'),
    labels: [LABELS.programme],
  };
}

// Publishing a follow-up task into a roadmap that already has a programme ADDS to it; it does not
// re-render it. The programme is the shared sheet a developer opens to see what is under way, and
// it is the one object nothing else reconciles: `board` checks every task line against git and the
// register, and would not notice its title, prose and ten of its eleven task lines being replaced
// by a one-task file's own heading. That is exactly what happened in the project this was ported
// from, on 2026-09-02: a second file took issue #120 from eleven checklist lines to one, `publish`
// printed `programme #120` just as it does for a first publication, `lint` had passed, and it was
// found hours later by accident (ticket `t-120tjoq`).
//
// So the prose is left exactly as it stands, and only lines for tasks the list does not already
// carry are appended, after the last line it does. Which also means the ticks `tickChecklist`
// writes survive a republish, where a full re-render used to reset every one of them to `- [ ]`.
// Rewriting a programme on purpose stays possible and stays manual (`gh issue edit`).
export function mergeProgrammeBody(existingBody, tasks, numbers) {
  const lines = String(existingBody ?? '').split('\n');
  const head = lines.findIndex((l) => l.trim() === '## Tasks');
  // A programme body with no task section at all — one written before the section existed, or one
  // a human trimmed. Append the section rather than refuse: the list is the part this owns.
  if (head < 0) {
    const trimmed = [...lines];
    while (trimmed.length && trimmed[trimmed.length - 1].trim() === '') trimmed.pop();
    const added = tasks.map((t) => checklistLine(t, numbers));
    return { body: [...trimmed, '', '## Tasks', ...added, ''].join('\n'), added: added.length };
  }
  // Identity by issue number where the line carries one and by task id otherwise, so a line
  // predating the number and a line predating a retitling are both recognised as already listed.
  const listed = new Set();
  let last = head;
  for (let i = head + 1; i < lines.length; i += 1) {
    const m = lines[i].match(CHECKLIST_LINE);
    if (!m) continue;
    if (m[1]) listed.add(`#${m[1]}`);
    listed.add(m[2]);
    last = i;
  }
  const added = tasks
    .filter((t) => !listed.has(t.id) && !listed.has(`#${numbers[t.key]}`))
    .map((t) => checklistLine(t, numbers));
  return { body: [...lines.slice(0, last + 1), ...added, ...lines.slice(last + 1)].join('\n'), added: added.length };
}

// The other half of the fix: a merge that says nothing is a merge nobody checks. `publish` printed
// the programme's number for a full rewrite exactly as it does for a first publication, which is
// why the damage was found hours later and by accident.
export function programmeReport({ programme, programmeCreated, programmeAdded, reopened }) {
  const reason = reopened ? ' (reopened — it had closed when its last task landed)' : '';
  if (programmeCreated) return `programme #${programme} created${reason}`;
  const lines = programmeAdded === 1 ? '1 task line' : `${programmeAdded} task lines`;
  const what = programmeAdded
    ? `completed: ${lines} added, title and prose left as they were`
    : 'completed: nothing to add, title and prose left as they were';
  return `programme #${programme} ${what}${reason}`;
}

export function planPublish({ roadmap, tasks, existing }) {
  const byKey = new Map(existing
    .filter((i) => i.labels?.includes(LABELS.task))
    .map((i) => [keyFromTitle(i.title), i]));
  const create = [];
  const update = [];
  for (const t of tasks) {
    if (t.roadmap !== roadmap) continue;
    const hit = byKey.get(t.key);
    if (hit) update.push({ number: hit.number, task: t });
    else create.push(t);
  }
  return { create, update };
}

export function publishIssues(gh, { roadmap, title, prose, tasks }) {
  // planPublish already drops a foreign-roadmap task when deciding create vs. update; filtered here
  // too so the checklist itself never lists one, instead of relying on every caller to pass a
  // tasks array pre-scoped to this roadmap.
  tasks = tasks.filter((t) => t.roadmap === roadmap);

  gh.ensureLabels(Object.values(LABELS));
  const existing = gh.listIssues({ labels: [LABELS.task] });
  const { create, update } = planPublish({ roadmap, tasks, existing });

  // The programme first, so a task issue can name it — created empty of numbers, then rewritten
  // with the checklist once the task numbers exist.
  // `programmeForRoadmap` (./ownership.mjs), not a second regex of the same shape: this decides
  // whether a publish CREATES a programme or updates one, and `open`/`reserve` decide which
  // programme a slug names, off what is supposed to be one match. They were byte-identical copies,
  // which is two matches that happen to agree.
  const programmes = gh.listIssues({ labels: [LABELS.programme] });
  const mine = programmeForRoadmap(programmes, roadmap);
  const shell = renderProgrammeIssue({ roadmap, title, prose, tasks, numbers: {} });
  const programmeCreated = !mine;
  const programme = mine?.number ?? gh.createIssue(shell);
  // A programme closed when its last task landed (planetCraft's `planProgrammes`, in
  // `tools/roadmap/sync.mjs`; a later phase here), being published into again.
  // Reopened BEFORE the task issues are written, so the roadmap is never momentarily a closed
  // programme with open tasks under it, and reopened only when there is something to put in it —
  // `tasks` is already scoped to this roadmap above.
  let reopened = false;
  if (mine?.state === 'closed' && tasks.length) { gh.reopenIssue(programme); reopened = true; }

  const numbers = Object.fromEntries(update.map(({ number, task }) => [task.key, number]));
  for (const t of create) numbers[t.key] = gh.createIssue(renderTaskIssue(t, programme));
  for (const { number, task } of update) {
    const i = renderTaskIssue(task, programme);
    gh.updateIssue(number, { title: i.title, body: i.body, addLabels: i.labels });
  }

  // Two different writes, because they answer two different questions. A programme this publish
  // just created is rendered whole — it is ours and it is empty. A programme that already existed
  // is COMPLETED: `mergeProgrammeBody` adds the lines it lacks and touches nothing else, and the
  // title is not passed at all, so no title edit is ever issued against it.
  let programmeAdded = 0;
  if (programmeCreated) {
    const full = renderProgrammeIssue({ roadmap, title, prose, tasks, numbers });
    gh.updateIssue(programme, { title: full.title, body: full.body, addLabels: full.labels });
    programmeAdded = tasks.length;
  } else {
    const merged = mergeProgrammeBody(mine.body, tasks, numbers);
    programmeAdded = merged.added;
    // A publish that adds no line writes nothing: the programme already carries the label it was
    // found by, so there is no second reason to edit it.
    if (merged.body !== mine.body) gh.updateIssue(programme, { body: merged.body });
  }
  return {
    programme, reopened, programmeCreated, programmeAdded,
    created: create.map((t) => t.key), updated: update.map((u) => u.task.key),
  };
}
