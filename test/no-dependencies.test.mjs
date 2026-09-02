// The invariant that makes this plugin installable in a project that runs `npm install` never:
// nothing it executes may import anything but a node builtin or a relative path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

function* files(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

const IMPORT = /(?:^|\n)\s*(?:import|export)[^'"\n]*from\s+['"]([^'"]+)['"]/g;

test('nothing under bin/, lib/ or hooks/ imports a package', () => {
  const offenders = [];
  for (const dir of ['bin', 'lib', 'hooks']) {
    for (const file of files(join(repo, dir))) {
      const src = readFileSync(file, 'utf8');
      for (const [, spec] of src.matchAll(IMPORT)) {
        const ok = spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../');
        if (!ok) offenders.push(`${file.slice(repo.length + 1)} imports ${spec}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('package.json declares no dependencies', () => {
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.type, 'module');
});
