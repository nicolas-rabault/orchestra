// The heartbeat: the four templates, the pure render/lookup functions over their text, and
// `installHeartbeat` under a temporary, explicit `home` — never the developer's own
// `~/Library/LaunchAgents` — with `run` recorded rather than spawned, exactly as §14 already
// requires of the machine registry (test/machine.test.mjs). `doctor`'s three new rows are covered
// at the end, through the real CLI, the same way every other doctor row already is
// (test/cli.test.mjs) — a temporary HOME there too, since `heartbeatStatus`/`installedAgents` fall
// back to `homedir()` when a CLI invocation gives them no override.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers/fixture.mjs';
import { projectId } from '../lib/paths.mjs';
import { recordInstance } from '../lib/machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const BIN = join(REPO, 'bin', 'orchestra');
const TEMPLATES = ['heartbeat.plist', 'heartbeat.service', 'heartbeat.timer', 'tick.sh'];
const readTemplate = (name) => readFileSync(join(REPO, 'templates', name), 'utf8');

const {
  renderTemplate, installedRoot, agentLabel, plistPath, systemdServicePath, systemdTimerPath,
  installedAgents, heartbeatStatus, installHeartbeat,
} = await import('../lib/cli/heartbeat.mjs');

// A temporary HOME, exactly like test/machine.test.mjs's own pattern — only the doctor-through-the-
// CLI tests at the bottom of this file read it (`homedir()` follows HOME on POSIX); every other
// test here passes its own `home` directly and never touches this one.
const REAL_HOME = process.env.HOME;
const homes = [];
beforeEach(() => { const h = mkdtempSync(join(tmpdir(), 'orchestra-home-')); homes.push(h); process.env.HOME = h; });

const roots = [];
const projectRoot = () => { const r = mkdtempSync(join(tmpdir(), 'orchestra-proj-')); roots.push(r); return r; };
const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };

after(() => {
  process.env.HOME = REAL_HOME;
  homes.forEach((h) => rmSync(h, { recursive: true, force: true }));
  roots.forEach((r) => rmSync(r, { recursive: true, force: true }));
  repos.forEach((r) => r.cleanup());
});

// A recorder standing in for launchctl/systemctl: records every call, throws for `bootout` (the
// ordinary "not currently loaded" case a fresh install always hits — its argument names the
// label, remembered here) and answers `list` with a line naming every label bootout was asked
// about, so the verify-by-listing step in installHeartbeat's launchd path sees success by default.
function recorder({ listHasLabel = true } = {}) {
  const calls = [];
  const seenLabels = new Set();
  const run = (bin, args) => {
    calls.push([bin, args]);
    if (bin === 'launchctl' && args[0] === 'bootout') {
      seenLabels.add(String(args[1]).split('/').pop());
      throw new Error('boot-out: no such service');
    }
    if (bin === 'launchctl' && args[0] === 'list') {
      return listHasLabel ? [...seenLabels].map((l) => `-\t0\t${l}`).join('\n') : '';
    }
    return '';
  };
  run.calls = calls;
  return run;
}

// ---------------------------------------------------------------------------------------------
// Step 1: renderTemplate / installedRoot / the path and label helpers — no filesystem, no
// launchctl, over rendered text only.
// ---------------------------------------------------------------------------------------------

test('renderTemplate replaces every placeholder with its value', () => {
  const out = renderTemplate('root=__ROOT__ id=__ID__ bin=__BIN__', { ROOT: '/a/b', ID: 'abc123', BIN: '/a/b/bin/orchestra' });
  assert.equal(out, 'root=/a/b id=abc123 bin=/a/b/bin/orchestra');
});

test('renderTemplate leaves a placeholder untouched when no var is given for it', () => {
  const out = renderTemplate('root=__ROOT__ id=__ID__', { ROOT: '/a/b' });
  assert.equal(out, 'root=/a/b id=__ID__');
});

// The bug this pins: `String.prototype.replaceAll(search, value)` treats `$&`, `$$`, `` $` ``,
// `$'` and `$<n>` as special replacement patterns whenever `value` is a plain STRING, even though
// `search` here is a literal string and not a regex. A project path containing a bare `$` would
// silently corrupt the render if `renderTemplate` passed `v` straight through instead of behind a
// replacer function.
test('renderTemplate treats the replacement value literally, even one shaped like a $-pattern', () => {
  const out = renderTemplate('root=__ROOT__ and bin=__BIN__', { ROOT: '/weird/$&/$1/$$path', BIN: 'x' });
  assert.equal(out, 'root=/weird/$&/$1/$$path and bin=x');
});

test('agentLabel formats the six-hex id into the launchd/systemd label', () => {
  assert.equal(agentLabel('abc123'), 'com.orchestra.abc123');
});

test('plistPath, systemdServicePath and systemdTimerPath place the agent under the given home', () => {
  assert.equal(plistPath('abc123', '/home/x'), '/home/x/Library/LaunchAgents/com.orchestra.abc123.plist');
  assert.equal(systemdServicePath('abc123', '/home/x'), '/home/x/.config/systemd/user/com.orchestra.abc123.service');
  assert.equal(systemdTimerPath('abc123', '/home/x'), '/home/x/.config/systemd/user/com.orchestra.abc123.timer');
});

test('installedRoot recovers the root from a rendered plist', () => {
  const text = renderTemplate(readTemplate('heartbeat.plist'), { ROOT: '/Users/dev/proj', ID: 'abc123', BIN: '/x/bin/orchestra' });
  assert.equal(installedRoot(text), '/Users/dev/proj');
});

test('installedRoot recovers the root from a rendered systemd service file', () => {
  const text = renderTemplate(readTemplate('heartbeat.service'), { ROOT: '/Users/dev/proj', ID: 'abc123', BIN: '/x/bin/orchestra' });
  assert.equal(installedRoot(text), '/Users/dev/proj');
});

test('installedRoot returns null when the text carries no marker', () => {
  assert.equal(installedRoot('nothing to see here'), null);
  assert.equal(installedRoot(''), null);
});

// A placeholder added to a template without adding it to `freshRender`'s vars would leave it
// unresolved in every real install — this catches that class of mistake directly on the shipped
// template files, not on a hand-written fixture string.
test('every real template renders with {ROOT, ID, BIN} and leaves no placeholder behind', () => {
  const vars = { ROOT: '/Users/dev/my-project', ID: 'abc123', BIN: '/plugins/cache/orchestra@0.5.0/bin/orchestra' };
  for (const name of TEMPLATES) {
    const out = renderTemplate(readTemplate(name), vars);
    assert.doesNotMatch(out, /__[A-Z]+__/, `${name} left an unresolved placeholder`);
    assert.match(out, /\/Users\/dev\/my-project/, `${name} does not carry the rendered root`);
  }
});

// ---------------------------------------------------------------------------------------------
// Step 2: installHeartbeat, under an explicit temporary home and a recorded run — never the
// developer's own ~/Library/LaunchAgents, never a real launchctl. Exercised on `process.platform`
// as it actually is on the machine running this suite (macOS) — the launchd path. The systemd path
// is written from the same shape and is NOT exercised here; see the README.
// ---------------------------------------------------------------------------------------------

test('a fresh install writes the plist and an executable tick.sh, and bootstraps', () => {
  const root = projectRoot();
  const home = mkdtempSync(join(tmpdir(), 'orchestra-home-')); homes.push(home);
  const cfg = { id: 'aaa111', root };
  const run = recorder();

  const report = installHeartbeat(cfg, { home, run });

  assert.equal(report.ok, true);
  assert.equal(report.action, 'installed');
  assert.equal(report.platform, 'darwin');

  const plist = readFileSync(plistPath('aaa111', home), 'utf8');
  assert.equal(installedRoot(plist), root);
  assert.match(plist, /com\.orchestra\.aaa111/);

  const tickPath = join(root, '.orchestra', 'tick.sh');
  const tickText = readFileSync(tickPath, 'utf8');
  assert.match(tickText, new RegExp(`ROOT="${root}"`));
  assert.equal(statSync(tickPath).mode & 0o777, 0o755);

  // bootout (ignored failure), then bootstrap, then the verify-by-listing `list` call — in order.
  assert.deepEqual(run.calls.map((c) => c[0]), ['launchctl', 'launchctl', 'launchctl']);
  assert.deepEqual(run.calls.map((c) => c[1][0]), ['bootout', 'bootstrap', 'list']);
  assert.deepEqual(run.calls[1][1], ['bootstrap', `gui/${process.getuid ? process.getuid() : 0}`, plistPath('aaa111', home)]);
});

test('a re-install over the same root is idempotent', () => {
  const root = projectRoot();
  const home = mkdtempSync(join(tmpdir(), 'orchestra-home-')); homes.push(home);
  const cfg = { id: 'aaa111', root };

  const first = installHeartbeat(cfg, { home, run: recorder() });
  const second = installHeartbeat(cfg, { home, run: recorder() });

  assert.equal(first.action, 'installed');
  assert.equal(second.action, 'reinstalled');
  assert.equal(second.ok, true);
  // Re-rendering over the same root produces byte-identical content — the whole point of a
  // template rather than a hand-edited file.
  assert.equal(readFileSync(plistPath('aaa111', home), 'utf8'), readFileSync(plistPath('aaa111', home), 'utf8'));
});

test('a plist rendered for another root is refused, naming both paths, and touches nothing else', () => {
  const home = mkdtempSync(join(tmpdir(), 'orchestra-home-')); homes.push(home);
  const otherRoot = projectRoot();
  const myRoot = projectRoot();
  const cfg = { id: 'shared', root: myRoot };

  // A plist already sits at this label's path, rendered for a DIFFERENT root — the shape the P5
  // acceptance line names: an agent left behind by another checkout (or, as built here, one that
  // otherwise ended up at the same label).
  mkdirSync(dirname(plistPath('shared', home)), { recursive: true });
  writeFileSync(plistPath('shared', home), renderTemplate(readTemplate('heartbeat.plist'), { ROOT: otherRoot, ID: 'shared', BIN: '/x/bin/orchestra' }));

  const run = recorder();
  const report = installHeartbeat(cfg, { home, run });

  assert.equal(report.ok, false);
  assert.equal(report.action, 'refused');
  assert.equal(report.existingRoot, otherRoot);
  assert.match(report.message, new RegExp(otherRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(report.message, new RegExp(myRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // Refused before anything is touched: no launchctl call, and no tick.sh written into MY root.
  assert.equal(run.calls.length, 0);
  assert.equal(existsSync(join(myRoot, '.orchestra', 'tick.sh')), false);
  // The other project's plist is untouched.
  assert.equal(installedRoot(readFileSync(plistPath('shared', home), 'utf8')), otherRoot);
});

test('--print renders every template and installs nothing', () => {
  const root = projectRoot();
  const home = mkdtempSync(join(tmpdir(), 'orchestra-home-')); homes.push(home);
  const cfg = { id: 'aaa111', root };
  const run = recorder();

  const report = installHeartbeat(cfg, { home, run, print: true });

  assert.equal(report.ok, true);
  assert.equal(report.action, 'printed');
  assert.match(report.rendered.plist, new RegExp(`ORCHESTRA_ROOT=${root}`));
  assert.match(report.rendered.tick, new RegExp(`ROOT="${root}"`));
  assert.equal(run.calls.length, 0);
  assert.equal(existsSync(plistPath('aaa111', home)), false);
  assert.equal(existsSync(join(root, '.orchestra', 'tick.sh')), false);
});

test('a bootstrap failure is a real failure, not swallowed like bootout\'s', () => {
  const root = projectRoot();
  const home = mkdtempSync(join(tmpdir(), 'orchestra-home-')); homes.push(home);
  const cfg = { id: 'aaa111', root };
  const run = (bin, args) => {
    if (args[0] === 'bootout') throw new Error('not loaded');
    if (args[0] === 'bootstrap') throw new Error('bootstrap failed: permission denied');
    return '';
  };
  assert.throws(() => installHeartbeat(cfg, { home, run }), /bootstrap failed/);
});

// ---------------------------------------------------------------------------------------------
// heartbeatStatus / installedAgents: the pure read half `doctor` builds its rows from, tested
// directly with an injected home AND platform, so both the launchd and the systemd shapes of the
// FILE-READING logic are exercised even though the systemd INSTALL path (spawning systemctl) is
// not — see the README for that line.
// ---------------------------------------------------------------------------------------------

test('heartbeatStatus reports not-installed, then installed, then drifted after the template moves', () => {
  const root = projectRoot();
  const home = mkdtempSync(join(tmpdir(), 'orchestra-home-')); homes.push(home);
  const cfg = { id: 'aaa111', root };

  assert.equal(heartbeatStatus(cfg, { home }).state, 'not-installed');
  installHeartbeat(cfg, { home, run: recorder() });
  assert.equal(heartbeatStatus(cfg, { home }).state, 'installed');

  // Simulate the plugin having moved (a version bump): the plist itself never names BIN_PATH — it
  // only ever points at `<root>/.orchestra/tick.sh` — so the drift this is supposed to catch shows
  // up in tick.sh's own content, which DOES bake BIN_PATH in. Rewriting tick.sh with a stale one,
  // leaving the plist untouched, is exactly what a real version bump looks like on disk.
  writeFileSync(join(root, '.orchestra', 'tick.sh'), renderTemplate(readTemplate('tick.sh'), { ROOT: root, BIN: '/old/cache/orchestra@0.1.0/bin/orchestra' }));
  assert.equal(heartbeatStatus(cfg, { home }).state, 'drifted');
});

test('heartbeatStatus reports other-root for a systemd install too', () => {
  const home = mkdtempSync(join(tmpdir(), 'orchestra-home-')); homes.push(home);
  const otherRoot = projectRoot();
  const myRoot = projectRoot();
  mkdirSync(dirname(systemdServicePath('shared', home)), { recursive: true });
  writeFileSync(systemdServicePath('shared', home), renderTemplate(readTemplate('heartbeat.service'), { ROOT: otherRoot, ID: 'shared', BIN: '/x/bin/orchestra' }));

  const status = heartbeatStatus({ id: 'shared', root: myRoot }, { home, platform: 'linux' });
  assert.equal(status.state, 'other-root');
  assert.equal(status.existingRoot, otherRoot);
});

test('installedAgents lists every com.orchestra.* plist under the given home, unreadable ones included', () => {
  const home = mkdtempSync(join(tmpdir(), 'orchestra-home-')); homes.push(home);
  const root = projectRoot();
  installHeartbeat({ id: 'aaa111', root }, { home, run: recorder() });
  mkdirSync(dirname(plistPath('bbb222', home)), { recursive: true });
  writeFileSync(plistPath('bbb222', home), 'not a valid plist, no marker at all');
  // Not a `com.orchestra.` agent — must not be picked up.
  writeFileSync(join(dirname(plistPath('bbb222', home)), 'com.other.thing.plist'), 'irrelevant');

  const agents = installedAgents({ home }).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(agents.map((a) => a.id), ['aaa111', 'bbb222']);
  assert.equal(agents.find((a) => a.id === 'aaa111').root, root);
  assert.equal(agents.find((a) => a.id === 'bbb222').root, null);
});

test('installedAgents on a machine with nothing installed is an empty list, not a throw', () => {
  const home = mkdtempSync(join(tmpdir(), 'orchestra-home-')); homes.push(home);
  assert.deepEqual(installedAgents({ home }), []);
  assert.deepEqual(installedAgents({ home, platform: 'linux' }), []);
});

// ---------------------------------------------------------------------------------------------
// Step 3: doctor's three new rows, through the real CLI — the same style every other doctor row
// is already tested in (test/cli.test.mjs), since doctor(cfg) itself takes no injected deps and
// falls back to `homedir()`, which follows the HOME this file's beforeEach already redirects.
//
// These tests never run the real `install-heartbeat` subcommand as a subprocess: that command has
// no way to inject `run`, so doing so would spawn a REAL `launchctl` and could bootstrap a REAL
// LaunchAgent on the machine running this suite — exactly what this whole file exists to prevent.
// Wherever a test needs an "installed" agent on disk, it gets there by calling the exported
// `installHeartbeat` directly, in-process, with a recorder — writing to the very same `home`
// (`process.env.HOME`, set by this file's own beforeEach) that the `doctor` subprocess below it
// will then read, since `execFileSync` inherits the parent's environment by default.
// ---------------------------------------------------------------------------------------------

const run = (cwd, ...args) => execFileSync('node', [BIN, ...args], { cwd, encoding: 'utf8' });

test('doctor reports the heartbeat as not installed when it is not', () => {
  const r = repo({ mode: 'offline' });
  const out = run(r.root, 'doctor');
  assert.match(out, /heartbeat\s+not installed — run `orchestra install-heartbeat`/);
});

test('doctor reports the heartbeat as installed once one has been rendered for this root', () => {
  const r = repo({ mode: 'offline' });
  installHeartbeat({ id: projectId(r.root), root: r.root }, { home: process.env.HOME, run: recorder() });
  const out = run(r.root, 'doctor');
  assert.match(out, /heartbeat\s+installed \(.*Library\/LaunchAgents/);
});

test('doctor reports an agent installed for a different root by name, without crashing', () => {
  const r = repo({ mode: 'offline' });
  const other = repo({ mode: 'offline', name: 'other' });
  const home = process.env.HOME;
  const mineId = projectId(r.root);
  // The collision this row exists to catch: this project's OWN id-keyed plist path, but rendered
  // for a different root — same shape `installHeartbeat`'s own refusal test builds by hand.
  mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true });
  writeFileSync(
    join(home, 'Library', 'LaunchAgents', `com.orchestra.${mineId}.plist`),
    renderTemplate(readTemplate('heartbeat.plist'), { ROOT: other.root, ID: mineId, BIN: '/x/bin/orchestra' }),
  );
  const out = run(r.root, 'doctor');
  assert.match(out, /heartbeat\s+installed for a DIFFERENT project/);
  assert.match(out, new RegExp(other.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('doctor reports rerere.enabled, false by default, without ever refusing', () => {
  const r = repo({ mode: 'offline' });
  const out = run(r.root, 'doctor');
  assert.match(out, /rerere\.enabled\s+false/);
  execFileSync('git', ['config', 'rerere.enabled', 'true'], { cwd: r.root });
  const out2 = run(r.root, 'doctor');
  assert.match(out2, /rerere\.enabled\s+true/);
});

test('doctor lists heartbeat agents on this machine, none installed', () => {
  const r = repo({ mode: 'offline' });
  const out = run(r.root, 'doctor');
  assert.match(out, /heartbeat agents\s+none installed on this machine/);
});

test('doctor lists an installed agent as ok once it is in the machine registry, orphaned once its root is gone', () => {
  const r = repo({ mode: 'offline' });
  const home = process.env.HOME;
  installHeartbeat({ id: projectId(r.root), root: r.root }, { home, run: recorder() });
  recordInstance({ id: projectId(r.root), name: 'demo', root: r.root, mode: 'offline' });

  const before = run(r.root, 'doctor');
  assert.match(before, /heartbeat agents\s+1 installed on this machine/);
  assert.match(before, /—\s+ok/);

  const gone = r.root;
  r.cleanup();
  // `doctor` itself needs a live project to run from — read the agent listing from a SECOND,
  // unrelated project on the same (temporary) machine, now that the first one's checkout is gone.
  // The stale registry entry for `gone` is deliberately left in place (nothing here calls
  // `recordInstance` again to reap it): the orphan check reads the plist's own root directly and
  // must catch this regardless of whether the registry has caught up.
  const other = repo({ mode: 'offline', name: 'other' });
  const after1 = run(other.root, 'doctor');
  assert.match(after1, /ORPHANED — its checkout no longer exists/);
  assert.doesNotMatch(after1, new RegExp(`${gone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+—\\s+ok`));
});
