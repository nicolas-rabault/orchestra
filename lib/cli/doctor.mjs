import { liveInstances } from '../machine.mjs';
import { pinConflict } from '../monitor/port.mjs';

const pad = (s, n) => String(s).padEnd(n);

// The whole of a first-time user's experience, in this phase. `doctor` is one of the commands the
// off switch exempts precisely so it can answer in a project that has not opted in, and there is
// nothing else for such a user to read. It used to say "Run `orchestra init`" — a subcommand this
// phase deliberately does not have, which exits 2 as unknown, so the one instruction a new user
// was given was a dead end. It names the file and the one required key instead, and says who will
// write it later.
const NO_CONFIG = `orchestra: no .orchestra/config.json here — this project has not opted in.

Create .orchestra/config.json holding the one required key:

  {"mode": "offline"}   roadmaps are committed markdown under docs/roadmaps, and "is somebody
                        already working on this" is answered for this machine only
  {"mode": "online"}    roadmaps are GitHub issues, so every developer on the repository sees
                        who is working on what (needs the \`gh\` CLI, authenticated)

Every other key has a default — run \`orchestra doctor\` again and it prints the resolved
configuration, marking each one it filled in. A later version's \`orchestra init\` will write the
file for you.
`;

// `briefExtra` is PROSE — a project's hard rules, pasted into every worker brief — and a row here
// is one line. The row answers "is anything being injected, and roughly what": its first line,
// marked when there is more.
const firstLine = (s) => {
  const [head = ''] = String(s).split('\n');
  return head === String(s) && head.length <= 60 ? head : `${head.slice(0, 60)} …`;
};

export function doctorText(cfg) {
  if (!cfg) return NO_CONFIG;
  const rows = [
    ['name', cfg.name], ['id', cfg.id], ['mode', cfg.mode], ['root', cfg.root],
    ['language', cfg.language], ['mainBranch', cfg.mainBranch], ['worktrees', cfg.worktrees],
    ['roadmaps.drafts', cfg.roadmaps.drafts], ['roadmaps.published', cfg.roadmaps.published],
    ['docs.specs', cfg.docs.specs], ['docs.plans', cfg.docs.plans], ['docs.results', cfg.docs.results],
    ['branchTests', cfg.branchTests ?? '—'], ['gates', cfg.gates.map((g) => g.name).join(', ') || '—'],
    ['ledgers', cfg.ledgers.join(', ') || '—'], ['queue', cfg.queue ?? '—'],
    ['monitor.port', cfg.monitor.port], ['tickets.file', cfg.tickets.file],
    ['briefExtra', cfg.briefExtra ? firstLine(cfg.briefExtra) : '—'],
  ];
  const lines = rows.map(([k, v]) =>
    `  ${pad(k, 20)} ${v}${cfg.defaulted.includes(k) ? '   (default)' : ''}`);
  const note = cfg.mode === 'offline'
    ? '\n  Offline mode: "is somebody already working on this" is answered for this machine only.\n  That question is the whole reason the online mode exists.\n'
    : '';
  return `orchestra — ${cfg.name}\n${lines.join('\n')}\n${note}`;
}

// §8.3 / plan scope answer 4: a pinned `monitor.port` already held by another LIVE registered
// project is the first thing `doctor` reports as an error rather than a warning, and the first
// check in this command that can exit non-zero — it will refuse to start, not silently move. An
// absent config has nothing to check (`NO_CONFIG` already covers that project), and an "auto" port
// is never in conflict by construction, so `pinConflict` alone decides whether anything prints.
export const doctor = (cfg) => {
  process.stdout.write(doctorText(cfg));
  if (!cfg) return;
  const conflict = pinConflict(cfg, liveInstances());
  if (conflict) {
    process.stdout.write(`error: monitor.port ${conflict.port} is pinned here but already held by ${conflict.name} (${conflict.root})\n`);
    process.exitCode = 1;
  }
};
