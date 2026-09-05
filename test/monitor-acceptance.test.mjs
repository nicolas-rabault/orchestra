// The machine-wide monitor's acceptance (docs/specs/2026-09-04-machine-wide-monitor-design.md):
// "one page serves every project on this machine; killing it and restarting it returns to the same
// port; an answer posted for one project reaches that project alone."
//
// SPLIT DELIBERATELY IN TWO, and this is why. What is SERVED is asserted IN-PROCESS, by calling
// `createHandler(ctx)` with a fake request and a fake response — the shape the source project's own
// suite used, deterministic and fast, with no socket between the assertion and the code. What needs
// A REAL LISTENER — binding, the machine registry's recorded port, the same port across a restart,
// the refuse-and-point — is asserted OUT-OF-PROCESS, with `orchestra monitor --no-open` children.
//
// The seam is not timidity about sockets. It is that an HTTP client against localhost is not
// trustworthy as a PROBE here: measured 2026-08-12 in planetCraft, `curl` could not reach a
// localhost server `lsof` proved was listening and a browser was using, and the hang cost a
// conductor. So nothing below asks a child's own port a question; the children are asked only to
// bind, to print, and to be recorded, and everything about content is asked of the handler directly.
//
// Every test runs under a TEMPORARY HOME (spec §14), so `~/.orchestra/instances.json` and
// `~/.orchestra/monitor.json` under test are never the developer's own — except the bound PORT
// itself, which is a real machine-wide TCP resource no HOME can namespace: a monitor started here
// binds the same 4380 a real orchestra page on this developer's machine would, and steps upward
// exactly as that page would if something already held it. Nothing below asserts the literal
// number for that reason — only that a restart returns to the SAME one, and that an obstacle on it
// is stepped over.
//
// WHAT THIS SUITE DOES NOT PROVE, said here rather than discovered later: it proves the page
// composes, discovers its projects, allocates and round-trips an answer. It proves nothing about
// what the page LOOKS like, and nothing about the browser half beyond the bytes being served — no
// test here loads `app.js`. That is the same limit the source's suite had.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigOrThrow } from '../lib/config.mjs';
import { writeBeat } from '../lib/register/beat.mjs';
import { machineMonitorPort, readMonitor } from '../lib/machine.mjs';
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

// Two projects. There is no per-project port any more to keep distinct, so nothing here needs the
// retry loop the candidate-port era required — two temp directories are already two projects.
function twoProjects() {
  return [project('alpha'), project('beta')];
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
// a URL on the refuse-and-point path too (one page per machine) and then exits, so without this
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
// relative request URL against. Deliberately outside the 4380-4479 band all the same, so nothing in
// this file can be read as claiming a port a real orchestra on this machine might be serving.
const FAKE_PORT = 59999;
const ctx = (p) => ({ id: p.cfg().id, name: p.cfg().name, root: p.root, mode: p.cfg().mode, cfg: p.cfg() });
const handlerFor = (...ps) => createHandler({ projects: () => ps.map(ctx), port: FAKE_PORT, publicDir: PUBLIC_DIR });

// ---- row 1 -------------------------------------------------------------------------------------
test('two projects reach one page: one `orchestra monitor` child, and `/api/model` names both, each with its own root, mode and branch', async () => {
  const [a, b] = twoProjects();
  // `b` reaches the live set the way a project ordinarily does — by running something that records
  // it — never by starting a second page, which would only point at the first (row 7).
  b.run('ready');

  const m = startMonitor(a.root);
  const said = await m.said;
  assert.ok(stillServing(m), 'the one child is serving');
  assert.match(m.text(), /http:\/\/127\.0\.0\.1:\d+/);

  // The registry side: both projects are recorded, `a` by the monitor's own self-discovery, `b` by
  // its `ready`.
  assert.equal(entryOf(a.id).root, a.root);
  assert.equal(entryOf(a.id).name, 'alpha');
  assert.equal(entryOf(b.id).root, b.root);
  assert.equal(entryOf(b.id).name, 'beta');

  // The content side: asserted in-process (see header), against a handler built over the same two
  // projects — `/api/model` names both, each with its own root, mode and branch.
  const res = fakeRes();
  await handlerFor(a, b)(fakeReq('GET', '/api/model'), res);
  assert.equal(res.code, 200);
  const { machine, projects } = JSON.parse(res.body);
  assert.equal(machine.port, FAKE_PORT);
  assert.equal(projects.length, 2);
  const byId = Object.fromEntries(projects.map((p) => [p.project.id, p.project]));
  assert.equal(byId[a.id].root, a.root);
  assert.equal(byId[a.id].mode, 'offline');
  assert.equal(byId[a.id].branch, 'main');
  assert.equal(byId[b.id].root, b.root);
  assert.equal(byId[b.id].mode, 'offline');
  assert.equal(byId[b.id].branch, 'main');
  assert.notEqual(said.port, undefined);

  await stopMonitor(m);
});

// ---- row 2 -------------------------------------------------------------------------------------
test('each project names itself in the model; the served <title> is `orchestra` and carries no project name', async () => {
  const [a, b] = twoProjects();
  const handler = handlerFor(a, b);

  const page = fakeRes();
  await handler(fakeReq('GET', '/'), page);
  assert.equal(page.code, 200);
  const html = String(page.body);
  assert.match(html, /<title>orchestra<\/title>/);
  for (const p of [a, b]) assert.doesNotMatch(html, new RegExp(p.cfg().name));

  const model = fakeRes();
  await handler(fakeReq('GET', '/api/model'), model);
  assert.equal(model.code, 200);
  const { projects } = JSON.parse(model.body);
  for (const p of [a, b]) {
    const shown = projects.find((x) => x.project.id === p.id).project;
    assert.equal(shown.name, p.cfg().name);
    assert.equal(shown.root, p.root);
    assert.equal(shown.mode, 'offline');
    assert.equal(shown.branch, 'main');
    // There is one page now, named once by `machine.port` — repeating it per project is gone.
    assert.equal(shown.port, undefined);
  }
});

// ---- row 3 -------------------------------------------------------------------------------------
test('killing a monitor and restarting it returns the same port', async () => {
  const p = project('steady');
  const first = startMonitor(p.root);
  const { port } = await first.said;
  assert.equal(readMonitor().port, port);
  await stopMonitor(first);

  const again = startMonitor(p.root);
  const back = await again.said;
  assert.ok(stillServing(again), 'the restarted monitor bound rather than pointing at the dead one');
  assert.equal(back.port, port);
  assert.equal(readMonitor().port, port);
  await stopMonitor(again);
});

// ---- row 4 -------------------------------------------------------------------------------------
test('the machine port held by an obstacle makes the monitor probe upward, and `monitor.json` records what it bound', async () => {
  const p = project('crowded');
  const candidate = machineMonitorPort();

  // The obstacle is bound on THE MACHINE PORT ITSELF, computed the same way the monitor computes
  // it — never a number written into this file, which could be a port a real orchestra on this
  // machine is serving right now. If something else already holds it (a real page, another test),
  // the premise of the test holds anyway and our own bind is skipped.
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
    // `monitor.json` records what it BOUND, never the candidate it started from.
    assert.equal(readMonitor().port, port);
    await stopMonitor(m);
  } finally {
    if (held) await new Promise((resolve) => obstacle.close(resolve));
  }
});

// ---- row 5 -------------------------------------------------------------------------------------
// The invariant this change introduces: an answer names a project, and reaches that project alone.
test('an answer posted for one project lands in that project alone', async () => {
  const [a, b] = twoProjects();
  const inboxA = join(a.root, '.orchestra', 'inbox.jsonl');
  const inboxB = join(b.root, '.orchestra', 'inbox.jsonl');

  const res = fakeRes();
  await handlerFor(a, b)(fakeReq('POST', '/api/answer', {
    body: JSON.stringify({ project: a.id, task: null, pending: null, answer: 'ship at 0.75' }),
  }), res);
  assert.equal(res.code, 200);
  assert.equal(JSON.parse(res.body).conductor, 'no-conductor');

  const lines = readFileSync(inboxA, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).answer, 'ship at 0.75');
  assert.equal(JSON.parse(lines[0]).from, 'monitor');
  assert.equal(existsSync(inboxB), false);

  assert.match(a.run('inbox'), /ship at 0\.75/);
  assert.equal(b.run('inbox'), '');
});

// ---- row 6 -------------------------------------------------------------------------------------
test('`orchestra instances` prints the one machine URL and lists both projects', async () => {
  const [a, b] = twoProjects();
  b.run('ready');

  const m = startMonitor(a.root);
  const { port } = await m.said;

  const out = execFileSync(process.execPath, [BIN, 'instances'],
    { cwd: a.root, encoding: 'utf8', env: { ...process.env, HOME: process.env.HOME } });

  assert.match(out, new RegExp(`page: http://127\\.0\\.0\\.1:${port}\\b`));

  for (const p of [a, b]) {
    const row = out.split('\n').find((l) => l.includes(p.root));
    assert.ok(row, `no row for ${p.root} in:\n${out}`);
    assert.match(row, new RegExp(p.cfg().name));
    assert.match(row, /offline/);
    // Neither project has run `orchestra ready` with a beating conductor yet, so both columns are
    // a dash, never a blank cell (spec §8.2, branch review item 3).
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

  await stopMonitor(m);
});

// ---- row 7 -------------------------------------------------------------------------------------
// One page per MACHINE now, not one per project: a second `orchestra monitor`, started in a
// DIFFERENT project, points at the first page instead of binding a second one.
test('a second `orchestra monitor` started in a different project points at the one page', async () => {
  const [a, b] = twoProjects();
  const first = startMonitor(a.root);
  const { port } = await first.said;

  const second = spawnSync(process.execPath, [BIN, 'monitor', '--no-open'],
    { cwd: b.root, encoding: 'utf8', env: { ...process.env, HOME: process.env.HOME } });
  assert.equal(second.status, 0);
  assert.match(second.stdout, new RegExp(`already open at http://127\\.0\\.0\\.1:${port}\\b`));
  assert.match(second.stdout, /one page for this machine/);
  // It changed nothing: the recorded port is still the one the live page bound, and the first
  // child is still the one serving it.
  assert.equal(readMonitor().port, port);
  assert.ok(stillServing(first));

  // And the argument check runs BEFORE that refusal, or `orchestra monitor --prot` in a project
  // while the page is already up would print "already open", exit 0, and never mention the
  // argument it did not understand.
  const typo = spawnSync(process.execPath, [BIN, 'monitor', '--prot'],
    { cwd: b.root, encoding: 'utf8', env: { ...process.env, HOME: process.env.HOME } });
  assert.equal(typo.status, 1);
  assert.equal(typo.stdout, '');
  assert.match(typo.stderr, /unknown argument --prot/);

  await stopMonitor(first);
});

// ---- row 8 -------------------------------------------------------------------------------------
test('`orchestra monitor --port 5000` is refused, because the port has one source of truth', () => {
  const p = project('flagless');
  const r = spawnSync(process.execPath, [BIN, 'monitor', '--port', '5000'],
    { cwd: p.root, encoding: 'utf8', env: { ...process.env, HOME: process.env.HOME } });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /unknown argument --port/);
  assert.match(r.stderr, /monitorPort in ~\/\.orchestra\/machine\.json/);
});

// ---- row 9 -------------------------------------------------------------------------------------
// The machine exception, inverted: P4's `orchestra monitor` was silent with no config (an
// off-switch respecter). The machine command answers from anywhere, config or none.
test('`orchestra monitor` serves even with no config — the machine exception, inverted; `orchestra instances` answers there too', async () => {
  const r = makeRepo({ name: 'unconfigured' });
  repos.push(r);
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });

  const on = startMonitor(r.root);
  await on.said;
  assert.ok(stillServing(on), 'the monitor served despite no config in this directory');
  assert.match(on.text(), /http:\/\/127\.0\.0\.1:\d+/);

  const machine = spawnSync(process.execPath, [BIN, 'instances'],
    { cwd: r.root, encoding: 'utf8', env: { ...process.env, HOME: process.env.HOME } });
  assert.equal(machine.status, 0);
  assert.match(machine.stdout, /\S/);

  await stopMonitor(on);
});
