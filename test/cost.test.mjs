// `lib/register/cost.mjs` — what a session actually costs, and whether it should be retired.
//
// The transcripts are BUILT here, in a temporary `CLAUDE_CONFIG_DIR`, rather than read from the
// machine: the numbers under test are arithmetic over a shape Claude Code writes, and a suite that
// depended on this machine's own sessions would pass or fail on whatever happened to be on disk.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  measure, findTranscript, sessionCost, retireVerdict, fleetCost, retireLine,
  transcriptRoot, RETIRE_AT, MIN_REQUESTS,
} from '../lib/register/cost.mjs';

const homes = [];
after(() => homes.forEach((h) => rmSync(h, { recursive: true, force: true })));

// One assistant record, in the shape Claude Code writes it.
const req = (input, cacheRead, output = 100) => JSON.stringify({
  type: 'assistant',
  message: { usage: { input_tokens: input, cache_read_input_tokens: cacheRead, output_tokens: output } },
});

// A transcript for `session` under a throwaway config directory, plus the env that points at it.
function transcript(session, lines, { dir = 'a-project' } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'orchestra-claude-'));
  homes.push(home);
  mkdirSync(join(home, 'projects', dir), { recursive: true });
  writeFileSync(join(home, 'projects', dir, `${session}.jsonl`), `${lines.join('\n')}\n`);
  return { env: { CLAUDE_CONFIG_DIR: home }, home };
}

// ---- measure ----------------------------------------------------------------------------------

test('measure sums the three input kinds, and reports the first and last as boot and prefix', () => {
  const m = measure([req(10, 990), req(20, 1980), req(30, 4970)].join('\n'));
  assert.equal(m.requests, 3);
  assert.equal(m.boot, 1000);
  assert.equal(m.prefix, 5000);
  assert.equal(m.read, 1000 + 2000 + 5000);
  assert.equal(m.output, 300);
});

test('measure counts cache CREATION too — it is context read, whoever paid to write it', () => {
  const line = JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 5, cache_creation_input_tokens: 95, output_tokens: 1 } } });
  assert.equal(measure(line).prefix, 100);
});

test('measure ignores everything that is not an assistant request with a usage block', () => {
  const noise = [
    JSON.stringify({ type: 'user', message: { content: 'hello "usage" is in this text' } }),
    JSON.stringify({ type: 'system', usage: { input_tokens: 999 } }),
    'not json at all, but it mentions "usage"',
    req(1, 999),
  ];
  const m = measure(noise.join('\n'));
  assert.equal(m.requests, 1);
  assert.equal(m.prefix, 1000);
});

test('a request that read nothing is not a request the measurement can see', () => {
  assert.equal(measure([req(0, 0, 50), req(1, 999)].join('\n')).requests, 1);
});

test('a transcript with no measurable request at all is null, never a zero', () => {
  assert.equal(measure(''), null);
  assert.equal(measure('{"type":"user"}'), null);
});

// ---- finding the file -------------------------------------------------------------------------

test('a transcript is found by its uuid, whatever directory holds it', () => {
  const s = 'aaaaaaaa-1111-2222-3333-444444444444';
  const { env } = transcript(s, [req(1, 999)], { dir: '-some-encoded-worktree-path' });
  assert.match(findTranscript(s, { env }), new RegExp(`${s}\\.jsonl$`));
});

test('CLAUDE_CONFIG_DIR moves where transcripts are looked for', () => {
  assert.match(transcriptRoot({ CLAUDE_CONFIG_DIR: '/somewhere/else' }), /^\/somewhere\/else\/projects$/);
  assert.match(transcriptRoot({}), /\.claude\/projects$/);
});

test('a session with no transcript is null, and nothing that is not a uuid is ever looked up', () => {
  const { env } = transcript('aaaaaaaa-1111-2222-3333-444444444444', [req(1, 999)]);
  assert.equal(findTranscript('bbbbbbbb-1111-2222-3333-444444444444', { env }), null);
  // A path, not an id: it must never become a file read outside the transcript directory.
  assert.equal(findTranscript('../../../etc/passwd', { env }), null);
  assert.equal(findTranscript('', { env }), null);
  assert.equal(findTranscript(null, { env }), null);
});

test('sessionCost measures the file it finds, and is null when there is none', () => {
  const s = 'aaaaaaaa-1111-2222-3333-444444444444';
  const { env } = transcript(s, [req(10, 990), req(0, 300000)]);
  const c = sessionCost(s, { env });
  assert.equal(c.requests, 2);
  assert.equal(c.boot, 1000);
  assert.equal(c.prefix, 300000);
  assert.equal(c.session, s);
  assert.ok(c.bytes > 0);
  assert.equal(sessionCost('cccccccc-1111-2222-3333-444444444444', { env }), null);
});

// ---- the rule ---------------------------------------------------------------------------------

const row = (over = {}) => ({ id: 'demo/D1', session: 'aaaaaaaa-1111-2222-3333-444444444444', status: 'claimed', pending: [], ...over });
const cost = (over = {}) => ({ requests: 100, boot: 34000, prefix: 250000, read: 1e7, output: 1e5, ...over });
const TERMINAL = new Set(['landed', 'dropped']);

test('a grown session is retired, and says what it was measured at', () => {
  const v = retireVerdict(row(), cost(), { terminal: TERMINAL });
  assert.equal(v.ok, true);
  assert.equal(v.reason, 'grown');
  assert.equal(v.prefix, 250000);
  assert.equal(v.at, RETIRE_AT);
});

test('a session below the threshold is not retired', () => {
  const v = retireVerdict(row(), cost({ prefix: 150000 }), { terminal: TERMINAL });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'below');
  assert.equal(v.prefix, 150000);
});

// The guard that makes the whole mechanism safe. Without it, a threshold below `boot + R` means the
// replacement is born already over the line and is retired again on its next request, for ever —
// simulated at 141 cuts per session and 160 % MORE tokens read than doing nothing.
test('a session is never retired below twice its OWN boot, however low the threshold', () => {
  // The replacement of an expensive hand-over: it booted at 180 k, so its own floor is 360 k.
  const v = retireVerdict(row(), cost({ boot: 180000, prefix: 250000 }), { retireAt: 100000, terminal: TERMINAL });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'below-its-own-floor');
  assert.equal(v.at, 360000, 'the bar is twice its own boot, not the configured threshold');
});

test('an expensive hand-over raises the bar for the next one, with no state kept anywhere', () => {
  // Same row, same threshold, two generations. The first booted cheap and is retired; its
  // replacement booted expensive and is NOT, at the very same prefix.
  const cheap = retireVerdict(row(), cost({ boot: 34000, prefix: 210000 }), { terminal: TERMINAL });
  const dear = retireVerdict(row(), cost({ boot: 140000, prefix: 210000 }), { terminal: TERMINAL });
  assert.equal(cheap.ok, true);
  assert.equal(dear.ok, false);
  assert.equal(dear.at, 280000);
});

test('a session too young to have earned a hand-over is not retired', () => {
  const v = retireVerdict(row(), cost({ requests: MIN_REQUESTS - 1, prefix: 400000 }), { terminal: TERMINAL });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'young');
});

test('NOT MEASURED never reads as NOT GROWN', () => {
  const v = retireVerdict(row(), null, { terminal: TERMINAL });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'unmeasured');
});

test('a row mid-question is never retired — the answer is coming back to THAT session', () => {
  const v = retireVerdict(row({ pending: [{ id: 'd1-design-1', ask: '…' }] }), cost(), { terminal: TERMINAL });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'asked');
});

test('a row waiting on the gate is not retired — its worker has already finished', () => {
  assert.equal(retireVerdict(row({ status: 'review' }), cost(), { terminal: TERMINAL }).reason, 'waiting-on-the-gate');
});

test('a terminal row and a row with no session are refused before anything is measured', () => {
  assert.equal(retireVerdict(row({ status: 'landed' }), cost(), { terminal: TERMINAL }).reason, 'terminal');
  assert.equal(retireVerdict(row({ session: null }), cost(), { terminal: TERMINAL }).reason, 'no-session');
});

// ---- the fleet ---------------------------------------------------------------------------------

test('fleetCost measures every live row with a session and sorts the dearest first', () => {
  const tasks = [
    { id: 'demo/A', session: 'a', status: 'claimed', pending: [] },
    { id: 'demo/B', session: 'b', status: 'claimed', pending: [] },
    { id: 'demo/C', session: null, status: 'todo', pending: [] },
    { id: 'demo/D', session: 'd', status: 'landed', pending: [] },
  ];
  const sizes = { a: 120000, b: 400000, d: 900000 };
  const measureOne = (s) => (sizes[s] ? { requests: 100, boot: 34000, prefix: sizes[s], read: 1e7, output: 1e5 } : null);
  const rows = fleetCost(tasks, { terminal: TERMINAL, measureOne });
  assert.deepEqual(rows.map((r) => r.id), ['demo/B', 'demo/A'], 'terminal and session-less rows are not measured');
  assert.equal(rows[0].verdict.ok, true);
  assert.equal(rows[1].verdict.ok, false);
});

test('a row being driven right now is never retired — its prefix is already out of date', () => {
  const tasks = [{ id: 'demo/A', session: 'a', status: 'claimed', pending: [] }];
  const measureOne = () => ({ requests: 100, boot: 34000, prefix: 400000, read: 1e7, output: 1e5 });
  const rows = fleetCost(tasks, { terminal: TERMINAL, driving: new Set(['demo/A']), measureOne });
  assert.equal(rows[0].verdict.ok, false);
  assert.equal(rows[0].verdict.reason, 'driving');
});

test('the RETIRE line carries the two numbers the decision rests on', () => {
  const r = {
    id: 'demo/A', status: 'claimed',
    cost: { requests: 210, boot: 34000, prefix: 420000, read: 5.4e7 },
    verdict: { ok: true, reason: 'grown', at: 200000 },
  };
  const line = retireLine(r);
  assert.match(line, /RETIRE: demo\/A \[claimed\] — 210 requests, prefix 420k/);
  assert.match(line, /booted 34k, threshold 200k/);
  assert.match(line, /re-reads 420k; a replacement on the same worktree starts near 34k/);
  assert.match(line, /orchestra retire demo\/A/);
});
