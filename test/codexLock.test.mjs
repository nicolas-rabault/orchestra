import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquire, release, readHolder, holderIsDead, MAX_AGE_MS } from '../lib/register/lock.mjs';
const now = Date.now();
const noBeat = () => { throw new Error('Codex must not ask for a Claude beat'); };
test('two native conductors without beats cannot hold the same lease, and release checks identity', () => {
 const root = mkdtempSync(join(tmpdir(), 'orchestra-codex-lock-')); mkdirSync(join(root, '.orchestra'));
 try {
  const first = acquire(root, { kind: 'conductor', runtime: 'codex', session: 'native-one', now });
  assert.equal(first.ok, true); assert.equal(first.holder.runtime, 'codex');
  assert.equal(acquire(root, { kind: 'conductor', runtime: 'codex', session: 'native-two', now: now + 1, deps: { conductor: noBeat } }).ok, false);
  assert.equal(release(root, { kind: 'conductor', session: 'native-two' }), false);
  assert.equal(readHolder(root).session, 'native-one');
  assert.equal(release(root, { kind: 'conductor', session: 'native-one' }), true);
  assert.equal(acquire(root, { kind: 'conductor', runtime: 'codex', session: 'native-two', now: now + 2 }).ok, true);
 } finally { rmSync(root, { recursive: true, force: true }); }
});
test('native lease expires conservatively and stale owner cannot release replacement', () => {
 const root = mkdtempSync(join(tmpdir(), 'orchestra-codex-expiry-')); mkdirSync(join(root, '.orchestra'));
 try {
  acquire(root, { kind: 'conductor', runtime: 'codex', session: 'old', now });
  assert.equal(holderIsDead(root, readHolder(root), { now: now + MAX_AGE_MS, conductor: noBeat }), false);
  assert.equal(acquire(root, { kind: 'conductor', runtime: 'codex', session: 'new', now: now + MAX_AGE_MS + 1, deps: { conductor: noBeat } }).ok, true);
  assert.equal(release(root, { kind: 'conductor', session: 'old' }), false);
 } finally { rmSync(root, { recursive: true, force: true }); }
});
test('Claude liveness remains beat-based, and native acquire requires an identity', () => {
 const holder = { kind: 'conductor', session: 'claude', startedAt: new Date(now).toISOString() };
 assert.equal(holderIsDead('/unused', holder, { now, conductor: () => null }), true);
 assert.equal(holderIsDead('/unused', holder, { now, conductor: () => ({ session: 'claude', conducting: true }) }), false);
 assert.throws(() => acquire('/unused', { kind: 'conductor', runtime: 'codex' }), /session identity/);
 assert.throws(() => acquire('/unused', { kind: 'tick', session: 'id', runtime: 'codex' }), /kind conductor/);
});

test('CLI runtime flag persists native lease across separate command processes', async () => {
 const { spawnSync } = await import('node:child_process');
 const { makeRepo } = await import('./helpers/fixture.mjs');
 const { fileURLToPath } = await import('node:url');
 const repo = makeRepo();
 try {
  const bin = fileURLToPath(new URL('../bin/orchestra', import.meta.url));
  const run = (session) => spawnSync(process.execPath, [bin, 'lock', 'acquire', '--kind', 'conductor', '--runtime', 'codex', '--session', session], { cwd: repo.root, encoding: 'utf8' });
  const first = run('first'); assert.equal(first.status, 0, first.stderr);
  assert.equal(readHolder(repo.root).runtime, 'codex');
  const second = run('second'); assert.equal(second.status, 1, second.stderr); assert.match(second.stdout, /held by conductor first/);
 } finally { repo.cleanup(); }
});
