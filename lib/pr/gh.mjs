// The `gh` calls a sweep makes, and nothing else. Injected wherever it is used, so lib/pr/scan.mjs
// stays pure and the suite never reaches the network.
//
// The repository is READ, never hardcoded: this plugin is installed into projects it has never
// heard of, and the skills it replaces named one repository in a dozen places.
import { execFileSync } from 'node:child_process';

const run = (root, args) =>
  execFileSync('gh', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const FIELDS = [
  'number', 'title', 'author', 'createdAt', 'updatedAt', 'isDraft',
  'additions', 'deletions', 'changedFiles', 'labels', 'headRefOid', 'statusCheckRollup',
].join(',');

// `pass` only when every check that reported has passed: a rollup with a pending entry is pending,
// and a PR with no checks configured at all is `none`, which is not the same claim as green.
export function rollup(checks) {
  const states = (checks ?? []).map((c) => c.conclusion || c.state || '').map((s) => s.toUpperCase());
  if (!states.length) return 'none';
  if (states.some((s) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED'].includes(s))) return 'fail';
  if (states.some((s) => ['PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED', ''].includes(s))) return 'pending';
  return 'pass';
}

export function makeGh(root) {
  return {
    repo: () => JSON.parse(run(root, ['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner,
    pulls: () => JSON.parse(run(root, ['pr', 'list', '--state', 'open', '--limit', '200', '--json', FIELDS])),
    // The highest comment id from anybody but `me` — the watermark's second half. One call per PR,
    // which is why it is separate: the list above is one call for the whole board.
    lastOtherComment: (repo, number, me) => {
      const raw = run(root, ['api', `repos/${repo}/issues/${number}/comments`, '--paginate']);
      const ids = JSON.parse(raw).filter((c) => c.user?.login !== me).map((c) => c.id);
      return ids.length ? Math.max(...ids) : 0;
    },
    me: () => JSON.parse(run(root, ['api', 'user'])).login,
  };
}
