import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { liveInstances, readInstances } from '../machine.mjs';
import { pinConflict } from '../monitor/port.mjs';
import { gitEnv } from '../paths.mjs';
import { agentLabel, heartbeatStatus, installedAgents } from './heartbeat.mjs';

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

// `doctor`'s heartbeat row (§8.5): not installed / installed / installed for another root /
// drifted from a fresh render — the last one including the plugin having moved to a new version's
// cache directory, since `heartbeatStatus` folds the project's own `.orchestra/tick.sh` (where the
// plugin's path is actually baked in) into the same comparison. The last two states both point at
// the same remedy, `install-heartbeat`, because a drifted agent and one belonging to another
// checkout are the same underlying question — is what is on disk still what this project would
// render today.
function heartbeatLine(cfg) {
  const hb = heartbeatStatus(cfg);
  const where = hb.paths.join(', ');
  const text = {
    'not-installed': 'not installed — run `orchestra install-heartbeat`',
    installed: `installed (${where})`,
    'other-root': `installed for a DIFFERENT project (${hb.existingRoot}), not this one (${cfg.root}) — `
      + 'remove that agent, then run `orchestra install-heartbeat` here',
    drifted: `installed but drifted from a fresh render (${where}) — run \`orchestra install-heartbeat\` to re-render it`,
  }[hb.state];
  return `  ${pad('heartbeat', 20)} ${text}`;
}

// `git config --get` exits 1 with no output when the key is unset — read here as "false", the
// same default git itself applies. Never a refusal: this is a row, never an error, because
// rerere.enabled is a recommendation, not a requirement.
function rerereLine(cfg) {
  let value = 'false';
  try {
    const out = execFileSync('git', ['-C', cfg.root, 'config', '--get', 'rerere.enabled'], { encoding: 'utf8', env: gitEnv() }).trim();
    if (out) value = out;
  } catch { /* unset — the default already covers it */ }
  return `  ${pad('rerere.enabled', 20)} ${value}\n`
    + '    worth setting true in a repository whose branches are rebased all day — the merge gate\n'
    + '    rebases every landing onto main (docs/specs/2026-09-02-orchestra-plugin-design.md §5),\n'
    + '    and rerere remembers a conflict\'s resolution instead of asking the same rebase to\n'
    + '    re-fight it.';
}

// The installed agents on THIS MACHINE, across every project, cross-checked against
// `~/.orchestra/instances.json` — so a project deleted while its heartbeat lived on is visible
// rather than mysterious (§8.5), the same failure `installedRoot`'s other-root check catches for
// the ACTIVE project instead of every project on the machine.
function heartbeatAgentsLine() {
  const agents = installedAgents();
  if (!agents.length) return `  ${pad('heartbeat agents', 20)} none installed on this machine`;
  const known = new Set(readInstances().map((e) => e.root));
  const rows = agents.map((a) => {
    const status = !a.root ? 'unreadable — no ORCHESTRA_ROOT marker found'
      : !existsSync(a.root) ? 'ORPHANED — its checkout no longer exists'
      : known.has(a.root) ? 'ok'
      : 'not yet in the machine registry (heartbeat may not have ticked yet)';
    return `    ${agentLabel(a.id)}  ${a.root ?? '?'}  —  ${status}`;
  });
  return `  ${pad('heartbeat agents', 20)} ${agents.length} installed on this machine\n${rows.join('\n')}`;
}

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
  const extra = [heartbeatLine(cfg), rerereLine(cfg), heartbeatAgentsLine()].join('\n');
  return `orchestra — ${cfg.name}\n${lines.join('\n')}\n${note}\n${extra}\n`;
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
    process.stderr.write(`error: monitor.port ${conflict.port} is pinned here but already held by ${conflict.name} (${conflict.root})\n`);
    process.exitCode = 1;
  }
};
