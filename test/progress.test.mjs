import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers/fixture.mjs';
import { emptyState, writeState, statePath } from '../lib/register/state.mjs';
import { journalPath } from '../lib/register/journal.mjs';
import { readJsonl } from '../lib/jsonl.mjs';
import { publishProgress } from '../lib/register/progress.mjs';
import { nudgeFor } from '../lib/register/drive.mjs';
const bin = fileURLToPath(new URL('../bin/orchestra', import.meta.url));
const fixture = () => {
 const repo = makeRepo();
 writeState(repo.root, { ...emptyState(repo.root), conductor: { runtime: 'codex', eventTransport: 'codex-queue' }, tasks: [{ id: 'demo/A', runtime: 'claude', status: 'claimed' }, { id: 'demo/B', runtime: 'codex', status: 'claimed' }] });
 return repo;
};

test('progress validates task and text before append and never changes register', () => {
 const repo = fixture();
 try {
  const path = statePath(repo.root); const before = readFileSync(path, 'utf8'); const mtime = statSync(path).mtimeMs;
  assert.throws(() => publishProgress(repo.root, 'demo/missing', 'working'), /no registered task/);
  assert.throws(() => publishProgress(repo.root, 'demo/A', ' \n'), /non-empty/);
  assert.equal(existsSync(journalPath(repo.root)), false);
  publishProgress(repo.root, 'demo/A', 'Vérification : 12 tests passent.\nSuite terminée.');
  const { entries, skipped } = readJsonl(journalPath(repo.root));
  assert.equal(skipped, 0); assert.equal(entries.length, 1);
  assert.deepEqual(Object.keys(entries[0]), ['ts', 'kind', 'task', 'text']);
  assert.equal(entries[0].kind, 'note'); assert.equal(entries[0].task, 'demo/A');
  assert.equal(entries[0].text, 'Vérification : 12 tests passent.\nSuite terminée.');
  assert.equal(readFileSync(path, 'utf8'), before); assert.equal(statSync(path).mtimeMs, mtime);
 } finally { repo.cleanup(); }
});

test('parallel worker CLI progress writes complete visible notes from both runtimes without conductor wakes', async () => {
 const repo = fixture();
 try {
  const before = readFileSync(statePath(repo.root), 'utf8');
  await Promise.all(Array.from({ length: 8 }, (_, i) => new Promise((resolve, reject) => {
   const child = spawn(process.execPath, [bin, 'progress', i % 2 ? 'demo/A' : 'demo/B', `Step ${i}: verified`], { cwd: repo.root, stdio: ['ignore', 'pipe', 'pipe'] });
   let error = ''; child.stderr.on('data', (chunk) => { error += chunk; });
   child.on('error', reject); child.on('close', (code) => code === 0 ? resolve() : reject(new Error(error)));
  })));
  const { entries, skipped } = readJsonl(journalPath(repo.root));
  assert.equal(skipped, 0); assert.equal(entries.length, 8);
  assert.equal(new Set(entries.map((e) => e.text)).size, 8);
  assert.ok(entries.every((e) => e.kind === 'note'));
  assert.equal(readFileSync(statePath(repo.root), 'utf8'), before);
  const invalid = spawnSync(process.execPath, [bin, 'progress', 'demo/A'], { cwd: repo.root, encoding: 'utf8' });
  assert.equal(invalid.status, 1); assert.match(invalid.stderr, /usage/);
 } finally { repo.cleanup(); }
});

test('resume nudges tell Claude and Codex workers to report meaningful progress while preserving relay', () => {
 for (const runtime of ['claude', 'codex']) {
  const prompt = nudgeFor({ id: 'demo/A', runtime, relay: { text: '  Keep this exact reply.\n' } });
  assert.ok(prompt.startsWith('  Keep this exact reply.\n'));
  assert.match(prompt, /orchestra progress demo\/A/);
  assert.match(prompt, /verification returns a result/);
  assert.match(prompt, /does not change state.json or wake the conductor/);
 }
});
