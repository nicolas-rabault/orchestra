// Which projects reach the page (spec §2). Under a temporary HOME, with real throwaway repositories.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfigOrThrow } from '../lib/config.mjs';
import { readInstances, recordInstance } from '../lib/machine.mjs';
import { discoverProjects } from '../lib/monitor/discover.mjs';
import { makeRepo } from './helpers/fixture.mjs';

const HOME = process.env.HOME;
const homes = [];
const repos = [];
beforeEach(() => { const h = mkdtempSync(join(tmpdir(), 'orchestra-home-')); homes.push(h); process.env.HOME = h; });
after(() => {
  process.env.HOME = HOME;
  homes.forEach((h) => rmSync(h, { recursive: true, force: true }));
  repos.forEach((r) => r.cleanup());
});

const repo = (name) => { const r = makeRepo({ name }); repos.push(r); return { ...r, cfg: loadConfigOrThrow(r.root) }; };
// What `orchestra ready` writes: the project side of an entry, with a live pid so `isLive` holds.
const enrol = (p) => recordInstance({ id: p.cfg.id, name: p.cfg.name, root: p.root, mode: 'offline', conductorPid: process.pid });

test('a registered project reaches the page from anywhere', () => {
  const a = repo('alpha');
  enrol(a);
  const found = discoverProjects({ cwd: tmpdir() });
  assert.deepEqual(found.map((p) => p.name), ['alpha']);
  assert.equal(found[0].root, a.root);
  assert.equal(found[0].id, a.cfg.id);
  assert.equal(found[0].mode, 'offline');
  assert.equal(found[0].cfg.root, a.root);
});

test('the current directory joins the set even when it has never registered, and is recorded', () => {
  const a = repo('alpha');
  assert.deepEqual(readInstances(), []);
  const found = discoverProjects({ cwd: a.root });
  assert.deepEqual(found.map((p) => p.name), ['alpha']);
  assert.equal(readInstances().find((e) => e.id === a.cfg.id).root, a.root);
});

test('the current directory is not added twice when it is already registered', () => {
  const a = repo('alpha');
  enrol(a);
  assert.equal(discoverProjects({ cwd: a.root }).length, 1);
});

test('a current directory with no config adds nothing and throws nothing', () => {
  const bare = mkdtempSync(join(tmpdir(), 'orchestra-bare-'));
  try {
    assert.deepEqual(discoverProjects({ cwd: bare }), []);
    assert.deepEqual(readInstances(), []);
  } finally { rmSync(bare, { recursive: true, force: true }); }
});

test('a registered project whose config has gone is DROPPED, and does not take the set down', () => {
  const a = repo('alpha');
  const b = repo('beta');
  enrol(a);
  enrol(b);
  rmSync(join(b.root, '.orchestra', 'config.json'));
  assert.deepEqual(discoverProjects({ cwd: tmpdir() }).map((p) => p.name), ['alpha']);
});

test('a registered project whose config is unparseable is dropped too', () => {
  const a = repo('alpha');
  const b = repo('beta');
  enrol(a);
  enrol(b);
  writeFileSync(join(b.root, '.orchestra', 'config.json'), '{ half written');
  assert.deepEqual(discoverProjects({ cwd: tmpdir() }).map((p) => p.name), ['alpha']);
});

test('the set is sorted by name, then by id', () => {
  const z = repo('zulu');
  const a = repo('alpha');
  enrol(z);
  enrol(a);
  assert.deepEqual(discoverProjects({ cwd: tmpdir() }).map((p) => p.name), ['alpha', 'zulu']);
});
