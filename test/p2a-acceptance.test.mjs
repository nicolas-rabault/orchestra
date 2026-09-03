// P2a's acceptance (spec §14). Driven through `bin/orchestra` wherever a subcommand exists, so what
// is asserted is what a user can type — not a set of functions that happen to compose in a test.
//
// THIS SUITE IS A PIN, NOT A PROOF. It is written after the code it exercises, so going green on
// the first run is the expected outcome and evidence of composition only — it shows the eleven
// pieces still fit together, not that any one of them is correct. The proofs are the per-task
// suites; each of those was watched failing against the code before that code existed. Read a green
// run here as "nothing broke the seam", never as "this was verified".
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo, ROADMAP } from './helpers/fixture.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orchestra');

const HOME = process.env.HOME;
const homes = [];
const repos = [];
beforeEach(() => { const h = mkdtempSync(join(tmpdir(), 'orchestra-home-')); homes.push(h); process.env.HOME = h; });
after(() => {
  process.env.HOME = HOME;
  homes.forEach((h) => rmSync(h, { recursive: true, force: true }));
  repos.forEach((r) => r.cleanup());
});

// A fixture with a published, enroled roadmap: the state P1 leaves and P2a starts from.
function project(name) {
  const r = makeRepo({ name });
  repos.push(r);
  mkdirSync(join(r.root, '.orchestra', 'drafts'), { recursive: true });
  writeFileSync(join(r.root, '.orchestra', 'drafts', 'demo.md'), ROADMAP);
  const run = (...args) => execFileSync(process.execPath, [BIN, ...args],
    { cwd: r.root, encoding: 'utf8', env: { ...process.env, HOME: process.env.HOME } });
  const statePath = join(r.root, '.orchestra', 'state.json');
  run('roadmap', 'publish');
  return {
    ...r,
    run,
    state: () => JSON.parse(readFileSync(statePath, 'utf8')),
    setState: (s) => writeFileSync(statePath, `${JSON.stringify(s, null, 2)}\n`),
  };
}

test('the fixture adopts, ticks and round-trips its register', () => {
  const p = project('acceptance');

  // Adopted: publishing enroled the roadmap's one task as a todo row that is mine.
  assert.deepEqual(p.state().tasks.map((t) => t.id), ['demo/D1']);
  assert.equal(p.state().tasks[0].mine, true);

  // The gate says there is work, and the plan names the launch.
  assert.match(p.run('tick-gate'), /^run hold-awake/);
  assert.match(p.run('ready'), /launch: demo\/D1 — First thing \[opus\] on demo\/d1-first-thing/);

  // Nobody holds the baton, so nothing hands back and the lock is free.
  assert.match(p.run('beat'), /nobody is holding the baton/);
  assert.match(p.run('yield-check'), /no live conductor beat/);
  assert.match(p.run('lock', 'acquire', '--kind', 'conductor', '--session', 's1'), /acquired/);
  assert.match(p.run('lock', 'holder'), /held by conductor s1/);

  // A tick writes to the journal, and the answer channel round-trips: nothing to say until an answer
  // is posted, then the question, the answer, and the instruction to stamp the cursor.
  p.run('journal', 'launch', 'demo/D1', 'started demo/D1');
  assert.match(readFileSync(join(p.root, '.orchestra', 'journal.jsonl'), 'utf8'), /"kind":"launch"/);
  assert.equal(p.run('inbox'), '');

  // Unambiguously PAST stamps. `pendingWaiting` compares `askedAt` against the real `Date.now()`
  // with a 30-minute floor, so a stamp dated today makes the WAITING assertion below depend on the
  // hour the suite happens to run — green after 09:30Z, red before it.
  const s = p.state();
  Object.assign(s.tasks[0], {
    status: 'claimed', session: 'abcdef12-0000', sessionName: 'orchestra-demo-D1',
    pending: [{ id: 'q1', kind: 'question', ask: 'Ship at 0.75 or 1.0?', askedAt: '2026-01-01T00:00:00.000Z' }],
  });
  p.setState(s);
  writeFileSync(join(p.root, '.orchestra', 'inbox.jsonl'),
    `${JSON.stringify({ ts: '2026-01-01T00:30:00.000Z', task: 'demo/D1', pending: 'q1', answer: '0.75' })}\n`);

  const relayed = p.run('inbox');
  assert.match(relayed, /Ship at 0\.75 or 1\.0\?/);
  assert.match(relayed, /the user's answer: "0\.75"/);
  assert.match(p.run('ready'), /WAITING: 1 item/);
  assert.match(p.run('tick-gate'), /^run/);

  // Stamping the cursor consumes it, and the same commands go quiet.
  const stamped = p.state();
  stamped.conductor.inboxSeen = '2026-01-01T00:30:00.000Z';
  stamped.tasks[0].pending = [];
  p.setState(stamped);
  assert.equal(p.run('inbox'), '');

  // The work lands, and the register empties into the archive while keeping what the guard needs.
  const landed = p.state();
  landed.tasks[0].status = 'landed';
  landed.tasks[0].subjects = ['feat: first thing'];
  p.setState(landed);
  assert.match(p.run('tick-gate'), /^skip nothing to do — 1 row\(s\)/);
  p.run('lock', 'release', '--kind', 'conductor', '--session', 's1');
  assert.match(p.run('archive', '--write'), /moved 1 line\(s\)/);
  assert.deepEqual(p.state().tasks, []);
  assert.equal(p.state().root, p.root);
  assert.match(readFileSync(join(p.root, '.orchestra', 'archive.jsonl'), 'utf8'), /"kind":"task"/);
});

test('two fixtures ticking together never exceed maxWorkers between them', () => {
  mkdirSync(join(process.env.HOME, '.orchestra'), { recursive: true });
  writeFileSync(join(process.env.HOME, '.orchestra', 'machine.json'), '{"maxWorkers":3}\n');

  const a = project('alpha');
  const b = project('beta');

  // A holds two workers: two claimed rows. `ready` reconciles a claim against git before it counts
  // it (`reconcileTasks` in lib/register/ready.mjs: "git is the only truth for claimed/landed", and
  // `test/ready.test.mjs`'s first test proves a claimed row with no matching ref returns to todo) —
  // so a register row alone is not enough; the branches it names must actually exist.
  const sa = a.state();
  const seed = sa.tasks[0];
  sa.tasks = [
    { ...seed, id: 'demo/A1', branch: 'a/1', status: 'claimed' },
    { ...seed, id: 'demo/A2', branch: 'a/2', status: 'claimed' },
    { ...seed, id: 'demo/A3', branch: 'a/3', status: 'todo' },
  ];
  a.setState(sa);
  a.git('branch', 'a/1');
  a.git('branch', 'a/2');
  a.run('ready');                      // publishes workers: 2 into the machine registry

  // B, alone, would plan its one task at a width of eight. With A holding two of three, it may not.
  const line = b.run('ready', '--width', '8');
  assert.match(line, /in flight: 0\/1 \(width 8, held down to 1: 2 of 3 worker\(s\) belong to other project\(s\)/);
  assert.match(line, /launch: demo\/D1/);

  // A third worker on A leaves B nothing, and B says so instead of launching anyway. Same rule: the
  // third branch must exist too, now that its row is claimed.
  const sa2 = a.state();
  sa2.tasks[2].status = 'claimed';
  a.setState(sa2);
  a.git('branch', 'a/3');
  a.run('ready');
  const held = b.run('ready', '--width', '8');
  assert.doesNotMatch(held, /launch:/);
  assert.match(held, /HELD: 1 task\(s\) are ready and this machine has no slot for them — 3 of 3 are held elsewhere/);

  // The registry knows exactly two projects and never more than maxWorkers between them.
  const reg = JSON.parse(readFileSync(join(process.env.HOME, '.orchestra', 'instances.json'), 'utf8'));
  assert.equal(reg.instances.length, 2);
  assert.ok(reg.instances.reduce((n, i) => n + i.workers, 0) <= 3);
});
