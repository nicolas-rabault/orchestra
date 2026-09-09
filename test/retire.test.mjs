// `orchestra retire` — the hand-over, end to end, against a fake `claude` and a built transcript.
//
// What must be true of it, and what each test below pins: it refuses every case where a hand-over
// would lose work or cost more than it saves; it writes the note BEFORE it stops anything; and it
// leaves a state the ordinary tick knows how to finish, rather than launching a replacement through
// a second launch path.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo, ROADMAP } from './helpers/fixture.mjs';
import { withFakeClaude } from './helpers/claude.mjs';
import { readState, writeState, emptyState } from '../lib/register/state.mjs';
import { loadConfig } from '../lib/config.mjs';
import { retireCommand } from '../lib/cli/retire.mjs';
import { WRAP_UP, noteFrom } from '../lib/register/retire.mjs';
import { journalPath } from '../lib/register/journal.mjs';

const SESSION = 'aaaaaaaa-1111-2222-3333-444444444444';
const NOTE = [
  'DONE: the parser lands, committed as 9f2a1c.',
  'NEXT: wire it into arena/cli.py, at the `--verify` flag.',
  'FILES: arena/parse.py is finished, do not re-read it. arena/cli.py is where you work.',
  'TRAPS: `uv run pytest -q` needs colima up first.',
].join('\n');

const junk = [];
after(() => junk.forEach((d) => rmSync(d, { recursive: true, force: true })));

// A project with one claimed row, a worktree for its branch, and a transcript for its session whose
// prefix is over the threshold.
function project({ prefix = 400000, boot = 34000, requests = 200, status = 'claimed', pending = [] } = {}) {
  const r = makeRepo({ mode: 'offline' });
  junk.push(r.root);
  // Published, not merely registered: every register row comes from a published roadmap, and
  // `orchestra brief` — which is what a relaunch runs — reads the row from the store.
  mkdirSync(join(r.root, '.orchestra', 'roadmaps'), { recursive: true });
  writeFileSync(join(r.root, '.orchestra', 'roadmaps', 'demo.md'), ROADMAP);
  const branch = 'demo/d1-first-thing';
  r.git('worktree', 'add', '-q', join(r.root, '.orchestra', 'worktrees', 'demo-d1'), '-b', branch);
  writeState(r.root, {
    ...emptyState(r.root),
    tasks: [{
      id: 'demo/D1', branch, status, session: SESSION, sessionName: 'orchestra-abc123-demo-d1',
      deps: [], subjects: [], pending, note: '',
    }],
  });
  // The transcript, under a throwaway CLAUDE_CONFIG_DIR this test points the process at.
  const home = mkdtempSync(join(tmpdir(), 'orchestra-claude-'));
  junk.push(home);
  mkdirSync(join(home, 'projects', 'p'), { recursive: true });
  const req = (n) => JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 0, cache_read_input_tokens: n, output_tokens: 10 } } });
  const lines = [req(boot), ...Array.from({ length: requests - 2 }, () => req(Math.round((boot + prefix) / 2))), req(prefix)];
  writeFileSync(join(home, 'projects', 'p', `${SESSION}.jsonl`), `${lines.join('\n')}\n`);
  return { ...r, branch, home, cfg: loadConfig(r.root) };
}

// `retireCommand` writes to stdout; the suites that read output capture it the same way.
function capture(fn) {
  const real = process.stdout.write.bind(process.stdout);
  let text = '';
  process.stdout.write = (c) => { text += c; return true; };
  try { fn(); } finally { process.stdout.write = real; }
  return text;
}

// The command signals a partial outcome through `process.exitCode` (the no-note path exits 1, a
// wrap-up still running exits 12), and this process INHERITS it — a suite that left it set reported
// every test passing and the file failing. So it is captured, restored, and returned: the exit code
// is part of what each case below asserts.
function retire(p, args = ['demo/D1'], fake) {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  const savedExit = process.exitCode;
  process.env.CLAUDE_CONFIG_DIR = p.home;
  try {
    process.exitCode = 0;
    const text = capture(() => retireCommand({ cfg: p.cfg, args }));
    return { text, exit: process.exitCode ?? 0 };
  } finally {
    process.exitCode = savedExit;
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved;
  }
}

// ---- the note ----------------------------------------------------------------------------------

test('the note is found by its first heading, not by taking the tail of the log', () => {
  const log = `some tool output\nmore output\n${NOTE}\n`;
  assert.equal(noteFrom(log), NOTE);
});

test('a wrap-up that ignored the shape produces no note at all', () => {
  assert.equal(noteFrom('I have committed everything. Goodbye!'), null);
  assert.equal(noteFrom(''), null);
  assert.equal(noteFrom(null), null);
});

test('the wrap-up asks for the four headings, and says why the note must be short', () => {
  for (const h of ['DONE:', 'NEXT:', 'FILES:', 'TRAPS:']) assert.ok(WRAP_UP.includes(h), h);
  assert.match(WRAP_UP, /COMMIT everything/);
  assert.match(WRAP_UP, /the less your replacement has to re-read/);
});

// ---- the refusals ------------------------------------------------------------------------------

test('a row below the threshold is refused, and nothing is touched', () => {
  const p = project({ prefix: 120000 });
  withFakeClaude(() => {
    assert.throws(() => retire(p), /not retirable — below/);
  });
  assert.equal(readState(p.root).tasks[0].session, SESSION, 'the session is untouched');
});

test('a row mid-question is refused — the answer is coming back to that session', () => {
  const p = project({ pending: [{ id: 'd1-design-1', ask: 'which way?' }] });
  withFakeClaude(() => { assert.throws(() => retire(p), /not retirable — asked/); });
});

test('a row waiting on the gate is refused — its worker has already finished', () => {
  const p = project({ status: 'review' });
  withFakeClaude(() => { assert.throws(() => retire(p), /not retirable — waiting-on-the-gate/); });
});

test('an unmeasurable session is refused rather than retired on a guess', () => {
  const p = project();
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'orchestra-empty-'));
  junk.push(process.env.CLAUDE_CONFIG_DIR);
  try {
    withFakeClaude(() => {
      assert.throws(() => capture(() => retireCommand({ cfg: p.cfg, args: ['demo/D1'] })), /not retirable — unmeasured/);
    });
  } finally { if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved; }
});

test('an unknown row and a missing key are named, not guessed at', () => {
  const p = project();
  withFakeClaude(() => {
    assert.throws(() => retire(p, ['demo/NOPE']), /no row demo\/NOPE/);
    assert.throws(() => retire(p, []), /needs a task key/);
  });
});

// ---- the hand-over -----------------------------------------------------------------------------

test('a grown row is wrapped up, its note written, its session cleared and stopped', () => {
  const p = project({ prefix: 400000, requests: 200 });
  const { text, exit } = withFakeClaude((fake) => {
    fake.answer(NOTE);
    return retire(p, ['demo/D1', '--for=60'], fake);
  });
  assert.equal(exit, 0, 'a completed hand-over exits clean');
  assert.match(text, /retiring: demo\/D1 — prefix 400k over 200 requests/);
  assert.match(text, /retired: demo\/D1 — note on the row \(4 lines\)/);
  assert.match(text, /orchestra brief demo\/D1 --handover 200/);

  const row = readState(p.root).tasks[0];
  assert.equal(row.note, NOTE, 'the note is on the row, verbatim');
  assert.equal(row.session, null, 'the session is cleared — that is what makes ready report a relaunch');
  assert.equal(row.sessionName, 'orchestra-abc123-demo-d1', 'the name is KEPT: the replacement is given it again');
  assert.equal(row.turns, 200);
  assert.equal(row.retiredFrom.session, SESSION);
  assert.equal(row.retiredFrom.prefix, 400000);
  assert.ok(row.retiredAt, 'the row records when');
  assert.equal(row.status, 'claimed', 'the row is still live — only its worker has gone');
});

test('the wrap-up prompt the worker actually receives is the plugin\'s own, not a typed nudge', () => {
  const p = project();
  withFakeClaude((fake) => {
    fake.answer(NOTE);
    retire(p, ['demo/D1', '--for=60'], fake);
    assert.equal(fake.prompt(SESSION), WRAP_UP);
  });
});

test('the retirement is journalled with what it measured', () => {
  const p = project({ prefix: 400000, requests: 200 });
  withFakeClaude((fake) => { fake.answer(NOTE); retire(p, ['demo/D1', '--for=60'], fake); });
  const lines = readFileSync(journalPath(p.root), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const entry = lines.find((l) => l.task === 'demo/D1' && /Retired at/.test(l.text));
  assert.ok(entry, 'a retirement leaves a journal line');
  assert.match(entry.text, /Retired at 200 requests and a 400k prefix/);
});

// The failure that must not lose work: the worker did not produce a note. Retiring anyway would
// hand the replacement nothing to continue from, which is the expensive kind of hand-over.
test('a wrap-up with no note retires NOTHING and says so', () => {
  const p = project();
  const { text, exit } = withFakeClaude((fake) => {
    fake.answer('All committed. Bye.');
    return retire(p, ['demo/D1', '--for=60'], fake);
  });
  assert.equal(exit, 1, 'a hand-over that produced no note is not a success');
  assert.match(text, /NOT retired: demo\/D1 — the wrap-up turn produced no note/);
  const row = readState(p.root).tasks[0];
  assert.equal(row.session, SESSION, 'its session still holds the work');
  assert.equal(row.note, '', 'nothing was written');
});

test('the wrap-up log gets its own slug, so it never overwrites the row\'s last drive log', () => {
  const p = project();
  withFakeClaude((fake) => { fake.answer(NOTE); retire(p, ['demo/D1', '--for=60'], fake); });
  assert.ok(existsSync(join(p.root, '.orchestra', 'drive', 'retire-demo-d1.out')));
  assert.ok(!existsSync(join(p.root, '.orchestra', 'drive', 'demo-d1.out')));
});

// The whole point of clearing the session rather than launching a replacement here: the retirement
// finishes through the launch path the protocol already has. This test is the seam between the two
// halves, and it is the one that would break silently if either end changed.
test('a retired row is reported by ready as RELAUNCH, and brief --handover picks up its note', () => {
  const p = project({ prefix: 400000, requests: 200 });
  withFakeClaude((fake) => { fake.answer(NOTE); retire(p, ['demo/D1', '--for=60'], fake); });

  const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orchestra');
  const run = (args) => execFileSync(process.execPath, [BIN, ...args], { cwd: p.root, encoding: 'utf8' });

  const ready = run(['ready']);
  assert.match(ready, /RELAUNCH: demo\/D1 \[claimed\] — the branch is there and no session is/);
  assert.match(ready, /its note: DONE: the parser lands/);
  assert.match(ready, /orchestra brief demo\/D1 --handover 200/);
  assert.match(ready, /relaunch: 1 live row\(s\) with no session — demo\/D1/);

  // And the brief that relaunch names carries the note the wrap-up produced.
  const brief = run(['brief', 'demo/D1', '--handover', '200']);
  assert.match(brief, /took this task to 200 turns and was retired to drop its accumulated context/);
  assert.match(brief, /Its note: DONE: the parser lands/);
  assert.match(brief, /do not re-read files the note tells you are already done/);
});
