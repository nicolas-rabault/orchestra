// One `gh` recorder, for every suite that needs one: issues in memory, no network, in place of the
// CLI `lib/store/github/gh.mjs` shells out to.
//
// There were three of these — in `both-modes`, in `cli-roadmap` and in `store-github` — with three
// different method sets: one lacked `unassign`, one stubbed calls the adapter does not have. So the
// acceptance suite, whose one job is to hold the two modes to ONE behaviour, was comparing them
// against a different GitHub simulation from the one the CLI suite used, and the next method a
// store started calling would have crashed one suite instead of being compared in it.
//
// It implements what the adapter exposes and the stores actually call. `comment` and `listComments`
// are deliberately absent: no store path reaches either in this phase, and a stub for a call
// nobody makes is one more thing to keep honest for nothing.
export function makeFakeGh({ issues = [], me = 'nico' } = {}) {
  // Seeded issues get the shape `gh.listIssues` flattens to, so a fixture only has to write the
  // fields its own assertion is about.
  const state = issues.map((i) => ({
    labels: [], assignees: [], state: 'open', body: '', ...i,
  }));
  const calls = [];
  let next = 100;
  const find = (n) => state.find((i) => i.number === n);
  return {
    state,
    calls,
    me: () => me,
    ensureLabels: (names) => calls.push(['ensureLabels', names]),
    listIssues: ({ labels = [] } = {}) => state.filter((i) => labels.every((l) => i.labels.includes(l))),
    // `author: me` by default: an issue this identity created is one it authored, which is exactly
    // what ownership reads off a programme issue.
    createIssue: (i) => {
      next += 1;
      state.push({
        number: next, state: 'open', labels: [], assignees: [], author: me, ...i,
      });
      calls.push(['create', i.title]);
      return next;
    },
    // Mirrors the real adapter's shape (lib/store/github/gh.mjs): `addLabels`/`removeLabels` are
    // DIFFS against the issue's current `labels`, never a raw `Object.assign` of a field so named —
    // `sync` is the first caller to pass them, and a stub that stored the diff arrays as literal
    // properties instead of applying them would leave a stale `status:todo` on a closed issue and
    // call it stripped. No `addAssignees`/`removeAssignees` here: `claim`/`release` are the only
    // callers that touch assignees and they use the single-value `assign`/`unassign` below — a diff
    // form nobody calls is one more thing to keep honest for nothing.
    updateIssue: (n, { addLabels = [], removeLabels = [], ...rest }) => {
      calls.push(['update', n]);
      const issue = find(n);
      Object.assign(issue, rest);
      if (removeLabels.length) issue.labels = issue.labels.filter((l) => !removeLabels.includes(l));
      for (const l of addLabels) if (!issue.labels.includes(l)) issue.labels.push(l);
    },
    reopenIssue: (n) => { calls.push(['reopen', n]); find(n).state = 'open'; },
    // `body` recorded on the call, not just the fact of closing: `sync.mjs`'s `applySync` writes
    // "Landed as:\n- <subject>" as the close's own comment — the only durable record on the shared
    // channel of what actually landed — and nothing could assert it while this dropped the argument.
    closeIssue: (n, body) => { calls.push(['close', n, body]); find(n).state = 'closed'; },
    addLabel: (n, l) => { const i = find(n); if (!i.labels.includes(l)) i.labels.push(l); },
    // Real removals, not no-ops: `reserve` and `release` are read back by later assertions, and a
    // stub that always succeeds silently is how their own bugs went untested.
    removeLabel: (n, l) => { const i = find(n); i.labels = i.labels.filter((x) => x !== l); },
    assign: (n, who) => { calls.push(['assign', n, who]); find(n).assignees.push(who); },
    unassign: (n, who) => {
      calls.push(['unassign', n, who]);
      const i = find(n);
      i.assignees = i.assignees.filter((x) => x !== who);
    },
  };
}
