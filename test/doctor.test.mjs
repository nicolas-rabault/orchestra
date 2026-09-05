// lib/cli/doctor.mjs: `doctorText` itself, called directly rather than through the CLI binary —
// the CLI-level doctor behaviour (defaults, briefExtra, offline/online wording) is already covered
// end-to-end in test/cli.test.mjs. This file is for what changed when the per-project monitor port
// was deleted: a config that still sets `monitor.port` is neither an error (nothing in `validate`
// checks it any more) nor silently ignored — `mergeInto` still copies it onto `cfg`, so `doctorText`
// warns about it explicitly rather than leaving a stale key nobody is ever told about.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo } from './helpers/fixture.mjs';
import { loadConfigOrThrow } from '../lib/config.mjs';
import { doctorText } from '../lib/cli/doctor.mjs';

const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

test('doctor warns about a monitor.port left in a config, because nothing reads it any more', () => {
  const r = repo({ name: 'legacy', config: { monitor: { port: 4500 } } });
  const out = doctorText(loadConfigOrThrow(r.root));
  assert.doesNotMatch(out, /^monitor\.port\s/m);
  assert.match(out, /monitor\.port .*no longer/i);
  assert.match(out, /monitorPort/);
});

test('doctor says nothing about monitor.port when a config never set it', () => {
  const r = repo({ name: 'clean' });
  const out = doctorText(loadConfigOrThrow(r.root));
  assert.doesNotMatch(out, /monitor\.port/);
});
