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
import { createHandler, serve, PUBLIC_DIR } from '../lib/monitor/server.mjs';
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
  return { ...r, cfg, handler: createHandler({ cfg, port: FAKE_PORT, publicDir: PUBLIC_DIR }) };
}

const ask = async (f, method, url, opts) => {
  const res = fakeRes();
  await f.handler(fakeReq(method, url, opts), res);
  return res;
};

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
  assert.deepEqual(model.nodes, []);
  assert.deepEqual(model.rail, []);
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

// `replaceAll`'s replacement STRING expands `$&`, `$'` and friends. Passing the escaped name as a
// string would splice the remainder of the file in after the title — `<script src="/app.js">` tag
// included — straight past the escaping. A replacer function's return value is inserted verbatim.
test('a project whose name contains $ patterns does not splice the file into its own title', async () => {
  const f = fixture("x$'y$&z");
  const html = String((await ask(f, 'GET', '/')).body);
  // `&` is an entity by the time it reaches the title; the `$` sequences are not, and must survive
  // verbatim rather than expanding into the file around them.
  assert.match(html, /<title>x\$'y\$&amp;z — orchestra<\/title>/);
  // The tell of the bug: `$'` inserts everything AFTER the match, so the rest of the page would
  // appear a second time and the file would carry two <main> elements.
  assert.equal(html.split('<main>').length - 1, 1);
});

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

test('the page carries the project name, as TEXT: a project called <script> names a tab, it does not run', async () => {
  const f = fixture('<script>alert(1)</script>');
  const res = await ask(f, 'GET', '/');
  assert.equal(res.code, 200);
  const html = String(res.body);
  assert.match(html, /<title>&lt;script&gt;alert\(1\)&lt;\/script&gt; — orchestra<\/title>/);
  assert.equal(html.includes('{{project}}'), false);
  assert.equal(html.includes('<script>alert(1)'), false);
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
  const f = fixture();
  const { server, port, url } = await serve(f.cfg);
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
