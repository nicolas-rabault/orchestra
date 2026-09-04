// The invariant that makes this plugin installable in a project that runs `npm install` never:
// nothing it executes may import anything but a node builtin or a relative path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

// The one directory under `lib/` whose files are NOT executed by node. `lib/monitor/public/app.js`
// runs in a BROWSER, and it imports `/layout.mjs`, `/answers.mjs`, `/clock.mjs`, `/progress.mjs` and
// `/tabs.mjs` — the five pure modules the monitor serves so the page and the tests share one copy of
// them instead of the page carrying a second.
//
// The invariant this whole file holds is "nothing this plugin executes IN NODE may import a
// package". A `/`-rooted specifier in a browser asset is not a package: it is a URL, answered by
// `lib/monitor/server.mjs` from a CLOSED LIST of five paths, and it is never a specifier node
// resolves. So it is legal there and nowhere else.
//
// Deliberately NOT an exclusion of the directory, which would be a hole: a real package import
// (`'lodash'`) or a CDN URL in a browser file would then go unflagged, and this narrower rule still
// catches both. `//` is excluded too — `//cdn.example.com/x.js` is a protocol-relative URL to
// another host, which starts with a slash and is exactly the thing an exclusion would have let
// through.
const BROWSER_ASSETS = `lib${sep}monitor${sep}public${sep}`;
const browserUrl = (rel, spec) =>
  rel.startsWith(BROWSER_ASSETS) && spec.startsWith('/') && !spec.startsWith('//');

function* files(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

// Extract all offending package imports from source code.
// Catches: static imports (single/multi-line), side-effect imports, dynamic imports, export-from.
// Returns: array of specifiers that are not node: builtins or relative paths.
function packageImports(source) {
  const offenders = new Set();

  // Match import/export with from clause (handles multi-line)
  const fromPattern = /(?:import|export)[^;]*?from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(fromPattern)) {
    const spec = match[1];
    if (!spec.startsWith('node:') && !spec.startsWith('./') && !spec.startsWith('../')) {
      offenders.add(spec);
    }
  }

  // Match side-effect imports: import 'package'
  const sideEffectPattern = /import\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(sideEffectPattern)) {
    const spec = match[1];
    if (!spec.startsWith('node:') && !spec.startsWith('./') && !spec.startsWith('../')) {
      offenders.add(spec);
    }
  }

  // Match dynamic imports: import(...) with optional await
  const dynamicPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(dynamicPattern)) {
    const spec = match[1];
    if (!spec.startsWith('node:') && !spec.startsWith('./') && !spec.startsWith('../')) {
      offenders.add(spec);
    }
  }

  return Array.from(offenders);
}

test('packageImports() catches all import forms', () => {
  // Multi-line static import
  const multiline = `
    import {
      something
    } from 'some-package'
  `;
  assert.deepEqual(packageImports(multiline).sort(), ['some-package']);

  // Side-effect import
  const sideEffect = `import 'some-package'`;
  assert.deepEqual(packageImports(sideEffect), ['some-package']);

  // Dynamic import
  const dynamic = `await import('some-package')`;
  assert.deepEqual(packageImports(dynamic), ['some-package']);

  // Single-line import
  const singleLine = `import x from 'pkg'`;
  assert.deepEqual(packageImports(singleLine), ['pkg']);

  // Export from
  const exportFrom = `export { x } from 'pkg'`;
  assert.deepEqual(packageImports(exportFrom), ['pkg']);

  // Multi-line export
  const exportMultiline = `
    export {
      x as y
    } from 'another-pkg'
  `;
  assert.deepEqual(packageImports(exportMultiline).sort(), ['another-pkg']);

  // Legal cases should not be flagged
  const legal = `
    import { x } from 'node:fs'
    import { y } from './local'
    import { z } from '../parent'
    await import('node:path')
    import 'node:stream'
  `;
  assert.deepEqual(packageImports(legal), []);

  // Multiple packages in one source
  const multiple = `
    import { a } from 'pkg-a'
    import 'side-effect'
    const x = await import('dynamic-pkg')
  `;
  assert.deepEqual(packageImports(multiple).sort(), ['dynamic-pkg', 'pkg-a', 'side-effect']);
});

test('nothing under bin/, lib/ or hooks/ imports a package', () => {
  const offenders = [];
  for (const dir of ['bin', 'lib', 'hooks']) {
    for (const file of files(join(repo, dir))) {
      const src = readFileSync(file, 'utf8');
      const rel = file.slice(repo.length + 1);
      for (const spec of packageImports(src)) {
        if (browserUrl(rel, spec)) continue;
        offenders.push(`${rel} imports ${spec}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

// The exemption's edges, pinned so nobody widens it into the exclusion it deliberately is not.
test('a "/"-rooted specifier is legal only in a browser asset, and only when it is not a URL to another host', () => {
  const asset = `lib${sep}monitor${sep}public${sep}app.js`;
  assert.equal(browserUrl(asset, '/layout.mjs'), true);
  // A package, and a CDN, in the very file the exemption covers: still offences.
  assert.equal(browserUrl(asset, 'lodash'), false);
  assert.equal(browserUrl(asset, 'https://cdn.example.com/x.js'), false);
  assert.equal(browserUrl(asset, '//cdn.example.com/x.js'), false);
  // The same specifier in a file node executes: an offence.
  assert.equal(browserUrl(`lib${sep}monitor${sep}server.mjs`, '/layout.mjs'), false);
});

test('package.json declares no dependencies', () => {
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.type, 'module');
});
