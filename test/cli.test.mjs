import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers/fixture.mjs';
import { writeState, emptyState } from '../lib/register/state.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orchestra');
const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };

// A temporary HOME, exactly like test/machine.test.mjs's own pattern — `orchestra monitor` below
// writes a real `~/.orchestra/monitor.json`, and must never touch the developer's own registry.
// Harmless for every other test in this file, none of which reads HOME.
const HOME = process.env.HOME;
const homes = [];
// Monitor children, killed BY THEIR CAPTURED PID on cleanup (user rule) — never by a pattern over
// the process table. `orchestra monitor` binds a real port and keeps serving, so a test that starts
// one must be certain it is stopped even if an assertion above it throws.
const children = [];
beforeEach(() => { const h = mkdtempSync(join(tmpdir(), 'orchestra-home-')); homes.push(h); process.env.HOME = h; });
after(() => {
  process.env.HOME = HOME;
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
  homes.forEach((h) => rmSync(h, { recursive: true, force: true }));
  repos.forEach((r) => r.cleanup());
});

const run = (cwd, ...args) => {
  const r = execFileSync('node', [BIN, ...args], { cwd, encoding: 'utf8' });
  return r;
};

// A monitor child and the URL it prints — the same shape `test/p4-acceptance.test.mjs` uses.
// `spawn` and a bounded wait on the child's own stdout/stderr, never `spawnSync` with a timeout: a
// `spawnSync` here would bind a real port on the developer's own machine and hold it for the whole
// timeout, and killing a server by anything other than its captured pid is a standing rule in this
// project.
function startMonitor(cwd, args = ['--no-open']) {
  const child = spawn(process.execPath, [BIN, 'monitor', ...args],
    { cwd, env: { ...process.env, HOME: process.env.HOME } });
  children.push(child);
  let text = '';
  const said = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no URL printed in 20s by orchestra monitor in ${cwd}: ${text}`)), 20_000);
    const look = () => {
      const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(text);
      if (!m) return;
      clearTimeout(timer);
      resolve({ url: m[0], port: Number(m[1]) });
    };
    child.stdout.on('data', (c) => { text += c; look(); });
    child.stderr.on('data', (c) => { text += c; look(); });
    child.on('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`orchestra monitor exited (${code ?? signal}): ${text}`)); });
  });
  return { child, said };
}

// SIGTERM, then the child's own `exit` EVENT — never a fixed sleep, never a signal matched over the
// process table.
const stopMonitor = (m) => new Promise((resolve) => {
  if (m.child.exitCode !== null || m.child.signalCode !== null) { resolve(); return; }
  m.child.once('exit', () => resolve());
  m.child.kill('SIGTERM');
});

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

// `orchestra monitor` is a machine command now (spec: one page for the whole machine, not one per
// project) — it must answer from a directory that has never heard of orchestra, the same exception
// `doctor` already gets. It binds and keeps serving, so it is stopped by `stopMonitor` rather than
// left to exit on its own the way the old per-project refusal did.
test('`orchestra monitor` answers from a directory with no config — it is a machine command', async () => {
  const bare = mkdtempSync(join(tmpdir(), 'orchestra-bare-'));
  try {
    const m = startMonitor(bare);
    const { url } = await m.said;
    assert.match(url, /http:\/\/127\.0\.0\.1:\d+/);
    await stopMonitor(m);
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});

test('`orchestra monitor --port 5000` is still refused — the port has one source of truth', () => {
  const r = spawnSync(process.execPath, [BIN, 'monitor', '--port', '5000'],
    { cwd: tmpdir(), encoding: 'utf8', env: { ...process.env, HOME: process.env.HOME } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown argument --port/);
  assert.match(r.stderr, /monitorPort in ~\/\.orchestra\/machine\.json/);
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
// place and every verb but the machine-level ones relies on it rather than re-implementing the
// check — but until now only `roadmap board` was ever pinned against it. `archive-images` is behind
// that same gate and deletes files; a verb that quietly stopped honouring it would only be caught
// here.
//
// The verb list is read from `orchestra help`'s own output (bin/orchestra prints `[...COMMANDS.keys()]`
// verbatim) rather than duplicated by hand, so a verb registered later is covered automatically
// without this test being told about it.
//
// The exceptions are spec §3.1's machine-level verbs, which answer ABOUT THE MACHINE and not about
// a project, so a directory that has never heard of orchestra is exactly where they must still
// speak: `doctor` tells a first-time user how to opt in, `instances` says what else on this
// machine is running, `init` is the command a first-time user runs — it must answer bare, with
// usage and what it would detect, rather than the off switch's ordinary silence — and `monitor`
// serves the one page for the whole machine. They are named here, and asserted to answer, so that
// this test cannot go green by one of them quietly falling silent instead.
const MACHINE_VERBS = ['doctor', 'instances', 'init', 'monitor'];

test('every registered verb but the machine-level ones honours the off switch — exits 0 and prints nothing', async () => {
  const help = execFileSync('node', [BIN, 'help'], { encoding: 'utf8' });
  const verbs = help.split('\n').map((l) => l.trim())
    .filter((l) => l && l !== 'orchestra <subcommand>');
  for (const verb of MACHINE_VERBS) assert.ok(verbs.includes(verb), `${verb} is registered`);
  assert.ok(verbs.includes('archive-images'));
  assert.ok(verbs.length > 2, 'the help output did not parse into a real verb list');

  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  for (const verb of verbs) {
    // `monitor` is skipped here for the same reason it needs its own branch below: unlike every
    // other verb, it does not exit on its own — it binds and keeps serving. A `spawnSync` with no
    // timeout would hang this whole test waiting for a server that never stops.
    if (MACHINE_VERBS.includes(verb)) continue;
    const res = spawnSync('node', [BIN, verb], { cwd: r.root, encoding: 'utf8' });
    assert.equal(res.status, 0, `${verb}: expected exit 0, got ${res.status} (stderr: ${res.stderr})`);
    assert.equal(res.stdout, '', `${verb}: expected no stdout, got ${JSON.stringify(res.stdout)}`);
    assert.equal(res.stderr, '', `${verb}: expected no stderr, got ${JSON.stringify(res.stderr)}`);
  }

  // The positive control: each exception ANSWERS and SUCCEEDS in that same configless directory.
  // Both halves — a verb that started exiting 1 while still printing its answer would otherwise
  // pass here, and an exit code is what a script reads.
  // Driven off MACHINE_VERBS rather than a second literal list, so a verb added to it later is
  // controlled here without this loop being told about it — minus `monitor`, which answers by
  // binding and serving rather than by exiting and is proven on its own below.
  for (const verb of MACHINE_VERBS.filter((v) => v !== 'monitor')) {
    const res = spawnSync('node', [BIN, verb], { cwd: r.root, encoding: 'utf8' });
    assert.equal(res.status, 0, `${verb}: expected exit 0, got ${res.status} (stderr: ${res.stderr})`);
    assert.match(res.stdout, /\S/, `${verb}: expected the machine-level verb to answer anyway`);
  }

  // `monitor` answers too, but by binding and serving rather than by exiting — proven the same way
  // as the dedicated `orchestra monitor` test above, spawned and stopped by its own captured pid.
  const m = startMonitor(r.root);
  const { url } = await m.said;
  assert.match(url, /http:\/\/127\.0\.0\.1:\d+/);
  await stopMonitor(m);
});
