import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers/fixture.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orchestra');
const repos = [];
const repo = (opts) => { const r = makeRepo(opts); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

const run = (cwd, ...args) => {
  const r = execFileSync('node', [BIN, ...args], { cwd, encoding: 'utf8' });
  return r;
};

test('a subcommand in a project with no config exits 0 and prints nothing', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  assert.equal(run(r.root, 'roadmap', 'board'), '');
});

test('doctor answers even with no config', () => {
  const r = repo();
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  assert.match(run(r.root, 'doctor'), /no \.orchestra\/config\.json/);
});

test('doctor names the mode, the id and every defaulted key', () => {
  const r = repo({ mode: 'offline', name: 'demo' });
  const out = run(r.root, 'doctor');
  assert.match(out, /mode\s+offline/);
  assert.match(out, /name\s+demo/);
  assert.match(out, /[0-9a-f]{6}/);
  assert.match(out, /mainBranch.*\(default\)/);
});

// The spec says doctor "prints the resolved configuration and names every key that fell back to a
// default"; four keys were missing from the table — the three docs paths and briefExtra — so a
// project that had set one of them saw no row for it, and a project that had not was never told
// which directory the plugin would write a spec into.
test('doctor prints every config key, the docs paths and briefExtra included', () => {
  const r = repo({ mode: 'offline' });
  const out = run(r.root, 'doctor');
  assert.match(out, /docs\.specs\s+docs\/specs\s+\(default\)/);
  assert.match(out, /docs\.plans\s+docs\/plans\s+\(default\)/);
  assert.match(out, /docs\.results\s+docs\/results\s+\(default\)/);
  assert.match(out, /briefExtra\s+—\s+\(default\)/);
});

test('doctor shows a set briefExtra by its first line, not as a wall of prose', () => {
  const r = repo({ mode: 'offline', config: { briefExtra: 'Never touch the vendor tree.\nAnd run the linter.' } });
  const out = run(r.root, 'doctor');
  const line = out.split('\n').find((l) => l.includes('briefExtra'));
  assert.match(line, /Never touch the vendor tree\. …/);
  assert.doesNotMatch(line, /linter/);
});

test('doctor says what offline cannot answer', () => {
  const r = repo({ mode: 'offline' });
  assert.match(run(r.root, 'doctor'), /this machine only/i);
});

test('doctor does not say it in online mode', () => {
  const r = repo({ mode: 'online' });
  assert.doesNotMatch(run(r.root, 'doctor'), /this machine only/i);
});

test('an unknown subcommand exits non-zero and lists what exists', () => {
  const r = repo();
  assert.throws(
    () => execFileSync('node', [BIN, 'wat'], { cwd: r.root, encoding: 'utf8', stdio: 'pipe' }),
    (e) => e.status === 2 && /unknown subcommand "wat"/.test(e.stderr),
  );
});

test('doctor marks a nested default at the leaf, not the whole group', () => {
  const r = repo({ mode: 'offline', config: { roadmaps: { drafts: '.orchestra/wip' } } });
  const out = run(r.root, 'doctor');
  const draftsLine = out.split('\n').find((l) => l.includes('roadmaps.drafts'));
  const publishedLine = out.split('\n').find((l) => l.includes('roadmaps.published'));
  assert.match(publishedLine, /\(default\)/);
  assert.doesNotMatch(draftsLine, /\(default\)/);
});

test('a broken config surfaces through a non-machine subcommand as exit 2, not a silent off switch', () => {
  const r = repo();
  writeFileSync(join(r.root, '.orchestra', 'config.json'), JSON.stringify({ gates: [{}] }));
  assert.throws(
    () => execFileSync('node', [BIN, 'roadmap', 'board'], { cwd: r.root, encoding: 'utf8', stdio: 'pipe' }),
    (e) => e.status === 2 && /"mode" is required/.test(e.stderr) && /gates\[0\]/.test(e.stderr),
  );
});

test('doctor marks BOTH leaves of a nested default when the whole group is absent', () => {
  const r = repo({ mode: 'offline' });
  const out = run(r.root, 'doctor');
  const draftsLine = out.split('\n').find((l) => l.includes('roadmaps.drafts'));
  const publishedLine = out.split('\n').find((l) => l.includes('roadmaps.published'));
  assert.match(draftsLine, /\(default\)/);
  assert.match(publishedLine, /\(default\)/);
});
