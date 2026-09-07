// The routing, with no network anywhere near it: `routePulls` is pure, and this is the whole of
// what a sweep's grouping does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routePulls, sizeOf } from '../lib/pr/scan.mjs';
import { makeRepo } from './helpers/fixture.mjs';
import { loadConfig } from '../lib/config.mjs';
import { append } from '../lib/pr/ledger.mjs';
import { prCommand } from '../lib/cli/pr.mjs';

// Captures everything a `prCommand` call writes to stdout, same shape as `test/cli-roadmap.test.mjs`.
function capture(fn) {
  const realWrite = process.stdout.write.bind(process.stdout);
  let text = '';
  process.stdout.write = (chunk) => { text += chunk; return true; };
  try {
    fn();
    return { text };
  } finally {
    process.stdout.write = realWrite;
  }
}

const NOW = new Date('2026-09-07T12:00:00Z');
const days = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

const pull = (over = {}) => ({
  number: 1,
  title: 'a change',
  author: 'someone',
  additions: 20,
  deletions: 2,
  changedFiles: 1,
  createdAt: days(3),
  updatedAt: days(1),
  headRefOid: 'aaa',
  ci: 'pass',
  lastOtherCommentId: 0,
  ...over,
});

const route = (pulls, records = []) =>
  routePulls(pulls, new Map(records.map((r) => [r.pr, r])), { now: NOW });

test('size is measured on the diff, not on the file count', () => {
  assert.equal(sizeOf({ additions: 43, deletions: 1 }), 'small');
  assert.equal(sizeOf({ additions: 400, deletions: 20 }), 'medium');
  assert.equal(sizeOf({ additions: 9339, deletions: 4223 }), 'huge');
});

test('a bot PR nobody has looked at is a settled clear', () => {
  const [row] = route([pull({ number: 91, author: 'dependabot[bot]' })]);
  assert.equal(row.bot, true);
  assert.equal(row.group, 'settled');
});

test('a small human PR nobody has looked at is a quick win, a big one is new work', () => {
  const rows = route([
    pull({ number: 89, additions: 43, deletions: 1 }),
    pull({ number: 81, additions: 9339, deletions: 4223 }),
  ]);
  assert.equal(rows.find((r) => r.number === 89).group, 'quick-win');
  assert.equal(rows.find((r) => r.number === 81).group, 'new');
});

test('a new head since the record is movement; the same head is not', () => {
  const seen = { pr: 64, verdict: 'review', head: 'aaa', last_other_comment_id: 10 };
  const moved = route([pull({ number: 64, headRefOid: 'bbb' })], [seen])[0];
  const still = route([pull({ number: 64, headRefOid: 'aaa' })], [seen])[0];
  assert.equal(moved.moved, true);
  assert.equal(moved.group, 'author-moved');
  assert.equal(still.moved, false);
  assert.equal(still.group, 'waiting-on-author');
});

test('a comment from anyone but the maintainer is movement too', () => {
  const seen = { pr: 59, verdict: 'review', head: 'aaa', last_other_comment_id: 10 };
  const [row] = route([pull({ number: 59, lastOtherCommentId: 42 })], [seen]);
  assert.equal(row.moved, true);
  assert.equal(row.group, 'author-moved');
});

test('a declined PR whose author came back is its own group, and a dismissed one is not', () => {
  const declined = route(
    [pull({ number: 40, headRefOid: 'bbb' })],
    [{ pr: 40, verdict: 'decline', head: 'aaa', last_other_comment_id: 0 }],
  )[0];
  assert.equal(declined.group, 'declined-author-responded');

  const dismissed = route(
    [pull({ number: 41, headRefOid: 'aaa' })],
    [{ pr: 41, verdict: 'dismissed', head: 'aaa', last_other_comment_id: 0 }],
  )[0];
  assert.equal(dismissed.group, 'silent');
});

test('a merge verdict stays yours to click until the PR is gone', () => {
  const [row] = route(
    [pull({ number: 91, headRefOid: 'aaa' })],
    [{ pr: 91, verdict: 'merge', head: 'aaa', last_other_comment_id: 0 }],
  );
  assert.equal(row.group, 'ready-for-your-merge');
});

test('a failing check is its own group whatever the size, and idle days are measured', () => {
  const [row] = route([pull({ number: 73, ci: 'fail', updatedAt: days(52) })]);
  assert.equal(row.group, 'ci-fail');
  assert.equal(row.idleDays, 52);
});

test('pr scan --json folds the ledger in and never touches the network', () => {
  const r = makeRepo({ mode: 'offline' });
  const cfg = loadConfig(r.root);
  append(cfg, { pr: 64, verdict: 'review', head: 'aaa' });

  const gh = {
    repo: () => 'acme/thing',
    me: () => 'nico',
    pulls: () => [
      { number: 64, title: 'a fix', author: { login: 'eaozone' }, additions: 5, deletions: 1, changedFiles: 1, createdAt: days(9), updatedAt: days(1), headRefOid: 'bbb', statusCheckRollup: [{ conclusion: 'SUCCESS' }] },
    ],
    lastOtherComment: () => 0,
  };

  const { text } = capture(() => prCommand({ cfg, args: ['scan', '--json'], deps: { gh } }));
  const out = JSON.parse(text);
  assert.equal(out.repo, 'acme/thing');
  assert.equal(out.rows[0].group, 'author-moved');
  assert.equal(out.rows[0].ci, 'pass');
  r.cleanup();
});
