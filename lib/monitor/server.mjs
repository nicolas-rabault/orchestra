// The monitoring page's server. It reads files, serves a model, and appends one line to one file —
// the inbox. It never writes the register, never writes into a worktree, never writes a roadmap,
// AND IT SPAWNS NO TICK. The page this was ported from spawned one; see `POST /api/answer` below
// for why this one starts nothing.
//
// 127.0.0.1 only, no authentication: this is one developer looking at one machine.
//
// NO `#!` LINE, deliberately. A `#!` is legal only at byte 0, so any transform that wraps the
// module moves it and V8 answers `SyntaxError: Invalid or unexpected token` at whatever line
// imported it. Measured 2026-08-12 in planetCraft: the test file that imported this module
// collected 0 tests and blamed the wrong line, while every module beside it imported cleanly under
// plain node on that same machine. Nothing here is run as a program — `bin/orchestra` is this
// plugin's one entry point, and `lib/cli/monitor.mjs` is what calls `serve`.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendAnswer, inboxPath } from '../register/inbox.mjs';
import { liveConductor } from '../register/beat.mjs';
import { machineMonitorPort } from '../machine.mjs';
import {
  SERVERS_TTL_MS, currentBranch, imageFinder, listServers, readBoard, readInbox, readJournal,
  readState, resolveImageRequest, sourceStamp, worktreePaths,
} from './sources.mjs';
import { buildModel } from './model.mjs';
import { listenOnFreePort } from './port.mjs';
import { discoverProjects } from './discover.mjs';

// Resolved from THIS module, never from `cwd` or `process.argv[1]`: the plugin is installed
// somewhere other than the project it serves — a global install, a symlinked dev checkout — and a
// path built from the caller's own invocation would be wrong in every real install while looking
// right in a fixture that happens to run from the plugin's own tree.
const HERE = dirname(fileURLToPath(import.meta.url));

// Where the page's own three files live. A parameter of `createHandler` rather than a constant it
// reads, so what a handler serves is visible at its call site — and exported because `serve` and
// the acceptance are both callers and must not be able to disagree about it.
export const PUBLIC_DIR = join(HERE, 'public');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

// The six modules the page imports that are NOT page assets: they are this plugin's own pure
// modules, unit-tested in node and served verbatim to the browser so the page and the tests share
// one copy of the geometry, the progress bands, the tabs, the clock, the project strip and the rule
// for what an answer still refers to. A CLOSED LIST, so the path is never used to reach a file that
// is not on it, and resolved beside THIS module because that is where those six files are —
// `publicDir` names the page's assets and has nothing to say about them. Exported so a test can
// hold the page's own imports against it: nothing loads `app.js`, so a `/`-rooted import that is
// not on this list would be a silent 404 that breaks the page with every suite still green.
export const SHARED_MODULES = ['/layout.mjs', '/answers.mjs', '/clock.mjs', '/progress.mjs', '/tabs.mjs', '/projects.mjs'];

const send = (res, code, body, headers = {}) => { res.writeHead(code, headers); res.end(body); };
const json = (res, code, obj, headers = {}) => send(res, code, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8', ...headers });

// Thrown by `readBody` alone, and caught by name at the answer route: an oversize body is a
// different refusal from an unparseable one, and telling a client its 2 MB of valid JSON "is not
// JSON" is telling it something untrue about its own request.
const TOO_LARGE = 'body too large';

const readBody = (req) => new Promise((resolve, reject) => {
  // Without this, `data += c` decodes each chunk independently — a multi-byte UTF-8 character
  // split across a chunk boundary corrupts — and `data.length` would count UTF-16 code units
  // rather than the bytes the 1e6 cap names. `setEncoding` makes node reassemble multi-byte
  // sequences across chunks before this listener ever sees them. No test here can see the bug this
  // fixes: `test/helpers/fakeHttp.mjs`'s fake request delivers its whole body as one chunk.
  req.setEncoding('utf8');
  let data = '';
  req.on('data', (c) => {
    data += c;
    // Rejecting alone stops nothing: the socket keeps delivering chunks to this same listener and
    // `data` keeps growing until the OS closes the connection. destroy() is what actually stops the
    // stream, so the 1e6 cap bounds memory rather than merely naming a limit.
    if (data.length > 1e6) { req.destroy(); reject(new Error(TOO_LARGE)); }
  });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

// The whole handler body sits inside one try. It is an async arrow: an unhandled rejection here
// TERMINATES the node process, so any throw the readers do not catch — one half-written register
// row was enough, in planetCraft — would take the tool down entirely, answer channel included. A
// 500 with a sentence keeps the server up and says what happened.
//
// `projects` is resolved PER REQUEST, never once at startup: a project that opts in, opts out or is
// deleted while the page is open must follow within one poll (`lib/monitor/discover.mjs`'s own
// header carries the same rule for `discoverProjects`, this handler's one real caller).
export function createHandler({ projects, port, publicDir }) {
  // The dev-server cache, now ONE probe for the whole machine rather than one per project. This is
  // the single place where going plural makes the page cheaper than N copies of it were: an `lsof`
  // costs a child process, and `listServers` already takes a list of ports, so N projects ask it
  // exactly one question instead of N.
  let cached = { at: 0, key: null, value: { ok: true, list: [] } };
  const devServers = (ports) => {
    const key = [...new Set(ports)].sort((a, b) => a - b).join(',');
    if (key !== cached.key || Date.now() - cached.at > SERVERS_TTL_MS)
      cached = { at: Date.now(), key, value: listServers(ports) };
    return cached.value;
  };

  // The ports one register names — its rows' own and any a pending item points at. Hoisted out of
  // the model builder because the machine-wide probe needs the union of them before any project's
  // model is built, and the per-project slice needs them again afterwards.
  const portsOf = (register) => [
    ...register.map((r) => r?.port),
    ...register.flatMap((r) => (r?.pending ?? []).map((item) => item?.port)),
  ].filter((p) => Number.isInteger(p));

  // One project's model — exactly what P4 built, with the page's own port removed from it: there is
  // one page now and `machine.port` names it once, so repeating it per project would be the same
  // fact stated N times and free to drift.
  //
  // `state` is handed in rather than read here: `model()` below already read it once to build the
  // machine-wide port union, and the invariant this replaces was explicit that `tasks` and
  // `conductor` must come from that SAME read, not a second one that could disagree with it.
  const modelFor = ({ cfg }, state, found) => {
    const register = state.tasks ?? [];
    const trees = worktreePaths(cfg.root);
    return buildModel({
      project: { name: cfg.name, root: cfg.root, mode: cfg.mode, branch: currentBranch(cfg.root), id: cfg.id },
      cfg,
      board: readBoard(cfg.root),
      register,
      conductor: state.conductor ?? null,
      journal: readJournal(cfg.root),
      inbox: readInbox(cfg.root),
      servers: found.list.filter((s) => portsOf(register).includes(s.port)),
      serversKnown: found.ok,
      worktrees: trees,
      findImage: imageFinder(cfg.root, trees),
    });
  };

  const model = () => {
    // ONE read of each project's register, not two: `tasks` and `conductor` must come from the same
    // file contents, and the machine-wide port union must not become a second read that can
    // disagree with the model built beside it.
    //
    // Sorted by name (id breaking a tie) — the same total order `discoverProjects` and
    // `projectTabsOf` already apply — rather than trusted to `projects()`'s own order: the model's
    // array is what the project strip is drawn from, and the two must never disagree about which
    // project is first.
    const set = projects()
      .map((p) => ({ p, state: readState(p.cfg.root) }))
      .sort((a, b) => a.p.cfg.name.localeCompare(b.p.cfg.name) || a.p.cfg.id.localeCompare(b.p.cfg.id));
    const found = devServers(set.flatMap(({ state }) => portsOf(state.tasks ?? [])));
    return { machine: { port }, projects: set.map(({ p, state }) => modelFor(p, state, found)) };
  };

  // These two routes are still SINGLE-PROJECT: they answer against the first entry of the live set,
  // which is the only one every real deployment and every existing caller still hands this handler.
  // Resolving each one against a `project` id the request itself names is Task 5's job — until then
  // "the" project is whichever one there is.
  const only = () => projects()[0] ?? null;

  // No substitution: with one page and N projects there is no single name to write in, and the
  // server cannot know which project the reader was last looking at. `app.js` writes
  // `<project> — orchestra` on its first poll, from the project remembered in localStorage. What
  // this gives up is P4's promise that a tab was named before a byte of JavaScript had run — and
  // the reason that promise existed, telling four tabs apart, is gone with the four tabs.
  //
  // A project name now reaches the browser only inside JSON, rendered by `el()`, which sets
  // textContent — so the escaping this function used to need has no remaining caller and is gone
  // rather than left standing as a defence of nothing.
  const page = () => readFileSync(join(publicDir, 'index.html'), 'utf8');

  return async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (req.method === 'GET' && url.pathname === '/')
        return send(res, 200, page(), { 'content-type': MIME['.html'] });
      // A closed list here too, so the two names are the only thing `publicDir` is ever joined with.
      // A file missing from the install throws and lands in the catch below, which says which path
      // could not be read — more useful than a bare 404 for a page that ships with its own assets.
      if (req.method === 'GET' && ['/app.js', '/style.css'].includes(url.pathname)) {
        const path = join(publicDir, url.pathname.slice(1));
        return send(res, 200, readFileSync(path), { 'content-type': MIME[extname(path)] });
      }
      if (req.method === 'GET' && SHARED_MODULES.includes(url.pathname))
        return send(res, 200, readFileSync(join(HERE, url.pathname.slice(1))), { 'content-type': MIME['.js'] });

      if (req.method === 'GET' && url.pathname === '/api/model') {
        // Every project's stamp, in the set's own order. A project appearing or leaving changes the
        // stamp's shape, which is itself a change worth busting the etag for.
        const etag = `"${Buffer.from(projects().map((p) => sourceStamp(p.cfg)).join('|')).toString('base64url')}"`;
        if (req.headers['if-none-match'] === etag) return send(res, 304, '');
        return json(res, 200, model(), { etag, 'cache-control': 'no-cache' });
      }

      // The one route that serves a file the page did not ship with. It is guarded in sources.mjs —
      // extension allowlist, containment inside the checkout — and never trusts the query string,
      // because a page is a page and `p=../../../.ssh/id_rsa.png` costs nothing to write.
      //
      // A screenshot is hundreds of kilobytes and the page polls every two seconds, so the etag is
      // the difference between a thumbnail and a stall: mtime+size, which changes exactly when a
      // re-rendered capture is written over the old one.
      if (req.method === 'GET' && url.pathname === '/api/image') {
        const owner = only();
        if (!owner) return send(res, 404, 'no project on this machine');
        const found = resolveImageRequest(owner.cfg.root, url.searchParams.get('p'));
        if (!found.ok) return send(res, found.code, found.error);
        if (req.headers['if-none-match'] === found.stamp) return send(res, 304, '');
        return send(res, 200, readFileSync(found.path), { 'content-type': found.type, etag: found.stamp, 'cache-control': 'no-cache' });
      }

      // The answer channel's one writer. It reaches a conductor; IT NEVER CREATES ONE.
      //
      // The page this was ported from spawned `cron-tick.sh` when no conductor was beating. This
      // route never does that: this project's tick runner is `templates/tick.sh`, rendered per
      // project by `orchestra install-heartbeat` and fired by launchd/systemd, not by an HTTP
      // request — a page that started a bare `claude -p` instead would re-commit the failure that
      // source's own comment records:
      // six conductor identities in half an hour on 2026-08-13 in planetCraft, two merge_agent runs
      // twelve seconds apart on one branch, and three answers left unread because the register kept
      // naming a reader that had already died, all because delivering an answer had been wired to
      // CREATE a conductor instead of to REACH the live one.
      //
      // So there are exactly two outcomes, and both are facts rather than hopes:
      //   'awake'        — a beat under a minute old belongs to a pid that answers signal 0, and
      //                    that session's own `watch-answers` loop hands it this answer in seconds;
      //   'no-conductor' — the answer is in the inbox and the next tick will read it. The page says
      //                    that in a sentence rather than implying anything was started.
      if (req.method === 'POST' && url.pathname === '/api/answer') {
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch (e) {
          return e.message === TOO_LARGE
            ? json(res, 413, { ok: false, error: 'that answer is larger than 1 MB — the monitor stopped reading it' })
            : json(res, 400, { ok: false, error: 'body is not JSON' });
        }
        // `null`, `42` and `"x"` are all valid JSON that parse to something which is not an object,
        // and property access on them either throws (null) or silently reads undefined (the rest).
        // Checked BEFORE any property of body is touched, so a malformed request answers 400
        // instead of killing the process.
        if (typeof body !== 'object' || body === null) return json(res, 400, { ok: false, error: 'body must be a JSON object' });
        const { task = null, pending = null } = body;
        if (typeof body.answer !== 'string') return json(res, 400, { ok: false, error: 'answer must be a string' });
        const answer = body.answer.trim();
        if (!answer) return json(res, 400, { ok: false, error: 'an empty answer is not an answer' });
        if (task !== null && typeof task !== 'string') return json(res, 400, { ok: false, error: 'task must be a string or null' });
        if (pending !== null && typeof pending !== 'string') return json(res, 400, { ok: false, error: 'pending must be a string or null' });
        const owner = only();
        if (!owner) return json(res, 400, { ok: false, error: 'no project on this machine to answer' });
        // `ts` and `from` are stamped by `appendAnswer` itself, never here: one module defines the
        // channel's shape, its timestamp precision and its `from` marker.
        appendAnswer(inboxPath(owner.cfg.root), { task, pending, answer });
        return json(res, 200, { ok: true, conductor: liveConductor(owner.cfg.root) ? 'awake' : 'no-conductor' });
      }

      return send(res, 404, 'not found');
    } catch (e) {
      process.stderr.write(`${e.stack ?? e.message}\n`);
      if (res.headersSent) return res.end();
      return send(res, 500, `the monitor failed to answer this request: ${e.message}`);
    }
  };
}

// Binds, and hands back the server it bound with the port it actually got. THAT IS ALL IT DOES.
// It touches `~/.orchestra` not at all, and it starts no process: the machine registry, the
// refuse-and-point, the keepalive and the browser launch all belong to `lib/cli/monitor.mjs`. That
// is what keeps this module's header true — it reads files, serves a model, appends one line — and
// what lets a caller start a server in-process without a browser window opening on the developer's
// screen because it forgot a flag.
//
// The probe IS this bind (`listenOnFreePort`): never a throwaway socket opened to test a port and
// closed before the real listen, which is a window another process takes.
export async function serve({ cwd = process.cwd() } = {}) {
  // The handler needs the port, the port needs the socket, and the socket must not be reachable
  // before something is listening for requests on it — so the server is created with a FORWARDING
  // listener attached before the bind, and the real handler is dropped in behind it. A handler
  // attached only after the listen resolved leaves a window in which a request is accepted and
  // never answered, and that window is reachable: `machineMonitorPort()` is deterministic, so a
  // browser tab left open from an earlier run of this same machine's page is already polling that
  // exact URL every two seconds. The page's own poll skips while one request is in flight, so one
  // hung poll is the last poll that tab ever makes.
  let handle = null;
  const server = createServer((req, res) => (handle
    ? handle(req, res)
    : send(res, 503, 'the monitor is still starting — reload in a moment')));
  const bound = await listenOnFreePort(server, { port: machineMonitorPort(), pinned: false });
  handle = createHandler({ projects: () => discoverProjects({ cwd }), port: bound, publicDir: PUBLIC_DIR });
  // The last door to the process death `createHandler`'s own try/catch exists to prevent, and the
  // one it cannot cover. `listenOnFreePort` removes both of ITS listeners the instant the bind
  // succeeds, and nothing in this plugin installs `process.on('uncaughtException')` — so from here
  // on an `'error'` event on this server has no handler, and an unhandled `'error'` terminates node
  // with no diagnostic at all. A listening server emits it for accept-time failures, EMFILE and
  // ENFILE above all, which is a live condition on a machine running several worker sessions and
  // their dev servers beside this page. A sentence keeps the page up for every OTHER connection.
  server.on('error', (e) => process.stderr.write(`the monitor's socket reported an error: ${e.message}\n`));
  return { server, port: bound, url: `http://127.0.0.1:${bound}` };
}
