// Everything the monitor knows about the world, in one module. Nothing above this file touches
// the filesystem, git, or a child process, which is what makes the page's model and layout testable
// without a repository.
//
// Every reader here degrades instead of throwing. The page's job is to show what orchestra is
// doing; a missing register, a half-written register row, an absent lsof are all conditions the
// page must render THROUGH, naming what it could not read.
//
// `mainCheckout()` is deliberately NOT here, unlike the source project's own copy of this file: it
// duplicated `lib/paths.mjs`. The root this whole module reads arrives as `cfg.root`, resolved once
// by `bin/orchestra` — see the Global Constraints' "runtime state resolves to the main checkout".
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitEnv } from '../paths.mjs';
import { statePath } from '../register/state.mjs';
import { journalPath } from '../register/journal.mjs';
import { inboxPath, readJsonl } from '../register/inbox.mjs';
import { IMAGE_EXTENSIONS } from '../register/images.mjs';
import { imagesDir } from '../register/archiveImages.mjs';

// How long a dev-server list stays good, and how long a successfully-read board is served before
// it is read again. The two are one constant rather than two numbers left free to drift apart: see
// `sourceStamp`, whose etag expires at exactly this cadence, and `readBoard`'s own success cache.
export const SERVERS_TTL_MS = 5000;

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();

const readJsonOr = (path, fallback) => {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
};

export const readState = (root) => readJsonOr(statePath(root), {});
export const readJournal = (root) => readJsonl(journalPath(root));
export const readInbox = (root) => readJsonl(inboxPath(root));

// Resolved from THIS module, never from `process.argv[1]` or `cwd`: the plugin is installed
// somewhere other than the project it serves — a global install, a symlinked dev checkout — and a
// path built from the caller's own invocation would be wrong in every real install while looking
// right in a fixture that happens to run from the plugin's own tree.
const DEFAULT_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'orchestra');

// The one reader here that reaches the NETWORK, through a child process: online, `store.list()`
// shells to `gh`, and `lib/store/github/gh.mjs`'s `execFileSync` carries no timeout of its own. This
// server is single-threaded, so an unbounded wait becomes the whole page — measured 2026-08-12 in
// planetCraft: `/api/model` never answered, the browser sat on a request that could not fail, and a
// freshly started monitor did exactly the same, so it read as the tool being broken rather than as
// GitHub being unreachable, for nine hours. Ten seconds is far longer than a healthy board read and
// far shorter than forever.
//
// `timeoutMs` is a parameter and not a constant read from inside, for one reason: a test that proves
// the wait is bounded has to wait for it, and a ten-second unit test is a test nobody runs.
const BOARD_TIMEOUT_MS = 10_000;

// A failure is remembered for a minute: retried on every model build, a GitHub outage would leave
// the page answering for one second in eleven, which is indistinguishable from the hang the
// timeout just fixed. A success is remembered too, for a harder reason than cost: measured
// 2026-08-13 in planetCraft, 8 worktrees, a healthy board took 3.0 s against a page that polls
// every 2 s — uncached, requests overlapped and hand-timed responses degraded 15 s, 29 s, 47 s
// until the server answered nothing at all, which reads as a dead server and was reported as one.
const BOARD_RETRY_MS = 60_000;

// One cache entry per (root, bin) pair, so two projects — or two tests naming two different scratch
// roots — never share a stale answer. A real monitor only ever calls this with one root for its
// whole life; the map exists for that life, not for concurrency.
const boardCache = new Map();

// There is no "absent board" state here, unlike the source project's reader: `bin/orchestra` always
// exists beside this module, whatever project it is serving. Offline the child is a node start
// against local markdown — cheap, and the fixture suite exercises exactly that path.
export function readBoard(root, { bin = DEFAULT_BIN, timeoutMs = BOARD_TIMEOUT_MS } = {}, now = Date.now()) {
  // `\0` and not a space, a colon or anything else printable: it is the one byte a filesystem path
  // can never contain, on any platform this runs on, so `root` and `bin` can never collide into the
  // same key by coincidence the way two path-shaped strings joined on a printable separator could.
  const key = `${root}\0${bin}`;
  let entry = boardCache.get(key);
  if (!entry) {
    entry = { lastGood: null, goodAt: 0, failure: null, failedAt: 0 };
    boardCache.set(key, entry);
  }

  // The last board that DID answer keeps being served, said plainly as stale, and nothing goes
  // back to the child for a minute.
  const stale = () => (entry.lastGood
    ? { ...entry.lastGood, status: 'stale', message: `${entry.failure} — the board on screen is the last one that answered` }
    : { status: 'error', rows: [], message: entry.failure });

  if (entry.failure && now - entry.failedAt < BOARD_RETRY_MS) return stale();
  if (entry.lastGood && !entry.failure && now - entry.goodAt < SERVERS_TTL_MS) return entry.lastGood;

  try {
    const out = JSON.parse(run(process.execPath, [bin, 'roadmap', 'board', '--json'], { cwd: root, timeout: timeoutMs }));
    const read = { status: 'ok', rows: out.rows ?? [], message: null };
    entry.lastGood = read;
    entry.goodAt = now;
    entry.failure = null;
    return read;
  } catch (e) {
    // A killed child reports its signal, not a sentence, so the one condition a reader of this
    // banner can act on would otherwise arrive as `spawnSync node ETIMEDOUT`.
    const timedOut = e.code === 'ETIMEDOUT' || e.signal === 'SIGTERM';
    entry.failure = timedOut
      ? `the roadmap board did not answer within ${timeoutMs / 1000}s — it asks GitHub for the shared board, so GitHub is probably unreachable from here; this is orchestra's register alone`
      : `the roadmap board failed: ${e.message.split('\n')[0]}`;
    entry.failedAt = now;
    return stale();
  }
}

// `timeout: 2000` on the `git` call below is the same promise `readBoard`'s deadline makes for the
// board, paid through a different door: `git worktree list` is ordinary and fast, but this server
// is single-threaded, and an unbounded child here blocks every other reader exactly the way the
// nine-hour 2026-08-12 GitHub incident (see `readBoard`, above) blocked the whole page — just
// without a network call to blame it on. A timeout that fires is caught below like any other
// failure: no worktrees, never a crash.
export function worktreePaths(root) {
  const map = new Map();
  let path = null;
  try {
    // stderr silenced: a directory that is not a repository is a state this reader answers with an
    // empty map, and git's `fatal:` on the way there is noise in every test that builds a scratch
    // checkout in a temp directory.
    const opts = { stdio: ['ignore', 'pipe', 'ignore'], env: gitEnv(), timeout: 2000 };
    for (const line of run('git', ['-C', root, 'worktree', 'list', '--porcelain'], opts).split('\n')) {
      if (line.startsWith('worktree ')) path = line.slice(9);
      else if (line.startsWith('branch refs/heads/') && path) map.set(line.slice(18), path);
    }
  } catch { /* a repository that cannot answer — including a timed-out one — is reported as no worktrees, never as a crash */ }
  return map;
}

// The branch HEAD names in this checkout, read as a FILE rather than shelled out to `git
// rev-parse`: this reader must never be able to hang, and everything else in this module now keeps
// that promise — `worktreePaths` and `listServers` bound their own child processes with a 2s
// timeout, and `readBoard` is bounded on purpose, at a longer deadline, because a healthy board
// read is itself slower than 2s. A detached HEAD (a bare commit hash, not a `ref:` line) has no
// branch name and reads as null, the same as an unreadable or absent `.git`.
//
// `root`'s `.git` is a DIRECTORY in the main checkout and a FILE (`gitdir: <path>`) in a linked
// worktree — `worktreePaths` above hands back exactly the latter kind of path, so a reader that
// only handled the directory form would silently know every worker's branch except its own.
export function currentBranch(root) {
  try {
    const gitPath = join(root, '.git');
    const dir = statSync(gitPath).isDirectory() ? gitPath
      : resolve(root, /^gitdir:\s*(.+?)\s*$/.exec(readFileSync(gitPath, 'utf8'))[1]);
    const head = readFileSync(join(dir, 'HEAD'), 'utf8');
    const m = /^ref:\s*refs\/heads\/(.+?)\s*$/.exec(head);
    return m ? m[1] : null;
  } catch { return null; }
}

// One containment rule, used twice: once to decide what a path in the prose is allowed to resolve
// to, and once to decide what /api/image is allowed to serve. Two rules would be two chances to
// disagree, and the disagreement would be the permissive one.
//
// `root + sep` and not `startsWith(root)`: a sibling checkout named `fixture-old` starts with the
// same string as `fixture` and is a different repository.
const inside = (root, abs) => abs === root || abs.startsWith(root + sep);

const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
// This key set and `IMAGE_EXTENSIONS` (`lib/register/images.mjs`) name the same extensions by
// construction, never by coincidence: an extension added to one and not the other would serve a
// 200 with `type: undefined`, or refuse an extension `scanImagePaths` already finds, and nothing
// would fail loudly. Asserted once, at load, rather than trusted.
const mimeExts = Object.keys(MIME_BY_EXT).sort().join(',');
const knownExts = [...IMAGE_EXTENSIONS].sort().join(',');
if (mimeExts !== knownExts)
  throw new Error(`orchestra: MIME_BY_EXT and IMAGE_EXTENSIONS disagree (${mimeExts} vs ${knownExts})`);

const extOf = (path) => path.split('.').pop().toLowerCase();

// Where a path orchestra wrote is looked for. It names three roots by turns and never says which:
// the checkout it is talking about, `.orchestra/images/` where a bare `c1-altitude-main.png`
// resolves, and the worktree of the worker that wrote the line. First hit wins; nothing found is
// reported as nothing found rather than dropped.
//
// This is NOT `lib/register/archiveImages.mjs`'s own `resolver()`. That one resolves only inside
// `.orchestra/images/`, because everything it resolves is a file it may REMOVE; this one searches
// the checkout and the worktrees too, because its question is "which file should I serve" — see
// that module's own comment on the distinction.
export function imageFinder(root, worktrees = new Map()) {
  return (raw, branch = null) => {
    const roots = [root, imagesDir(root), worktrees.get(branch)].filter(Boolean);
    const tries = isAbsolute(raw) ? [resolve(raw)] : roots.map((base) => resolve(base, raw));
    for (const abs of tries) {
      // Checked here and not only at the route: a `../../../.ssh/id_rsa.png` written into a note
      // must never become a path the page then asks the server for.
      if (!inside(root, abs)) continue;
      try { if (statSync(abs).isFile()) return { rel: relative(root, abs), raw, missing: false }; }
      catch { /* no file at this candidate (containment was already checked above); try the next */ }
    }
    return { rel: null, raw, missing: true };
  };
}

// What /api/image is allowed to answer with, decided here rather than in the request handler, so the
// guard is testable without a socket. `p` arrives from the page, which built it from a model this
// process produced — and is trusted exactly as far as any query string is, which is not at all.
export function resolveImageRequest(root, p) {
  if (typeof p !== 'string' || !p) return { ok: false, code: 400, error: 'no image path given' };
  if (!IMAGE_EXTENSIONS.includes(extOf(p))) return { ok: false, code: 400, error: 'not an image path' };
  const abs = resolve(root, p);
  if (!inside(root, abs)) return { ok: false, code: 400, error: 'outside this repository' };
  try {
    const s = statSync(abs);
    if (!s.isFile()) return { ok: false, code: 404, error: 'not a file' };
    return { ok: true, path: abs, type: MIME_BY_EXT[extOf(abs)], stamp: `"${s.mtimeMs}-${s.size}"` };
  } catch { return { ok: false, code: 404, error: 'no such file' }; }
}

// Listening dev ports, probed by NUMBER rather than swept by band: the source project's reader
// scanned Vite's neighbourhood (5170-5599) and then resolved each holder's cwd with a second `lsof`
// per pid to match it against a worktree. Neither survives a portable plugin — the band is one
// toolchain's, and a Rust or Python dev server is nowhere near it — so this instead probes exactly
// the ports the caller already knows about (the register's `reg.port` and `pending[].port`), in
// ONE `lsof` call.
//
// The cost is real: a dev server on a port no register row names is invisible to the page. The
// conductor's own orphan sweep is where that question belongs, and it is a shell procedure, not
// this page's job.
//
// `ok` is the difference between "no dev server is running" and "this machine cannot tell me":
// lsof exits non-zero both when it finds nothing and when it is not installed, and reporting the
// second as the first would have the page state, confidently, something it never checked.
export function listServers(ports = []) {
  // A `null` port (unassigned yet) or a duplicate is real input, not a hypothetical one — `ports`
  // is derived from `reg.port` and `pending[].port`, both nullable. An EMPTY set is the ordinary
  // idle state (no worker holds a port yet), and it is worth naming: `-iTCP:` with nothing after
  // the colon is not "find everything", it is a usage error lsof refuses outright, so this is
  // answered without asking lsof anything at all.
  const unique = [...new Set(ports)].filter((p) => Number.isInteger(p) && p > 0);
  if (!unique.length) return { ok: true, list: [] };
  let out = '';
  // `timeout: 2000`: lsof is the canonical binary that hangs on a stale network mount, and this
  // server is single-threaded — an unbounded call here is the nine-hour 2026-08-12 GitHub incident
  // (see `readBoard`, above) reached through a different door. A timeout kills the child and lands
  // in the catch below exactly like every other lsof failure this reader already handles.
  try { out = run('lsof', ['-nP', `-iTCP:${unique.join(',')}`, '-sTCP:LISTEN', '-F', 'pn'], { timeout: 2000 }); }
  // Measured directly against a real lsof, 2026-09-04, the same distinction planetCraft's own
  // `listGameServers` reader already drew: it exits with `status: 1` when it finds nothing, and
  // with `status: null` and `code: 'ENOENT'` when the binary is absent. A killed child (the timeout
  // above) reports `status: null` too — indistinguishable from "not installed", and both are
  // honestly `ok: false`: this machine could not tell either way.
  catch (e) { return { ok: typeof e.status === 'number', list: [] }; }
  const found = new Map();
  let pid = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid) {
      const port = Number(line.split(':').pop());
      if (port && !found.has(port)) found.set(port, pid);
    }
  }
  return { ok: true, list: [...found].map(([port, p]) => ({ port, pid: p })).sort((a, b) => a.port - b.port) };
}

// mtime and size of every file the model reads, so /api/model can answer 304 without rebuilding it.
//
// `cfg`, not `root`, unlike every other reader in this module: it is the only one that needs
// `cfg.roadmaps.published`, a project-configurable path with no other way to reach this function.
export function sourceStamp(cfg, now = Date.now()) {
  const parts = [];
  // The dev-server list comes from lsof, not from a file: no mtime here moves when a server starts,
  // so while these files are still the etag would hold the old list for as long as orchestra is
  // idle — and this module's own cache promises a few seconds. A coarse bucket of the clock, exactly
  // as wide as the list is cached for, expires the etag at that cadence and no faster.
  parts.push(`servers:${Math.floor(now / SERVERS_TTL_MS)}`);
  const stamp = (label, path) => {
    try { const s = statSync(path); parts.push(`${label}:${s.mtimeMs}:${s.size}`); }
    catch { parts.push(`${label}:-`); }
  };
  stamp('state', statePath(cfg.root));
  stamp('journal', journalPath(cfg.root));
  stamp('inbox', inboxPath(cfg.root));
  // Each published roadmap is stat'd on its own, sorted so the stamp does not depend on directory
  // scan order. An absent published directory (offline, before any roadmap is published) is a
  // stable, empty contribution, not an error.
  const publishedDir = join(cfg.root, cfg.roadmaps.published);
  let names = [];
  try { names = readdirSync(publishedDir).filter((f) => f.endsWith('.md')).sort(); } catch { /* nothing published yet */ }
  for (const name of names) stamp(`roadmap:${name}`, join(publishedDir, name));
  // The branch, so a checkout the page is looking at moving to another branch busts the etag too —
  // stat'd rather than read, and never shelled to `git rev-parse`: this is the one file `currentBranch`
  // also reads directly, for the same reason (it cannot hang). `cfg.root` is always the MAIN
  // checkout (`lib/paths.mjs`'s `mainCheckout`), whose `.git` is always a real directory, so this
  // stamp never needs `currentBranch`'s other branch: following a linked worktree's `gitdir:`
  // pointer. The branch component of this stamp would be inert for any other kind of root.
  stamp('branch', join(cfg.root, '.git', 'HEAD'));
  return parts.join('|');
}
