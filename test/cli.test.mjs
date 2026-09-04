import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers/fixture.mjs';
import { writeState, emptyState } from '../lib/register/state.mjs';
import { recordInstance } from '../lib/machine.mjs';
import { projectId } from '../lib/paths.mjs';
import { candidatePort } from '../lib/monitor/port.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orchestra');
const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };

// A temporary HOME, exactly like test/machine.test.mjs's own pattern — the doctor pin-conflict
// tests below write real entries into `~/.orchestra/instances.json`, and must never touch the
// developer's own registry. Harmless for every other test in this file, none of which reads HOME.
const HOME = process.env.HOME;
const homes = [];
beforeEach(() => { const h = mkdtempSync(join(tmpdir(), 'orchestra-home-')); homes.push(h); process.env.HOME = h; });
after(() => {
  process.env.HOME = HOME;
  homes.forEach((h) => rmSync(h, { recursive: true, force: true }));
  repos.forEach((r) => r.cleanup());
});

const run = (cwd, ...args) => {
  const r = execFileSync('node', [BIN, ...args], { cwd, encoding: 'utf8' });
  return r;
};

test('a subcommand in a project with no config exits 0 and prints nothing', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  assert.equal(run(r.root, 'roadmap', 'board'), '');
});

test('doctor answers even with no config', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  assert.match(run(r.root, 'doctor'), /no \.orchestra\/config\.json/);
});

test('doctor names the mode, the id and every defaulted key', () => {
  const r = repo({ mode: 'offline', name: 'demo' });
  const out = run(r.root, 'doctor');
  assert.match(out, /mode\s+offline/);
  assert.match(out, /name\s+demo/);
  assert.match(out, /[0-9a-f]{6}/);
  assert.match(out, /mainBranch.*\(default\)/);
});

// The spec says doctor "prints the resolved configuration and names every key that fell back to a
// default"; four keys were missing from the table — the three docs paths and briefExtra — so a
// project that had set one of them saw no row for it, and a project that had not was never told
// which directory the plugin would write a spec into.
test('doctor prints every config key, the docs paths and briefExtra included', () => {
  const r = repo({ mode: 'offline' });
  const out = run(r.root, 'doctor');
  assert.match(out, /docs\.specs\s+docs\/specs\s+\(default\)/);
  assert.match(out, /docs\.plans\s+docs\/plans\s+\(default\)/);
  assert.match(out, /docs\.results\s+docs\/results\s+\(default\)/);
  assert.match(out, /briefExtra\s+—\s+\(default\)/);
});

test('doctor shows a set briefExtra by its first line, not as a wall of prose', () => {
  const r = repo({ mode: 'offline', config: { briefExtra: 'Never touch the vendor tree.\nAnd run the linter.' } });
  const out = run(r.root, 'doctor');
  const line = out.split('\n').find((l) => l.includes('briefExtra'));
  assert.match(line, /Never touch the vendor tree\. …/);
  assert.doesNotMatch(line, /linter/);
});

test('doctor says what offline cannot answer', () => {
  const r = repo({ mode: 'offline' });
  assert.match(run(r.root, 'doctor'), /this machine only/i);
});

test('doctor does not say it in online mode', () => {
  const r = repo({ mode: 'online' });
  assert.doesNotMatch(run(r.root, 'doctor'), /this machine only/i);
});

// §8.3 / plan scope answer 4: a pinned `monitor.port` already held by another LIVE registered
// project is an error, not a warning — it will refuse to start, not silently move. `run()` throws
// on a non-zero exit (`execFileSync`), so this catches the throw and reads the error's own
// `stderr`/`status` rather than a returned string — every other CLI error path in this file writes
// to stderr, and `doctor`'s error follows the same convention.
test('doctor reports a pinned monitor.port already held by another live project, and exits 1', () => {
  const other = repo({ name: 'other-project' });
  const mine = repo({ mode: 'offline', config: { monitor: { port: 45123 } } });
  recordInstance({ id: projectId(other.root), name: 'other-project', root: other.root,
    mode: 'offline', port: 45123, monitorPid: process.pid });

  assert.throws(
    () => execFileSync('node', [BIN, 'doctor'], { cwd: mine.root, encoding: 'utf8', stdio: 'pipe' }),
    (e) => e.status === 1
      && e.stderr.includes(`error: monitor.port 45123 is pinned here but already held by other-project (${other.root})`),
  );
});

// "auto" never conflicts, by construction (§8.3) — the candidate is a pure function of the
// project's own id, so it cannot be "stolen". The collision built here is REAL — the other
// instance's recorded port IS `mine`'s own auto candidate — so this proves the "auto" guard itself
// is what suppresses the error, not that the two numbers merely happened not to match.
test('doctor prints no error for an "auto" monitor.port, even given a same-port collision on file', () => {
  const other = repo({ name: 'other-project' });
  const mine = repo({ mode: 'offline' });   // monitor.port defaults to "auto"
  recordInstance({ id: projectId(other.root), name: 'other-project', root: other.root,
    mode: 'offline', port: candidatePort(projectId(mine.root)), monitorPid: process.pid });

  const out = run(mine.root, 'doctor');
  assert.doesNotMatch(out, /error:/);
});

// A pin held only by a REAPED instance (its checkout gone) is not a live conflict — `liveInstances`
// already filters it out, so `doctor` must say nothing.
test('doctor prints no error when the pin is held only by a reaped instance', () => {
  const other = repo({ name: 'other-project' });
  const mine = repo({ mode: 'offline', config: { monitor: { port: 45123 } } });
  recordInstance({ id: projectId(other.root), name: 'other-project', root: other.root,
    mode: 'offline', port: 45123, monitorPid: process.pid });
  rmSync(other.root, { recursive: true, force: true });   // the other project's checkout is gone

  const out = run(mine.root, 'doctor');
  assert.doesNotMatch(out, /error:/);
});

test('an unknown subcommand exits non-zero and lists what exists', () => {
  const r = repo();
  assert.throws(
    () => execFileSync('node', [BIN, 'wat'], { cwd: r.root, encoding: 'utf8', stdio: 'pipe' }),
    (e) => e.status === 2 && /unknown subcommand "wat"/.test(e.stderr),
  );
});

test('doctor marks a nested default at the leaf, not the whole group', () => {
  const r = repo({ mode: 'offline', config: { roadmaps: { drafts: '.orchestra/wip' } } });
  const out = run(r.root, 'doctor');
  const draftsLine = out.split('\n').find((l) => l.includes('roadmaps.drafts'));
  const publishedLine = out.split('\n').find((l) => l.includes('roadmaps.published'));
  assert.match(publishedLine, /\(default\)/);
  assert.doesNotMatch(draftsLine, /\(default\)/);
});

test('a broken config surfaces through a non-machine subcommand as exit 2, not a silent off switch', () => {
  const r = repo();
  writeFileSync(join(r.root, '.orchestra', 'config.json'), JSON.stringify({ gates: [{}] }));
  assert.throws(
    () => execFileSync('node', [BIN, 'roadmap', 'board'], { cwd: r.root, encoding: 'utf8', stdio: 'pipe' }),
    (e) => e.status === 2 && /"mode" is required/.test(e.stderr) && /gates\[0\]/.test(e.stderr),
  );
});

test('doctor marks BOTH leaves of a nested default when the whole group is absent', () => {
  const r = repo({ mode: 'offline' });
  const out = run(r.root, 'doctor');
  const draftsLine = out.split('\n').find((l) => l.includes('roadmaps.drafts'));
  const publishedLine = out.split('\n').find((l) => l.includes('roadmaps.published'));
  assert.match(draftsLine, /\(default\)/);
  assert.match(publishedLine, /\(default\)/);
});

// A NaN --width would otherwise slice `planLaunches` to nothing AND suppress both lines that would
// have explained why (see lib/cli/tick.mjs), so a typo'd flag must be refused loudly rather than
// disable launching in total silence.
test('ready refuses a non-integer --width, naming what was passed', () => {
  const r = repo();
  writeState(r.root, emptyState(r.root));
  assert.throws(
    () => execFileSync('node', [BIN, 'ready', '--width', 'abc'], { cwd: r.root, encoding: 'utf8', stdio: 'pipe' }),
    (e) => e.status === 1 && /--width must be a positive integer/.test(e.stderr) && /"abc"/.test(e.stderr),
  );
});

test('ready refuses a --width with no value, the same as a non-numeric one', () => {
  const r = repo();
  writeState(r.root, emptyState(r.root));
  assert.throws(
    () => execFileSync('node', [BIN, 'ready', '--width'], { cwd: r.root, encoding: 'utf8', stdio: 'pipe' }),
    (e) => e.status === 1 && /--width must be a positive integer/.test(e.stderr),
  );
});

// A NaN --pid is written to disk as `pid: null` by JSON.stringify, and `holderIsDead` (lock.mjs)
// then reads a `tick` holder with a null pid as dead on its very first check — a lock that protects
// nothing. See lib/cli/register.mjs.
test('lock acquire refuses a --pid with no value, rather than writing a null pid', () => {
  const r = repo();
  assert.throws(
    () => execFileSync('node', [BIN, 'lock', 'acquire', '--pid'], { cwd: r.root, encoding: 'utf8', stdio: 'pipe' }),
    (e) => e.status === 1 && /--pid must be a positive integer/.test(e.stderr),
  );
});

// The off switch (`if (!cfg && !cmd.machine) process.exit(0)` in bin/orchestra) is written in ONE
// place and every verb but `doctor` relies on it rather than re-implementing the check — but until
// now only `roadmap board` was ever pinned against it. `archive-images` is behind that same gate
// and deletes files; a verb that quietly stopped honouring it would only be caught here.
//
// The verb list is read from `orchestra help`'s own output (bin/orchestra prints `[...COMMANDS.keys()]`
// verbatim) rather than duplicated by hand, so a verb registered later is covered automatically
// without this test being told about it.
test('every registered verb but doctor honours the off switch — exits 0 and prints nothing', () => {
  const help = execFileSync('node', [BIN, 'help'], { encoding: 'utf8' });
  const verbs = help.split('\n').map((l) => l.trim())
    .filter((l) => l && l !== 'orchestra <subcommand>');
  assert.ok(verbs.includes('doctor'));
  assert.ok(verbs.includes('archive-images'));
  assert.ok(verbs.length > 2, 'the help output did not parse into a real verb list');

  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  for (const verb of verbs) {
    if (verb === 'doctor') continue;
    const res = spawnSync('node', [BIN, verb], { cwd: r.root, encoding: 'utf8' });
    assert.equal(res.status, 0, `${verb}: expected exit 0, got ${res.status} (stderr: ${res.stderr})`);
    assert.equal(res.stdout, '', `${verb}: expected no stdout, got ${JSON.stringify(res.stdout)}`);
    assert.equal(res.stderr, '', `${verb}: expected no stderr, got ${JSON.stringify(res.stderr)}`);
  }
});
