// The only place in tools/roadmap/ that talks to GitHub, and the only one that imports
// child_process. `run` is injectable so publish, claim, release and sync are all testable with a
// recorder and no network — which matters because their failure mode is destructive: a duplicated
// issue, a claim awarded to the wrong machine, a task closed that never landed.
import { execFileSync } from 'node:child_process';

const defaultRun = (args) =>
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const ISSUE_FIELDS = 'number,title,body,state,labels,assignees,author';

export function makeGh({ run = defaultRun } = {}) {
  const json = (args) => JSON.parse(run(args) || '[]');

  const flat = (i) => ({
    number: i.number,
    title: i.title,
    body: i.body ?? '',
    state: String(i.state).toLowerCase(),
    labels: (i.labels ?? []).map((l) => l.name ?? l),
    assignees: (i.assignees ?? []).map((a) => a.login ?? a),
    // A roadmap's owner is the author of its programme issue (tools/roadmap/ownership.mjs). null
    // rather than undefined: an author GitHub did not return — a deleted account — is a value the
    // ownership index must be able to test, not a hole that reads as "no owner" only by accident.
    author: i.author?.login ?? i.author ?? null,
  });

  return {
    me: () => run(['api', 'user', '--jq', '.login']).trim(),

    ensureLabels: (names) => {
      // --force makes it an upsert, so publishing twice is not an error.
      for (const n of names) run(['label', 'create', n, '--force']);
    },

    listIssues: ({ labels = [], state = 'all' } = {}) => {
      const args = ['issue', 'list'];
      if (labels.length > 0) args.push('--label', labels.join(','));
      const limit = 200;
      args.push('--state', state, '--limit', String(limit), '--json', ISSUE_FIELDS);
      const rows = json(args);
      // A result AT the cap is indistinguishable from one truncated BY it — `gh` gives no signal
      // either way. 29 issues were created in one day and `state: 'all'` keeps every landed task
      // forever, so silently returning a short list that reads as complete (a board missing rows,
      // a publish duplicating an issue it can no longer see) is worse than a loud, occasionally
      // over-cautious warning. To stdERR, never stdout: every caller of listIssues can be reached
      // through `board --json`, whose one contract is a single parseable JSON value on stdout.
      if (rows.length >= limit)
        console.error(`warning: gh issue list returned ${rows.length} issues, at the --limit ${limit} cap — the real count may be higher and this list may be truncated`);
      return rows.map(flat);
    },

    createIssue: ({ title, body, labels = [] }) => {
      const url = run(['issue', 'create', '--title', title, '--body', body,
        ...labels.flatMap((l) => ['--label', l])]).trim();
      const num = Number(url.split('/').pop());
      if (!Number.isInteger(num) || num <= 0) {
        throw new Error(`Failed to parse issue number from gh output: ${url}`);
      }
      return num;
    },

    updateIssue: (n, { title, body, addLabels = [], removeLabels = [], addAssignees = [], removeAssignees = [] } = {}) =>
      run(['issue', 'edit', String(n),
        ...(title ? ['--title', title] : []),
        ...(body ? ['--body', body] : []),
        ...addLabels.flatMap((l) => ['--add-label', l]),
        ...removeLabels.flatMap((l) => ['--remove-label', l]),
        ...addAssignees.flatMap((a) => ['--add-assignee', a]),
        ...removeAssignees.flatMap((a) => ['--remove-assignee', a])]),

    // Single-label/-assignee counterparts to updateIssue's arrays above, for a caller that only
    // ever touches one at a time (claim, release, openRoadmap, reserve) and would otherwise have
    // to wrap a lone value in an array just to reach the same flag.
    addLabel: (n, label) => run(['issue', 'edit', String(n), '--add-label', label]),
    removeLabel: (n, label) => run(['issue', 'edit', String(n), '--remove-label', label]),
    assign: (n, who) => run(['issue', 'edit', String(n), '--add-assignee', who]),

    comment: (n, body) => run(['issue', 'comment', String(n), '--body', body]),

    // Oldest first, so a caller comparing claim stamps reads them in the order they were posted.
    // Ties on createdAt (second granularity) are broken by author login — a string both machines see.
    listComments: (n) =>
      (json(['issue', 'view', String(n), '--json', 'comments']).comments ?? [])
        .map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, author: c.author?.login ?? '' }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.author.localeCompare(b.author)),

    closeIssue: (n, body) => run(['issue', 'close', String(n), ...(body ? ['--comment', body] : [])]),

    // Its counterpart, and the reason it exists: `planProgrammes` closes a programme when its last
    // task closes, and skips a closed programme for ever after. So publishing a NEW task into a
    // roadmap that had finished used to leave the programme shut — a finished roadmap holding
    // unfinished work, which is what the monitor and every reader would then see. `publish` is the
    // only caller; nothing else here reopens anything.
    reopenIssue: (n, body) => run(['issue', 'reopen', String(n), ...(body ? ['--comment', body] : [])]),
  };
}
