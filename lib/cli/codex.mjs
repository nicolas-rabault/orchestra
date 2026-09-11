import { readFileSync } from 'node:fs';
import { appendLine } from '../jsonl.mjs';
import { loadArchive, archivePath, TERMINAL } from '../register/archive.mjs';
import { readState, writeState } from '../register/state.mjs';
import { attachCodex, recordDispatch, observeCodex } from '../register/codex.mjs';
export function codexCommand({ cfg, args }) {
  const [action, key, value, ...flags] = args;
  if (!['attach', 'dispatched', 'observe'].includes(action) || !key || !value) throw new Error('usage: codex attach <task> <threadId> [--host=local] | codex dispatched|observe <task> <JSON file>');
  const state = readState(cfg.root);
  const i = state?.tasks?.findIndex((row) => row.id === key) ?? -1;
  // Archived workers can still own a held worktree. Refresh their observation without
  // resurrecting a task or enabling another dispatch; the latest archive entry wins.
  if (i < 0 && action === 'observe') {
    const row = loadArchive(cfg.root).filter(r => r.kind === 'task' && r.id === key).at(-1);
    if (row && TERMINAL.has(row.status)) {
      const next = observeCodex(row, JSON.parse(readFileSync(value, 'utf8')));
      appendLine(archivePath(cfg.root), JSON.stringify(next));
      process.stdout.write(`${JSON.stringify(next, null, 2)}\n`);
      return;
    }
  }
  if (i < 0) throw new Error(`no register row: ${key}`);
  const row = state.tasks[i];
  if (action === 'attach' && state.tasks.some((r, n) => n !== i && r.runtime === 'codex' && r.session === value)) throw new Error('native task is already attached to another row');
  const next = action === 'attach' ? attachCodex(row, value, flags.find((f) => f.startsWith('--host='))?.slice(7) ?? 'local')
    : (action === 'dispatched' ? recordDispatch : observeCodex)(row, JSON.parse(readFileSync(value, 'utf8')), Date.now(), cfg);
  state.tasks[i] = next;
  writeState(cfg.root, state);
  process.stdout.write(`${JSON.stringify(next, null, 2)}\n`);
}
