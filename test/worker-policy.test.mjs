import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workerSelection, workerRole } from '../lib/register/workerPolicy.mjs';
import { validate } from '../lib/config.mjs';
import { planLaunches, computeReadySet } from '../lib/register/ready.mjs';

test('one model policy for qualified and parsed task identities, both engines', () => {
  assert.equal(workerRole({ id: 'pr/PR12' }), 'review');
  assert.equal(workerRole({ roadmap: 'pr', id: 'PR12' }), 'review');
  assert.equal(workerRole({ roadmap: 'other', id: 'PR12' }), 'execution');
  assert.equal(workerSelection({}, { id: 'a/A' }, 'claude').model, 'sonnet');
  assert.equal(workerSelection({}, { design: true }, 'claude').model, 'opus');
  assert.deepEqual(workerSelection({}, {}, 'codex'), { role: 'execution', model: null, thinking: null });
  const cfg = { workerModels: { codexExecution: 'chosen-model', claudeReview: 'haiku' }, workerThinking: { codexExecution: 'low' } };
  assert.equal(workerSelection(cfg, {}, 'codex').model, 'chosen-model');
  assert.equal(workerSelection(cfg, {}, 'codex').thinking, 'low');
  assert.equal(workerSelection(cfg, { id: 'pr/PR12' }, 'claude').model, 'haiku');
  assert.equal(planLaunches([{ id: 'x/A' }], 0, 1, { ...cfg, conductorRuntime: 'codex' })[0].model, 'chosen-model');
});

test('invalid model and budget configuration fails before dispatch', () => {
  for (const config of [
    { maxAutoResumes: -1 }, { maxAutoResumes: 1.5 }, { maxAutoResumes: '3' },
    { workerModels: { typo: 'sonnet' } }, { workerModels: { claudeExecution: '' } },
    { workerThinking: { codexExecution: 'infinite' } },
  ]) assert.ok(validate({ mode: 'offline', ...config }).length, JSON.stringify(config));
});

test('equal orders use task keys for stable scheduling independent of store order', () => {
 const rows = ['x/B', 'x/A'].map(id => ({ id, order: 1, deps: [], status: 'todo' }));
 assert.deepEqual(computeReadySet(rows, {}).ready.map(r => r.id), ['x/A', 'x/B']);
});

test('a disappeared branch cannot bypass the task budget through the new-launch path', () => {
 const spent = { id: 'x/A', status: 'todo', autoResumes: 3 };
 assert.deepEqual(planLaunches([spent], 0, 1), []);
 assert.equal(planLaunches([{ id: 'x/new' }], 0, 1, { maxAutoResumes: 0 }).length, 1);
 assert.equal(planLaunches([spent, { id: 'x/B' }], 0, 1)[0].id, 'x/B');
});
