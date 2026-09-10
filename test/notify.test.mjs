import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { notifyConductor } from '../lib/register/notify.mjs';
const session = '01a08a8e-7713-71c1-803b-ce878c946267';
function fixture(t, conductor) {
  const root = mkdtempSync(join(tmpdir(), 'orchestra-notify-'));
  mkdirSync(join(root, '.orchestra'));
  writeFileSync(join(root, '.orchestra/state.json'), JSON.stringify({ tasks: [], conductor }));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
test('queues one wake to the existing local Codex conductor using arguments, not a shell', t => {
  const root = fixture(t, { runtime: 'codex', eventTransport: 'codex-queue', session });
  let calls = 0;
  assert.equal(notifyConductor(root, 'answer $(touch unwanted)', { run(cmd, args, options) {
    calls++; assert.equal(cmd, 'codex'); assert.deepEqual(args.slice(0, 3), ['queue', '--thread', session]);
    assert.ok(args[4].includes('answer $(touch unwanted)')); assert.equal(options.cwd, root); assert.equal(options.shell, undefined);
    return { status: 0 };
  } }), 'queued');
  assert.equal(calls, 1);
});
test('Claude and non-enabled Codex keep their existing watch without spawning', t => {
  for (const conductor of [{ session }, { runtime: 'claude', session }, { runtime: 'codex', session }]) {
    assert.equal(notifyConductor(fixture(t, conductor), 'answer', { run() { assert.fail('must not spawn'); } }), 'watch');
  }
});
test('invalid and remote identities never queue to a guessed local session', t => {
  for (const extra of [{ session: 'short' }, { session, hostId: 'remote' }]) {
    assert.equal(notifyConductor(fixture(t, { runtime: 'codex', eventTransport: 'codex-queue', ...extra }), 'answer', { run() { assert.fail('must not spawn'); } }), 'unavailable');
  }
});
test('queue errors remain unavailable, without claiming receipt or retrying', t => {
  const root = fixture(t, { runtime: 'codex', eventTransport: 'codex-queue', session });
  for (const result of [{ status: 1 }, { status: null, error: new Error('timeout') }]) {
    assert.equal(notifyConductor(root, 'answer', { run: () => result }), 'unavailable');
  }
});
