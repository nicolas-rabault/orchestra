// The off-switch matrix — spec §16's mitigation for the single biggest risk this plugin carries:
// it is installed globally, so it runs inside every project on the machine, most of which have
// never heard of it. Every one of the seven hooks must do NOTHING at all in a project that has not
// opted in.
//
// Table-driven over the seven hooks, so an eighth hook added later without a row here is a visible
// gap rather than a silent one. Each row spawns the REAL hook file as a process — the same way
// Claude Code invokes it, JSON on stdin, nothing on argv — because importing a hook proves nothing
// about it: its entire contract is a process's exit code and its two streams.
//
// Review round 1 found two rows (guard-full-suite, guard-claim) whose payload was silent whether
// or not a config existed — the fixture had no `suite` gate, and the branch matched no roadmap
// row, so each hook took its own ORDINARY "nothing to do here" exit rather than the off switch.
// A silent row proves nothing about the off switch specifically, and reads as coverage it is not.
// A third row (lint-roadmap) had the same defect, found while checking the other five for it: the
// target file never existed on disk, so `readFileSync` threw and the hook exited 0 for THAT
// reason regardless of config.
//
// Fixed by giving every row a `build(root)` that sets up whatever a FULLY CONFIGURED project needs
// for that exact payload to be acted on — a gate, a published+unclaimed roadmap task, a malformed
// file on disk, a register naming the payload's own session — and testing each row TWICE against
// the very same fixture and the very same payload:
//   1. "is not inert" — run against the config `build` just wrote; assert the hook actually does
//      something (a refusal, or `orchestra-inbox`'s relayed text).
//   2. "the off switch" — delete ONLY `.orchestra/config.json` from that same project (never the
//      rest of `.orchestra/` — a register or a draft left behind by a project that turned this
//      plugin off is the realistic shape of "no config", not a pristine repository) and re-run the
//      identical payload; assert silence.
// One fixture, one payload, both checks — so a row cannot go inert again without failing #1, and
// cannot regain behaviour with no config without failing #2.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo, ROADMAP } from './helpers/fixture.mjs';
import { fakeGhOnPath, foreignClaim } from './helpers/fakeGh.mjs';
import { writeState, emptyState } from '../lib/register/state.mjs';
import { inboxPath } from '../lib/register/inbox.mjs';
import { writeBeat } from '../lib/register/beat.mjs';
import { hookEnv } from './helpers/hookEnv.mjs';

const HOOKS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks');
const HOOKS_JSON = join(HOOKS_DIR, 'hooks.json');

const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

// An explicit `env`, because the default is to inherit `process.env` wholesale — and inside a
// landing that carries the two off switches these rows exist to prove are NOT inert.
function runHook(file, payload, env = {}) {
  return spawnSync(process.execPath, [join(HOOKS_DIR, file)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: hookEnv(env),
  });
}

function write(root, relPath, text) {
  const p = join(root, relPath);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return p;
}

// One row per hook in `hooks/hooks.json`.
//   - `repoOpts`: passed to `makeRepo` — the config a row's payload needs to be live at all
//     (`guard-full-suite` needs a `suite` gate; the rest are live under `makeRepo`'s defaults).
//   - `build(r)`: does whatever ELSE a live run needs (publishing a roadmap task, writing a
//     malformed file, seeding a register) and returns the payload.
//   - `env(r)`: optional, for a hook whose live behaviour needs something on PATH — `guard-claim`
//     reads its board by spawning `bin/orchestra`, so its backend has to be a real binary. Applied
//     to BOTH runs of the row, so the off-switch half is proven against the same environment.
//   - `assertLive(res)`: what "this payload was actually acted on" looks like for this hook.
const ROWS = [
  {
    name: 'guard-main-edit',
    file: 'guard-main-edit.mjs',
    build: (r) => ({ cwd: r.root, tool_input: { file_path: join(r.root, 'README.md') } }),
    assertLive: (res) => {
      assert.equal(res.status, 2);
      assert.match(res.stderr, /MAIN checkout/);
    },
  },
  {
    name: 'guard-main-commit',
    file: 'guard-main-commit.mjs',
    build: (r) => ({ cwd: r.root, tool_input: { command: 'git commit -m x' } }),
    assertLive: (res) => {
      assert.equal(res.status, 2);
      assert.match(res.stderr, /MAIN checkout/);
    },
  },
  {
    name: 'guard-full-suite',
    file: 'guard-full-suite.mjs',
    repoOpts: { config: { gates: [{ name: 'suite', cmd: 'npm test' }] } },
    build: (r) => ({ cwd: r.root, tool_input: { command: 'npm test' } }),
    assertLive: (res) => {
      assert.equal(res.status, 2);
      assert.match(res.stderr, /ORCHESTRA_FULL_SUITE=1/);
    },
  },
  {
    name: 'guard-draft',
    file: 'guard-draft.mjs',
    build: (r) => ({ cwd: r.root, tool_input: { command: 'git add .orchestra/drafts/foo.md' } }),
    assertLive: (res) => {
      assert.equal(res.status, 2);
      assert.match(res.stderr, /\.orchestra\/drafts/);
    },
  },
  {
    name: 'guard-claim',
    file: 'guard-claim.mjs',
    // ONLINE, and held by a colleague, because that is now the only board state this hook refuses:
    // a row whose store records no claim — offline, or a `destination: local` roadmap — fails open
    // deliberately (`startVerdict`'s `unrecordable`, lib/roadmap/policy.mjs), since demanding a
    // claim there demands evidence that store cannot produce. This row used to publish an offline
    // task and assert the refusal; the day the guard stopped refusing it, the row went INERT — the
    // exact defect this file's header was written about — so it moves to the case that is still a
    // refusal rather than to a weaker assertion about the same fixture.
    //
    // `foreignClaim` is served by a `gh` on PATH (./helpers/fakeGh.mjs): the hook reads its board
    // by spawning `bin/orchestra`, so the fixture has to exist as a binary that subprocess can run.
    repoOpts: { mode: 'online' },
    env: (r) => fakeGhOnPath(r.root, foreignClaim()),
    build: (r) => ({ cwd: r.root, tool_input: { command: 'git worktree add ../wt -b demo/d1-first-thing main' } }),
    assertLive: (res) => {
      assert.equal(res.status, 2);
      assert.match(res.stderr, /orchestra roadmap claim/);
    },
  },
  {
    name: 'lint-roadmap',
    file: 'lint-roadmap.mjs',
    // A roadmap on disk missing a required field — `test/hooks-lint-roadmap.test.mjs`'s own
    // "malformed roadmap under drafts is REPORTED" fixture. Without a real, malformed file at the
    // target path, `readFileSync` throws (ENOENT) and the hook exits 0 for THAT reason before it
    // ever reaches the off switch's actual job — the exact defect review found here.
    build: (r) => {
      const broken = ROADMAP.replace('- **Roadmap** demo\n', '');
      const p = write(r.root, '.orchestra/drafts/demo.md', broken);
      return { cwd: r.root, tool_input: { file_path: p } };
    },
    assertLive: (res) => {
      assert.equal(res.status, 2);
      assert.match(res.stderr, /does not match the format/);
    },
  },
  {
    name: 'orchestra-inbox',
    file: 'orchestra-inbox.mjs',
    // A register naming this exact session as conductor, a live beat backing that up, and a real
    // unconsumed answer sitting in the inbox — everything `relay` needs to produce text.
    build: (r) => {
      const session = 'aaaaaaaa-1111-2222-3333-444444444444';
      writeState(r.root, {
        ...emptyState(r.root),
        conductor: { session: session.slice(0, 8), language: null, inboxSeen: null },
        tasks: [{ id: 'demo/D1', branch: 'demo/d1', pending: [] }],
      });
      appendFileSync(
        inboxPath(r.root),
        `${JSON.stringify({ ts: '2026-09-05T10:00:00.000Z', task: 'demo/D1', pending: null, answer: 'ship it', from: 'monitor' })}\n`,
      );
      writeBeat(r.root, { session, pid: process.pid, now: Date.now() });
      return { cwd: r.root, session_id: session };
    },
    assertLive: (res) => {
      assert.equal(res.status, 0);
      assert.match(res.stdout, /ship it/);
    },
  },
];

// Every `.mjs` file named anywhere in `hooks.json`'s commands, walked generically rather than
// assumed to sit at one fixed depth — so this stays true of the registration's actual shape
// instead of a guess about it. This is the guard against the exact gap the header describes: a
// hook registered here without a row above must fail THIS test, not slip through silently.
function registeredHooks() {
  const config = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
  const found = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') {
      if (typeof node.command === 'string') {
        const m = /([\w-]+\.mjs)/.exec(node.command);
        if (m) found.add(m[1]);
      }
      Object.values(node).forEach(walk);
    }
  };
  walk(config.hooks);
  return found;
}

test('every hook registered in hooks.json has a row in this matrix', () => {
  const registered = registeredHooks();
  const covered = new Set(ROWS.map((row) => row.file));
  assert.deepEqual([...registered].sort(), [...covered].sort());
});

for (const row of ROWS) {
  test(`${row.name}: the row's payload is not inert — a real config acts on it`, () => {
    const r = repo(row.repoOpts);
    const payload = row.build(r);
    const res = runHook(row.file, payload, row.env?.(r));
    row.assertLive(res);
  });

  test(`${row.name}: silent and exit 0 with no config`, () => {
    const r = repo(row.repoOpts);
    const payload = row.build(r);
    // Only the config file goes — a register, a draft or an inbox a project left behind after
    // turning this plugin off is the realistic shape of "no config", and the off switch must hold
    // regardless of what else is sitting under `.orchestra/`.
    rmSync(join(r.root, '.orchestra', 'config.json'), { force: true });
    const res = runHook(row.file, payload, row.env?.(r));
    assert.equal(res.status, 0, `expected exit 0, got ${res.status}\nstderr: ${res.stderr}`);
    assert.equal(res.stdout, '');
    assert.equal(res.stderr, '');
  });
}
