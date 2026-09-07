// Every open pull request, routed into a group, folded against what the ledger says was last seen.
//
// PURE — pulls in, rows out — for the reason lib/store/github/ splits the same way: the routing is
// the part that must be exercised, and a rule that can only be tested against a live tracker is a
// rule nobody edits with confidence. lib/pr/gh.mjs is the half that shells out.
//
// This file ROUTES and does not RECOMMEND. Whether a PR should be merged, reviewed, declined or
// dismissed is the sweep skill's judgement, formed against the project's own direction files, and
// encoding it here would turn an opinion an operator can overrule into a rule they cannot.

const DAY = 86400000;
const daysSince = (iso, now) => Math.floor((now.getTime() - new Date(iso).getTime()) / DAY);

// Measured on the DIFF, never on the file count: a rename touching forty files is not a big change
// and a single-file rewrite of a module is not a small one.
export function sizeOf({ additions = 0, deletions = 0 }) {
  const n = additions + deletions;
  if (n > 1000) return 'huge';
  if (n <= 100) return 'small';
  return 'medium';
}

// GitHub's own convention: an app's login is suffixed. Matched on the suffix rather than on a list
// of names, so a project's own bot is recognised without this file knowing it exists.
export const isBot = (author) => /\[bot\]$/.test(String(author ?? ''));

// A PR has MOVED when its head is not the head that was reviewed, or when somebody other than the
// maintainer has commented since. The maintainer's own activity never counts: they are the person
// this whole report is for, and their comment resurfacing their own PR is noise.
//
// No record at all is deliberately NOT movement — it is a PR nobody has looked at, which is a
// different fact and gets its own groups below.
export function hasMoved(pull, record) {
  if (!record) return false;
  if (record.head && pull.headRefOid !== record.head) return true;
  return (pull.lastOtherCommentId ?? 0) > (record.last_other_comment_id ?? 0);
}

export function groupOf(row) {
  if (row.ci === 'fail') return 'ci-fail';
  if (!row.record) {
    if (row.bot) return 'settled';
    return row.size === 'small' ? 'quick-win' : 'new';
  }
  if (row.moved) return row.record.verdict === 'decline' ? 'declined-author-responded' : 'author-moved';
  if (row.record.verdict === 'merge') return 'ready-for-your-merge';
  if (row.record.verdict === 'review') return 'waiting-on-author';
  return 'silent';
}

export function routePulls(pulls, byPr = new Map(), { now = new Date() } = {}) {
  return pulls.map((p) => {
    const record = byPr.get(p.number) ?? null;
    const row = {
      number: p.number,
      title: p.title,
      author: p.author,
      bot: isBot(p.author),
      adds: p.additions ?? 0,
      dels: p.deletions ?? 0,
      files: p.changedFiles ?? 0,
      size: sizeOf(p),
      ci: p.ci ?? 'none',
      ageDays: daysSince(p.createdAt, now),
      idleDays: daysSince(p.updatedAt, now),
      headRefOid: p.headRefOid,
      lastOtherCommentId: p.lastOtherCommentId ?? 0,
      record,
      moved: hasMoved(p, record),
    };
    return { ...row, group: groupOf(row) };
  });
}
