import { workerSelection } from '../register/workerPolicy.mjs';
// `orchestra install-heartbeat` — the per-project timer that ticks the conductor hourly, unattended.
// One agent per project (§8.5), labelled `com.orchestra.<id>`: a launchd LaunchAgent on macOS, a
// systemd user timer everywhere else. Both are rendered from `templates/` with this project's root,
// its id, and the absolute path this plugin's own `bin/orchestra` happens to be installed at —
// which moves on every version bump, since a plugin lives in a cache directory named for its
// version. See templates/tick.sh's own header for what that trap costs when it goes unhandled.
//
// `run` (the launchctl/systemctl invoker) and `home` are both injected, with real defaults, for the
// same reason `lib/machine.mjs` injects `alive`: a test must never spawn `launchctl` for real and
// must never touch the developer's own `~/Library/LaunchAgents`. `print`, here, is not an injected
// function but a boolean — the `--print` flag's own meaning, "render and return without installing
// anything" — because everything this command has to say is already carried on the returned report;
// nothing needs a second output channel to be testable.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { orchestraDir } from '../paths.mjs';

// Resolved from this module's own location, exactly as `lib/gate/land.mjs`'s BIN and
// `lib/monitor/sources.mjs`'s DEFAULT_BIN are: a fact about where THIS installed copy of the
// plugin lives, never from `process.argv[1]` or an environment variable that a hook's or a shell's
// environment is not guaranteed to carry. Not exported: nothing outside this file needs it today.
const BIN_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'orchestra');

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');
const readTemplate = (name) => readFileSync(join(TEMPLATES_DIR, name), 'utf8');

export const agentLabel = (id) => `com.orchestra.${id}`;

// Literal substring replacement, not a regex: a project's own path is arbitrary text and must never
// be read as a pattern. `sed`'s `s|__REPO__|$REPO|g`, which the source project used for this exact
// job, has the same literal-replacement contract — but `replaceAll(search, value)` does NOT, when
// `value` is a plain string: `$&`, `$$`, `` $` ``, `$'` and `$<n>` are all special replacement
// patterns even though `search` itself is a literal string, so a root path containing a bare `$`
// would silently corrupt the render. A replacer FUNCTION never applies that interpretation.
export function renderTemplate(text, vars) {
  let out = text;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`__${k}__`, () => String(v));
  return out;
}

// The marker line every template carries — `ORCHESTRA_ROOT=<root>`, in whatever comment syntax its
// format uses (`<!-- -->` for the plist, `#` for the systemd units) — read back from an INSTALLED,
// already-rendered file to recover which project's checkout it was rendered for. One regex covers
// every format because the marker's syntax around it is the only thing that differs between them.
//
// Bounded on END OF LINE, never on whitespace: every template places the marker alone on its own
// line, with nothing else trailing the value on that line (the plist's closing `-->` is on a LATER
// line, not appended after the value), so "the rest of the line" is exactly the root, whatever it
// contains — a space, an `&`, a `<`, anything but a literal newline, which no path can contain.
// `\S+` here once stopped at the first space, so a root containing one was recovered as a
// TRUNCATED prefix — read back on the project's own second install, that prefix compared unequal
// to the real, untruncated `cfg.root`, and the project refused itself as belonging to somebody
// else. `[^\r\n]*` never truncates, and a CR is excluded too in case a rendered file is ever read
// back with CRLF line endings.
const ROOT_MARKER = /ORCHESTRA_ROOT=([^\r\n]*)/;
export const installedRoot = (text) => text.match(ROOT_MARKER)?.[1] ?? null;

// The plist's `<string>` elements hold ROOT as actual XML element content, where `&` and `<` are
// not literal — unlike the marker above, which lives inside an XML COMMENT, where they are (an
// XML comment is not parsed for entities or markup at all, `--` aside). Escaping the marker's own
// copy of ROOT would be worse than not escaping it: `installedRoot` would then read back
// `&amp;` instead of `&`, which never equals the real `cfg.root`, reproducing the exact
// refuses-itself failure the marker fix above exists to close. So this is applied to a SEPARATE
// template variable, `ROOT_XML`, used only where element content actually requires it.
const escapeXml = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export const plistPath = (id, home = homedir()) =>
  join(home, 'Library', 'LaunchAgents', `${agentLabel(id)}.plist`);
export const systemdServicePath = (id, home = homedir()) =>
  join(home, '.config', 'systemd', 'user', `${agentLabel(id)}.service`);
export const systemdTimerPath = (id, home = homedir()) =>
  join(home, '.config', 'systemd', 'user', `${agentLabel(id)}.timer`);

const readIfExists = (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } };

// Every `com.orchestra.*` agent installed on this machine, for `orchestra doctor`'s third row
// (§8.5): a project deleted while its heartbeat lived on must be visible, not mysterious. Read-only
// and never throws on a directory that does not exist — the ordinary case on a machine where no
// project here has ever installed one.
export function installedAgents({ home = homedir(), platform = process.platform } = {}) {
  const darwin = platform === 'darwin';
  const dir = darwin ? join(home, 'Library', 'LaunchAgents') : join(home, '.config', 'systemd', 'user');
  const suffix = darwin ? '.plist' : '.service';
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names
    .filter((n) => n.startsWith('com.orchestra.') && n.endsWith(suffix))
    .map((n) => {
      const path = join(dir, n);
      const id = n.slice('com.orchestra.'.length, n.length - suffix.length);
      return { id, path, root: installedRoot(readIfExists(path) ?? '') };
    });
}

// The launchd/systemctl invoker every real install goes through, so `installHeartbeat`'s own logic
// never calls `execFileSync` directly and a test never has to reach past the injection point to
// stop it doing so.
const defaultRun = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const uid = () => (typeof process.getuid === 'function' ? process.getuid() : 0);

// `heartbeatStatus` and `installHeartbeat` share this: the four template vars, and the fresh render
// of whichever agent file this platform installs, for a byte-for-byte drift check against whatever
// is actually on disk. Recomputed on every call rather than cached — `BIN_PATH` is a fact about the
// currently-running copy of the plugin, and caching it would be exactly the staleness this exists
// to catch.
function freshRender(cfg) {
  const selection = workerSelection(cfg, {}, 'claude');
  const vars = { ROOT: cfg.root, ID: cfg.id, BIN: BIN_PATH, ROOT_XML: escapeXml(cfg.root), TICK_MODEL: selection.model, TICK_EFFORT: selection.thinking };
  return {
    tick: renderTemplate(readTemplate('tick.sh'), vars),
    plist: renderTemplate(readTemplate('heartbeat.plist'), vars),
    service: renderTemplate(readTemplate('heartbeat.service'), vars),
    timer: renderTemplate(readTemplate('heartbeat.timer'), vars),
  };
}

// `doctor`'s first new row: not installed / installed / installed for another root / drifted from
// a fresh render. The same drift check catches two different things with one comparison — a
// template edited since this agent was installed, and the plugin having moved to a new version's
// cache directory. The second one is why `tick.sh` is always part of the comparison and never just
// the plist/service file on its own: `BIN_PATH` is baked into `tick.sh`, rendered into the
// project's own `.orchestra/tick.sh`, and NOT into the plist or service file at all — those only
// ever name `<root>/.orchestra/tick.sh`, a path that does not change across a version bump. A drift
// check that compared only the agent file would never notice the plugin had moved.
export function heartbeatStatus(cfg, { home = homedir(), platform = process.platform } = {}) {
  const fresh = freshRender(cfg);
  const darwin = platform === 'darwin';
  const paths = darwin ? [plistPath(cfg.id, home)] : [systemdServicePath(cfg.id, home), systemdTimerPath(cfg.id, home)];
  const texts = paths.map(readIfExists);
  if (texts.every((t) => t === null)) return { state: 'not-installed', paths };

  // Either file missing while the other exists is itself a drift worth reporting, not a crash —
  // `installedRoot` below just reads whichever text it has.
  const existingRoot = installedRoot(texts.find((t) => t !== null) ?? '');
  if (existingRoot && existingRoot !== cfg.root) return { state: 'other-root', paths, existingRoot };

  const freshTexts = darwin ? [fresh.plist] : [fresh.service, fresh.timer];
  const tickText = readIfExists(join(orchestraDir(cfg.root), 'tick.sh'));
  const drifted = texts.some((t, i) => t !== freshTexts[i]) || tickText !== fresh.tick;
  return { state: drifted ? 'drifted' : 'installed', paths };
}

function refuse({ paths, existingRoot, cfg, removeHint }) {
  const message = `orchestra install-heartbeat: ${paths[0]} is already installed for ${existingRoot} — `
    + `refusing to overwrite it for ${cfg.root}. If ${existingRoot} no longer exists, remove that `
    + `agent first (${removeHint}), then re-run \`orchestra install-heartbeat\` here.\n`;
  return { ok: false, action: 'refused', platform: process.platform, id: cfg.id, root: cfg.root, existingRoot, paths, message };
}

function installLaunchd(cfg, { home, run }) {
  const label = agentLabel(cfg.id);
  const dest = plistPath(cfg.id, home);
  const existingText = readIfExists(dest);
  const existingRoot = existingText ? installedRoot(existingText) : null;
  if (existingRoot && existingRoot !== cfg.root) {
    return refuse({ paths: [dest], existingRoot, cfg, removeHint: `launchctl bootout gui/${uid()}/${label}; rm ${dest}` });
  }

  const fresh = freshRender(cfg);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, fresh.plist);
  mkdirSync(orchestraDir(cfg.root), { recursive: true });
  const tickPath = join(orchestraDir(cfg.root), 'tick.sh');
  writeFileSync(tickPath, fresh.tick);
  chmodSync(tickPath, 0o755);

  // `bootout` first and its failure ignored: it exits non-zero whenever the agent was not already
  // loaded, which is the ordinary case for a fresh install and not an error. `bootstrap` is not
  // allowed to fail silently the same way — a genuine failure there is this command's own.
  try { run('launchctl', ['bootout', `gui/${uid()}/${label}`]); } catch { /* not currently loaded */ }
  run('launchctl', ['bootstrap', `gui/${uid()}`, dest]);

  // Verify rather than announce: `launchctl list` is the only thing that knows whether the
  // bootstrap actually took, and a bootstrap that reports success without it happening is a real,
  // previously measured failure mode — not a hypothetical one this skips checking for.
  const listed = (() => { try { return run('launchctl', ['list']); } catch { return ''; } })();
  const verified = listed.includes(label);

  const action = existingText ? 'reinstalled' : 'installed';
  const message = verified
    ? `heartbeat ${action}: ${label}\n`
      + `  schedule: hourly at :13 (StartCalendarInterval — fires on wake for a slot missed asleep)\n`
      + `  rendered: ${dest}\n`
      + `  tick:     ${tickPath}\n`
      + `  log:      ${join(orchestraDir(cfg.root), 'tick.log')}\n`
    : `orchestra install-heartbeat: bootstrap reported success but launchctl does not list ${label} — not installed.\n`;
  return { ok: verified, action: verified ? action : 'failed', platform: 'darwin', id: cfg.id, root: cfg.root, path: dest, message };
}

function installSystemd(cfg, { home, run }) {
  const label = agentLabel(cfg.id);
  const svcPath = systemdServicePath(cfg.id, home);
  const timerPath = systemdTimerPath(cfg.id, home);
  const existingText = readIfExists(svcPath) ?? readIfExists(timerPath);
  const existingRoot = existingText ? installedRoot(existingText) : null;
  if (existingRoot && existingRoot !== cfg.root) {
    return refuse({
      paths: [svcPath, timerPath], existingRoot, cfg,
      removeHint: `systemctl --user disable --now ${label}.timer; rm ${svcPath} ${timerPath}`,
    });
  }

  const fresh = freshRender(cfg);
  mkdirSync(dirname(svcPath), { recursive: true });
  writeFileSync(svcPath, fresh.service);
  writeFileSync(timerPath, fresh.timer);
  mkdirSync(orchestraDir(cfg.root), { recursive: true });
  const tickPath = join(orchestraDir(cfg.root), 'tick.sh');
  writeFileSync(tickPath, fresh.tick);
  chmodSync(tickPath, 0o755);

  // UNTESTED (see README): written from the launchd path's shape, without its verify-by-listing
  // step — `daemon-reload` picks up the rewritten unit files, `enable --now` both enables the timer
  // for future logins and starts it now.
  run('systemctl', ['--user', 'daemon-reload']);
  run('systemctl', ['--user', 'enable', '--now', `${label}.timer`]);

  const action = existingText ? 'reinstalled' : 'installed';
  const message = `heartbeat ${action}: ${label}.timer\n`
    + `  schedule: hourly at :13 (OnCalendar, Persistent=true — fires on the next start for a slot missed while off)\n`
    + `  rendered: ${svcPath}\n            ${timerPath}\n`
    + `  tick:     ${tickPath}\n`
    + `  log:      ${join(orchestraDir(cfg.root), 'tick.log')}\n`
    + `  NOTE: the systemd path is written from the launchd path's shape and is not exercised by any\n`
    + `        test in this plugin — verify by hand with \`systemctl --user status ${label}.timer\`.\n`;
  return { ok: true, action, platform: 'linux', id: cfg.id, root: cfg.root, path: svcPath, message };
}

// `print: true` renders every template for this project and returns without writing a file or
// calling `run` at all — the `--print` flag's whole contract.
export function installHeartbeat(cfg, { home = homedir(), run = defaultRun, print = false } = {}) {
  const platform = process.platform;
  if (print) {
    const fresh = freshRender(cfg);
    const rendered = platform === 'darwin' ? { plist: fresh.plist } : { service: fresh.service, timer: fresh.timer };
    const message = `${Object.entries(rendered).map(([name, text]) => `--- ${name} ---\n${text}`).join('\n')}\n--- tick.sh ---\n${fresh.tick}\n`;
    return { ok: true, action: 'printed', platform, id: cfg.id, root: cfg.root, rendered: { ...rendered, tick: fresh.tick }, message };
  }
  return platform === 'darwin' ? installLaunchd(cfg, { home, run }) : installSystemd(cfg, { home, run });
}

export function installHeartbeatCommand({ cfg, args }) {
  const report = installHeartbeat(cfg, { print: args.includes('--print') });
  process.stdout.write(report.message);
  if (!report.ok) process.exitCode = 1;
}
