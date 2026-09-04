// P4's acceptance (spec §15): "two fixtures serve at once on different ports, each page naming its
// own project; killing one and restarting it returns the same port."
//
// SPLIT DELIBERATELY IN TWO, and this is why. What is SERVED is asserted IN-PROCESS, by calling
// `createHandler(ctx)` with a fake request and a fake response — the shape the source project's own
// suite used, deterministic and fast, with no socket between the assertion and the code. What needs
// TWO REAL LISTENERS at once — allocation, the registry's bound port, the same port across a
// restart — is asserted OUT-OF-PROCESS, with `orchestra monitor --no-open` children.
//
// The seam is not timidity about sockets. It is that an HTTP client against localhost is not
// trustworthy as a PROBE here: measured 2026-08-12 in planetCraft, `curl` could not reach a
// localhost server `lsof` proved was listening and a browser was using, and the hang cost a
// conductor. So nothing below asks a child's own port a question; the children are asked only to
// bind, to print, and to be recorded, and everything about content is asked of the handler directly.
//
// Every test runs under a TEMPORARY HOME (spec §14), so `~/.orchestra/instances.json` under test is
// never the developer's own.
//
// WHAT THIS SUITE DOES NOT PROVE, said here rather than discovered later: it proves the page
// composes, allocates and round-trips an answer. It proves nothing about what the page LOOKS like,
// and nothing about the browser half beyond the bytes being served — no test here loads `app.js`.
// That is the same limit the source's suite had.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigOrThrow } from '../lib/config.mjs';
import { writeBeat } from '../lib/register/beat.mjs';
import { candidatePort } from '../lib/monitor/port.mjs';
import { createHandler, PUBLIC_DIR } from '../lib/monitor/server.mjs';
import { makeRepo, ROADMAP } from './helpers/fixture.mjs';
import { fakeReq, fakeRes } from './helpers/fakeHttp.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orchestra');

const HOME = process.env.HOME;
const homes = [];
const repos = [];
const children = [];
beforeEach(() => { const h = mkdtempSync(join(tmpdir(), 'orchestra-home-')); homes.push(h); process.env.HOME = h; });
after(() => {
  process.env.HOME = HOME;
  // BY PID, never by a pattern over the process table (user rule): each child was captured when it
  // was spawned, and `child.kill()` signals exactly that pid.
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
  homes.forEach((h) => rmSync(h, { recursive: true, force: true }));
  repos.forEach((r) => r.cleanup());
});

// A fixture with a published, enroled roadmap — the state P1/P2a leave. `orchestra inbox` reads the
// register before it prints anything, so row 5 needs a real one; the model rows get a real task out
// of the same publish.
function project(name) {
  const r = makeRepo({ name });
  repos.push(r);
  mkdirSync(join(r.root, '.orchestra', 'drafts'), { recursive: true });
  writeFileSync(join(r.root, '.orchestra', 'drafts', 'demo.md'), ROADMAP);
  const run = (...args) => execFileSync(process.execPath, [BIN, ...args],
    { cwd: r.root, encoding: 'utf8', env: { ...process.env, HOME: process.env.HOME } });
  run('roadmap', 'publish');
  return { ...r, run, id: loadConfigOrThrow(r.root).id, cfg: () => loadConfigOrThrow(r.root) };
}

// Two fixtures whose CANDIDATES differ. `candidatePort` folds a project id into a 100-wide band, so
// two random temp directories collide about one time in a hundred — remade rather than left to
// flake, since "two different deterministic candidates" is half of what row 1 asserts.
function twoProjects() {
  const a = project('alpha');
  for (let i = 0; i < 20; i += 1) {
    const b = project('beta');
    if (candidatePort(b.id) !== candidatePort(a.id)) return [a, b];
  }
  throw new Error('could not build two fixtures with different candidate ports');
}

const instances = () => JSON.parse(readFileSync(join(process.env.HOME, '.orchestra', 'instances.json'), 'utf8')).instances;
const entryOf = (id) => instances().find((e) => e.id === id);

// A monitor child, and the URL it prints. Nothing here connects to it.
function startMonitor(root) {
  const child = spawn(process.execPath, [BIN, 'monitor', '--no-open'],
    { cwd: root, env: { ...process.env, HOME: process.env.HOME } });
  children.push(child);
  let text = '';
  const said = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no URL printed in 20s by orchestra monitor in ${root}: ${text}`)), 20_000);
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
  return { child, said, text: () => text };
}

// A child that printed a URL and is STILL RUNNING is a child that bound. `orchestra monitor` prints
// a URL on the refuse-and-point path too (one page per project) and then exits, so without this
// witness a refusal would satisfy every port assertion below vacuously.
const stillServing = (m) => m.child.exitCode === null && m.child.signalCode === null;

// SIGTERM, then the child's own `exit` EVENT — never a fixed sleep, and never a signal matched over
// the process table. A port is released when the process holding it is gone, and the only honest
// witness to that is the exit event.
const stopMonitor = (m) => new Promise((resolve) => {
  if (m.child.exitCode !== null || m.child.signalCode !== null) { resolve(); return; }
  m.child.once('exit', () => resolve());
  m.child.kill('SIGTERM');
});

// The in-process handler BINDS NOTHING, so the port it is handed is only the base it parses a
// relative request URL against and the number the model echoes back as `project.port`. Deliberately
// outside the 4380-4479 band all the same, so nothing in this file can be read as claiming a port a
// real orchestra on this machine might be serving.
const FAKE_PORT = 59999;
const handlerFor = (p) => createHandler({
  projects: () => [{ id: p.cfg().id, name: p.cfg().name, root: p.root, mode: p.cfg().mode, cfg: p.cfg() }],
  port: FAKE_PORT, publicDir: PUBLIC_DIR,
});

// ---- row 1 -------------------------------------------------------------------------------------
test('two projects serve at once on different ports, and the registry records the port each BOUND', async () => {
  const [a, b] = twoProjects();
  assert.notEqual(candidatePort(a.id), candidatePort(b.id));

  const ma = startMonitor(a.root);
  const sa = await ma.said;
  const mb = startMonitor(b.root);
  const sb = await mb.said;

  assert.notEqual(sa.port, sb.port);
  assert.ok(stillServing(ma), 'the first child is serving');
  assert.ok(stillServing(mb), 'the second child is serving');
  assert.match(ma.text(), /http:\/\/127\.0\.0\.1:\d+/);
  assert.match(mb.text(), /http:\/\/127\.0\.0\.1:\d+/);
  // The root, so a person with four tabs open can tell which checkout a page is looking at.
  assert.match(ma.text(), new RegExp(a.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.equal(entryOf(a.id).port, sa.port);
  assert.equal(entryOf(b.id).port, sb.port);
  assert.equal(entryOf(a.id).name, 'alpha');
  assert.equal(entryOf(b.id).name, 'beta');

  await stopMonitor(ma);
  await stopMonitor(mb);
});

// ---- row 2 -------------------------------------------------------------------------------------
test('each page names its own project, in its <title> and in the model', async () => {
  const [a, b] = twoProjects();

  for (const p of [a, b]) {
    const handler = handlerFor(p);

    const page = fakeRes();
    await handler(fakeReq('GET', '/'), page);
    assert.equal(page.code, 200);
    const html = String(page.body);
    assert.match(html, new RegExp(`<title>[^<]*${p.cfg().name}[^<]*</title>`));

    const model = fakeRes();
    await handler(fakeReq('GET', '/api/model'), model);
    assert.equal(model.code, 200);
    const { project: shown } = JSON.parse(model.body);
    assert.equal(shown.name, p.cfg().name);
    assert.equal(shown.root, p.root);
    assert.equal(shown.mode, 'offline');
    assert.equal(shown.branch, 'main');
    // The port the page is served on, echoed from the handler's own context rather than guessed.
    assert.equal(shown.port, FAKE_PORT);
  }
});

// ---- row 3 -------------------------------------------------------------------------------------
test('killing a monitor and restarting it returns the same port', async () => {
  const p = project('steady');
  const first = startMonitor(p.root);
  const { port } = await first.said;
  await stopMonitor(first);

  const again = startMonitor(p.root);
  const back = await again.said;
  assert.ok(stillServing(again), 'the restarted monitor bound rather than pointing at the dead one');
  assert.equal(back.port, port);
  assert.equal(entryOf(p.id).port, port);
  await stopMonitor(again);
});

// ---- row 4 -------------------------------------------------------------------------------------
test('a project whose candidate is taken probes upward, and the registry records what it bound', async () => {
  const p = project('crowded');
  const candidate = candidatePort(p.id);

  // The obstacle is THIS FIXTURE'S OWN candidate, computed from its temp path — never a number
  // written into this file, which could be a port a real orchestra on this machine is serving.
  // If something else already holds it, the premise of the test holds anyway and the bind is
  // skipped.
  const obstacle = createServer();
  const held = await new Promise((resolve) => {
    obstacle.once('error', () => resolve(false));
    obstacle.listen(candidate, '127.0.0.1', () => resolve(true));
  });

  try {
    const m = startMonitor(p.root);
    const { port } = await m.said;
    assert.ok(stillServing(m), 'the monitor bound rather than pointing at an existing page');
    assert.notEqual(port, candidate);
    assert.ok(port > candidate, `expected a port above the candidate ${candidate}, got ${port}`);
    assert.equal(entryOf(p.id).port, port);
    await stopMonitor(m);
  } finally {
    if (held) await new Promise((resolve) => obstacle.close(resolve));
  }
});

// ---- row 5 -------------------------------------------------------------------------------------
test('an answer posted to the page lands in the inbox, and `orchestra inbox` prints it', async () => {
  const p = project('answers');
  const inbox = join(p.root, '.orchestra', 'inbox.jsonl');

  const res = fakeRes();
  await handlerFor(p)(fakeReq('POST', '/api/answer', {
    body: JSON.stringify({ task: null, pending: null, answer: 'ship at 0.75' }),
  }), res);
  assert.equal(res.code, 200);
  const said = JSON.parse(res.body);
  assert.equal(said.ok, true);
  // No tick is ever spawned: the only two outcomes are facts about a conductor that already exists.
  assert.equal(said.conductor, 'no-conductor');

  const lines = readFileSync(inbox, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const line = JSON.parse(lines[0]);
  assert.equal(line.answer, 'ship at 0.75');
  assert.equal(line.from, 'monitor');

  assert.match(p.run('inbox'), /ship at 0\.75/);
});

// ---- row 6 -------------------------------------------------------------------------------------
test('`orchestra instances` lists both projects, and says which is listening', async () => {
  const [a, b] = twoProjects();
  const ma = startMonitor(a.root);
  const sa = await ma.said;
  const mb = startMonitor(b.root);
  const sb = await mb.said;

  const out = execFileSync(process.execPath, [BIN, 'instances'],
    { cwd: a.root, encoding: 'utf8', env: { ...process.env, HOME: process.env.HOME } });

  for (const [p, s] of [[a, sa], [b, sb]]) {
    const row = out.split('\n').find((l) => l.includes(p.root));
    assert.ok(row, `no row for ${p.root} in:\n${out}`);
    assert.match(row, new RegExp(p.cfg().name));
    assert.match(row, new RegExp(`\\b${s.port}\\b`));
    assert.match(row, /offline/);
    assert.match(row, /\blistening\b/);
    // Neither project has run `orchestra ready` yet, so no conductor has ever beaten: both
    // columns are a dash, never a blank cell (spec §8.2, branch review item 3).
    assert.match(row, /—\s+—/);
  }

  // `conductorSession` and `beatAt` (spec §8.2): filled by `orchestra ready`, printed here as a
  // truncated session id and a relative beat age — the pair that turns "which page is which" into
  // "which conductor is which". Armed for `a` only, so `b`'s row still reads dash/dash.
  writeBeat(a.root, { session: 'abcdef12-conductor', pid: process.pid, now: Date.now() });
  a.run('ready');
  const out2 = execFileSync(process.execPath, [BIN, 'instances'],
    { cwd: a.root, encoding: 'utf8', env: { ...process.env, HOME: process.env.HOME } });
  const rowA = out2.split('\n').find((l) => l.includes(a.root));
  const rowB = out2.split('\n').find((l) => l.includes(b.root));
  assert.match(rowA, /\babcdef12\b/, `expected a's truncated session id in:\n${rowA}`);
  assert.match(rowA, /\b(just now|\d+m ago|\d+h ago)\b/, `expected a relative beat age in:\n${rowA}`);
  assert.match(rowB, /—\s+—/, `expected b's session and beat columns to stay dashes in:\n${rowB}`);

  await stopMonitor(ma);
  await stopMonitor(mb);
});

// ---- scope answer 9: one page per project --------------------------------------------------------
// Not one of the table's rows, but a requirement of the same phase, and the only path in
// `orchestra monitor` that decides NOT to bind. Two pages for one project are not wrong, they are
// confusing, and the second makes the recorded port flap between two numbers.
test('a second `orchestra monitor` in the same project points at the first page instead of binding', async () => {
  const p = project('single');
  const first = startMonitor(p.root);
  const { port } = await first.said;

  const second = spawnSync(process.execPath, [BIN, 'monitor', '--no-open'],
    { cwd: p.root, encoding: 'utf8', env: { ...process.env, HOME: process.env.HOME } });
  assert.equal(second.status, 0);
  assert.match(second.stdout, new RegExp(`already open at http://127\\.0\\.0\\.1:${port}\\b`));
  assert.match(second.stdout, /one page per project/);
  // It changed nothing: the recorded port is still the one the live page bound, and the first child
  // is still the one serving it.
  assert.equal(entryOf(p.id).port, port);
  assert.ok(stillServing(first));

  // And the argument check runs BEFORE that refusal, or `orchestra monitor --prot` in a project
  // whose page is already up would print "already open", exit 0, and never mention the argument it
  // did not understand.
  const typo = spawnSync(process.execPath, [BIN, 'monitor', '--prot'],
    { cwd: p.root, encoding: 'utf8', env: { ...process.env, HOME: process.env.HOME } });
  assert.equal(typo.status, 1);
  assert.equal(typo.stdout, '');
  assert.match(typo.stderr, /unknown argument --prot/);

  await stopMonitor(first);
});

// ---- an argument that does not exist ---------------------------------------------------------
test('`orchestra monitor --port 5000` is refused, because the port has one source of truth', () => {
  const p = project('flagless');
  const r = spawnSync(process.execPath, [BIN, 'monitor', '--port', '5000'],
    { cwd: p.root, encoding: 'utf8', env: { ...process.env, HOME: process.env.HOME } });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /unknown argument --port/);
  assert.match(r.stderr, /monitor\.port in \.orchestra\/config\.json/);
});

// ---- row 8 -------------------------------------------------------------------------------------
// Row 7 — a pinned port held by another live instance makes `doctor` exit 1 — is Task 1's, and is
// asserted in test/monitor-port.test.mjs and test/cli.test.mjs.
test('`orchestra monitor` is silent and exits 0 with no config; `orchestra instances` answers anyway', () => {
  const r = makeRepo({ name: 'unconfigured' });
  repos.push(r);
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  const env = { ...process.env, HOME: process.env.HOME };

  const off = spawnSync(process.execPath, [BIN, 'monitor'], { cwd: r.root, encoding: 'utf8', env });
  assert.equal(off.status, 0);
  assert.equal(off.stdout, '');
  assert.equal(off.stderr, '');

  const machine = spawnSync(process.execPath, [BIN, 'instances'], { cwd: r.root, encoding: 'utf8', env });
  assert.equal(machine.status, 0);
  assert.match(machine.stdout, /\S/);
});
