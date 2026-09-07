// `orchestra pr`'s own argument handling — the layer every verdict a review worker records passes
// through, and the one module of this feature nothing drove directly. `pr-ledger` tests the record
// and `pr-scan` tests the routing; what is here is the flag reader, the two refusals, and the fact
// that a worker is shown what it wrote.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { makeRepo } from './helpers/fixture.mjs';
import { loadConfig } from '../lib/config.mjs';
import { ledgerPath } from '../lib/pr/ledger.mjs';
import { prCommand } from '../lib/cli/pr.mjs';

const repos = [];
after(() => repos.forEach((r) => r.cleanup()));

const project = () => {
  const r = makeRepo({ mode: 'offline' });
  repos.push(r);
  return { r, cfg: loadConfig(r.root) };
};

function capture(fn) {
  const realWrite = process.stdout.write.bind(process.stdout);
  let text = '';
  process.stdout.write = (chunk) => { text += chunk; return true; };
  try {
    fn();
    return { text };
  } finally {
    process.stdout.write = realWrite;
  }
}

const logged = (cfg, args) => JSON.parse(capture(() => prCommand({ cfg, args })).text);

// Both flag forms, on one record, plus the thing the command PRINTS. It used to print
// `appendLine`'s return — the ledger's PATH — so a worker told to carry its record in its report
// could only report where the ledger lives.
test('log takes --k v and --k=v alike, and prints the record it wrote', () => {
  const { cfg } = project();

  const spaced = logged(cfg, ['log', '91', 'review', '--head', 'a1b2c3d', '--comment', '456', '--note', 'wants a test']);
  assert.deepEqual(spaced, {
    pr: 91,
    verdict: 'review',
    head: 'a1b2c3d',
    last_other_comment_id: 456,
    seen: spaced.seen,
    note: 'wants a test',
  });

  const equals = logged(cfg, ['log', '82', 'decline', '--head=deadbee', '--comment=7', '--note=not this project', '--direction=no-vendor-backends.md']);
  assert.equal(equals.head, 'deadbee');
  assert.equal(equals.last_other_comment_id, 7);
  assert.equal(equals.note, 'not this project');
  assert.equal(equals.direction, 'no-vendor-backends.md');
});

test('a log with no --comment records a null watermark rather than inventing one', () => {
  const { cfg } = project();
  assert.equal(logged(cfg, ['log', '5', 'merge', '--head', 'aaa']).last_other_comment_id, null);
});

// `Number('abc')` is NaN and `JSON.stringify` renders NaN as `null`, so this used to write
// `"last_other_comment_id":null` and say nothing. The next sweep reads that back as `?? 0`, and
// every comment on the PR looks like movement from then on.
test('a non-integer --comment is refused rather than coerced, and nothing is written', () => {
  const { cfg } = project();
  assert.throws(
    () => prCommand({ cfg, args: ['log', '91', 'review', '--head', 'aaa', '--comment', 'abc'] }),
    /--comment takes the id of the last comment you read, got "abc"/,
  );
  assert.throws(
    () => prCommand({ cfg, args: ['log', '91', 'review', '--head', 'aaa', '--comment', '4.5'] }),
    /--comment takes the id/,
  );
  assert.equal(existsSync(ledgerPath(cfg)), false, 'the refusal wrote no ledger at all');
});

test('log with no pull request or no verdict prints the usage, naming every verdict', () => {
  const { cfg } = project();
  for (const args of [['log'], ['log', '91'], ['log', '--head', 'aaa']]) {
    assert.throws(
      () => prCommand({ cfg, args }),
      (e) => /^usage: orchestra pr log/.test(e.message)
        && ['review', 'merge', 'decline', 'dismissed'].every((v) => e.message.includes(v)),
    );
  }
});

test('an unknown subcommand, and none at all, both name the two that exist', () => {
  const { cfg } = project();
  assert.throws(() => prCommand({ cfg, args: ['bogus'] }), /unknown subcommand "bogus"\nknown: log, scan/);
  assert.throws(() => prCommand({ cfg, args: [] }), /unknown subcommand ""\nknown: log, scan/);
});
