// lib/cli/doctor.mjs: `doctorText` itself, called directly rather than through the CLI binary —
// the CLI-level doctor behaviour (defaults, briefExtra, offline/online wording) is already covered
// end-to-end in test/cli.test.mjs. This file is for what changed when the per-project monitor port
// was deleted: a config that still sets `monitor.port` is neither an error (nothing in `validate`
// checks it any more) nor silently ignored — `mergeInto` still copies it onto `cfg`, so `doctorText`
// warns about it explicitly rather than leaving a stale key nobody is ever told about.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo } from './helpers/fixture.mjs';
import { loadConfig, loadConfigOrThrow } from '../lib/config.mjs';
import { doctorText } from '../lib/cli/doctor.mjs';
import { initProject } from '../lib/cli/init.mjs';

const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

test('doctor warns about a monitor.port left in a config, because nothing reads it any more', () => {
  const r = repo({ name: 'legacy', config: { monitor: { port: 4500 } } });
  const out = doctorText(loadConfigOrThrow(r.root));
  // The old table row was `` `  ${pad('monitor.port', 20)} ${v}` ``, which pads the key out to 20
  // columns before the value — nine spaces before "4500" once the one literal space is added.
  // `^monitor\.port` alone would never match either shape (every line, table row or warning
  // sentence, starts with a two-space indent), so this asserts the TABULAR shape specifically: a
  // key padded by two or more spaces before a value, which only the deleted row ever produced. The
  // warning sentence below it has exactly one space after "monitor.port", so it does not trip this.
  assert.doesNotMatch(out, /^\s*monitor\.port\s{2,}\S/m);
  assert.match(out, /monitor\.port .*no longer/i);
  assert.match(out, /monitorPort/);
});

test('doctor says nothing about monitor.port when a config never set it', () => {
  const r = repo({ name: 'clean' });
  const out = doctorText(loadConfigOrThrow(r.root));
  assert.doesNotMatch(out, /monitor\.port/);
});

test('doctor prints the pull-request rows', () => {
  const r = repo({ mode: 'offline' });
  const text = doctorText(loadConfig(r.root));
  assert.match(text, /roadmaps\.published\s+\.orchestra\/roadmaps\s+\(default\)/);
  assert.match(text, /pr\.direction\s+\.orchestra\/direction\s+\(default\)/);
  r.cleanup();
});

test('doctor offline: the trace row is clean once init has run', () => {
  const r = repo();
  // `makeRepo`'s own initial commit already tracks `.orchestra/config.json` — the fixture is built
  // for tests that want a project mid-way through opting in, not a clean start. Untracking it here,
  // the same way Task 9's end-to-end test does, is what makes `initProject` below able to leave a
  // repository with nothing left for the tracked-path check to find.
  r.git('rm', '-q', '--cached', '-r', '--ignore-unmatch', '.orchestra');
  r.git('commit', '-q', '-m', 'clean start', '--allow-empty');
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  initProject(r.root, { mode: 'offline' });
  assert.match(doctorText(loadConfigOrThrow(r.root)), /trace\s+clean/);
});

test('doctor offline: a tracked path and a missing exclusion are both named', () => {
  const r = repo();                       // fixture commits .orchestra/config.json, excludes nothing
  const text = doctorText(loadConfigOrThrow(r.root));
  assert.match(text, /\/\.orchestra\/ is not excluded/);
  assert.match(text, /\.orchestra\/config\.json/);
});

test('doctor offline: a CLAUDE.md still carrying the rules block is named, with the fix', () => {
  const r = repo();
  // The flip-from-online case (Task 7): a committed CLAUDE.md that still has the marker the rules
  // template starts with. The probe does a substring test, not an exact-block match, so the marker
  // alone is enough to exercise it without pulling in the real template text.
  writeFileSync(join(r.root, 'CLAUDE.md'), '<!-- orchestra:claude-rules -->\nsome rules\n');
  const text = doctorText(loadConfigOrThrow(r.root));
  assert.match(text, /the rules block is still in .*CLAUDE\.md — remove it and commit the deletion/);
});

test('doctor offline: an unreadable CLAUDE.md degrades to a row, never a throw', () => {
  const r = repo();
  // A directory named CLAUDE.md: `existsSync` is true, so the probe does not skip it, but
  // `readFileSync` on a directory throws EISDIR on every platform regardless of uid — unlike
  // `chmod 0o000`, which a suite running as root silently ignores, proving nothing. `doctor`
  // reports, it never gates: this must return a string, not throw.
  mkdirSync(join(r.root, 'CLAUDE.md'));
  const text = doctorText(loadConfigOrThrow(r.root));
  assert.match(text, /trace/);
});

test('doctor online: no trace row', () => {
  const r = repo({ mode: 'online' });
  assert.doesNotMatch(doctorText(loadConfigOrThrow(r.root)), /trace/);
});

// `.orchestra/.gitignore` is written once by `init` and committed, so a release that adds a path
// under `.orchestra/` leaves every project that opted in before it exposed. Measured at 0.10.0:
// planetCraft had opted in at 0.8 and neither `tick.out` nor `tick.wake` was ignored there.
test('doctor names the paths a committed .gitignore no longer covers, and says nothing when it does', () => {
  const r = repo();
  initProject(r.root, { mode: 'online', force: true });
  const cfg = loadConfigOrThrow(r.root);
  const path = join(r.root, '.orchestra', '.gitignore');

  // Fresh from this version: nothing missing.
  assert.match(doctorText(cfg), /\.gitignore\s+covers every path this version writes/);

  // The file as an older version left it.
  const stale = readFileSync(path, 'utf8').split('\n').filter((l) => l !== 'tick.out' && l !== 'tick.wake');
  writeFileSync(path, stale.join('\n'));
  const text = doctorText(cfg);
  assert.match(text, /\.gitignore\s+2 path\(s\) this version writes are NOT ignored/);
  assert.match(text, /\n {4}tick\.out\n/);
  assert.match(text, /\n {4}tick\.wake\n/);
  assert.ok(text.includes(path));
});

// Offline projects have no such file — their whole `.orchestra/` is excluded through the clone's own
// info/exclude, which covers a new path the day it appears — so the row is absent rather than wrong.
test('doctor says nothing about a .gitignore an offline project deliberately does not have', () => {
  const r = repo();
  initProject(r.root, { mode: 'offline', force: true });
  assert.ok(!doctorText(loadConfigOrThrow(r.root)).includes('.gitignore'));
});

// The trace row's three original probes read the exclude file, the tracked paths whose own NAME
// says orchestra, and CLAUDE.md. None of them looks at a config key, so a project that repoints a
// path orchestra WRITES at a committed directory — measured in a real offline project on
// 2026-09-09: `roadmaps.published: docs/roadmaps`, fourteen roadmaps in the index — got a row
// reading "2 problem(s)" that named neither the directory nor the files.
test('doctor offline: a published-roadmaps directory git tracks is named, with the untracking', () => {
  const r = repo({ config: { roadmaps: { published: 'docs/roadmaps' } } });
  mkdirSync(join(r.root, 'docs', 'roadmaps'), { recursive: true });
  writeFileSync(join(r.root, 'docs', 'roadmaps', 'demo.md'), '# demo\n');
  r.git('add', '-A');
  r.git('commit', '-q', '-m', 'roadmaps');
  const text = doctorText(loadConfigOrThrow(r.root));
  assert.match(text, /git tracks 1 file\(s\) under roadmaps\.published \(docs\/roadmaps\)/);
  assert.match(text, /git rm --cached -r -- docs\/roadmaps/);
});

test('doctor offline: a written path git can still see is named before anything is tracked', () => {
  const r = repo({ config: { roadmaps: { published: 'docs/roadmaps' } } });
  const text = doctorText(loadConfigOrThrow(r.root));
  assert.match(text, /roadmaps\.published \(docs\/roadmaps\) is not excluded from this clone/);
});

test('doctor offline: a configured ledger is named — the gate commits it at every landing', () => {
  const r = repo({ config: { ledgers: ['.orchestra/tickets.jsonl'] } });
  const text = doctorText(loadConfigOrThrow(r.root));
  assert.match(text, /the merge gate commits \.orchestra\/tickets\.jsonl at every landing/);
});

test('doctor online: a committed roadmaps directory is not a problem — visibility is the point', () => {
  const r = repo({ mode: 'online', config: { roadmaps: { published: 'docs/roadmaps' } } });
  assert.doesNotMatch(doctorText(loadConfigOrThrow(r.root)), /is not excluded from this clone/);
});
