// `orchestra pr <subcommand>` — the two mechanical halves of a pull-request sweep. The JUDGEMENT is
// the pr-sweep and pr-triage skills' and stays there; what is here is the scan nobody should do by
// hand over twenty PRs, and the ledger line nobody should `printf`.
import { append, VERDICTS } from '../pr/ledger.mjs';

const out = (s) => process.stdout.write(`${s}\n`);

// A flag reader small enough to read in one go: `--k v` and `--k=v`, nothing else. There is no
// option here that takes a list or repeats.
function flags(args) {
  const f = {};
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a.startsWith('--')) { rest.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq !== -1) f[a.slice(2, eq)] = a.slice(eq + 1);
    else { f[a.slice(2)] = args[i + 1]; i += 1; }
  }
  return { f, rest };
}

function cmdLog(cfg, args) {
  const { f, rest } = flags(args);
  const [pr, verdict] = rest;
  if (!pr || !verdict)
    throw new Error(`usage: orchestra pr log <pr> <${VERDICTS.join('|')}> --head <sha> [--comment <id>] [--note "…"] [--direction <file.md>]`);
  out(append(cfg, {
    pr: Number(pr),
    verdict,
    head: f.head,
    lastOtherCommentId: f.comment === undefined ? null : Number(f.comment),
    note: f.note ?? '',
    direction: f.direction ?? null,
  }));
}

export function prCommand({ cfg, args }) {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'log': return cmdLog(cfg, rest);
    default:
      throw new Error(`orchestra pr: unknown subcommand "${sub ?? ''}"\nknown: log`);
  }
}
