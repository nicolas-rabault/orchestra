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
// Each payload below is one that WOULD be acted on if `.orchestra/config.json` existed — a write
// to the main checkout, a bare suite run, a claim command, a draft add, a roadmap edit, an inbox
// with a matching conductor already waiting to be relayed. The fixture is a real git repository
// with no config, which is the ordinary shape of "a project that has not opted in" (as opposed to
// a path outside any repository at all, which every hook's own `projectFor` already tolerates via
// `mainCheckout` failing softly).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers/fixture.mjs';
import { writeState, emptyState } from '../lib/register/state.mjs';
import { inboxPath } from '../lib/register/inbox.mjs';
import { writeBeat } from '../lib/register/beat.mjs';

const HOOKS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks');
const HOOKS_JSON = join(HOOKS_DIR, 'hooks.json');

const repos = [];
// A real git repository with NO `.orchestra/config.json` — the off switch's own precondition —
// built by stripping the directory `makeRepo` writes it into, the same way `test/config.test.mjs`
// does for `loadConfig`'s own "no config" case.
function repoWithoutConfig() {
  const r = makeRepo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  repos.push(r);
  return r;
}
after(() => repos.forEach((r) => r.cleanup()));

function runHook(file, payload) {
  return spawnSync(process.execPath, [join(HOOKS_DIR, file)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
}

// One row per hook in `hooks/hooks.json`. `payload` is built fresh per row so one row's fixture
// (an inbox file, a register) cannot leak into another's.
const ROWS = [
  {
    name: 'guard-main-edit',
    file: 'guard-main-edit.mjs',
    payload: (r) => ({ cwd: r.root, tool_input: { file_path: join(r.root, 'README.md') } }),
  },
  {
    name: 'guard-main-commit',
    file: 'guard-main-commit.mjs',
    payload: (r) => ({ cwd: r.root, tool_input: { command: 'git commit -m x' } }),
  },
  {
    name: 'guard-full-suite',
    file: 'guard-full-suite.mjs',
    payload: (r) => ({ cwd: r.root, tool_input: { command: 'npm test' } }),
  },
  {
    name: 'guard-draft',
    file: 'guard-draft.mjs',
    payload: (r) => ({ cwd: r.root, tool_input: { command: 'git add .orchestra/drafts/foo.md' } }),
  },
  {
    name: 'guard-claim',
    file: 'guard-claim.mjs',
    payload: (r) => ({ cwd: r.root, tool_input: { command: 'git worktree add ../wt -b some-branch' } }),
  },
  {
    name: 'lint-roadmap',
    file: 'lint-roadmap.mjs',
    payload: (r) => ({ cwd: r.root, tool_input: { file_path: join(r.root, 'docs', 'roadmaps', 'demo.md') } }),
  },
  {
    name: 'orchestra-inbox',
    file: 'orchestra-inbox.mjs',
    // The strongest version of "would be acted on": a register naming this exact session as
    // conductor, plus a real unconsumed answer sitting in the inbox — everything `relay` needs to
    // produce text, missing only the config that turns any of this plugin's behaviour on.
    payload: (r) => {
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
  test(`${row.name}: silent and exit 0 with no config`, () => {
    const r = repoWithoutConfig();
    const res = runHook(row.file, row.payload(r));
    assert.equal(res.status, 0, `expected exit 0, got ${res.status}\nstderr: ${res.stderr}`);
    assert.equal(res.stdout, '');
    assert.equal(res.stderr, '');
  });
}
