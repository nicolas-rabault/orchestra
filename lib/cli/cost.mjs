// `orchestra cost [--json]` — what this project's live sessions actually cost.
//
// The number nobody had. The protocol's retirement rule opened with "this plugin ships no tool that
// measures a session's token use ... the turn count is therefore the only signal a conductor has
// here", and a conductor deciding on turn count alone is deciding on the one signal that does NOT
// track cost: measured 2026-09-09 in duckJam, sessions with a similar turn count differed threefold
// in what they had read, because what a session costs is its PREFIX integrated over its length and
// two workers accumulate prefix at very different rates.
//
// It prints every live row, not only the ones that fire, because the useful question when nothing
// fires is which reason held it back — and that is exactly what a conductor cannot see from a rule
// that only speaks when it says yes.
import { readState } from '../register/state.mjs';
import { fleetCost, k } from '../register/cost.mjs';
import { TERMINAL } from '../register/archive.mjs';
import { gatherLiveness } from '../register/liveness.mjs';
import { obligations } from '../register/drive.mjs';

const out = (s) => process.stdout.write(`${s}\n`);
const pad = (s, n) => String(s).padEnd(n);

// Why a row is not firing, in the words a conductor needs to decide whether to override it.
const WHY = {
  'codex-native-usage-unavailable': 'NOT MEASURED — Codex native usage unavailable',
  grown: 'RETIRE',
  below: 'below the threshold',
  'below-its-own-floor': 'below twice its own boot',
  young: 'too young to have earned a hand-over',
  driving: 'a turn is running in it',
  asked: 'waiting on the user',
  'waiting-on-the-gate': 'finished, waiting on the gate',
  unmeasured: 'NOT MEASURED — no transcript for its session',
  terminal: 'terminal',
  'no-session': 'no session',
};

export function costCommand({ cfg, args }) {
  const state = readState(cfg.root);
  if (!state) { out('no register — publish a roadmap first, then `orchestra roadmap enrol`'); return; }
  const tasks = state.tasks ?? [];
  const { driving } = obligations(tasks, gatherLiveness(cfg.root, tasks));
  const fleet = fleetCost(tasks, {
    retireAt: cfg.retireAt, terminal: TERMINAL, driving: new Set(driving.map((d) => d.id)),
  });

  if (args.includes('--json')) { out(JSON.stringify({ retireAt: cfg.retireAt, fleet }, null, 2)); return; }

  if (!fleet.length) { out('no live session on any row'); return; }
  // The row column is as wide as the widest key, never a fixed guess: a real qualified key is
  // `dome-web-app-and-broadcast/DW6`, and a 22-column guess ran the id straight into the numbers.
  const w = Math.max(3, ...fleet.map((r) => String(r.id).length)) + 2;
  out(`  ${pad('row', w)}${pad('reqs', 6)}${pad('boot', 7)}${pad('prefix', 8)}${pad('read', 9)}${pad('at', 7)}why`);
  for (const r of fleet) {
    const c = r.cost;
    out(`  ${pad(r.id, w)}${pad(c?.requests ?? '—', 6)}${pad(c ? k(c.boot) : '—', 7)}`
      + `${pad(c ? k(c.prefix) : '—', 8)}${pad(c ? k(c.read) : '—', 9)}`
      + `${pad(r.verdict.at ? k(r.verdict.at) : '—', 7)}${WHY[r.verdict.reason] ?? r.verdict.reason}`);
  }
  // The fleet's own total, which is the number that answers "where did the day's quota go".
  const read = fleet.reduce((n, r) => n + (r.cost?.read ?? 0), 0);
  const written = fleet.reduce((n, r) => n + (r.cost?.output ?? 0), 0);
  const next = fleet.reduce((n, r) => n + (r.cost?.prefix ?? 0), 0);
  out('');
  const measured = fleet.filter((r) => r.cost).length;
  out(`  ${measured}/${fleet.length} session(s) measured: ${k(read)} read, ${k(written)} written`
    + `${written ? ` — ${Math.round(read / written)}:1` : ''}.`
    + ` One more request from each measured session costs ${k(next)}.`);
  const firing = fleet.filter((r) => r.verdict.ok);
  if (firing.length)
    out(`  ${firing.length} past the threshold: ${firing.map((r) => r.id).join(', ')} — \`orchestra retire <id>\``);
}
