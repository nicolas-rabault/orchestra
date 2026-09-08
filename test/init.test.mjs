// `orchestra init` — the front door. `detect` is pure over a directory listing plus one
// `package.json` read, so it is tested against plain temporary directories with no git repository
// at all. `initProject` writes real files but never resolves a git checkout itself (the CLI layer,
// `initCommand`, does that): it too is tested against plain directories. Only the CLI-spawn tests
// at the bottom need a real repository, since `mainCheckout` requires one — those reuse
// `makeRepo` + removing `.orchestra/config.json`, `test/hooks-offswitch.test.mjs`'s own pattern for
// "a project with no config", rather than inventing a third way to build one.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers/fixture.mjs';
import { DEFAULTS } from '../lib/config.mjs';
import { detect, initProject, GITIGNORE } from '../lib/cli/init.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orchestra');

const dirs = [];
const tmpDir = () => { const d = mkdtempSync(join(tmpdir(), 'orchestra-init-')); dirs.push(d); return d; };
const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => {
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
  repos.forEach((r) => r.cleanup());
});

const pkg = (dir, scripts) => writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts }));

// ---------------------------------------------------------------------------------
// detect() — table-driven over five fixture shapes plus the empty one.
// ---------------------------------------------------------------------------------

test('detect: empty project — nothing found, both suite and branchTests missing', () => {
  const d = tmpDir();
  const det = detect(d);
  assert.equal(det.buildSystem, null);
  assert.equal(det.branchTests, null);
  assert.deepEqual(det.gates, []);
  assert.deepEqual(det.missing.sort(), ['branchTests', 'suite']);
  // Proposed unconditionally, at the tickets ledger's own default path — never "detected", and
  // never missing.
  assert.deepEqual(det.ledgers, [DEFAULTS.tickets.file]);
});

test('detect: npm with a knip script — the cheap gate goes before suite, branchTests found', () => {
  const d = tmpDir();
  pkg(d, { test: 'vitest run', 'test:branch': 'vitest run --changed', knip: 'knip' });
  const det = detect(d);
  assert.equal(det.buildSystem, 'npm');
  assert.equal(det.branchTests, 'npm run test:branch');
  assert.deepEqual(det.gates, [
    { name: 'deadcode', cmd: 'npm run knip' },
    { name: 'suite', cmd: 'npm test' },
  ]);
  assert.deepEqual(det.missing, []);
});

test('detect: npm with a lint script but no knip — lint is the cheap gate, test:changed is branchTests', () => {
  const d = tmpDir();
  pkg(d, { test: 'jest', 'test:changed': 'jest -o', lint: 'eslint .' });
  const det = detect(d);
  assert.equal(det.buildSystem, 'npm');
  assert.equal(det.branchTests, 'npm run test:changed');
  assert.deepEqual(det.gates, [
    { name: 'lint', cmd: 'npm run lint' },
    { name: 'suite', cmd: 'npm test' },
  ]);
});

test('detect: npm with only a test script — suite found, branchTests and the cheap gate are not', () => {
  const d = tmpDir();
  pkg(d, { test: 'vitest run' });
  const det = detect(d);
  assert.equal(det.buildSystem, 'npm');
  assert.equal(det.branchTests, null);
  assert.deepEqual(det.gates, [{ name: 'suite', cmd: 'npm test' }]);
  assert.deepEqual(det.missing, ['branchTests']);
});

test('detect: Cargo.toml — cargo test proposed, branchTests missing', () => {
  const d = tmpDir();
  writeFileSync(join(d, 'Cargo.toml'), '[package]\nname = "demo"\n');
  const det = detect(d);
  assert.equal(det.buildSystem, 'cargo');
  assert.deepEqual(det.gates, [{ name: 'suite', cmd: 'cargo test' }]);
  assert.equal(det.branchTests, null);
  assert.deepEqual(det.missing, ['branchTests']);
});

test('detect: pyproject.toml — pytest proposed', () => {
  const d = tmpDir();
  writeFileSync(join(d, 'pyproject.toml'), '[project]\nname = "demo"\n');
  const det = detect(d);
  assert.equal(det.buildSystem, 'python');
  assert.deepEqual(det.gates, [{ name: 'suite', cmd: 'pytest' }]);
});

test('detect: go.mod — go test ./... proposed', () => {
  const d = tmpDir();
  writeFileSync(join(d, 'go.mod'), 'module example.com/demo\n\ngo 1.22\n');
  const det = detect(d);
  assert.equal(det.buildSystem, 'go');
  assert.deepEqual(det.gates, [{ name: 'suite', cmd: 'go test ./...' }]);
  assert.equal(det.branchTests, null);
  assert.deepEqual(det.missing, ['branchTests']);
});

test('detect: a Makefile with a test: target — make test proposed', () => {
  const d = tmpDir();
  writeFileSync(join(d, 'Makefile'), 'build:\n\techo building\n\ntest: build\n\techo testing\n');
  const det = detect(d);
  assert.equal(det.buildSystem, 'make');
  assert.deepEqual(det.gates, [{ name: 'suite', cmd: 'make test' }]);
});

test('detect: a Makefile with no test: target proposes nothing', () => {
  const d = tmpDir();
  writeFileSync(join(d, 'Makefile'), 'build:\n\techo building\n');
  const det = detect(d);
  assert.equal(det.buildSystem, null);
  assert.deepEqual(det.gates, []);
});

test('detect: package.json without a test script never blocks the next rule — Cargo.toml still wins', () => {
  const d = tmpDir();
  pkg(d, { build: 'tsc' });
  writeFileSync(join(d, 'Cargo.toml'), '[package]\nname = "demo"\n');
  const det = detect(d);
  assert.equal(det.buildSystem, 'cargo');
});

test('detect: npm takes priority when both package.json and Cargo.toml qualify', () => {
  const d = tmpDir();
  pkg(d, { test: 'vitest run' });
  writeFileSync(join(d, 'Cargo.toml'), '[package]\nname = "demo"\n');
  const det = detect(d);
  assert.equal(det.buildSystem, 'npm');
});

test('detect: a malformed package.json is read as absent, not thrown', () => {
  const d = tmpDir();
  writeFileSync(join(d, 'package.json'), '{ not json');
  assert.doesNotThrow(() => detect(d));
  assert.equal(detect(d).buildSystem, null);
});

// ---------------------------------------------------------------------------------
// initProject()
// ---------------------------------------------------------------------------------

test('initProject: refuses without a valid --mode, writes nothing', () => {
  const d = tmpDir();
  const report = initProject(d, {});
  assert.equal(report.ok, false);
  assert.equal(report.action, 'invalid');
  assert.match(report.message, /mode/);
  assert.equal(existsSync(join(d, '.orchestra')), false);
});

test('initProject: refuses an invalid mode string, writes nothing', () => {
  const d = tmpDir();
  const report = initProject(d, { mode: 'production' });
  assert.equal(report.ok, false);
  assert.equal(report.action, 'invalid');
  assert.equal(existsSync(join(d, '.orchestra')), false);
});

test('initProject: a mode containing a quote is refused cleanly, not a raw JSON.parse crash', () => {
  // Review round 1: `__MODE__` is substituted into templates/config.json's TEXT, inside a JSON
  // string literal, before that text is parsed — a mode holding a `"` used to corrupt the JSON and
  // surface `JSON.parse`'s own SyntaxError instead of `validate`'s clean refusal message.
  const d = tmpDir();
  assert.doesNotThrow(() => initProject(d, { mode: 'a"bad' }));
  const report = initProject(d, { mode: 'a"bad' });
  assert.equal(report.ok, false);
  assert.equal(report.action, 'invalid');
  assert.match(report.message, /"mode" is required and must be "online" or "offline"/);
  assert.equal(existsSync(join(d, '.orchestra')), false);
});

test('initProject: refuses to overwrite an existing config without --force, and touches nothing', () => {
  const d = tmpDir();
  mkdirSync(join(d, '.orchestra'));
  writeFileSync(join(d, '.orchestra', 'config.json'), '{"mode": "offline"}\n');
  const before = readFileSync(join(d, '.orchestra', 'config.json'), 'utf8');
  const report = initProject(d, { mode: 'online' });
  assert.equal(report.ok, false);
  assert.equal(report.action, 'exists');
  assert.match(report.message, /--force/);
  assert.equal(readFileSync(join(d, '.orchestra', 'config.json'), 'utf8'), before);
  assert.equal(existsSync(join(d, '.orchestra', '.gitignore')), false);
  assert.equal(existsSync(join(d, 'CLAUDE.md')), false);
});

test('initProject: --force overwrites an existing config', () => {
  const d = tmpDir();
  mkdirSync(join(d, '.orchestra'));
  writeFileSync(join(d, '.orchestra', 'config.json'), '{"mode": "offline"}\n');
  const report = initProject(d, { mode: 'online', force: true });
  assert.equal(report.ok, true);
  assert.equal(report.action, 'reinitialized');
  assert.equal(report.config.mode, 'online');
  assert.equal(JSON.parse(readFileSync(join(d, '.orchestra', 'config.json'), 'utf8')).mode, 'online');
});

test('initProject: a fresh project writes mode, the detected gates/branchTests, and the ledger', () => {
  const d = tmpDir();
  pkg(d, { test: 'vitest run', 'test:branch': 'vitest run --changed', knip: 'knip' });
  const report = initProject(d, { mode: 'offline' });
  assert.equal(report.ok, true);
  assert.equal(report.action, 'initialized');
  const written = JSON.parse(readFileSync(join(d, '.orchestra', 'config.json'), 'utf8'));
  assert.deepEqual(written, {
    mode: 'offline',
    ledgers: [DEFAULTS.tickets.file],
    gates: [{ name: 'deadcode', cmd: 'npm run knip' }, { name: 'suite', cmd: 'npm test' }],
    branchTests: 'npm run test:branch',
  });
  // Never a number `init` picked, and never written at all here (scope answer 5).
  assert.equal('monitor' in written, false);
  // What was written must itself validate — the config this command produces is a config
  // `orchestra doctor`/`loadConfigOrThrow` can load without complaint.
});

test('initProject: an empty project writes only mode and the ledger — nothing invented', () => {
  const d = tmpDir();
  const report = initProject(d, { mode: 'offline' });
  const written = JSON.parse(readFileSync(join(d, '.orchestra', 'config.json'), 'utf8'));
  assert.deepEqual(written, { mode: 'offline', ledgers: [DEFAULTS.tickets.file] });
  assert.equal('gates' in written, false);
  assert.equal('branchTests' in written, false);
});

test('initProject: writes .orchestra/.gitignore with exactly the paths the plugin creates, and nothing else', () => {
  const d = tmpDir();
  initProject(d, { mode: 'offline' });
  const text = readFileSync(join(d, '.orchestra', '.gitignore'), 'utf8');
  const lines = text.split('\n').filter(Boolean).filter((l) => !l.startsWith('#'));
  assert.deepEqual(lines, [
    'state.json', 'journal.jsonl', 'inbox.jsonl', 'archive.jsonl', 'conductor.beat.json',
    'tick.lock', '.queue.lock', 'drafts/', 'roadmaps/', 'worktrees/', 'images/', 'gate/', 'drive/', 'tick.sh',
    '*.log', '*.err', '*.tmp',
  ]);
  // Neither of the two committed paths under `.orchestra/` is ignored.
  assert.equal(lines.includes('config.json'), false);
  assert.equal(lines.includes('.gitignore'), false);
  assert.equal(lines.includes(DEFAULTS.tickets.file.replace('.orchestra/', '')), false);
  assert.equal(readFileSync(join(d, '.orchestra', '.gitignore'), 'utf8'), GITIGNORE);
});

test('initProject: the written .gitignore actually hides every real atomic-write scratch file, in a real repo', () => {
  // Review round 1: `state.json.<pid>.tmp` and `conductor.beat.json.<pid>.tmp` — the scratch files
  // `lib/register/state.mjs`'s `writeState` and `lib/register/beat.mjs`'s `writeBeat` rename
  // FROM — showed up as `??` in `git status` after an `init`, because the first cut of this list
  // named `.queue.lock` but not the wider class it belongs to. This reproduces the exact shape of
  // that failure — a real git repo, `init`, then the scratch names those two functions (and
  // `templates/tick.sh`'s own `tick.log.tmp` log-rotation line) actually use on disk — and proves
  // `git status` now reports nothing.
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  initProject(r.root, { mode: 'offline' });
  // CLAUDE.md is also new here (`init` created it) — real and expected to show up in `git status`
  // until a human commits it; committing it in this fixture keeps the assertion below about the
  // scratch files under `.orchestra/`, not about CLAUDE.md's own tracked state.
  r.git('add', '.orchestra/config.json', '.orchestra/.gitignore', 'CLAUDE.md');
  r.git('commit', '-q', '-m', 'opt in');

  writeFileSync(join(r.root, '.orchestra', 'state.json.12345.tmp'), '{}');
  writeFileSync(join(r.root, '.orchestra', 'conductor.beat.json.6789.tmp'), '{}');
  writeFileSync(join(r.root, '.orchestra', 'tick.log.tmp'), 'log rotation in flight\n');
  // A published roadmap belongs to the same class: `publish` writes it and never commits it, so
  // the ignore line is the only thing keeping it out of somebody else's next commit.
  mkdirSync(join(r.root, '.orchestra', 'roadmaps'));
  writeFileSync(join(r.root, '.orchestra', 'roadmaps', 'demo.md'), '---\nroadmap: demo\n---\n');
  mkdirSync(join(r.root, '.orchestra', '.queue.lock'));
  writeFileSync(join(r.root, '.orchestra', '.queue.lock', 'pid'), '99999');

  const status = r.git('status', '--porcelain');
  assert.equal(status.trim(), '', `expected git status to report nothing untracked, got:\n${status}`);
});

test('initProject: creates CLAUDE.md when none exists', () => {
  const d = tmpDir();
  const report = initProject(d, { mode: 'offline' });
  assert.equal(report.claude.action, 'created');
  const text = readFileSync(join(d, 'CLAUDE.md'), 'utf8');
  assert.match(text, /<!-- orchestra:claude-rules -->/);
  assert.match(text, /merge_agent/);
});

test('initProject: running again (--force) does not duplicate the CLAUDE.md block', () => {
  const d = tmpDir();
  initProject(d, { mode: 'offline' });
  const once = readFileSync(join(d, 'CLAUDE.md'), 'utf8');
  const report = initProject(d, { mode: 'offline', force: true });
  assert.equal(report.claude.action, 'unchanged');
  const twice = readFileSync(join(d, 'CLAUDE.md'), 'utf8');
  assert.equal(twice, once);
  assert.equal(twice.match(/<!-- orchestra:claude-rules -->/g).length, 1);
});

test('initProject: appends to a pre-existing CLAUDE.md rather than replacing it, then does not duplicate on a second run', () => {
  const d = tmpDir();
  writeFileSync(join(d, 'CLAUDE.md'), '# My project\n\nSome existing rules here.\n');
  const first = initProject(d, { mode: 'offline' });
  assert.equal(first.claude.action, 'appended');
  const afterFirst = readFileSync(join(d, 'CLAUDE.md'), 'utf8');
  assert.match(afterFirst, /# My project/);
  assert.match(afterFirst, /Some existing rules here/);
  assert.match(afterFirst, /<!-- orchestra:claude-rules -->/);

  const second = initProject(d, { mode: 'offline', force: true });
  assert.equal(second.claude.action, 'unchanged');
  assert.equal(readFileSync(join(d, 'CLAUDE.md'), 'utf8'), afterFirst);
  assert.equal(afterFirst.match(/<!-- orchestra:claude-rules -->/g).length, 1);
});

test('initProject: a CLAUDE.md carrying the marker line but not the rules underneath it still gets them', () => {
  // Review round 1: the marker alone used to be read as "the block is already here", so a
  // CLAUDE.md where the rules were edited or truncated but the marker line survived was reported
  // `unchanged` forever and never actually received them. The fix checks for the block itself.
  const d = tmpDir();
  writeFileSync(join(d, 'CLAUDE.md'), '<!-- orchestra:claude-rules -->\n(someone deleted the rest)\n');
  const report = initProject(d, { mode: 'offline' });
  assert.equal(report.claude.action, 'appended');
  const text = readFileSync(join(d, 'CLAUDE.md'), 'utf8');
  assert.match(text, /\(someone deleted the rest\)/);
  assert.match(text, /rerere\.enabled true/);
  assert.match(text, /merge_agent/);

  // Now that the full, current block is actually present, a second run reports unchanged.
  const second = initProject(d, { mode: 'offline', force: true });
  assert.equal(second.claude.action, 'unchanged');
  assert.equal(readFileSync(join(d, 'CLAUDE.md'), 'utf8'), text);
});

// ---------------------------------------------------------------------------------
// The CLI, spawned for real — `bin/orchestra init`. `init` is `machine: true`, so every case here
// runs in a project with no config at all except the `--force` one, which needs an existing config
// to overwrite.
// ---------------------------------------------------------------------------------

function run(cwd, ...args) {
  return spawnSync('node', [BIN, ...args], { cwd, encoding: 'utf8' });
}

test('CLI: bare `init` answers with usage and what it detects, exits 0, writes nothing', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  const res = run(r.root, 'init');
  assert.equal(res.status, 0);
  assert.match(res.stdout, /usage: orchestra init/);
  assert.match(res.stdout, /--detect/);
  assert.equal(existsSync(join(r.root, '.orchestra', 'config.json')), false);
});

test('CLI: `init --detect --json` reports without writing', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  const res = run(r.root, 'init', '--detect', '--json');
  assert.equal(res.status, 0);
  const det = JSON.parse(res.stdout);
  assert.deepEqual(Object.keys(det).sort(), ['branchTests', 'buildSystem', 'gates', 'ledgers', 'missing'].sort());
  assert.equal(existsSync(join(r.root, '.orchestra', 'config.json')), false);
});

test('CLI: `init --mode offline` writes a config and prints the two steps it cannot take', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  const res = run(r.root, 'init', '--mode', 'offline');
  assert.equal(res.status, 0);
  assert.match(res.stdout, /orchestra init: wrote/);
  assert.match(res.stdout, /install-heartbeat/);
  assert.match(res.stdout, /dangerously-skip-permissions/);
  assert.equal(JSON.parse(readFileSync(join(r.root, '.orchestra', 'config.json'), 'utf8')).mode, 'offline');
  // `orchestra doctor` now answers as a fully opted-in project.
  const doc = run(r.root, 'doctor');
  assert.match(doc.stdout, /mode\s+offline/);
});

test('CLI: `init --mode offline` a second time refuses without --force', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  run(r.root, 'init', '--mode', 'offline');
  const res = run(r.root, 'init', '--mode', 'offline');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /already exists/);
  assert.match(res.stderr, /--force/);
});

test('CLI: `init --mode online --force` overwrites', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  run(r.root, 'init', '--mode', 'offline');
  const res = run(r.root, 'init', '--mode', 'online', '--force');
  assert.equal(res.status, 0);
  assert.equal(JSON.parse(readFileSync(join(r.root, '.orchestra', 'config.json'), 'utf8')).mode, 'online');
});

test('CLI: `init --mode nonsense` refuses — an invalid mode value, never silently accepted', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  const res = run(r.root, 'init', '--mode', 'nonsense');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /"mode"/);
});

test('CLI: `init --mode <value with a quote>` refuses cleanly, no raw JSON.parse SyntaxError on stderr', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  const res = run(r.root, 'init', '--mode', 'a"bad');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /"mode" is required and must be "online" or "offline"/);
  assert.doesNotMatch(res.stderr, /SyntaxError/);
  assert.equal(existsSync(join(r.root, '.orchestra', 'config.json')), false);
});
