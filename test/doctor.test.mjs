// lib/cli/doctor.mjs: `doctorText` itself, called directly rather than through the CLI binary —
// the CLI-level doctor behaviour (defaults, briefExtra, offline/online wording) is already covered
// end-to-end in test/cli.test.mjs. This file is for what changed when the per-project monitor port
// was deleted: a config that still sets `monitor.port` is neither an error (nothing in `validate`
// checks it any more) nor silently ignored — `mergeInto` still copies it onto `cfg`, so `doctorText`
// warns about it explicitly rather than leaving a stale key nobody is ever told about.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo } from './helpers/fixture.mjs';
import { loadConfigOrThrow } from '../lib/config.mjs';
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
