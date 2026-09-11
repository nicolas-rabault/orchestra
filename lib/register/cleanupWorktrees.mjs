// Reconcile terminal rows with Git on every conductor pass, including rows already archived.
// A status or a matching commit subject is not proof that ALL of a branch has landed.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { relative, isAbsolute } from 'node:path';
import { gitEnv } from '../paths.mjs';
import { loadArchive, TERMINAL } from './archive.mjs';
import { gatherLiveness } from './liveness.mjs';
import { running } from './drive.mjs';
import { codexStatus } from './codex.mjs';
import { append } from './journal.mjs';

export function cleanupWorktrees(cfg, tasks, { liveness = gatherLiveness } = {}) {
  const result = { removed: [], kept: [] };
  const rows = new Map(loadArchive(cfg.root).filter(r => r.kind === 'task').map(r => [r.id, r]));
  for (const row of tasks) rows.set(row.id, row);
  const active = new Set([...rows.values()].filter(r => !TERMINAL.has(r.status)).map(r => r.branch));
  const terminal = [...rows.values()].filter(r => TERMINAL.has(r.status) && r.branch && r.mine !== false);
  if (!terminal.length) return result;
  const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], {
    env: gitEnv(), encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const trees = git(cfg.root, ['worktree', 'list', '--porcelain', '-z']).split('\0\0').filter(Boolean)
    .map(block => Object.fromEntries(block.split('\0').filter(Boolean).map(field => {
      const space = field.indexOf(' ');
      return space < 0 ? [field, true] : [field.slice(0, space), field.slice(space + 1)];
    })));
  const candidates = trees.filter(tree => tree.branch && terminal.some(r => tree.branch === `refs/heads/${r.branch}`));
  if (!candidates.length) return result;
  // Terminal workers need the same fresh liveness witnesses as active workers. A failed witness
  // blocks deletion; the scheduler's more permissive fallback is not safe for housekeeping.
  const workers = terminal.filter(r => candidates.some(tree => tree.branch === `refs/heads/${r.branch}`));
  const live = liveness(cfg.root, workers.map(r => ({ ...r, status: 'claimed' })));
  for (const tree of candidates) {
    const branch = tree.branch.slice('refs/heads/'.length);
    const owners = workers.filter(r => r.branch === branch);
    const entry = { id: owners[0].id, branch, path: tree.worktree };
    try {
      const path = realpathSync(tree.worktree);
      const fromTree = relative(path, realpathSync(process.cwd()));
      if (path === realpathSync(cfg.root) || (!isAbsolute(fromTree) && fromTree !== '..' && !fromTree.startsWith('../')))
        throw new Error('main or current checkout');
      if (active.has(branch)) throw new Error('branch still belongs to an active task');
      if (tree.locked) throw new Error('worktree is locked');
      for (const row of owners) {
        if (!row.session) continue;
        if (row.runtime === 'codex') {
          if (codexStatus(row) !== 'completed') throw new Error('refresh native task snapshot: worker is not confirmed completed');
        } else {
          if (live.errors.length) throw new Error('worker liveness unavailable');
          if (running(row, live, Date.now())) throw new Error('worker is still running');
        }
      }
      // Use full refs, not an ambiguous branch/tag name. Re-read the checked-out tip immediately
      // before removal so switching this tree to another branch cannot reuse the old proof.
      if (git(path, ['symbolic-ref', '-q', 'HEAD']).trim() !== tree.branch) throw new Error('worktree branch changed');
      try { git(path, ['merge-base', '--is-ancestor', 'HEAD', `refs/heads/${cfg.mainBranch}`]); }
      catch { throw new Error(`branch is not proven merged into ${cfg.mainBranch}`); }
      // Include ignored files: recordings and local configuration can be ignored too. Never force
      // a deferred cleanup; unlike the gate, we cannot attribute dirt to the tests it just ran.
      if (git(path, ['status', '--porcelain', '--untracked-files=all', '--ignored']).trim())
        throw new Error('local changes or untracked/ignored files remain');
      git(cfg.root, ['worktree', 'remove', '--', path]);
      result.removed.push(entry);
    } catch (e) {
      result.kept.push({ ...entry, reason: String(e.stderr || e.message).trim() });
    }
  }
  for (const entry of result.removed) append(cfg.root, {
    kind: 'note', task: entry.id, text: `Removed merged worktree ${entry.path} (${entry.branch})`,
  });
  return result;
}
