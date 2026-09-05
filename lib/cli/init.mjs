// `orchestra init` — the one command that opts a project in. Every hook and every other
// subcommand is a silent no-op until `.orchestra/config.json` exists (spec §3.1); this is what
// writes it, registered `machine: true` like `doctor` and `instances` because it must answer in
// the one kind of project that ever needs it — one with no config at all.
//
// `detect(root)` is pure over a directory listing plus one `package.json` read: no git call, no
// config read, no write. That purity is what lets `--detect --json` report it without touching
// anything, which is what the `orchestra` skill uses to ask the user about whatever it could not
// settle instead of guessing (spec §11). `initProject` is the only function here with a side
// effect, and `initCommand` is a thin CLI wrapper over both.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, validate } from '../config.mjs';
import { mainCheckout, orchestraDir } from '../paths.mjs';
import { renderTemplate } from './heartbeat.mjs';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');
const readTemplate = (name) => readFileSync(join(TEMPLATES_DIR, name), 'utf8');

const readJson = (path) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
};

function hasMakeTestTarget(root) {
  let text;
  try { text = readFileSync(join(root, 'Makefile'), 'utf8'); } catch { return false; }
  return /^test\s*:/m.test(text);
}

// ---------------------------------------------------------------------------------
// Detection — one table, no cleverness (spec §11). Every proposal names a command this function
// actually found evidence of; anything it did not find is named in `missing` and left out of the
// written config — a gate that does not run is a gate that refuses every landing.
// ---------------------------------------------------------------------------------
export function detect(root) {
  let buildSystem = null;
  let branchTests = null;
  const gates = [];

  const pkg = readJson(join(root, 'package.json'));
  if (pkg?.scripts?.test) {
    buildSystem = 'npm';
    const branchScript = pkg.scripts['test:branch'] ? 'test:branch'
      : pkg.scripts['test:changed'] ? 'test:changed' : null;
    if (branchScript) branchTests = `npm run ${branchScript}`;
    // The cheaper gate, when one exists, goes BEFORE `suite` — cheapest first is the project's
    // own call and this is only a proposal. `knip` wins over `lint` when a project has both: it is
    // the more specific hygiene check (dead code and unused exports) rather than style, and it is
    // named `deadcode` to match the one worked example this plugin ships with (spec §3.1).
    if (pkg.scripts.knip) gates.push({ name: 'deadcode', cmd: 'npm run knip' });
    else if (pkg.scripts.lint) gates.push({ name: 'lint', cmd: 'npm run lint' });
    gates.push({ name: 'suite', cmd: 'npm test' });
  } else if (existsSync(join(root, 'Cargo.toml'))) {
    buildSystem = 'cargo';
    gates.push({ name: 'suite', cmd: 'cargo test' });
  } else if (existsSync(join(root, 'pyproject.toml'))) {
    buildSystem = 'python';
    gates.push({ name: 'suite', cmd: 'pytest' });
  } else if (hasMakeTestTarget(root)) {
    buildSystem = 'make';
    gates.push({ name: 'suite', cmd: 'make test' });
  }

  const missing = [];
  if (!gates.length) missing.push('suite');
  if (!branchTests) missing.push('branchTests');

  // Not detected from the project's own files — proposed unconditionally, at its default path,
  // because every orchestra project gets the ticket queue (`lib/tickets/`). Matching
  // `DEFAULTS.tickets.file` rather than a literal string is what keeps this from silently
  // disagreeing with `lib/config.mjs` if that default ever moves. Without it in `ledgers`, the
  // merge gate's `commitLedgers` (`lib/gate/land.mjs`) commits nothing, and the first branch that
  // touches the ticket file is refused by the clash check instead — the day it lands is the day
  // this line stops being optional.
  const ledgers = [DEFAULTS.tickets.file];

  return { buildSystem, branchTests, gates, ledgers, missing };
}

// ---------------------------------------------------------------------------------
// `.orchestra/.gitignore` — every path the plugin creates under `.orchestra/`, and nothing else.
// `config.json` and this file are the two paths under `.orchestra/` that ARE committed, so this
// lists what to ignore rather than a blanket `*` with exceptions — a future committed file needs
// no thought here.
//
// Verified against a grep of the whole tree — every `renameSync`/`.tmp` (an atomic write) and every
// `mkdirSync` used as a mutex or lock directory (`lib/`, `hooks/`, `bin/`, `templates/`, and
// `skills/`, which the first pass of this list missed) — not just the two files this line list
// already named:
//
//   - `.queue.lock` — `lib/tickets/lock.mjs`'s mutex directory (`withQueueLock`'s `LOCK_DIR`),
//     created beside whichever file it locks — by default `tickets.file` (`.orchestra/tickets.jsonl`,
//     deliberately NOT listed below: it is a committed ledger, per `lib/gate/land.mjs`'s
//     `commitLedgers`). Released in a `finally` after every write, but a holder killed between its
//     `mkdir` and that `finally` leaves it behind, exactly like `tick.lock` — `tickets.jsonl` being
//     committed is exactly why the directory next to it needs a line of its own.
//   - `*.tmp` — every atomic write under `.orchestra/` goes through a `<name>.<pid>.tmp` scratch
//     file and a `renameSync`, and nothing here ever cleans up an orphan left by a crash between
//     the two (unlike `.queue.lock`/`tick.lock`, which both have dead-holder detection precisely
//     because the code already expects them to sometimes survive on disk). Confirmed as `??` in
//     `git status` after a real `init`: `lib/register/state.mjs`'s `writeState`
//     (`state.json.<pid>.tmp`), `lib/register/beat.mjs`'s `writeBeat`
//     (`conductor.beat.json.<pid>.tmp`), and `templates/tick.sh`'s own log-rotation line
//     (`tick.log.tmp`, written by `tail … > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"` — the same crash
//     window in shell rather than JS). `lib/register/lock.mjs`'s own `holder.json.<pid>.tmp` needs
//     no line of its own: it is written INSIDE `tick.lock`, already ignored whole. Everything else
//     that renames through a `.tmp` (`lib/gate/land.mjs`'s and `lib/gate/run.mjs`'s `writeAtomic`)
//     targets a path already under `gate/`; `lib/machine.mjs`'s own `.tmp` targets
//     `~/.orchestra/instances.json` — the MACHINE's `.orchestra/`, a different directory this file
//     has no say over.
//   - `*.err` — not orphaned, just easy to miss on a `lib/`-only grep: `skills/orchestra/SKILL.md`
//     starts the monitor with `2>.orchestra/monitor.err`. Already covered by the line below.
// ---------------------------------------------------------------------------------
export const GITIGNORE = `state.json
journal.jsonl
inbox.jsonl
archive.jsonl
conductor.beat.json
tick.lock
.queue.lock
drafts/
worktrees/
images/
gate/
tick.sh
*.log
*.err
*.tmp
`;

// `templates/CLAUDE-rules.md` starts with a marker line (`<!-- orchestra:claude-rules -->`), kept
// in the file as a greppable anchor for a human reading CLAUDE.md — but idempotence below checks
// for the BLOCK ITSELF, not just that line. A marker is only proof the block is already there when
// the block actually follows it; a CLAUDE.md where someone edited or truncated the rules but left
// the marker line behind would otherwise read as `unchanged` forever and never receive them.
function writeClaudeRules(root) {
  const path = join(root, 'CLAUDE.md');
  const block = readTemplate('CLAUDE-rules.md');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (existing === null) {
    writeFileSync(path, block);
    return { path, action: 'created' };
  }
  if (existing.includes(block)) return { path, action: 'unchanged' };
  writeFileSync(path, `${existing.replace(/\n*$/, '\n')}\n${block}`);
  return { path, action: 'appended' };
}

function formatDetect(det) {
  return [
    `  buildSystem  ${det.buildSystem ?? '— (nothing recognised)'}`,
    `  branchTests  ${det.branchTests ?? '— (none proposed)'}`,
    `  gates        ${det.gates.length ? det.gates.map((g) => `${g.name} (${g.cmd})`).join(', ') : '— (none proposed)'}`,
    `  ledgers      ${det.ledgers.join(', ')}`,
    `  missing      ${det.missing.length ? det.missing.join(', ') : '— (nothing)'}`,
  ].join('\n');
}

// What a missing entry means for a human deciding whether to add it by hand.
const MISSING_LABEL = { suite: 'a "suite" gate', branchTests: 'a "branchTests" command' };

function successMessage({ configPath, config, det, claude, existed }) {
  const lines = [
    `orchestra init: ${existed ? 're-wrote' : 'wrote'} ${configPath}`,
    `  mode         ${config.mode}`,
    `  gates        ${config.gates?.length ? config.gates.map((g) => g.name).join(', ') : '(none — no recognised test command)'}`,
    `  branchTests  ${config.branchTests ?? '(none)'}`,
    `  ledgers      ${config.ledgers.join(', ')}`,
    `  wrote        ${join(dirname(configPath), '.gitignore')}`,
    `  CLAUDE.md    ${claude.action} (${claude.path})`,
  ];
  if (det.missing.length) {
    const asked = det.missing.map((m) => MISSING_LABEL[m]).join(' and ');
    lines.push(`  could not detect ${asked} — add it to ${configPath} by hand if this project has one`);
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------
// The one function with a side effect. Refuses (never writes anything) when `.orchestra/config.json`
// already exists and `force` was not passed, and when the resulting config would not validate —
// today that means only a missing or misspelled `mode`, the one key with no default.
// ---------------------------------------------------------------------------------
export function initProject(root, { mode, force = false } = {}) {
  const dir = orchestraDir(root);
  const configPath = join(dir, 'config.json');
  const existed = existsSync(configPath);
  if (existed && !force) {
    return {
      ok: false,
      action: 'exists',
      configPath,
      message: `orchestra init: ${configPath} already exists — pass --force to overwrite it\n`,
    };
  }

  // `mode` is caller input, and `templates/config.json`'s `__MODE__` is substituted into the
  // template's TEXT — inside a JSON string literal — before that text is ever parsed. A mode
  // containing a `"` or a `\` would corrupt the JSON syntax there, and `JSON.parse` would throw its
  // own raw `SyntaxError` a few lines down instead of the clean refusal `validate` already gives an
  // unusable `mode`. Checked here, on `mode` alone, through the SAME `validate` the full config is
  // checked with below — not a second spelling of "online or offline" — so no unsafe value ever
  // reaches the template.
  const modeErrors = validate({ mode });
  if (modeErrors.length) {
    return { ok: false, action: 'invalid', errors: modeErrors, message: `${modeErrors.join('\n')}\n` };
  }

  const det = detect(root);
  // `templates/config.json` carries the one key `detect` cannot propose — `mode` has no default,
  // per `lib/config.mjs`'s `DEFAULTS` — so there is nothing in it to disagree with that file.
  // Everything `detect` DID find is merged on top; a key it left unset stays unset here too and
  // falls back to `DEFAULTS` the same way any other project's config would.
  const config = JSON.parse(renderTemplate(readTemplate('config.json'), { MODE: mode }));
  config.ledgers = det.ledgers;
  if (det.gates.length) config.gates = det.gates;
  if (det.branchTests) config.branchTests = det.branchTests;

  const errors = validate(config);
  if (errors.length) {
    return { ok: false, action: 'invalid', errors, message: `${errors.join('\n')}\n` };
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(join(dir, '.gitignore'), GITIGNORE);
  const claude = writeClaudeRules(root);

  return {
    ok: true,
    action: existed ? 'reinitialized' : 'initialized',
    root,
    configPath,
    config,
    detected: det,
    claude,
    message: successMessage({ configPath, config, det, claude, existed }),
  };
}

// The two steps `init` cannot take for the user (spec §11, §16): installing the heartbeat needs
// `launchctl`/`systemctl`, and the one-time interactive acceptance of `--dangerously-skip-permissions`
// needs a human answering a prompt once. Neither has a file this command — or `doctor` — could read
// back to confirm; the `orchestra` skill's own preflight proves the second on a throwaway session
// before it ever plans a launch, which is where it was always actually established.
const NEXT_STEPS = `
Two steps orchestra cannot take for you:

  1. \`orchestra install-heartbeat\` — installs the per-project timer that ticks the conductor
     hourly, unattended (a launchd agent on macOS, a systemd user timer on Linux).
  2. The one-time interactive acceptance of \`claude --dangerously-skip-permissions\`, which every
     background launch (a worker, a heartbeat tick) needs granted once before it can run
     unattended. Nothing on disk records whether it was — the \`orchestra\` skill's preflight
     proves it on a throwaway session before planning any launch.
`;

function usageText(root) {
  return `usage: orchestra init --mode online|offline [--force]
       orchestra init --detect [--json]

  --mode    required — the one config key with no default:
              online   roadmaps are GitHub issues (needs the \`gh\` CLI, authenticated)
              offline  roadmaps are committed markdown under docs/roadmaps
  --force   overwrite an existing .orchestra/config.json
  --detect  report what init would propose, without writing anything

what --detect finds in this project right now:
${formatDetect(detect(root))}
`;
}

export function initCommand({ args }) {
  const root = mainCheckout(process.cwd());

  if (args.includes('--detect')) {
    const det = detect(root);
    process.stdout.write(args.includes('--json') ? `${JSON.stringify(det, null, 2)}\n` : `${formatDetect(det)}\n`);
    return;
  }

  const modeIdx = args.indexOf('--mode');
  if (modeIdx === -1) {
    // No `--mode` and no `--detect`: nothing was actually asked for. Answering with usage (and
    // what detection sees right now) rather than a refusal is what lets `init` stay a `machine:
    // true` command that ALWAYS answers a bare call successfully, exactly like `doctor` and
    // `instances` do in a project with no config.
    process.stdout.write(usageText(root));
    return;
  }

  const mode = args[modeIdx + 1];
  const force = args.includes('--force');
  const report = initProject(root, { mode, force });
  // A refusal throws, like every other command's bad-invocation path (`lib/cli/tickets.mjs`'s
  // USAGE, `lib/config.mjs`'s validation errors at load): `bin/orchestra`'s own catch writes it to
  // stderr and exits 1, so this command needs no error-handling convention of its own.
  if (!report.ok) throw new Error(report.message.trimEnd());
  process.stdout.write(report.message);
  process.stdout.write(NEXT_STEPS);
}
