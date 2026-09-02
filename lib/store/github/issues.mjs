// A roadmap becomes issues: one programme issue, one task issue per task.
//
// The block is rendered byte-for-byte re-parseable on purpose. That is what makes ONE grammar and
// TWO channels true rather than aspirational: reading a shared roadmap is parsing issue bodies
// with the same parser that reads a local file, so there is no second format to keep in step.
//
// Idempotence is matched on the TITLE key (`<roadmap>/<ID> — …`), never on body text or on a
// stored number, so publishing twice updates and a partially failed publish is resumable.
import { EMPTY } from '../../roadmap/parse.mjs';

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
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

export function renderProgrammeIssue({ roadmap, title, prose, tasks, numbers }) {
  const checklist = tasks.map((t) => {
    const n = numbers[t.key];
    return `- [ ] ${n ? `#${n} ` : ''}${t.id} — ${t.title}`;
  });
  return {
    title: `${roadmap} — ${title}`,
    body: [`- **Roadmap** ${roadmap}`, '', prose, '', '## Tasks', ...checklist, ''].join('\n'),
    labels: [LABELS.programme],
  };
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
  const programmes = gh.listIssues({ labels: [LABELS.programme] });
  const mine = programmes.find((i) => new RegExp(`^- \\*\\*Roadmap\\*\\* ${escapeRegExp(roadmap)}$`, 'm').test(i.body));
  const shell = renderProgrammeIssue({ roadmap, title, prose, tasks, numbers: {} });
  const programme = mine?.number ?? gh.createIssue(shell);
  // A programme `planProgrammes` closed when its last task landed, being published into again.
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

  const full = renderProgrammeIssue({ roadmap, title, prose, tasks, numbers });
  gh.updateIssue(programme, { title: full.title, body: full.body, addLabels: full.labels });
  return { programme, reopened, created: create.map((t) => t.key), updated: update.map((u) => u.task.key) };
}
