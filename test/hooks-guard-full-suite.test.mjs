// `hooks/guard-full-suite.mjs` run as the real process Claude Code spawns: JSON on stdin, judged
// on exit code and stderr. `test/guards-suite.test.mjs` already covers the pure decision
// (`bareSuiteRun`); this covers the wiring around it — reading `cfg.gates`, the off switch, and
// the two ways the override is read.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers/fixture.mjs';
import { hookEnv } from './helpers/hookEnv.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'guard-full-suite.mjs');

const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

// `hookEnv` and not a bare `process.env`: the ambient one carries ORCHESTRA_FULL_SUITE=1 when the
// suite runs inside a landing, which is this guard's own off switch.
function runHook(payload, env = {}) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8', env: hookEnv(env),
  });
}

const bashPayload = (cwd, command) => ({ cwd, tool_input: { command } });

test('a bare run of the configured suite gate is REFUSED', () => {
  const r = repo({ config: { gates: [{ name: 'suite', cmd: 'npm test' }] } });
  const res = runHook(bashPayload(r.root, 'npm test'));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /npm test/);
  assert.match(res.stderr, /ORCHESTRA_FULL_SUITE=1/);
});

test('a narrowed run is ALLOWED', () => {
  const r = repo({ config: { gates: [{ name: 'suite', cmd: 'npm test' }] } });
  const res = runHook(bashPayload(r.root, 'npm test tests/foo.test.js'));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

test('no gate named "suite" leaves this hook with nothing to guard', () => {
  const r = repo({ config: { gates: [{ name: 'lint', cmd: 'npm run lint' }] } });
  const res = runHook(bashPayload(r.root, 'npm test'));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

test('no gates configured at all is ALLOWED', () => {
  const r = repo();
  const res = runHook(bashPayload(r.root, 'npm test'));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

test('ORCHESTRA_FULL_SUITE=1 on the segment is ALLOWED', () => {
  const r = repo({ config: { gates: [{ name: 'suite', cmd: 'npm test' }] } });
  const res = runHook(bashPayload(r.root, 'ORCHESTRA_FULL_SUITE=1 npm test'));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

test("ORCHESTRA_FULL_SUITE=1 in the hook's own environment is ALLOWED", () => {
  const r = repo({ config: { gates: [{ name: 'suite', cmd: 'npm test' }] } });
  const res = runHook(bashPayload(r.root, 'npm test'), { ORCHESTRA_FULL_SUITE: '1' });
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

test('the refusal names cfg.branchTests when it is configured', () => {
  const r = repo({ config: { gates: [{ name: 'suite', cmd: 'npm test' }], branchTests: 'npm run test:branch' } });
  const res = runHook(bashPayload(r.root, 'npm test'));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /npm run test:branch/);
});

test('the refusal is honest when cfg.branchTests is null, never printing "null"', () => {
  const r = repo({ config: { gates: [{ name: 'suite', cmd: 'npm test' }] } });
  const res = runHook(bashPayload(r.root, 'npm test'));
  assert.equal(res.status, 2);
  assert.doesNotMatch(res.stderr, /\bnull\b/);
});

test('no .orchestra/config.json (outside any project): silent and exit 0', () => {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(bashPayload('/', 'npm test')), encoding: 'utf8',
  });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, '');
});
