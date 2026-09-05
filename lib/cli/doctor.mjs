import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readInstances } from '../machine.mjs';
import { gitEnv } from '../paths.mjs';
import { agentLabel, heartbeatStatus, installedAgents } from './heartbeat.mjs';

const pad = (s, n) => String(s).padEnd(n);

// The whole of a first-time user's experience in a project that has not opted in. It used to tell
// a new user to create `.orchestra/config.json` by hand and promise that "a later version's
// `orchestra init` will write the file for you" — a promise `lib/cli/init.mjs` now keeps, so the
// instruction names the command instead of the file.
const NO_CONFIG = `orchestra: no .orchestra/config.json here — this project has not opted in.

Run \`orchestra init --mode online\` or \`orchestra init --mode offline\`:

  online    roadmaps are GitHub issues, so every developer on the repository sees who is working
            on what (needs the \`gh\` CLI, authenticated)
  offline   roadmaps are committed markdown under docs/roadmaps, and "is somebody already working
            on this" is answered for this machine only

\`init\` detects a build system where it can and proposes gates from it; run
\`orchestra init --detect --json\` first to see what it would propose without writing anything.
Every other key has a default — run \`orchestra doctor\` again afterwards and it prints the
resolved configuration, marking each one it filled in.
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
    ['tickets.file', cfg.tickets.file],
    ['briefExtra', cfg.briefExtra ? firstLine(cfg.briefExtra) : '—'],
  ];
  const lines = rows.map(([k, v]) =>
    `  ${pad(k, 20)} ${v}${cfg.defaulted.includes(k) ? '   (default)' : ''}`);
  const note = cfg.mode === 'offline'
    ? '\n  Offline mode: "is somebody already working on this" is answered for this machine only.\n  That question is the whole reason the online mode exists.\n'
    : '';
  // `mergeInto` copies every key the file sets, including ones DEFAULTS no longer has, so a
  // leftover `monitor.port` is still readable here — and `validate` only checks keys that ARE in
  // DEFAULTS, so it is not an error, it is silently inert. Which is worse, hence this line. No
  // `raw` on `cfg` and no second read of the file: the merged object already carries it.
  const stale = cfg.monitor?.port !== undefined
    ? '\n  monitor.port no longer does anything — the page is machine-wide.\n  Set monitorPort in ~/.orchestra/machine.json instead, and delete this key.\n'
    : '';
  const extra = [heartbeatLine(cfg), rerereLine(cfg), heartbeatAgentsLine()].join('\n');
  return `orchestra — ${cfg.name}\n${lines.join('\n')}\n${note}${stale}\n${extra}\n`;
}

export const doctor = (cfg) => {
  process.stdout.write(doctorText(cfg));
};
