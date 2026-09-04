// lib/monitor/server.mjs: the request handler, asserted the way the source project's own suite
// asserted it — in-process, with a fake request and a fake response. There is no socket here on
// purpose: `serve`'s binding half is `lib/monitor/port.mjs`'s subject (test/monitor-port.test.mjs)
// and the two real listeners are the acceptance's (test/p4-acceptance.test.mjs).
//
// The source's "reads the board once for two model requests" test is NOT repeated here: that cache
// moved into `readBoard` itself and is proven in test/monitor-sources.test.mjs. The cache this
// handler still owns — the dev-server list — is proven below, against a fake `lsof` on PATH.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfigOrThrow } from '../lib/config.mjs';
import { writeBeat } from '../lib/register/beat.mjs';
import { createHandler, serve, PUBLIC_DIR, SHARED_MODULES } from '../lib/monitor/server.mjs';
import { makeRepo } from './helpers/fixture.mjs';
import { fakeReq, fakeRes } from './helpers/fakeHttp.mjs';

const repos = [];
const dirs = [];
after(() => {
  repos.forEach((r) => r.cleanup());
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

// Nothing here binds anything, so this number is only the base a relative request URL is parsed
// against and the port the model echoes back. Outside the 4380-4479 band all the same.
const FAKE_PORT = 59998;

function fixture(name = 'served') {
  const r = makeRepo({ name });
  repos.push(r);
  const cfg = loadConfigOrThrow(r.root);
  const project = { id: cfg.id, name: cfg.name, root: r.root, mode: cfg.mode, cfg };
  return { ...r, cfg, handler: createHandler({ projects: () => [project], port: FAKE_PORT, publicDir: PUBLIC_DIR }) };
}

const ask = async (f, method, url, opts) => {
  const res = fakeRes();
  await f.handler(fakeReq(method, url, opts), res);
  return res;
};

// The plural shape `createHandler` now takes, and a handler over any number of `fixture()`s —
// beside `fixture`/`ask` because every test below that needs more than one project uses these two
// rather than repeating the projection inline.
const ctx = (p) => ({ id: p.cfg.id, name: p.cfg.name, root: p.root, mode: p.cfg.mode, cfg: p.cfg });
const handlerFor = (...ps) => createHandler({ projects: () => ps.map(ctx), port: FAKE_PORT, publicDir: PUBLIC_DIR });

// ---- ported from the source project's own handler suite -----------------------------------------

test('answers 500 in plain English instead of killing the process, and records the stack', async () => {
  // An unhandled rejection in an async request handler TERMINATES the node process, so a throw the
  // readers do not catch would take the tool down entirely, answer channel included.
  //
  // stderr is captured rather than left to print: the sentence in the page is for the person
  // looking at it and the STACK is for whoever has to find the cause, so both are asserted — and
  // this suite's own output stays clean.
  const write = process.stderr.write.bind(process.stderr);
  let logged = '';
  process.stderr.write = (chunk) => { logged += chunk; return true; };
  let res;
  try { res = await ask(fixture(), 'GET', 'http://['); } finally { process.stderr.write = write; }
  assert.equal(res.code, 500);
  assert.match(String(res.body), /^the monitor failed to answer this request: /);
  assert.match(logged, /Invalid URL/);
  assert.match(logged, /server\.mjs/);
});

test('still serves the model of a repository with nothing in it', async () => {
  const res = await ask(fixture(), 'GET', '/api/model');
  assert.equal(res.code, 200);
  const model = JSON.parse(res.body);
  assert.deepEqual(model.projects[0].nodes, []);
  assert.deepEqual(model.projects[0].rail, []);
});

// A screenshot is hundreds of kilobytes and the page polls every two seconds: the etag is the
// difference between a thumbnail strip and a stall.
test('serves a picture from inside the checkout, and answers 304 on its own etag', async () => {
  const f = fixture();
  writeFileSync(join(f.root, 'top.png'), 'not really a png, but a file');
  const first = await ask(f, 'GET', '/api/image?p=top.png');
  assert.equal(first.code, 200);
  assert.equal(first.headers['content-type'], 'image/png');
  const again = await ask(f, 'GET', '/api/image?p=top.png', { headers: { 'if-none-match': first.headers.etag } });
  assert.equal(again.code, 304);
});

test('serves no file the query string asks for outside the checkout', async () => {
  const res = await ask(fixture(), 'GET', '/api/image?p=../../etc/passwd.png');
  assert.equal(res.code, 400);
});

test('refuses a malformed answer with a 400 rather than a crash, and writes nothing', async () => {
  const f = fixture();
  for (const body of [null, '42', '"x"', 'null', '{}', '{"answer":"   "}', '{"answer":"ok","task":7}']) {
    const res = await ask(f, 'POST', '/api/answer', { body });
    assert.equal(res.code, 400, `body ${body} should be refused`);
    assert.equal(JSON.parse(res.body).ok, false);
  }
  assert.throws(() => readFileSync(join(f.root, '.orchestra', 'inbox.jsonl'), 'utf8'), /ENOENT/);
});

// ---- new here ------------------------------------------------------------------------------------

test('an answer larger than the 1 MB cap is refused as too large, not as "not JSON" — and the socket is destroyed', async () => {
  const f = fixture();
  const huge = JSON.stringify({ task: null, pending: null, answer: 'x'.repeat(1_100_000) });
  const req = fakeReq('POST', '/api/answer', { body: huge });
  const res = fakeRes();
  await f.handler(req, res);
  assert.equal(res.code, 413);
  assert.match(JSON.parse(res.body).error, /larger than 1 MB/);
  // The refusal alone stops nothing: the socket keeps delivering chunks to the same listener until
  // something calls destroy(), which is what actually bounds memory. A test that checked only the
  // status code would stay green even if `req.destroy()` were deleted from `readBody`.
  assert.equal(req.destroyed, true);
});

test('the page and its two assets are served from publicDir', async () => {
  const f = fixture();
  const page = await ask(f, 'GET', '/');
  assert.equal(page.code, 200);
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(String(page.body), /<script type="module" src="\/app\.js">/);

  const script = await ask(f, 'GET', '/app.js');
  assert.equal(script.code, 200);
  assert.equal(script.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.match(String(script.body), /^\/\/ The page\./);

  const css = await ask(f, 'GET', '/style.css');
  assert.equal(css.code, 200);
  assert.equal(css.headers['content-type'], 'text/css; charset=utf-8');
});

test('the five shared modules are served from a closed list, and nothing else under it is reachable', async () => {
  const f = fixture();
  for (const name of ['/layout.mjs', '/answers.mjs', '/clock.mjs', '/progress.mjs', '/tabs.mjs']) {
    const res = await ask(f, 'GET', name);
    assert.equal(res.code, 200, `${name} should be served`);
    assert.equal(res.headers['content-type'], 'text/javascript; charset=utf-8');
  }
  // Real modules in the same directory, and a climb out of it: the path is never used to reach a
  // file, only to look one up in the list.
  for (const name of ['/server.mjs', '/model.mjs', '/sources.mjs', '/keys.mjs', '/../config.mjs']) {
    assert.equal((await ask(f, 'GET', name)).code, 404, `${name} must not be served`);
  }
});

test('/api/model answers 304 on its own etag, and 200 once the register moves', async () => {
  const f = fixture();

  // Warm-up, thrown away, and LOAD-BEARING. `sourceStamp` carries a coarse bucket of the clock
  // (`servers:${Math.floor(now / SERVERS_TTL_MS)}`), and the etag is computed BEFORE `model()`
  // runs. The FIRST build is the expensive one: `readBoard` shells out to a child process before
  // its own per-root cache goes hot. So without this line, several hundred milliseconds of that
  // first build sit between the two etag computations below, and the bucket rolls inside that gap
  // often enough to turn the expected 304 into a 200. Measured 2026-09-05: green 5/5 run alone,
  // red 2/2 under the full parallel suite, which is exactly where it matters — the merge gate.
  await ask(f, 'GET', '/api/model');

  const first = await ask(f, 'GET', '/api/model');
  const etag = first.headers.etag;
  assert.ok(etag, 'the model carries an etag');
  assert.equal((await ask(f, 'GET', '/api/model', { headers: { 'if-none-match': etag } })).code, 304);

  writeFileSync(join(f.root, '.orchestra', 'state.json'), `${JSON.stringify({ version: 1, tasks: [] })}\n`);
  assert.equal((await ask(f, 'GET', '/api/model', { headers: { 'if-none-match': etag } })).code, 200);
});

test('an unknown path is a 404, not a 500', async () => {
  assert.equal((await ask(fixture(), 'GET', '/nope')).code, 404);
});

// The whole of what the answer route may say about a conductor: it REACHES one, it never creates
// one. No tick is spawned in either branch.
test('an answer reports a beating conductor as awake, and says so honestly when there is none', async () => {
  const f = fixture();
  const quiet = await ask(f, 'POST', '/api/answer', { body: JSON.stringify({ task: null, pending: null, answer: 'first' }) });
  assert.deepEqual(JSON.parse(quiet.body), { ok: true, conductor: 'no-conductor' });

  writeBeat(f.root, { session: 'abcdef12-0000', pid: process.pid });
  const awake = await ask(f, 'POST', '/api/answer', { body: JSON.stringify({ task: 'demo/D1', pending: 'q1', answer: 'second' }) });
  assert.deepEqual(JSON.parse(awake.body), { ok: true, conductor: 'awake' });

  // Both answers are in the file, in order, stamped by `appendAnswer` and not by the route.
  const lines = readFileSync(join(f.root, '.orchestra', 'inbox.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.answer), ['first', 'second']);
  assert.deepEqual(lines.map((l) => l.from), ['monitor', 'monitor']);
  assert.deepEqual(lines.map((l) => l.pending), [null, 'q1']);
  assert.ok(lines.every((l) => typeof l.ts === 'string' && l.ts !== ''));
});

// The one cache this handler still owns. `listServers` costs a child process, and the page polls
// every two seconds — but the answer is about SPECIFIC port numbers, so the cache is keyed on the
// port set as well as the clock: a register row that gains a port between two polls must not be
// answered from a list probed before that port existed.
test('the dev-server list is probed once for two model builds, and again when the register names a new port', async () => {
  const bin = mkdtempSync(join(tmpdir(), 'orchestra-fakebin-'));
  dirs.push(bin);
  const calls = join(bin, 'calls.log');
  // Exit 1 with nothing found — what a real lsof does when no port on its list is listening.
  writeFileSync(join(bin, 'lsof'), `#!/bin/sh\nprintf x >> ${JSON.stringify(calls)}\nexit 1\n`);
  chmodSync(join(bin, 'lsof'), 0o755);
  const PATH = process.env.PATH;
  process.env.PATH = `${bin}:${PATH}`;
  try {
    const f = fixture();
    const state = (port) => `${JSON.stringify({ version: 1, tasks: [{ id: 'D1', status: 'claimed', port }] })}\n`;
    mkdirSync(join(f.root, '.orchestra'), { recursive: true });
    writeFileSync(join(f.root, '.orchestra', 'state.json'), state(5173));

    await ask(f, 'GET', '/api/model');
    await ask(f, 'GET', '/api/model');
    assert.equal(readFileSync(calls, 'utf8'), 'x', 'the same port set is probed once');

    writeFileSync(join(f.root, '.orchestra', 'state.json'), state(5174));
    await ask(f, 'GET', '/api/model');
    assert.equal(readFileSync(calls, 'utf8'), 'xx', 'a new port is a new question');
  } finally {
    process.env.PATH = PATH;
  }
});

// `serve` binds and nothing else: no browser, no registry write, no process of any kind. Those are
// `lib/cli/monitor.mjs`'s, and the acceptance drives them through `orchestra monitor`.
test('serve binds, and the bound server carries an error listener of its own', async () => {
  const { server, port, url } = await serve();
  try {
    assert.ok(server.listening);
    assert.equal(url, `http://127.0.0.1:${port}`);
    // `listenOnFreePort` removes both of ITS listeners the instant the bind succeeds, and nothing in
    // this plugin installs `process.on('uncaughtException')` — so without one here an 'error' event
    // on the listening socket (EMFILE at accept time, above all) would terminate node outright, with
    // no diagnostic. `emit` returning true is node's own answer to "did anything handle this".
    const write = process.stderr.write.bind(process.stderr);
    let logged = '';
    process.stderr.write = (chunk) => { logged += chunk; return true; };
    let handled;
    try { handled = server.emit('error', new Error('EMFILE, too many open files')); }
    finally { process.stderr.write = write; }
    assert.equal(handled, true, 'an error event on the bound server is handled');
    assert.match(logged, /the monitor's socket reported an error: EMFILE/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---- the handler goes plural ----------------------------------------------------------------------

test('the model carries the machine port and one entry per project, in name order', async () => {
  const a = fixture('alpha');
  const b = fixture('beta');
  const res = fakeRes();
  await handlerFor(b, a)(fakeReq('GET', '/api/model'), res);
  assert.equal(res.code, 200);
  const m = JSON.parse(res.body);
  assert.equal(m.machine.port, FAKE_PORT);
  assert.deepEqual(m.projects.map((p) => p.project.name), ['alpha', 'beta']);
  // Each entry is exactly today's model, unchanged.
  assert.equal(m.projects[0].project.root, a.root);
  assert.equal(m.projects[0].project.mode, 'offline');
  assert.equal(m.projects[0].project.branch, 'main');
  assert.ok(Array.isArray(m.projects[0].nodes));
  assert.ok(Array.isArray(m.projects[0].rail));
  // The per-project `port` field is gone: there is one page and it is named once, above.
  assert.equal(m.projects[0].project.port, undefined);
});

test('the etag covers every project, so one project changing busts it', async () => {
  const a = fixture('alpha');
  const b = fixture('beta');
  const handler = handlerFor(a, b);

  const first = fakeRes();
  await handler(fakeReq('GET', '/api/model'), first);
  const etag = first.headers.etag;

  const again = fakeRes();
  await handler(fakeReq('GET', '/api/model', { headers: { 'if-none-match': etag } }), again);
  assert.equal(again.code, 304);

  writeFileSync(join(b.root, '.orchestra', 'journal.jsonl'),
    `${JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', kind: 'note', task: null, text: 'moved' })}\n`);
  const third = fakeRes();
  await handler(fakeReq('GET', '/api/model', { headers: { 'if-none-match': etag } }), third);
  assert.equal(third.code, 200);
});

test('a project that leaves between two requests drops out without a 500', async () => {
  const a = fixture('alpha');
  const b = fixture('beta');
  let set = [a, b];
  const handler = createHandler({ projects: () => set.map(ctx), port: FAKE_PORT, publicDir: PUBLIC_DIR });

  const before = fakeRes();
  await handler(fakeReq('GET', '/api/model'), before);
  assert.equal(JSON.parse(before.body).projects.length, 2);

  set = [a];
  const after = fakeRes();
  await handler(fakeReq('GET', '/api/model'), after);
  assert.equal(after.code, 200);
  assert.deepEqual(JSON.parse(after.body).projects.map((p) => p.project.name), ['alpha']);
});

test('no projects at all is an empty array and a 200, not an error', async () => {
  const res = fakeRes();
  await createHandler({ projects: () => [], port: FAKE_PORT, publicDir: PUBLIC_DIR })(fakeReq('GET', '/api/model'), res);
  assert.equal(res.code, 200);
  assert.deepEqual(JSON.parse(res.body), { machine: { port: FAKE_PORT }, projects: [] });
});

test('the served page no longer substitutes a project name, and names the tool alone', async () => {
  const res = fakeRes();
  await handlerFor(fixture('alpha'))(fakeReq('GET', '/'), res);
  assert.equal(res.code, 200);
  assert.match(String(res.body), /<title>orchestra<\/title>/);
  assert.doesNotMatch(String(res.body), /\{\{project\}\}/);
});

test('/projects.mjs is served, and a module that is not on the list is not', async () => {
  const handler = handlerFor(fixture('alpha'));
  for (const path of SHARED_MODULES) {
    const res = fakeRes();
    await handler(fakeReq('GET', path), res);
    assert.equal(res.code, 200, `${path} should be served`);
  }
  assert.ok(SHARED_MODULES.includes('/projects.mjs'));
  const nope = fakeRes();
  await handler(fakeReq('GET', '/discover.mjs'), nope);
  assert.equal(nope.code, 404);
});
