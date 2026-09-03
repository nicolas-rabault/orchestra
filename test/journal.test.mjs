import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { makeRepo } from './helpers/fixture.mjs';
import { append, journalPath, line, KINDS } from '../lib/register/journal.mjs';

const repos = [];
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
after(() => repos.forEach((r) => r.cleanup()));

test('a line carries exactly four keys, in order, with a measured clock', () => {
  const now = new Date('2026-09-03T11:22:33.444Z');
  assert.equal(line({ kind: 'tick', task: null, text: 'started', now }),
    '{"ts":"2026-09-03T11:22:33.444Z","kind":"tick","task":null,"text":"started"}');
});

test('an unknown kind is refused, and the eight known ones are not', () => {
  assert.throws(() => line({ kind: 'gossip', task: null, text: 'x' }), /unknown kind "gossip"/);
  for (const kind of KINDS) assert.doesNotThrow(() => line({ kind, task: null, text: 'x' }));
  assert.equal(KINDS.length, 8);
});

test('empty text is refused', () => {
  assert.throws(() => line({ kind: 'note', task: null, text: '   ' }), /needs text/);
});

test('a file not ending in a newline gets one before the next line, never a glued line', () => {
  const r = repo();
  const p = journalPath(r.root);
  writeFileSync(p, '{"ts":"2026-09-03T00:00:00.000Z","kind":"note","task":null,"text":"trunc"');
  append(r.root, { kind: 'note', task: 'demo/D1', text: 'after' });
  const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).task, 'demo/D1');
});

test('append creates the journal under .orchestra of the MAIN checkout', () => {
  const r = repo();
  assert.equal(append(r.root, { kind: 'launch', task: 'demo/D1', text: 'go' }), journalPath(r.root));
  assert.match(journalPath(r.root), /\.orchestra\/journal\.jsonl$/);
});
