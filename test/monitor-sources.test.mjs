// lib/monitor/keys.mjs, lib/monitor/sources.mjs, and lib/register/images.mjs's `imagesIn`: what the
// monitoring page knows about the world, before there is a server or a page to look at it through.
// Ported from the source project's `tools/orchestra/monitor/{keys,sources,images}.mjs` and their
// test suite's `keys`, `sources` and "the images orchestra names in its own prose" — adjusted where
// this port's own data model differs (the register's `roadmap` field is a SLUG here, never a file
// path — see `lib/register/state.mjs`'s own comment on `registerRow`) and where this port moves
// behaviour the source left untested (the board's failure memory, `listServers`' honesty about
// `lsof`, and the sibling-directory containment case).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  UNFILED, registerKey, parseOptions, itemOptions, splitAsk,
} from '../lib/monitor/keys.mjs';
import {
  SERVERS_TTL_MS, readState, readJournal, readInbox, readBoard,
  worktreePaths, currentBranch, imageFinder, resolveImageRequest, listServers, sourceStamp,
} from '../lib/monitor/sources.mjs';
import { imagesIn } from '../lib/register/images.mjs';
import { makeRepo } from './helpers/fixture.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'orchestra-monitor-'));

// ---------------------------------------------------------------------------------------------
// keys.mjs
// ---------------------------------------------------------------------------------------------

test('registerKey leaves a qualified register id alone and files a bare one under unfiled', () => {
  assert.equal(registerKey({ id: 'lighting/S5' }), 'lighting/S5');
  assert.equal(registerKey({ id: 'C2' }), `${UNFILED}/C2`);
});

// The register names its roadmap by SLUG in this port (never a file path — see
// `lib/register/state.mjs`'s comment on `registerRow`), so the frame is that slug directly, not a
// file's basename stripped of its extension the way the source project needed.
test('registerKey frames a bare id by the roadmap slug the row names, keeping unfiled for a row that names none', () => {
  assert.equal(registerKey({ id: 'S5', roadmap: 'lighting' }), 'lighting/S5');
  assert.equal(registerKey({ id: 'C1', roadmap: 'ROADMAP' }), 'ROADMAP/C1');
  assert.equal(registerKey({ id: 'GT2' }), `${UNFILED}/GT2`);
  assert.equal(registerKey({ id: 'GT2', roadmap: null }), `${UNFILED}/GT2`);
});

// A half-written row is the exact condition this module exists to survive: `registerKey` used to
// throw on one, and because the request handler is an async arrow, the rejection would kill the
// whole server, answer channel included.
test('registerKey gives a row with no usable id a key instead of throwing', () => {
  assert.equal(registerKey({}), `${UNFILED}/(unnamed)`);
  assert.equal(registerKey({ id: null, roadmap: 'lighting' }), 'lighting/(unnamed)');
  assert.equal(registerKey({ id: 42 }), `${UNFILED}/(unnamed)`);
});

test('parseOptions reads the decision template\'s lettered options, and finds none when there are none', () => {
  assert.deepEqual(parseOptions('Options: A) keep 60 · B) drop to 30 · C) ask the bench'), [
    { letter: 'A', text: 'keep 60' },
    { letter: 'B', text: 'drop to 30' },
    { letter: 'C', text: 'ask the bench' },
  ]);
  assert.deepEqual(parseOptions('user compares :5307 against :5210'), []);
});

test('itemOptions offers what the conductor wrote down, over what its text happens to contain', () => {
  assert.deepEqual(
    itemOptions({ ask: 'land it or hold it?', options: [{ letter: 'A', text: 'land it' }] }),
    [{ letter: 'A', text: 'land it' }],
  );
  assert.deepEqual(
    itemOptions({ ask: 'Options: A) stale · B) also stale', options: [{ letter: 'A', text: 'current' }] }),
    [{ letter: 'A', text: 'current' }],
  );
});

test('itemOptions falls back to the ask\'s own text when nothing was written down', () => {
  assert.deepEqual(itemOptions({ ask: 'Options: A) keep · B) loosen' }).map((o) => o.letter), ['A', 'B']);
});

// The two live items today, verbatim in shape: a summary with no choice in it. The page must offer
// the free-text box alone rather than invent a choice from the item's kind.
test('itemOptions offers nothing for a question that puts no choice', () => {
  assert.deepEqual(itemOptions({ kind: 'fyi', ask: 'S5 is built and green but its deciding measurement has never run' }), []);
  assert.deepEqual(itemOptions({ kind: 'question', ask: 'go?', options: [] }), []);
});

test('itemOptions drops a half-written option instead of rendering a blank button', () => {
  assert.deepEqual(
    itemOptions({ ask: 'go?', options: [{ letter: 'A' }, { letter: 'B', text: 'go' }, 'C'] }),
    [{ letter: 'B', text: 'go' }],
  );
});

test('splitAsk separates the template\'s <sub> footer from the body, and keeps both', () => {
  assert.deepEqual(
    splitAsk('Which arm?\n<sub>Technical: 6.7 ms\nPictures: a.png</sub>'),
    { body: 'Which arm?', footer: 'Technical: 6.7 ms\nPictures: a.png' },
  );
});

test('splitAsk leaves an ask with no footer exactly as it was, and survives an absent one', () => {
  assert.deepEqual(splitAsk('does it still tremble?'), { body: 'does it still tremble?', footer: '' });
  assert.deepEqual(splitAsk(undefined), { body: '', footer: '' });
});

// ---------------------------------------------------------------------------------------------
// sources.mjs: readState / readJournal / readInbox
// ---------------------------------------------------------------------------------------------

test('readState, readJournal and readInbox read an absent register as empty, never throwing', () => {
  const root = tmp();
  assert.deepEqual(readState(root), {});
  assert.deepEqual(readJournal(root), { entries: [], skipped: 0 });
  assert.deepEqual(readInbox(root), { entries: [], skipped: 0 });
});

test('readState reads a truncated register as empty — a half-written file is not a reason to blank the page', () => {
  const root = tmp();
  mkdirSync(join(root, '.orchestra'), { recursive: true });
  writeFileSync(join(root, '.orchestra', 'state.json'), '{"tasks": [');
  assert.deepEqual(readState(root), {});
});

// ---------------------------------------------------------------------------------------------
// sources.mjs: readBoard — a child process, with a deadline and a memory
// ---------------------------------------------------------------------------------------------

// A fake `bin/orchestra` that reads its behaviour from a control file it shares with the test, so
// one `bin` path can act ok/fail/slow across several `readBoard` calls that all hit the SAME cache
// entry — proving the caching, not merely a lucky sequence of separate fakes.
function fakeBoard() {
  const dir = tmp();
  const bin = join(dir, 'board.mjs');
  const modePath = join(dir, 'mode.txt');
  const callsPath = join(dir, 'calls.txt');
  writeFileSync(modePath, 'ok');
  writeFileSync(callsPath, '');
  writeFileSync(bin, [
    "import { readFileSync, appendFileSync } from 'node:fs';",
    "const mode = readFileSync(new URL('./mode.txt', import.meta.url), 'utf8').trim();",
    "appendFileSync(new URL('./calls.txt', import.meta.url), 'x');",
    "if (mode === 'fail') { process.exit(1); }",
    "else if (mode === 'slow') { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000); console.log('{}'); }",
    "else { console.log(JSON.stringify({ rows: [{ key: 'demo/D1', id: 'D1' }] })); }",
  ].join('\n'));
  return {
    root: dir,
    bin,
    setMode: (m) => writeFileSync(modePath, m),
    calls: () => readFileSync(callsPath, 'utf8').length,
  };
}

test('readBoard reads a board that answers', () => {
  const { root, bin } = fakeBoard();
  const r = readBoard(root, { bin, timeoutMs: 2000 }, Date.now());
  assert.deepEqual(r, { status: 'ok', rows: [{ key: 'demo/D1', id: 'D1' }], message: null });
});

// The board CLI asks GitHub for the shared half of the board, and a killed child reports its
// SIGNAL, not a sentence — `spawnSync node ETIMEDOUT` is not something a person reading the page
// can act on.
test('readBoard bounds the wait on a board that never answers, and says what that means instead of the raw signal', () => {
  const { root, bin, setMode } = fakeBoard();
  setMode('slow');
  const r = readBoard(root, { bin, timeoutMs: 200 }, Date.now());
  assert.equal(r.status, 'error');
  assert.deepEqual(r.rows, []);
  assert.doesNotMatch(r.message, /ETIMEDOUT/);
  assert.match(r.message, /did not answer within 0\.2s/);
  assert.match(r.message, /GitHub/);
});

test('readBoard serves the last good board as stale on a later failure, and does not ask the child again for 60s', () => {
  const { root, bin, setMode, calls } = fakeBoard();
  const t0 = 1_700_000_000_000;

  setMode('ok');
  const good = readBoard(root, { bin, timeoutMs: 500 }, t0);
  assert.equal(good.status, 'ok');
  assert.equal(calls(), 1);

  // Past the success TTL, so the next call actually asks the child again rather than replaying the
  // 5s success cache.
  setMode('fail');
  const t1 = t0 + SERVERS_TTL_MS + 1;
  const failed = readBoard(root, { bin, timeoutMs: 500 }, t1);
  assert.equal(failed.status, 'stale');
  assert.deepEqual(failed.rows, good.rows);
  assert.match(failed.message, /the board on screen is the last one that answered/);
  assert.equal(calls(), 2);

  // The child WOULD succeed now if asked — proving the next assertion is the 60s memory at work,
  // not a coincidence of the fake still failing.
  setMode('ok');
  const t2 = t1 + 1000;
  const stillStale = readBoard(root, { bin, timeoutMs: 500 }, t2);
  assert.equal(stillStale.status, 'stale');
  assert.equal(calls(), 2);

  // 60s past the failure, the child is asked again and this time answers.
  const t3 = t1 + 60_000;
  const recovered = readBoard(root, { bin, timeoutMs: 500 }, t3);
  assert.equal(recovered.status, 'ok');
  assert.equal(calls(), 3);
});

// ---------------------------------------------------------------------------------------------
// sources.mjs: worktreePaths / currentBranch
// ---------------------------------------------------------------------------------------------

test('worktreePaths maps a live worktree\'s branch to its path, and currentBranch names each checkout\'s own', () => {
  const r = makeRepo({ name: 'wt-fixture' });
  // Nested under `r.root`, not a sibling `mkdtemp` of its own: `r.cleanup()` already removes
  // `r.root` recursively, so this needs no `finally` of its own — a hard kill that skips it leaves
  // nothing behind that is not already inside a directory something else owns and (usually) cleans.
  const side = join(r.root, '.worktree-side');
  try {
    r.git('branch', 'demo/d1');
    r.git('worktree', 'add', side, 'demo/d1');
    const map = worktreePaths(r.root);
    assert.equal(map.get('demo/d1'), side);
    assert.equal(currentBranch(r.root), 'main');
    assert.equal(currentBranch(side), 'demo/d1');
  } finally {
    r.cleanup();
  }
});

test('worktreePaths and currentBranch degrade to empty/null for a directory that is not a repository', () => {
  const dir = tmp();
  assert.deepEqual(worktreePaths(dir), new Map());
  assert.equal(currentBranch(dir), null);
});

// This server is single-threaded, and `git worktree list` is an ordinary, fast call — but a stuck
// one would block every other reader exactly the way the nine-hour 2026-08-12 GitHub incident
// blocked the whole page through `readBoard` (see that reader's own header comment), just through a
// different door. Proved here against a REAL hung child, not assumed from reading the `timeout`
// option — but at a millisecond budget, via the same injectable `timeoutMs` `readBoard` exposes for
// exactly this reason (its own header comment says why): the production default is 2000ms, and a
// test that waited for the real value would cost 2s on every run of this file, forever. 50ms against
// a fake `git` that sleeps 300ms proves the identical mechanism — `execFileSync`'s `timeout` killing
// a still-running child — with an order of magnitude of headroom against a loaded machine.
test('worktreePaths does not hang past its own timeout on a stuck git, and degrades to no worktrees', () => {
  withFakeBin('git', '#!/bin/sh\nsleep 0.3\n', () => {
    const start = Date.now();
    const map = worktreePaths('/whatever', 50);
    assert.ok(Date.now() - start < 300, `took ${Date.now() - start}ms — the timeout did not bound it`);
    assert.deepEqual(map, new Map());
  });
});

test('currentBranch reads the branch name out of .git/HEAD directly, without shelling to git', () => {
  const root = tmp();
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/demo/d1-first-thing\n');
  assert.equal(currentBranch(root), 'demo/d1-first-thing');
});

test('currentBranch reads null for a detached HEAD', () => {
  const root = tmp();
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(join(root, '.git', 'HEAD'), 'e4a1c929deadbeefcafefeed0123456789abcdef\n');
  assert.equal(currentBranch(root), null);
});

// ---------------------------------------------------------------------------------------------
// sources.mjs: imageFinder / resolveImageRequest — containment, and the three roots
// ---------------------------------------------------------------------------------------------

// A checkout holding one screenshot at each of the three roots a written path can mean, plus a
// worktree nested under it the way `.orchestra/worktrees` (this plugin's default) actually is.
const WORKTREE_REL = join('.orchestra', 'worktrees', 'c2');
const BRANCH = 'lod/c2-derived-switch';
const imageRepo = () => {
  const root = tmp();
  mkdirSync(join(root, '.orchestra', 'images'), { recursive: true });
  mkdirSync(join(root, WORKTREE_REL, 'reports'), { recursive: true });
  writeFileSync(join(root, 'top.png'), 'PNG');
  writeFileSync(join(root, '.orchestra', 'images', 'c1-main.png'), 'PNG');
  writeFileSync(join(root, WORKTREE_REL, 'reports', 'ab.png'), 'PNG');
  return root;
};
const trees = (root) => new Map([[BRANCH, join(root, WORKTREE_REL)]]);

test('imageFinder reads a checkout-relative path, a bare name dropped in .orchestra/images, and one relative to the task\'s worktree', () => {
  const root = imageRepo();
  const find = imageFinder(root, trees(root));
  assert.equal(find('top.png').rel, 'top.png');
  assert.equal(find('c1-main.png').rel, join('.orchestra', 'images', 'c1-main.png'));
  assert.equal(find('reports/ab.png', BRANCH).rel, join(WORKTREE_REL, 'reports', 'ab.png'));
});

// Not dropped: "orchestra pointed at an image that is not here" is a fact the page shows, and a
// silently absent picture is indistinguishable from a sentence that never mentioned one.
test('imageFinder reports a path that resolves to nothing rather than discarding it', () => {
  const found = imageFinder(imageRepo())('reports/never-written.png');
  assert.deepEqual(found, { rel: null, raw: 'reports/never-written.png', missing: true });
});

// STEP 2 SUBJECT: containment. `root + sep`, never `startsWith(root)` — a sibling directory whose
// name merely starts with the root's is a different repository, even though the raw string test
// would pass it.
test('imageFinder and resolveImageRequest both refuse a sibling directory that only STARTS WITH the root\'s name', () => {
  const parent = tmp();
  const root = join(parent, 'fixture');
  const sibling = join(parent, 'fixture-old');
  mkdirSync(root, { recursive: true });
  mkdirSync(sibling, { recursive: true });
  writeFileSync(join(sibling, 'secret.png'), 'PNG');

  const found = imageFinder(root)(join(sibling, 'secret.png'));
  assert.equal(found.missing, true);

  const resolved = resolveImageRequest(root, join(sibling, 'secret.png'));
  assert.equal(resolved.ok, false);
  assert.equal(resolved.code, 400);
});

test('imageFinder refuses a path that climbs out of the checkout, even to a file that really exists', () => {
  const root = imageRepo();
  const outside = tmp();
  writeFileSync(join(outside, 'escape.png'), 'PNG');
  const find = imageFinder(root);
  assert.equal(find(join(outside, 'escape.png')).missing, true);
});

test('resolveImageRequest accepts an image inside the checkout and stamps it by mtime and size', () => {
  const root = imageRepo();
  const out = resolveImageRequest(root, 'top.png');
  assert.equal(out.ok, true);
  assert.equal(out.type, 'image/png');
  assert.match(out.stamp, /^"\d+(\.\d+)?-3"$/);
});

// The extension is checked before the disk is touched, so a path that is not an image at all is
// refused as malformed (400) and never reaches a stat. Only something that LOOKS like an image and
// turns out not to be a file gets as far as 404.
test('resolveImageRequest refuses a climb out, a non-image file, an empty path, and answers 404 for one that is not there', () => {
  const root = imageRepo();
  const outside = tmp();
  writeFileSync(join(outside, 'escape.png'), 'PNG');
  assert.equal(resolveImageRequest(root, join(outside, 'escape.png')).code, 400);
  assert.equal(resolveImageRequest(root, join('.orchestra', 'images', 'c1-main.png')).ok, true);
  assert.equal(resolveImageRequest(root, '.orchestra').code, 400);
  assert.equal(resolveImageRequest(root, '').code, 400);
  assert.equal(resolveImageRequest(root, 'gone.png').code, 404);
});

// ---------------------------------------------------------------------------------------------
// sources.mjs: listServers — probing the ports the register named, not a port band
// ---------------------------------------------------------------------------------------------

function withFakeBin(name, scriptBody, fn) {
  const dir = tmp();
  writeFileSync(join(dir, name), scriptBody, { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}:${oldPath}`;
  try { fn(); } finally { process.env.PATH = oldPath; }
}
const withFakeLsof = (scriptBody, fn) => withFakeBin('lsof', scriptBody, fn);

test('listServers reports a port the caller named that lsof finds listening', () => {
  withFakeLsof('#!/bin/sh\necho "p4242"\necho "n*:5210"\n', () => {
    assert.deepEqual(listServers([5210, 5307]), { ok: true, list: [{ port: 5210, pid: 4242 }] });
  });
});

// Measured, not assumed: lsof finding nothing throws with `status: 1`, and an absent binary throws
// with `status: null` and `code: 'ENOENT'`.
test('listServers is honest about "nothing running" versus "cannot tell"', () => {
  withFakeLsof('#!/bin/sh\nexit 1\n', () => {
    assert.deepEqual(listServers([5210]), { ok: true, list: [] });
  });
  const emptyDir = tmp();
  const oldPath = process.env.PATH;
  process.env.PATH = emptyDir;
  try {
    assert.deepEqual(listServers([5210]), { ok: false, list: [] });
  } finally {
    process.env.PATH = oldPath;
  }
});

test('listServers with no ports named asks lsof nothing', () => {
  assert.deepEqual(listServers([]), { ok: true, list: [] });
});

// `lsof` is the canonical binary that hangs on a stale network mount, and this reader must never
// be able to hang the way an unbounded `readBoard` once could (see its own header comment) —
// proved here against a REAL hung child, not assumed from reading the `timeout` option. At a
// millisecond budget, the same way: 50ms against a fake `lsof` that sleeps 300ms costs a tenth of a
// second instead of two, and is still an order of magnitude of headroom against a loaded machine —
// a 2000ms budget against a real production timeout is a test that can fail for load, not for code.
test('listServers does not hang past its own timeout on a stuck lsof, and reports it honestly', () => {
  withFakeLsof('#!/bin/sh\nsleep 0.3\n', () => {
    const start = Date.now();
    const r = listServers([5210], 50);
    assert.ok(Date.now() - start < 300, `took ${Date.now() - start}ms — the timeout did not bound it`);
    assert.deepEqual(r, { ok: false, list: [] });
  });
});

// ---------------------------------------------------------------------------------------------
// sources.mjs: sourceStamp — the /api/model etag
// ---------------------------------------------------------------------------------------------

const cfgFor = (root) => ({ root, roadmaps: { published: 'docs/roadmaps' } });

test('sourceStamp is stable for an unchanged tree and changes when the register is touched', () => {
  const root = tmp();
  mkdirSync(join(root, '.orchestra'), { recursive: true });
  const cfg = cfgFor(root);
  const p = join(root, '.orchestra', 'state.json');
  const now = 1_760_000_000_000;
  writeFileSync(p, '{"tasks":[]}');
  const first = sourceStamp(cfg, now);
  assert.equal(sourceStamp(cfg, now), first);
  writeFileSync(p, '{"tasks":[{"id":"C2"}]}');
  assert.notEqual(sourceStamp(cfg, now), first);
});

test('sourceStamp reacts to a published roadmap being added, and then edited', () => {
  const root = tmp();
  const cfg = cfgFor(root);
  const now = 1_760_000_000_000;
  const before = sourceStamp(cfg, now);
  mkdirSync(join(root, 'docs', 'roadmaps'), { recursive: true });
  const roadmap = join(root, 'docs', 'roadmaps', 'demo.md');
  writeFileSync(roadmap, '# demo\n');
  const added = sourceStamp(cfg, now);
  assert.notEqual(added, before);
  writeFileSync(roadmap, '# demo\n\nmore than before.\n');
  assert.notEqual(sourceStamp(cfg, now), added);
});

test('sourceStamp reacts to the checkout moving to another branch', () => {
  const root = tmp();
  mkdirSync(join(root, '.git'), { recursive: true });
  const head = join(root, '.git', 'HEAD');
  const cfg = cfgFor(root);
  const now = 1_760_000_000_000;
  writeFileSync(head, 'ref: refs/heads/main\n');
  const onMain = sourceStamp(cfg, now);
  writeFileSync(head, 'ref: refs/heads/demo/d1\n');
  assert.notEqual(sourceStamp(cfg, now), onMain);
});

// The dev-server list comes from lsof, not from a file; no mtime moves when a server starts, so
// without a clock in the stamp the etag would freeze the list for as long as orchestra is idle.
test('sourceStamp expires at the rate the server list is cached, and no faster', () => {
  const root = tmp();
  const cfg = cfgFor(root);
  const now = 1_760_000_000_000;
  assert.equal(sourceStamp(cfg, now + SERVERS_TTL_MS - 1), sourceStamp(cfg, now));
  assert.notEqual(sourceStamp(cfg, now + SERVERS_TTL_MS), sourceStamp(cfg, now));
});

// ---------------------------------------------------------------------------------------------
// images.mjs: imagesIn — scanning composed with resolving
// ---------------------------------------------------------------------------------------------

test('imagesIn resolves every path a piece of prose names, in order, keeping a miss rather than dropping it', () => {
  const root = imageRepo();
  const find = imageFinder(root);
  const text = `which arm reads better? ${join('.orchestra', 'images', 'c1-main.png')} vs top.png vs gone.png`;
  const found = imagesIn(text, find);
  assert.deepEqual(found.map((i) => i.rel), [join('.orchestra', 'images', 'c1-main.png'), 'top.png', null]);
  assert.deepEqual(found.map((i) => i.missing), [false, false, true]);
});

// The same screenshot named twice, once bare and once qualified (or once relative and once
// absolute), is one screenshot: shown twice it reads as two arms of a comparison, which is the
// opposite of what it is.
test('imagesIn counts one file named two ways as one picture', () => {
  const root = imageRepo();
  const find = imageFinder(root);
  const text = `see top.png — that is also ${join(root, 'top.png')}`;
  assert.equal(imagesIn(text, find).length, 1);
});

// A reader with no filesystem under it cannot honestly report a file as present OR as missing.
test('imagesIn claims nothing either way when no resolver was given', () => {
  assert.deepEqual(imagesIn('see top.png', null), []);
});
