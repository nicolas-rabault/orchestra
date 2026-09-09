// `orchestra brief <task key> [--relaunch] [--handover <n>] [--repo <owner/name>]`
//
// Prints the worker's brief, ready to be the `claude --bg` prompt. See `lib/register/brief.mjs`
// for what it contains and why it is rendered here rather than composed by hand once per launch.
//
// The row comes from whichever store HOLDS the key, the same routing every other keyed subcommand
// uses (`lib/cli/roadmap.mjs`'s `storeForKey`): online a `destination: local` roadmap — which is
// what a pull-request sweep writes — lives in the file store, and the GitHub store has never heard
// of its keys.
//
// `base` and `note` are read from the register rather than passed: the sweep writes `base` onto the
// row (`skills/pr-sweep/SKILL.md`, "The fetch, and `base`"), and a retirement writes `note`, so a
// caller that had to supply either would be copying out of a file this command can read itself.
import { execFileSync } from 'node:child_process';
import { makeStore } from '../store/index.mjs';
import { readState } from '../register/state.mjs';
import { renderBrief } from '../register/brief.mjs';
import { gitEnv } from '../paths.mjs';

const stores = (cfg) => (cfg.mode === 'offline'
  ? [makeStore(cfg)]
  : [makeStore(cfg), makeStore(cfg, {}, { destination: 'local' })]);

export function briefCommand({ cfg, args }) {
  const key = args.find((a) => !a.startsWith('--'));
  if (!key) throw new Error('orchestra brief: needs a task key, `<roadmap>/<ID>`');

  const relaunch = args.includes('--relaunch');
  const handover = args.includes('--handover') ? args[args.indexOf('--handover') + 1] ?? null : null;
  const repoArg = args.includes('--repo') ? args[args.indexOf('--repo') + 1] ?? null : null;

  let row = null;
  for (const store of stores(cfg)) {
    row = store.list().find((t) => t.key === key) ?? null;
    if (row) break;
  }
  if (!row) throw new Error(`orchestra brief: no published task ${key}`);

  // A register that is absent or mid-rewrite must not stop a brief being rendered: `base` and
  // `note` are enrichments, and a review row without a `base` renders with the placeholder its
  // own line already carries, which is visible rather than silently wrong.
  let registered = null;
  try { registered = (readState(cfg.root).tasks ?? []).find((t) => t.id === key) ?? null; } catch { /* no register */ }

  const git = (a) => execFileSync('git', a, { cwd: cfg.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv() });

  process.stdout.write(renderBrief(cfg, row, {
    git,
    base: registered?.base ?? null,
    note: registered?.note ?? null,
    relaunch,
    handover,
    repo: repoArg,
  }));
}
