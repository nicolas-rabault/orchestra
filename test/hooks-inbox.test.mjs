// `hooks/orchestra-inbox.mjs` run as a real process. `test/relay.test.mjs` and `test/beat.test.mjs`
// already cover the pure logic this hook is built from; this file covers the wiring around it —
// which of the beat and the register decides, the identity comparison's own edge case, and the off
// switch that runs before either. `test/hooks-offswitch.test.mjs` covers the "no config" gate for
// this hook alongside the other six; it is not repeated here except for the "no inbox file" gate,
// which is specific to this hook.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers/fixture.mjs';
import { writeState, emptyState } from '../lib/register/state.mjs';
import { inboxPath } from '../lib/register/inbox.mjs';
import { writeBeat } from '../lib/register/beat.mjs';
import { relay } from '../lib/register/relay.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'orchestra-inbox.mjs');

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

function runHook(payload) {
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });
}

// One task row and one unconsumed answer on it — enough for `relay` to have something to say,
// which is what lets every test below tell "silent because nobody is the conductor" apart from
// "silent because there is nothing to relay".
function seedAnswer(r) {
  writeState(r.root, { ...emptyState(r.root), tasks: [{ id: 'demo/D1', branch: 'demo/d1', pending: [] }] });
  appendFileSync(
    inboxPath(r.root),
    `${JSON.stringify({ ts: '2026-09-05T10:00:00.000Z', task: 'demo/D1', pending: null, answer: 'ship it', from: 'monitor' })}\n`,
  );
}

test('no .orchestra/inbox.jsonl at all: silent', () => {
  const r = repo();
  writeState(r.root, { ...emptyState(r.root), conductor: { session: 'abcdef12', language: null, inboxSeen: null } });
  const res = runHook({ cwd: r.root, session_id: 'abcdef12-0000-0000-0000-000000000000' });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, '');
});

test('a live beat naming this session relays, even though the register names a DIFFERENT one', () => {
  const r = repo();
  const session = 'aaaaaaaa-1111-2222-3333-444444444444';
  seedAnswer(r);
  // The register alone would refuse this session — 'ffffffff' shares no prefix with it.
  writeState(r.root, {
    ...emptyState(r.root),
    conductor: { session: 'ffffffff', language: null, inboxSeen: null },
    tasks: [{ id: 'demo/D1', branch: 'demo/d1', pending: [] }],
  });
  writeBeat(r.root, { session, pid: process.pid, now: Date.now() });

  const res = runHook({ cwd: r.root, session_id: session });
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
  assert.match(res.stdout, /ship it/);
  // Both readers of the channel go through the same `relay`, so they cannot disagree.
  assert.equal(res.stdout, relay(r.root));
});

test('a live beat naming ANOTHER session is silent, even though the register would have matched', () => {
  const r = repo();
  const session = 'aaaaaaaa-1111-2222-3333-444444444444';
  seedAnswer(r);
  // The register alone would relay to this session — its prefix matches.
  writeState(r.root, {
    ...emptyState(r.root),
    conductor: { session: session.slice(0, 8), language: null, inboxSeen: null },
    tasks: [{ id: 'demo/D1', branch: 'demo/d1', pending: [] }],
  });
  // But a DIFFERENT session is holding the live beat, so it decides instead — the register never
  // gets asked while a beat is live.
  writeBeat(r.root, { session: 'bbbbbbbb-9999-8888-7777-666666666666', pid: process.pid, now: Date.now() });

  const res = runHook({ cwd: r.root, session_id: session });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, '');
});

test('no live beat: the register decides, and a matching session relays', () => {
  const r = repo();
  seedAnswer(r);
  writeState(r.root, {
    ...emptyState(r.root),
    conductor: { session: 'abcdef12', language: null, inboxSeen: null },
    tasks: [{ id: 'demo/D1', branch: 'demo/d1', pending: [] }],
  });
  const res = runHook({ cwd: r.root, session_id: 'abcdef12-0000-0000-0000-000000000000' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /ship it/);
  assert.equal(res.stdout, relay(r.root));
});

test('no live beat, and the register names a session that does not match: silent', () => {
  const r = repo();
  seedAnswer(r);
  writeState(r.root, {
    ...emptyState(r.root),
    conductor: { session: 'abcdef12', language: null, inboxSeen: null },
    tasks: [{ id: 'demo/D1', branch: 'demo/d1', pending: [] }],
  });
  const res = runHook({ cwd: r.root, session_id: 'ffffffff-0000-0000-0000-000000000000' });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, '');
});

// The identity check's own edge case: a short id under eight characters is never a match, even
// when the payload's session literally starts with it — the exact shape a truncated or garbled
// field would take.
test('a recorded session id under 8 characters is never a match', () => {
  const r = repo();
  seedAnswer(r);
  writeState(r.root, {
    ...emptyState(r.root),
    conductor: { session: 'ab', language: null, inboxSeen: null },
    tasks: [{ id: 'demo/D1', branch: 'demo/d1', pending: [] }],
  });
  const res = runHook({ cwd: r.root, session_id: 'ab000000-0000-0000-0000-000000000000' });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, '');
});

test('nothing unconsumed: the conductor is correctly identified but relay has nothing to say', () => {
  const r = repo();
  writeState(r.root, { ...emptyState(r.root), conductor: { session: 'abcdef12', language: null, inboxSeen: null } });
  // A real inbox file must exist to get past gate 2, but with no entries in it relay() returns ''.
  appendFileSync(inboxPath(r.root), '');
  const res = runHook({ cwd: r.root, session_id: 'abcdef12-0000-0000-0000-000000000000' });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, '');
});
