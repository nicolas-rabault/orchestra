import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo, ROADMAP } from './helpers/fixture.mjs';
import { loadConfigOrThrow, validate } from '../lib/config.mjs';
import { workerRuntime } from '../lib/register/runtime.mjs';
import { planLaunches } from '../lib/register/ready.mjs';
import { emptyState, writeState, readState } from '../lib/register/state.mjs';
const bin = fileURLToPath(new URL('../bin/orchestra', import.meta.url));
const run = (root, ...args) => spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8' });

test('roadmap runtime resolution inherits conductor while preserving existing legacy and native sessions', () => {
 const options = { roadmapRuntimes: { demo: 'claude', native: 'codex' }, conductorRuntime: 'codex' };
 assert.equal(workerRuntime({ id: 'demo/A' }, options), 'claude');
 assert.equal(workerRuntime({ id: 'other/A' }, options), 'codex');
 assert.equal(workerRuntime({ id: 'native/A', session: 'old' }, options), 'claude');
 assert.equal(workerRuntime({ id: 'demo/A', session: 'new', runtime: 'codex' }, options), 'codex');
 assert.equal(workerRuntime({ id: 'constructor/A' }), 'claude');
 assert.equal(workerRuntime({ id: 'x/A' }), 'claude');
 const plan = planLaunches([{ id: 'demo/A' }, { id: 'native/A', design: true }], 0, 2, options);
 assert.equal(plan[0].runtime, 'claude'); assert.equal(plan[0].model, 'opus');
 assert.equal(plan[1].runtime, 'codex'); assert.equal(plan[1].model, null);
});

test('configuration rejects malformed roadmap runtime mappings', () => {
 for (const roadmapRuntimes of [[], 'codex', { demo: 'typo' }, { 'bad/slug': 'codex' }, { demo: null }])
  assert.ok(validate({ mode: 'offline', roadmapRuntimes }).length);
 assert.deepEqual(validate({ mode: 'offline', roadmapRuntimes: { demo: 'codex' } }), []);
});

test('CLI assignment round-trips local configuration, changes future briefs, and leaves live sessions untouched', () => {
 const repo = makeRepo();
 try {
  mkdirSync(join(repo.root, '.orchestra', 'roadmaps'));
  writeFileSync(join(repo.root, '.orchestra', 'roadmaps', 'demo.md'), ROADMAP);
  const state = { ...emptyState(repo.root), conductor: { runtime: 'codex' }, tasks: [] };
  writeState(repo.root, state);
  let result = run(repo.root, 'roadmap', 'runtime', 'demo', 'claude');
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /claude \(assigned\)/);
  assert.equal(loadConfigOrThrow(repo.root).roadmapRuntimes.demo, 'claude');
  assert.deepEqual(readState(repo.root), state);
  assert.match(run(repo.root, 'brief', 'demo/D1').stdout, /Worker runtime: claude/);
  result = run(repo.root, 'roadmap', 'runtime', 'demo', 'inherit');
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /codex \(inherited\)/);
  assert.match(run(repo.root, 'brief', 'demo/D1').stdout, /Worker runtime: codex/);
  state.tasks.push({ id: 'demo/D1', session: 'legacy', runtime: 'claude' }); writeState(repo.root, state);
  assert.equal(run(repo.root, 'roadmap', 'runtime', 'demo', 'codex').status, 0);
  assert.match(run(repo.root, 'brief', 'demo/D1').stdout, /Worker runtime: claude/);
  assert.equal(readState(repo.root).tasks[0].runtime, 'claude');
  const before = readFileSync(join(repo.root, '.orchestra', 'config.json'), 'utf8');
  assert.equal(run(repo.root, 'roadmap', 'runtime', 'demo', 'wrong').status, 1);
  assert.equal(readFileSync(join(repo.root, '.orchestra', 'config.json'), 'utf8'), before);
  assert.match(run(repo.root, 'doctor').stdout, /demo=codex/);
 } finally { repo.cleanup(); }
});
