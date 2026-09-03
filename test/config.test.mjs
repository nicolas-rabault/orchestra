import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  writeFileSync, mkdirSync, rmSync, mkdtempSync, realpathSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo } from './helpers/fixture.mjs';
import { DEFAULTS, findConfig, validate, loadConfig, loadConfigOrThrow } from '../lib/config.mjs';

const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

test('loadConfig returns null when there is no config — the off switch', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  assert.equal(loadConfig(r.root), null);
});

test('loadConfig fills every default and records which ones it filled', () => {
  const r = repo({ mode: 'offline', name: 'demo' });
  const cfg = loadConfig(r.root);
  assert.equal(cfg.mode, 'offline');
  assert.equal(cfg.name, 'demo');
  assert.equal(cfg.mainBranch, DEFAULTS.mainBranch);
  assert.equal(cfg.roadmaps.published, DEFAULTS.roadmaps.published);
  assert.equal(cfg.root, r.root);
  assert.match(cfg.id, /^[0-9a-f]{6}$/);
  assert.ok(cfg.defaulted.includes('mainBranch'));
  assert.ok(!cfg.defaulted.includes('mode'));
});

test('name defaults to the checkout directory name', () => {
  const r = repo();
  writeFileSync(join(r.root, '.orchestra', 'config.json'), JSON.stringify({ mode: 'offline' }));
  assert.equal(loadConfig(r.root).name, r.root.split('/').pop());
});

test('a nested object is merged key by key, not replaced wholesale', () => {
  const r = repo({ config: { roadmaps: { published: 'plans' } } });
  const cfg = loadConfig(r.root);
  assert.equal(cfg.roadmaps.published, 'plans');
  assert.equal(cfg.roadmaps.drafts, DEFAULTS.roadmaps.drafts);
});

test('findConfig walks up from a subdirectory', () => {
  const r = repo();
  const deep = join(r.root, 'a', 'b');
  mkdirSync(deep, { recursive: true });
  assert.equal(findConfig(deep), join(r.root, '.orchestra', 'config.json'));
});

// The walk had no repository boundary, so a repository nested under a directory somebody had
// configured read the OUTER project's config while `mainCheckout` resolved the inner repository:
// one config object whose `mode`, `roadmaps` and `gates` belong to one project and whose `root` and
// `id` belong to another. Not reachable in the default worktree layout, and permanent once it is.
test('findConfig stops at the repository, never returning a config from above it', () => {
  const outer = realpathSync(mkdtempSync(join(tmpdir(), 'orchestra-outer-')));
  try {
    mkdirSync(join(outer, '.orchestra'), { recursive: true });
    writeFileSync(join(outer, '.orchestra', 'config.json'), JSON.stringify({ mode: 'online' }));
    const inner = join(outer, 'inner');
    mkdirSync(inner, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: inner, stdio: 'ignore' });
    assert.equal(findConfig(inner), null);
    // And the off switch holds: no config for this project is no behaviour, not a throw.
    assert.equal(loadConfig(inner), null);
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test('validate rejects a missing or unknown mode', () => {
  assert.deepEqual(validate({}), ['config: "mode" is required and must be "online" or "offline"']);
  assert.deepEqual(validate({ mode: 'hybrid' }), ['config: "mode" is required and must be "online" or "offline"']);
  assert.deepEqual(validate({ mode: 'online' }), []);
});

test('validate rejects a gate with no name or no cmd, and duplicate gate names', () => {
  assert.deepEqual(validate({ mode: 'offline', gates: [{ cmd: 'x' }] }),
    ['config: gates[0] needs both "name" and "cmd"']);
  assert.deepEqual(validate({ mode: 'offline', gates: [{ name: 'a', cmd: 'x' }, { name: 'a', cmd: 'y' }] }),
    ['config: gate name "a" is used twice — a gate is named in its refusal, so names must be unique']);
});

test('validate rejects a port that is neither "auto" nor a usable number', () => {
  assert.deepEqual(validate({ mode: 'offline', monitor: { port: 80 } }),
    ['config: monitor.port must be "auto" or an integer between 1024 and 65535']);
  assert.deepEqual(validate({ mode: 'offline', monitor: { port: 'auto' } }), []);
  assert.deepEqual(validate({ mode: 'offline', monitor: { port: 4380 } }), []);
});

test('loadConfigOrThrow reports every error at once', () => {
  const r = repo();
  writeFileSync(join(r.root, '.orchestra', 'config.json'), JSON.stringify({ gates: [{}] }));
  assert.throws(() => loadConfigOrThrow(r.root), (e) =>
    e.message.includes('"mode" is required') && e.message.includes('gates[0]'));
});

test('an unparseable config is an error, never a silent off switch', () => {
  const r = repo();
  writeFileSync(join(r.root, '.orchestra', 'config.json'), '{ not json');
  assert.throws(() => loadConfig(r.root), /config\.json.*(JSON|parse)/i);
});

test('a non-object JSON value is an error, not a TypeError', () => {
  const r = repo();
  writeFileSync(join(r.root, '.orchestra', 'config.json'), 'null');
  assert.throws(() => loadConfig(r.root), (e) =>
    !(e instanceof TypeError) && e.message.includes('must contain a JSON object'));
  writeFileSync(join(r.root, '.orchestra', 'config.json'), '42');
  assert.throws(() => loadConfig(r.root), (e) =>
    !(e instanceof TypeError) && e.message.includes('must contain a JSON object'));
  writeFileSync(join(r.root, '.orchestra', 'config.json'), '[]');
  assert.throws(() => loadConfig(r.root), (e) =>
    !(e instanceof TypeError) && e.message.includes('must contain a JSON object'));
});

test('defaulted is leaf-grained: a nested default only marks the leaf actually left unset', () => {
  const r = repo({ config: { roadmaps: { drafts: '.orchestra/wip' } } });
  const cfg = loadConfig(r.root);
  assert.ok(cfg.defaulted.includes('roadmaps.published'));
  assert.ok(!cfg.defaulted.includes('roadmaps.drafts'));
});

// An object-valued default always contributes leaf entries, never its own bare name — an absent
// group is the COMMON case, and reporting it as one bare name would leave `doctor` marking neither
// of that group's rows as defaulted.
test('an entirely-absent nested group defaults BOTH its leaves, not its bare name', () => {
  const r = repo();
  const cfg = loadConfig(r.root);
  assert.ok(cfg.defaulted.includes('roadmaps.drafts'));
  assert.ok(cfg.defaulted.includes('roadmaps.published'));
  assert.ok(!cfg.defaulted.includes('roadmaps'));
});

// The five probes from review round 2: a well-shaped partial override, an absent group (both
// above), and three ways a group can be given the wrong shape.
test('a group replaced by an array does not crash and honestly defaults both leaves', () => {
  const r = repo();
  writeFileSync(join(r.root, '.orchestra', 'config.json'), JSON.stringify({ mode: 'offline', roadmaps: [1] }));
  const cfg = loadConfig(r.root);
  assert.ok(cfg.defaulted.includes('roadmaps.drafts'));
  assert.ok(cfg.defaulted.includes('roadmaps.published'));
});

test('a group replaced by a string does not crash loadConfig, and validate reports it by name', () => {
  const r = repo();
  writeFileSync(join(r.root, '.orchestra', 'config.json'), JSON.stringify({ mode: 'offline', roadmaps: 'oops' }));
  assert.doesNotThrow(() => loadConfig(r.root));
  assert.throws(() => loadConfigOrThrow(r.root), (e) => e.message.includes('"roadmaps"'));
});

test('a group replaced by null does not crash loadConfig, and validate reports it by name', () => {
  const r = repo();
  writeFileSync(join(r.root, '.orchestra', 'config.json'), JSON.stringify({ mode: 'offline', roadmaps: null }));
  assert.doesNotThrow(() => loadConfig(r.root));
  assert.throws(() => loadConfigOrThrow(r.root), (e) => e.message.includes('"roadmaps"'));
});
