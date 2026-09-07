// The ledger a sweep folds its next scan against. Its clock is MEASURED, for the reason
// lib/register/journal.mjs already carries: the journal that was written by hand, one printf at a
// time, had 75% of its timestamps ending in :00 or :30 and four lines truncated mid-JSON.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { makeRepo } from './helpers/fixture.mjs';
import { loadConfig } from '../lib/config.mjs';
import { line, append, ledgerPath, readLedger, latest } from '../lib/pr/ledger.mjs';

const repos = [];
after(() => repos.forEach((r) => r.cleanup()));

const project = () => {
  const r = makeRepo({ mode: 'offline' });
  repos.push(r);
  return { r, cfg: loadConfig(r.root) };
};

test('a record carries the leLab ledger shape, with a measured date', () => {
  const rec = JSON.parse(line({
    pr: 89, verdict: 'review', head: 'a1b2c3d', lastOtherCommentId: 456,
    note: 'wants a test on build_training_command', now: new Date('2026-07-29T11:02:03Z'),
  }));
  assert.deepEqual(rec, {
    pr: 89,
    verdict: 'review',
    head: 'a1b2c3d',
    last_other_comment_id: 456,
    seen: '2026-07-29',
    note: 'wants a test on build_training_command',
  });
});

test('a decline carries the direction file that justifies it', () => {
  const rec = JSON.parse(line({
    pr: 40, verdict: 'decline', head: 'f00', direction: 'no-vendor-compute-backends.md',
  }));
  assert.equal(rec.direction, 'no-vendor-compute-backends.md');
});

test('an unknown verdict is refused rather than written', () => {
  assert.throws(() => line({ pr: 1, verdict: 'maybe', head: 'abc' }), /unknown verdict "maybe"/);
  assert.throws(() => line({ pr: 0, verdict: 'merge', head: 'abc' }), /pull request number/);
  assert.throws(() => line({ pr: 1, verdict: 'merge', head: '' }), /head sha/);
});

test('an append repairs a missing trailing newline instead of gluing two records together', () => {
  const { cfg } = project();
  const p = ledgerPath(cfg);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, '{"pr":1,"verdict":"merge","head":"aaa"}');  // no newline: a hand-written file

  append(cfg, { pr: 2, verdict: 'dismissed', head: 'bbb' });

  const lines = readFileSync(p, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.doesNotThrow(() => lines.forEach((l) => JSON.parse(l)));
});

test('the current state of a PR is its last line', () => {
  const { cfg } = project();
  append(cfg, { pr: 91, verdict: 'review', head: 'aaa' });
  append(cfg, { pr: 91, verdict: 'merge', head: 'bbb' });
  append(cfg, { pr: 82, verdict: 'dismissed', head: 'ccc' });

  assert.equal(readLedger(cfg).length, 3);
  assert.equal(latest(readLedger(cfg)).get(91).verdict, 'merge');
  assert.equal(latest(readLedger(cfg)).get(82).verdict, 'dismissed');
});

test('a corrupt line is skipped, never thrown on: the file outlives every writer of it', () => {
  const { cfg } = project();
  append(cfg, { pr: 91, verdict: 'review', head: 'aaa' });
  const p = ledgerPath(cfg);
  writeFileSync(p, `${readFileSync(p, 'utf8')}{"pr":92,"verdi\n`);
  assert.equal(readLedger(cfg).length, 1);
});
