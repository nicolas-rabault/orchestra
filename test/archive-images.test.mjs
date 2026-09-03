import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, utimesSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeRepo } from './helpers/fixture.mjs';
import { writeState, emptyState, statePath } from '../lib/register/state.mjs';
import { journalPath } from '../lib/register/journal.mjs';
import { loadArchive } from '../lib/register/archive.mjs';
import { scanImagePaths } from '../lib/register/images.mjs';
import { imagesDir, sweep, archivePhotos, FRESH_MS } from '../lib/register/archiveImages.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

const NOW = Date.parse('2026-09-03T10:00:00.000Z');
const OLD = (NOW - FRESH_MS - 86_400_000) / 1000;

const photo = (r, name, bytes = 32) => {
  const p = join(imagesDir(r.root), name);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, Buffer.alloc(bytes));
  utimesSync(p, OLD, OLD);
  return p;
};

test('the scanner takes a path out of prose and leaves the sentence behind', () => {
  assert.deepEqual(scanImagePaths('compare .orchestra/images/a.png with b.png, not the .png file'),
    ['.orchestra/images/a.png', 'b.png']);
  assert.deepEqual(scanImagePaths('see https://host/x.png'), []);
});

test('a photograph an OPEN ask names is kept, whatever the row status', () => {
  const r = repo();
  photo(r, 'ask.png');
  writeState(r.root, { ...emptyState(r.root),
    tasks: [{ id: 'demo/D1', status: 'landed', pending: [{ ask: 'look at ask.png' }] }] });
  const s = sweep(r.root, { now: NOW });
  assert.deepEqual(s.dropped, []);
  assert.match(s.kept[0].why[0], /open ask on demo\/D1/);
});

test('a photograph only a TERMINAL row names goes, and the archive line says which row', () => {
  const r = repo();
  photo(r, 'done.png', 64);
  writeState(r.root, { ...emptyState(r.root),
    tasks: [{ id: 'demo/D1', status: 'landed', note: 'the fix, done.png', pending: [] }] });
  const s = sweep(r.root, { now: NOW });
  assert.deepEqual(s.dropped.map((p) => p.rel), ['.orchestra/images/done.png']);
  assert.equal(s.bytes.dropped, 64);
  const res = archivePhotos(r.root, { now: NOW });
  assert.equal(res.removed, 1);
  assert.equal(existsSync(join(imagesDir(r.root), 'done.png')), false);
  const line = loadArchive(r.root).find((a) => a.kind === 'photo');
  assert.equal(line.path, '.orchestra/images/done.png');
  assert.equal(line.bytes, 64);
  assert.match(line.citedBy[0], /landed row demo\/D1/);
});

test('nothing younger than the freshness floor is ever taken', () => {
  const r = repo();
  const p = photo(r, 'fresh.png');
  utimesSync(p, NOW / 1000, NOW / 1000);
  writeState(r.root, { ...emptyState(r.root), tasks: [] });
  assert.deepEqual(sweep(r.root, { now: NOW }).dropped, []);
});

test('a journal line about a task the register cannot show keeps its pictures', () => {
  const r = repo();
  photo(r, 'unknown.png');
  writeState(r.root, { ...emptyState(r.root), tasks: [] });
  appendFileSync(journalPath(r.root),
    `${JSON.stringify({ ts: '2026-08-01T00:00:00.000Z', kind: 'note', task: 'gone/G1', text: 'unknown.png' })}\n`);
  assert.deepEqual(sweep(r.root, { now: NOW }).dropped, []);
});

test('a register with no task list throws rather than read the silence as "nothing is cited"', () => {
  const r = repo();
  photo(r, 'x.png');
  writeState(r.root, { ...emptyState(r.root), tasks: 'not a list' });
  assert.throws(() => sweep(r.root, { now: NOW }), /refusing to read an unparsed register/);
});

test('no register at all is refused exactly like an unparsed one — not read as "nothing is cited"', () => {
  const r = repo();
  // The photograph is not optional: without one on disk, a sweep that bailed out BEFORE reaching
  // the register check (e.g. on an empty `photosUnder` result) would report `dropped: []` and this
  // test would pass whether or not the guard ever ran. A photograph forces the sweep past that.
  photo(r, 'x.png');
  assert.throws(() => sweep(r.root, { now: NOW }),
    (err) => err.message === `${statePath(r.root)} has no task list — refusing to read an unparsed register as "nothing is cited"`);
});

test('a register with an ambiguous bare task id keeps its pictures rather than guess which row it means', () => {
  const r = repo();
  photo(r, 'ambiguous.png');
  // Two terminal rows sharing the bare id `D1` after the slash. The ambiguity IS the point of this
  // test — `rowLookup` must resolve `D1` to NOTHING rather than to either `alpha/D1` or `beta/D1`,
  // so do not "fix" this fixture into an unambiguous one; that would delete the only coverage for
  // the rule that an unresolvable task reads as LIVE, never as terminal.
  writeState(r.root, { ...emptyState(r.root),
    tasks: [
      { id: 'alpha/D1', status: 'landed', pending: [] },
      { id: 'beta/D1', status: 'dropped', pending: [] },
    ] });
  // Older than the freshness floor, so the sweep must fall through to the task lookup rather than
  // keeping it on age alone.
  appendFileSync(journalPath(r.root),
    `${JSON.stringify({ ts: '2026-08-01T00:00:00.000Z', kind: 'note', task: 'D1', text: 'ambiguous.png' })}\n`);
  assert.deepEqual(sweep(r.root, { now: NOW }).dropped, []);
});

test('a surviving board keeps the montages it names', () => {
  const r = repo();
  photo(r, 'ab/left.png');
  photo(r, 'ab/right.png');
  const board = join(imagesDir(r.root), 'ab/board.html');
  writeFileSync(board, '<img src="left.png"><img src="right.png">');
  utimesSync(board, OLD, OLD);
  writeState(r.root, { ...emptyState(r.root),
    tasks: [{ id: 'demo/D1', status: 'todo', note: 'see .orchestra/images/ab/board.html', pending: [] }] });
  assert.deepEqual(sweep(r.root, { now: NOW }).dropped, []);
});

test('the sweep never leaves its own directory', () => {
  const r = repo();
  // A CONTROL photograph under images/, named by the same finished row: it must be swept, which is
  // what proves the sweep ran at all. Without it `dropped: []` below is true whatever the sweep did.
  photo(r, 'control.png');
  // And a file in the project's own tree, named the way a worker names a screenshot, named by that
  // same finished row. It is not orchestra's to remove.
  mkdirSync(join(r.root, 'docs'), { recursive: true });
  writeFileSync(join(r.root, 'docs/screenshot.png'), Buffer.alloc(16));
  writeState(r.root, { ...emptyState(r.root),
    tasks: [{ id: 'demo/D1', status: 'landed', note: 'control.png and docs/screenshot.png', pending: [] }] });
  const s = sweep(r.root, { now: NOW });
  assert.deepEqual(s.dropped.map((p) => p.rel), ['.orchestra/images/control.png']);
  archivePhotos(r.root, { now: NOW });
  assert.equal(existsSync(join(imagesDir(r.root), 'control.png')), false);
  assert.ok(existsSync(join(r.root, 'docs/screenshot.png')));
});
