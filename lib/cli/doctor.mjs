import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRACE } from '../gate/state.mjs';
import { readInstances } from '../machine.mjs';
import { gitCommonDir, gitEnv } from '../paths.mjs';
import { agentLabel, heartbeatStatus, installedAgents } from './heartbeat.mjs';
import { GITIGNORE } from './init.mjs';

const pad = (s, n) => String(s).padEnd(n);

// The whole of a first-time user's experience in a project that has not opted in. It used to tell
// a new user to create `.orchestra/config.json` by hand and promise that "a later version's
// `orchestra init` will write the file for you" — a promise `lib/cli/init.mjs` now keeps, so the
// instruction names the command instead of the file.
const NO_CONFIG = `orchestra: no .orchestra/config.json here — this project has not opted in.

Run \`orchestra init --mode online\` or \`orchestra init --mode offline\`:

  online    roadmaps are GitHub issues, so every developer on the repository sees who is working
            on what (needs the \`gh\` CLI, authenticated)
  offline   roadmaps are markdown under .orchestra/roadmaps — excluded from this clone, never
            committed — and "is somebody already working on this" is answered for this
            machine only

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

// Every path orchestra WRITES, named by its config key. `/.orchestra/` covers all of them by
// default and none of them by guarantee: each is a key precisely so a project can repoint it, and a
// project that repoints one at a directory the repository carries has moved orchestra's own output
// into shared history — measured in a real offline project on 2026-09-09, `roadmaps.published` set
// to `docs/roadmaps` with fourteen roadmaps in the index, while the row below said "2 problem(s)"
// and named neither.
//
// Reported, not refused, and the distinction is the point: the layout is the project's to choose
// (lib/config.mjs says so at `roadmaps` and at `pr.direction`), and the merge gate refusing a
// landing that carried a roadmap file would break that choice with no way back. What the project
// was never told is the CONSEQUENCE of the choice under offline mode's promise. Now it is.
const WRITTEN_PATHS = (cfg) => [
  ['roadmaps.drafts', cfg.roadmaps.drafts],
  ['roadmaps.published', cfg.roadmaps.published],
  ['worktrees', cfg.worktrees],
  ['tickets.file', cfg.tickets.file],
  ['pr.ledger', cfg.pr.ledger],
  ['pr.direction', cfg.pr.direction],
];

// A tracked path is under `rel` when it IS `rel` (a file key like `tickets.file`) or sits beneath
// it (a directory key like `roadmaps.published`). One rule for both, so no key needs to declare
// which of the two it is.
const under = (p, rel) => p === rel || p.startsWith(`${rel}/`);

// Exit 0 means an ignore rule — a .gitignore or this clone's exclude — already covers the path.
// Anything else, including the 128 of a call made outside a working tree, answers "git can see it",
// which is the answer that produces a row rather than silence.
const gitIgnores = (root, rel) => {
  try {
    execFileSync('git', ['-C', root, 'check-ignore', '-q', '--', rel], { env: gitEnv(), stdio: 'ignore' });
    return true;
  } catch { return false; }
};

// Offline mode's one promise, checked rather than believed: nothing orchestra produces has entered
// a commit (docs/specs/2026-09-08-offline-leaves-no-trace-design.md). Each fact carries the action
// that fixes it. Never a refusal — `doctor` reports, it does not gate.
function traceLine(cfg) {
  if (cfg.mode !== 'offline') return null;
  const problems = [];

  let excluded = false;
  let excludePath = null;
  try {
    excludePath = join(gitCommonDir(cfg.root), 'info', 'exclude');
    excluded = existsSync(excludePath) && readFileSync(excludePath, 'utf8').split('\n').includes('/.orchestra/');
  } catch { /* not a working tree — nothing to exclude and nothing to leak */ }
  // The append, named exactly, and NOT `orchestra init --mode offline --force`, which this row used
  // to advise: `initProject` rebuilds config.json from `detect()` when forced, so a project that had
  // hand-tuned `gates`, `branchTests`, `ledgers` or `briefExtra` lost all of it to gain one line.
  // `doctor` reports; it must never hand out a command that destroys more than it fixes.
  if (!excluded && excludePath)
    problems.push(`/.orchestra/ is not excluded in this clone — add it:`
      + ` printf '/.orchestra/\\n' >> ${excludePath}`);

  let all = [];
  try {
    all = execFileSync('git', ['-C', cfg.root, 'ls-files'], { encoding: 'utf8', env: gitEnv() })
      .split('\n').filter(Boolean);
  } catch { /* unreadable — the row says what it could check */ }
  const named = all.filter((p) => TRACE.test(p));
  for (const p of named) problems.push(`git tracks ${p} — untrack it: git rm --cached -- ${p}`);

  // Both facts about a written path are worth saying, and they are independent: untracking without
  // excluding leaves the next `git add -A` putting the directory straight back.
  const already = new Set(named);
  for (const [key, rel] of WRITTEN_PATHS(cfg)) {
    const files = all.filter((p) => under(p, rel) && !already.has(p));
    if (files.length)
      problems.push(`git tracks ${files.length} file(s) under ${key} (${rel})`
        + ` — untrack them: git rm --cached -r -- ${rel}`);
    if (!gitIgnores(cfg.root, rel))
      problems.push(`${key} (${rel}) is not excluded from this clone`
        + ' — the next `git add` commits what orchestra writes there');
  }

  // `ledgers` is the one key whose whole purpose is to make the merge gate commit: `commitLedgers`
  // (lib/gate/land.mjs) stages and commits every path in it on the main branch at each landing.
  // Offline that is orchestra committing, which is exactly what the mode promises it does not do —
  // so the key is named even when nothing under it is tracked yet, because the commit is what the
  // configuration is FOR and it arrives at the next landing.
  if (cfg.ledgers.length)
    problems.push(`the merge gate commits ${cfg.ledgers.join(', ')} at every landing`
      + ` — offline, set "ledgers": [] in ${cfg.configPath}`);

  const claudePath = join(cfg.root, 'CLAUDE.md');
  try {
    if (existsSync(claudePath) && /orchestra:claude-rules/.test(readFileSync(claudePath, 'utf8')))
      problems.push(`the rules block is still in ${claudePath} — remove it and commit the deletion`);
  } catch { /* exists but unreadable (e.g. a directory) — no block found is the honest answer */ }

  // The probes above read the working tree, the index and the config. History is deliberately not
  // probed — rewriting it is out of scope and scanning every commit of a large repository on every
  // `doctor` is not what this row is for — so the word has to carry its own scope. A bare `clean`
  // would be read as a claim about the repository, and it is not one: follow `init`'s flip
  // instructions exactly and this row says clean while `git log -p --all` still shows the block.
  return `  ${pad('trace', 20)} ${problems.length ? `${problems.length} problem(s)`
    : 'clean (working tree and index; history is not checked)'}`
    + problems.map((p) => `\n    ${p}`).join('');
}

// `.orchestra/.gitignore` is written ONCE, by `init`, and committed — so a release that adds a path
// under `.orchestra/` leaves every project that opted in before it with a file that no longer covers
// what the plugin writes. Measured the day `tick.out` and `tick.wake` were added (0.10.0): planetCraft
// had opted in at 0.8, and both files would have shown as `??` in `git status`, one `git add .` from
// being committed into the repository.
//
// A ROW, not a rewrite. `init` owns that file and refuses to touch a project that has already opted
// in without `--force`, which would take `config.json` with it — so this names the missing lines
// rather than quietly editing a committed file on a `doctor` the user ran to LOOK at something.
//
// Offline projects have no such file and need none: their whole `.orchestra/` is excluded through
// the clone's own `info/exclude`, which covers a new path the day it appears.
function gitignoreLine(cfg) {
  const path = join(cfg.root, '.orchestra', '.gitignore');
  if (!existsSync(path)) return '';
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return ''; }
  const have = new Set(text.split('\n').map((l) => l.trim()).filter(Boolean));
  const missing = GITIGNORE.split('\n').map((l) => l.trim()).filter(Boolean).filter((l) => !have.has(l));
  if (!missing.length) return `  ${pad('.gitignore', 20)} covers every path this version writes`;
  return `  ${pad('.gitignore', 20)} ${missing.length} path(s) this version writes are NOT ignored`
    + ` — add them to ${path} and commit it:`
    + missing.map((l) => `\n    ${l}`).join('');
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
    ['pr.ledger', cfg.pr.ledger], ['pr.direction', cfg.pr.direction],
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
  const extra = [heartbeatLine(cfg), gitignoreLine(cfg), rerereLine(cfg), traceLine(cfg), heartbeatAgentsLine()]
    .filter(Boolean).join('\n');
  return `orchestra — ${cfg.name}\n${lines.join('\n')}\n${note}${stale}\n${extra}\n`;
}

export const doctor = (cfg) => {
  process.stdout.write(doctorText(cfg));
};
