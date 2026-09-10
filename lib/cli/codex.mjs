import { readFileSync } from 'node:fs';
import { readState, writeState } from '../register/state.mjs';
import { attachCodex, recordDispatch, observeCodex } from '../register/codex.mjs';
export function codexCommand({ cfg, args }) {
  const [action, key, value, ...flags] = args;
  if (!['attach', 'dispatched', 'observe'].includes(action) || !key || !value) throw new Error('usage: codex attach <task> <threadId> [--host=local] | codex dispatched|observe <task> <JSON file>');
  const state = readState(cfg.root);
  const i = state?.tasks?.findIndex((row) => row.id === key) ?? -1;
  if (i < 0) throw new Error(`no register row: ${key}`);
  const row = state.tasks[i];
  if (action === 'attach' && state.tasks.some((r, n) => n !== i && r.runtime === 'codex' && r.session === value)) throw new Error('native task is already attached to another row');
  const next = action === 'attach' ? attachCodex(row, value, flags.find((f) => f.startsWith('--host='))?.slice(7) ?? 'local')
    : (action === 'dispatched' ? recordDispatch : observeCodex)(row, JSON.parse(readFileSync(value, 'utf8')));
  state.tasks[i] = next;
  writeState(cfg.root, state);
  process.stdout.write(`${JSON.stringify(next, null, 2)}\n`);
}
