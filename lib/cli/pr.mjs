// `orchestra pr <subcommand>` — the two mechanical halves of a pull-request sweep. The JUDGEMENT is
// the pr-sweep and pr-triage skills' and stays there; what is here is the scan nobody should do by
// hand over twenty PRs, and the ledger line nobody should `printf`.
import { append, VERDICTS, readLedger, latest } from '../pr/ledger.mjs';
import { routePulls } from '../pr/scan.mjs';
import { makeGh, rollup } from '../pr/gh.mjs';

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

function cmdScan(cfg, args, deps) {
  const gh = deps.gh ?? makeGh(cfg.root);
  const repo = gh.repo();
  const me = gh.me();
  const pulls = gh.pulls().map((p) => ({
    ...p,
    author: p.author?.login ?? 'unknown',
    ci: rollup(p.statusCheckRollup),
    lastOtherCommentId: gh.lastOtherComment(repo, p.number, me),
  }));
  const rows = routePulls(pulls, latest(readLedger(cfg)), { now: new Date() });
  if (args.includes('--json')) { out(JSON.stringify({ repo, open: rows.length, rows })); return; }
  out(`${rows.length} open on ${repo}`);
  for (const r of rows)
    out(`  #${r.number}  ${r.group}  ${r.author}  +${r.adds}/-${r.dels} ${r.size}  ci ${r.ci}  idle ${r.idleDays}d  ${r.title}`);
}

export function prCommand({ cfg, args, deps = {} }) {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'log': return cmdLog(cfg, rest);
    case 'scan': return cmdScan(cfg, rest, deps);
    default:
      throw new Error(`orchestra pr: unknown subcommand "${sub ?? ''}"\nknown: log, scan`);
  }
}
