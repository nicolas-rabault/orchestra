import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideTick } from '../lib/register/tick.mjs';

test('a Claude timer cannot take over a Codex conductor', () => {
  const register = { conductor: { runtime: 'codex' }, tasks: [{ status: 'claimed' }] };
  assert.match(decideTick({ register }), /^skip.*codex/i);
  assert.match(decideTick({ register, runtime: 'codex' }), /^run/);
});

test('legacy projects retain Claude heartbeat behavior', () => {
  assert.match(decideTick({ register: { tasks: [{ status: 'claimed' }] } }), /^run/);
  assert.match(decideTick({ register: { conductor: { runtime: 'claude' }, tasks: [{ status: 'claimed' }] }, runtime: 'codex' }), /^skip/);
});

test('budget refusals are scoped to the runtime which incurred them', () => {
  const now = Date.now();
  const register = { conductor: { runtime: 'codex' }, tasks: [{ status: 'claimed' }],
    budgetResetAt: new Date(now + 3600000).toISOString(), budgetRuntime: 'claude' };
  assert.match(decideTick({ register, runtime: 'codex', now }), /^run/);
  assert.match(decideTick({ register: { ...register, budgetRuntime: 'codex' }, runtime: 'codex', now }), /^skip budget/);
});
