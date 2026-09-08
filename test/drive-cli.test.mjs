// The acceptance for `ready`'s two obligation lines and the command that resolves them, driven
// through `bin/orchestra` against a `claude` that records instead of spending: on a register where
// N workers are stopped on live rows and one relay is written but not delivered, `ready` names all
// of them, `drive` resumes each one with the relay in the message it received, and the receipt is
// written only once the turn has returned. Each guard has a test that fails when it is removed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers/fixture.mjs';
import { withFakeClaude } from './helpers/claude.mjs';
import { writeState, readState, emptyState } from '../lib/register/state.mjs';
import { readTurn, turnPaths } from '../lib/register/liveness.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orchestra');
const repos = [];
const HOME = process.env.HOME;
const homes = [];
after(() => {
  process.env.HOME = HOME;
  homes.forEach((h) => rmSync(h, { recursive: true, force: true }));
  repos.forEach((r) => r.cleanup());
});

// `ready` writes the machine registry under HOME; a temporary one keeps the developer's own clean.
const run = (cwd, ...args) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: process.env });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

const RELAY = 'L\'UTILISATEUR A REGARDÉ LE DÔME.\n\n« La barre orange passe au-dessus du header, passe-la en dessous. »';

// Three claimed rows with sessions and worktrees — two stopped with nothing owed by the user, one
// with a relay written and not delivered — plus a landed one nothing should ever drive.
function fleet() {
  const home = mkdtempSync(join(tmpdir(), 'orchestra-home-'));
  homes.push(home);
  process.env.HOME = home;
  const r = makeRepo();
  repos.push(r);
  const row = (id, branch, over = {}) => ({
    id, order: 1, title: id, roadmap: 'demo', deps: [], touches: [], lane: null, branch, subjects: [],
    status: 'claimed', design: false, model: null, session: `${id.split('/')[1].toLowerCase()}-uuid`,
    sessionName: null, port: null, note: '', pending: [], mine: true, ...over,
  });
  const tasks = [
    row('demo/A1', 'demo/a1'),
    row('demo/A2', 'demo/a2'),
    row('demo/R1', 'demo/r1', { relay: { text: RELAY, writtenAt: '2026-09-08T06:52:00.000Z' } }),
    row('demo/L1', 'demo/l1', { status: 'landed', session: 'l1-uuid' }),
  ];
  for (const t of tasks) if (t.status !== 'landed') r.git('worktree', 'add', '-q', '-b', t.branch, join(r.root, '.orchestra', 'worktrees', t.id.split('/')[1].toLowerCase()), 'main');
  writeState(r.root, { ...emptyState(r.root), adopted: true, tasks });
  return r;
}

const relayOf = (r, id) => readState(r.root).tasks.find((t) => t.id === id).relay;

// Polls a turn record until it reports an exit, for the deliberately slow turns below.
function untilEnded(record, ms = 15_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const t = readTurn(record);
    if (typeof t?.exit === 'number') return t;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  throw new Error(`turn ${record} did not end within ${ms} ms`);
}

test('ready names every stopped worker and the undelivered relay, above everything else, and in --json', () => {
  withFakeClaude((fake) => {
    const r = fleet();
    // A1 is still a registered background session sitting idle; A2 and R1 were stopped earlier.
    fake.agents([{ kind: 'background', sessionId: 'a1-uuid', id: 'a1short', status: 'idle', pid: 1 }]);
    const { code, out } = run(r.root, 'ready');
    assert.equal(code, 0, out);
    const lines = out.trim().split('\n');
    assert.match(lines[0], /^UNDELIVERED: demo\/R1 \[claimed\] — relay written 2026-09-08T06:52:00\.000Z, \d+ min ago$/);
    assert.match(lines[1], /^IDLE: demo\/A1 \[claimed\] — a1-uuid background session idle$/);
    assert.match(lines[2], /^IDLE: demo\/A2 \[claimed\] — a2-uuid stopped$/);
    assert.match(lines[3], /^owed: 3 worker turn\(s\) — orchestra drive$/);
    assert.ok(!out.includes('demo/L1'));
    const json = JSON.parse(run(r.root, 'ready', '--json').out);
    assert.deepEqual(json.idle.map((e) => e.id), ['demo/A1', 'demo/A2']);
    assert.deepEqual(json.undelivered.map((e) => e.id), ['demo/R1']);
  });
});

test('a worker mid-turn is driving, not idle: busy in the agent list, or a --resume process in the table', () => {
  withFakeClaude((fake) => {
    const r = fleet();
    fake.agents([{ kind: 'background', sessionId: 'a1-uuid', id: 'a1short', status: 'busy', pid: 1 }]);
    const { out } = run(r.root, 'ready');
    assert.match(out, /^driving: demo\/A1 \[claimed\] — busy in the agent list$/m);
    assert.ok(!/IDLE: demo\/A1/.test(out));
  });
});

test('drive resumes every stopped worker with the relay verbatim in the message it received, and writes the receipt after the turn returned', () => {
  withFakeClaude((fake) => {
    const r = fleet();
    fake.agents([{ kind: 'background', sessionId: 'a1-uuid', id: 'a1short', status: 'idle', pid: 1 }]);
    const { code, out } = run(r.root, 'drive', '--for=30');
    assert.equal(code, 0, out);
    // The registered session was unregistered before its resume, the others resumed directly.
    assert.match(fake.calls(), /^stop a1short$/m);
    assert.match(out, /^stopped background session a1short \(demo\/A1\)$/m);
    for (const id of ['A1', 'A2', 'R1']) assert.match(out, new RegExp(`^driving: demo/${id} \\[claimed\\]`, 'm'));
    // The relay is the head of the message the worker received — physically, in the prompt argv.
    assert.ok(fake.prompt('r1-uuid').startsWith(RELAY), fake.prompt('r1-uuid'));
    assert.match(fake.prompt('r1-uuid'), /act on the message above/);
    assert.ok(!fake.prompt('a1-uuid').includes('DÔME'));
    assert.match(fake.prompt('a2-uuid'), /^Continue your task in this worktree/);
    // Each turn ran in its own worktree: the fake was invoked from there.
    assert.match(out, /^--- demo\/R1: turn returned exit 0 after \d+s — relay delivered, receipt on the row ---$/m);
    assert.match(out, /^report: turn done for r1-uuid$/m);
    const relay = relayOf(r, 'demo/R1');
    assert.ok(relay.deliveredAt);
    assert.equal(relay.receipt.session, 'r1-uuid');
    assert.ok(relay.receipt.turnAt);
    // The turn is on record with its exact prompt, and its log holds the worker's words.
    const turn = readTurn(turnPaths(r.root, 'demo-r1').record);
    assert.equal(turn.exit, 0);
    assert.equal(turn.prompt, fake.prompt('r1-uuid'));
    assert.equal(turn.cwd, join(r.root, '.orchestra', 'worktrees', 'r1'));
    assert.match(readFileSync(turn.log, 'utf8'), /turn done for r1-uuid/);
    // Delivered means gone from `ready`; the three workers are stopped again, which is the truth.
    const after = run(r.root, 'ready').out;
    assert.ok(!after.includes('UNDELIVERED'), after);
    assert.match(after, /^IDLE: demo\/R1 \[claimed\] — r1-uuid stopped 2026-\S+ — last words: report: turn done for r1-uuid$/m);
  });
});

test('the receipt is written by the turn that returned, never before: a turn still running leaves the relay owed', () => {
  withFakeClaude((fake) => {
    const r = fleet();
    fake.sleep(3);
    const { code, out } = run(r.root, 'drive', 'demo/R1', '--for=1');
    assert.equal(code, 12, out);
    assert.match(out, /^still running: demo\/R1 \(pid \d+, \d+s in\) — run `orchestra drive` again; the turns go on without you$/m);
    assert.equal(relayOf(r, 'demo/R1').deliveredAt, undefined);
    // While it runs, `ready` and a second `drive` both see a driven turn, not a stopped worker.
    assert.match(run(r.root, 'ready').out, /^driving: demo\/R1 \[claimed\] — driven turn pid \d+, relay in flight$/m);
    assert.match(run(r.root, 'drive', 'demo/R1', '--for=0').out, /^skip: demo\/R1 — a turn is already running/m);
    const turn = untilEnded(turnPaths(r.root, 'demo-r1').record);
    assert.equal(turn.exit, 0);
    assert.ok(turn.delivered);
    assert.ok(relayOf(r, 'demo/R1').receipt);
  });
});

test('a turn that printed a budget refusal delivered nothing: no receipt, the relay stays owed, and ready says why', () => {
  withFakeClaude((fake) => {
    const r = fleet();
    fake.refuse("You've hit your session limit · resets 1:50pm");
    const { code, out } = run(r.root, 'drive', 'demo/R1', '--for=30');
    assert.equal(code, 0, out);
    assert.match(out, /REFUSED \(budget: You've hit your session limit · resets 1:50pm\); this turn executed nothing — relay NOT delivered, still owed/);
    assert.equal(relayOf(r, 'demo/R1').receipt, undefined);
    assert.match(run(r.root, 'ready').out, /^UNDELIVERED: demo\/R1/m);
  });
});

test('a deliveredAt stamped by hand, with no receipt, is still undelivered — the guard for the second defect', () => {
  withFakeClaude(() => {
    const r = fleet();
    const state = readState(r.root);
    const row = state.tasks.find((t) => t.id === 'demo/R1');
    row.relay.deliveredAt = '2026-09-08T07:00:00.000Z';
    writeState(r.root, state);
    assert.match(run(r.root, 'ready').out, /^UNDELIVERED: demo\/R1/m);
    assert.match(run(r.root, 'tick-gate').out, /^run hold-awake/);
  });
});

test('a relay rewritten while its turn ran is not the one that was delivered, and gets no receipt', () => {
  withFakeClaude((fake) => {
    const r = fleet();
    fake.sleep(2);
    run(r.root, 'drive', 'demo/R1', '--for=0');
    const state = readState(r.root);
    state.tasks.find((t) => t.id === 'demo/R1').relay = { text: 'a second thought', writtenAt: '2026-09-08T09:00:00.000Z' };
    writeState(r.root, state);
    const turn = untilEnded(turnPaths(r.root, 'demo-r1').record);
    assert.equal(turn.exit, 0);
    assert.equal(turn.delivered, null);
    assert.equal(relayOf(r, 'demo/R1').receipt, undefined);
  });
});

test('drive skips what it cannot or must not resume, and says so', () => {
  withFakeClaude(() => {
    const r = fleet();
    const state = readState(r.root);
    state.tasks.push({ ...state.tasks[0], id: 'demo/N1', branch: 'demo/n1', session: null, status: 'todo' });
    writeState(r.root, state);
    r.git('branch', 'demo/n1');
    rmSync(join(r.root, '.orchestra', 'worktrees', 'a2'), { recursive: true, force: true });
    const { code, out } = run(r.root, 'drive', 'demo/N1', 'demo/L1', 'demo/A2', '--for=0');
    assert.equal(code, 0, out);
    assert.match(out, /^skip: demo\/N1 — no session on the row; launch it \(step 8\)$/m);
    assert.match(out, /^skip: demo\/L1 — landed$/m);
    assert.match(out, /^skip: demo\/A2 — no worktree at .*a2; relaunch it \(step 8\)$/m);
    assert.match(out, /^nothing to drive$/m);
    assert.equal(existsSync(join(r.root, '.orchestra', 'drive')), false);
    assert.match(run(r.root, 'drive', 'demo/ZZ').out, /no such row\(s\) — demo\/ZZ/);
  });
});
