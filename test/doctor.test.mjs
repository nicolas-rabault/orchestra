// lib/cli/doctor.mjs: `doctorText` itself, called directly rather than through the CLI binary —
// the CLI-level doctor behaviour (defaults, briefExtra, offline/online wording) is already covered
// end-to-end in test/cli.test.mjs. This file is for what changed when the per-project monitor port
// was deleted: a config that still sets `monitor.port` is neither an error (nothing in `validate`
// checks it any more) nor silently ignored — `mergeInto` still copies it onto `cfg`, so `doctorText`
// warns about it explicitly rather than leaving a stale key nobody is ever told about.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo } from './helpers/fixture.mjs';
import { loadConfig, loadConfigOrThrow } from '../lib/config.mjs';
import { doctorText } from '../lib/cli/doctor.mjs';

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
  assert.match(text, /roadmaps\.local\s+\.orchestra\/roadmaps\s+\(default\)/);
  assert.match(text, /pr\.direction\s+\.orchestra\/direction\s+\(default\)/);
  r.cleanup();
});
