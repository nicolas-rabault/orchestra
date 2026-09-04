// `lib/tickets/ledger.mjs` — the row shape and every function that reads or writes a row, ported
// from planetCraft's `tools/tickets.mjs` under scope answer 7 of
// docs/plans/2026-09-04-p5-hooks-init-tickets-heartbeat.md. Judging a ticket against a project's
// own sessions, evidence, builds or an oracle table, and exporting to Notion, never travelled —
// this file tests what did.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers/fixture.mjs';
import { loadConfig } from '../lib/config.mjs';
import {
  KINDS, STATUSES, SEVERITIES,
  normalizeSubject, fingerprintFor, ticketIdFor,
  ticketsPath, loadTickets, saveTickets,
  upsertTicket, findTicket, setTicket, listTickets, pushHistory,
} from '../lib/tickets/ledger.mjs';
import { ticketsCommand } from '../lib/cli/tickets.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orchestra');
const repos = [];
const repo = (config = {}) => {
  const r = makeRepo({ config });
  repos.push(r);
  return { ...r, cfg: loadConfig(r.root) };
};
after(() => repos.forEach((r) => r.cleanup()));

// ---------------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------------

test('the three vocabularies are unchanged from the source project', () => {
  assert.deepEqual(KINDS, ['bug', 'friction', 'design', 'perf']);
  assert.deepEqual(STATUSES, ['open', 'fixing', 'needs-review', 'verified', 'closed']);
  assert.deepEqual(SEVERITIES, ['S1', 'S2', 'S3']);
});

// ---------------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------------

test('normalizeSubject folds punctuation, accents, stop words and pure-numeric tokens', () => {
  assert.equal(normalizeSubject('The bot got stuck in a wall'), 'bot-got-stuck-wall');
  assert.equal(normalizeSubject('café crashed at 12:30'), 'cafe-crashed');
});

test('normalizeSubject refuses a subject that is all punctuation and numbers', () => {
  assert.throws(() => normalizeSubject('12:30, 99%!'), /normalises to nothing/);
});

test('two subjects that open the same way fold to one fingerprint', () => {
  // Same significant words, in the same order — only case, punctuation and a stop word differ,
  // which is exactly what stop-word removal and case folding exist to erase.
  const a = fingerprintFor({ subject: 'the bot got stuck in a wall' });
  const b = fingerprintFor({ subject: 'Bot got stuck in the wall!' });
  assert.equal(a, b);
});

test('two genuinely different subjects do not fold together', () => {
  const a = fingerprintFor({ subject: 'the bot got stuck in a wall' });
  const b = fingerprintFor({ subject: 'the crafting menu never opens' });
  assert.notEqual(a, b);
});

test('a canonical fingerprint is case-folded but otherwise passed through unchanged', () => {
  assert.equal(fingerprintFor({ fingerprint: 'A1b2C3' }), 'fingerprint:a1b2c3');
});

// The strict-format check the source project's own `crash` kind carried (a token, never the
// message or the stack) is the whole point of the rename to `fingerprint` — losing it would let
// a caller passing free text mint a fresh ticket on every occurrence, exactly the failure a
// fingerprint exists to prevent. Review fix round 1, finding 1.
test('a canonical precomputed fingerprint folds onto ONE ticket, filed from two separate call sites', () => {
  const fileA = [];
  const fileB = [];
  const a = upsertTicket(fileA, { fingerprint: 'Ab12cd3' }).ticket;
  const b = upsertTicket(fileB, { fingerprint: 'ab12cd3' }).ticket;
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(a.id, b.id);
});

test('a non-canonical fingerprint is REJECTED, never silently slugified into a new identity', () => {
  // The raw message, not a token: exactly what a careless caller would pass, and exactly what
  // folds nothing since it still carries every line number and detail a fingerprint exists to
  // discard.
  assert.throws(() => fingerprintFor({ fingerprint: 'TypeError: cannot read property of undefined' }),
    /not a canonical fingerprint/);
  // Longer than the 12-character cap the source project's own reporter output fits inside.
  assert.throws(() => fingerprintFor({ fingerprint: 'waytoolongtobeanythingsreporter' }),
    /not a canonical fingerprint/);
});

test('fingerprintFor demands exactly one of fingerprint/subject', () => {
  assert.throws(() => fingerprintFor({}), /exactly one of fingerprint\/subject/);
  assert.throws(() => fingerprintFor({ fingerprint: 'x', subject: 'y' }), /exactly one of fingerprint\/subject/);
});

test('an oracle-style observation is refused — that identity kind stayed behind', () => {
  assert.throws(() => fingerprintFor({ oracle: 'stuck-in-geometry' }), /exactly one of fingerprint\/subject/);
});

test('ticketIdFor is a stable short hash of the fingerprint, not a counter', () => {
  const fp = 'note:bot-got-stuck-wall';
  assert.equal(ticketIdFor(fp), ticketIdFor(fp));
  assert.match(ticketIdFor(fp), /^t-[0-9a-z]{7}$/);
});

// ---------------------------------------------------------------------------------
// The path: the main checkout's, never the caller's cwd
// ---------------------------------------------------------------------------------

test('ticketsPath resolves against cfg.root and the configured tickets.file', () => {
  const cfg = { root: '/some/checkout', tickets: { file: '.orchestra/tickets.jsonl' } };
  assert.equal(ticketsPath(cfg), join('/some/checkout', '.orchestra', 'tickets.jsonl'));
});

// ---------------------------------------------------------------------------------
// Store: load / save
// ---------------------------------------------------------------------------------

test('loadTickets on a missing file returns an empty queue, not an error', () => {
  const r = repo();
  assert.deepEqual(loadTickets(join(r.root, 'nope.jsonl')), []);
});

test('saveTickets then loadTickets round-trips a row exactly, field order aside', () => {
  const r = repo();
  const file = join(r.root, '.orchestra', 'tickets.jsonl');
  const tickets = [];
  const { ticket } = upsertTicket(tickets, { subject: 'the crafting menu never opens' });
  saveTickets(file, tickets);
  const reloaded = loadTickets(file);
  assert.equal(reloaded.length, 1);
  assert.deepEqual(reloaded[0], JSON.parse(JSON.stringify(ticket)));
});

test('loadTickets throws naming the file and line on unparsable JSON', () => {
  const r = repo();
  const file = join(r.root, 'broken.jsonl');
  mkdirSync(r.root, { recursive: true });
  writeFileSync(file, '{"ok":true}\nnot json\n');
  assert.throws(() => loadTickets(file), /broken\.jsonl line 2 is not JSON/);
});

// A tickets.jsonl the source project wrote still has to load here (§9): a row with an `oracle:`
// fingerprint, a `verification` object and a stamped `reach`/`builds` is exactly what that
// project's own queue produces, and none of those fields are validated on load — they are only
// ever produced going forward by the identity rules this module still enforces.
test('a ticket row shaped like the source project wrote it still loads', () => {
  const r = repo();
  const file = join(r.root, 'legacy.jsonl');
  const legacyRow = {
    id: 't-abc1234', fingerprint: 'oracle:stuck-in-geometry', kind: 'bug', severity: 'S1',
    status: 'verified', title: 'stuck in geometry', body: 'cell 4,9', source: { session: 's1', anchor: null },
    repro: null, evidence: [], branch: null, fix: 'abc123', reach: 5,
    verification: { verdict: 'verified', at: '2026-08-01T00:00:00.000Z', fix: 'abc123', sessions: [] },
    firstSeen: '2026-08-01T00:00:00.000Z', lastSeen: '2026-08-01T00:00:00.000Z',
    count: 3, builds: ['abc123'], history: [{ at: '2026-08-01T00:00:00.000Z', event: 'created' }],
  };
  mkdirSync(r.root, { recursive: true });
  writeFileSync(file, `${JSON.stringify(legacyRow)}\n`);
  const rows = loadTickets(file);
  assert.deepEqual(rows, [legacyRow]);
});

// ---------------------------------------------------------------------------------
// upsertTicket: identity, folding, and an id stable across a re-file
// ---------------------------------------------------------------------------------

test('a fresh observation creates a ticket with count 1', () => {
  const { ticket, action } = upsertTicket([], { subject: 'the door never opens' });
  assert.equal(action, 'created');
  assert.equal(ticket.status, 'open');
  assert.equal(ticket.count, 1);
  assert.equal(ticket.kind, 'bug');
  assert.equal(ticket.severity, 'S2');
});

test('re-filing the same defect from a different session updates the existing row, not a new one', () => {
  const tickets = [];
  upsertTicket(tickets, { subject: 'the door never opens', session: 's1' });
  const { ticket, action } = upsertTicket(tickets, { subject: 'Door never opens!', session: 's2' });
  assert.equal(tickets.length, 1);
  assert.equal(action, 'updated');
  assert.equal(ticket.count, 2);
});

test('re-filing from the SAME session is a no-op — a filer that runs twice must not double the count', () => {
  const tickets = [];
  upsertTicket(tickets, { subject: 'the door never opens', session: 's1' });
  const { action, ticket } = upsertTicket(tickets, { subject: 'the door never opens', session: 's1' });
  assert.equal(action, 'unchanged');
  assert.equal(ticket.count, 1);
});

test('an id is stable across a re-file: the same fingerprint always yields the same id', () => {
  const first = upsertTicket([], { subject: 'the door never opens' }).ticket.id;
  const second = upsertTicket([], { subject: 'the door never opens' }).ticket.id;
  assert.equal(first, second);
});

test('severity only ever escalates to the worst ever observed, never relaxes on a milder re-sighting', () => {
  const tickets = [];
  upsertTicket(tickets, { subject: 'save corrupts on exit', severity: 'S1', session: 's1' });
  const { ticket } = upsertTicket(tickets, { subject: 'save corrupts on exit', severity: 'S3', session: 's2' });
  assert.equal(ticket.severity, 'S1');
});

// ---------------------------------------------------------------------------------
// findTicket / setTicket / listTickets
// ---------------------------------------------------------------------------------

test('findTicket resolves by id, by fingerprint, or by an unambiguous id prefix', () => {
  const tickets = [];
  const { ticket } = upsertTicket(tickets, { subject: 'the door never opens' });
  assert.equal(findTicket(tickets, ticket.id), ticket);
  assert.equal(findTicket(tickets, ticket.fingerprint), ticket);
  assert.equal(findTicket(tickets, ticket.id.slice(0, 4)), ticket);
  assert.equal(findTicket(tickets, 'no-such-thing'), null);
});

test('setTicket reports only what actually changed, and records it in history', () => {
  const { ticket } = upsertTicket([], { subject: 'the door never opens' });
  const changed = setTicket(ticket, { status: 'fixing' });
  assert.deepEqual(changed, ['status']);
  assert.equal(ticket.status, 'fixing');
  assert.equal(ticket.history.at(-1).event, 'status');
  assert.equal(setTicket(ticket, { status: 'fixing' }).length, 0);
});

test('setTicket refuses an unsettable field', () => {
  const { ticket } = upsertTicket([], { subject: 'the door never opens' });
  assert.throws(() => setTicket(ticket, { title: 'nope' }), /cannot set "title"/);
});

test('pushHistory caps the log but never drops the birth entry', () => {
  const { ticket } = upsertTicket([], { subject: 'the door never opens' });
  for (let i = 0; i < 250; i++) pushHistory(ticket, { at: `t${i}`, event: 'seen' });
  assert.equal(ticket.history.length, 200);
  assert.equal(ticket.history[0].event, 'created');
});

test('listTickets filters by status, kind and severity, worst-severity first', () => {
  const tickets = [];
  upsertTicket(tickets, { subject: 'alpha issue', severity: 'S3' });
  upsertTicket(tickets, { subject: 'bravo issue', severity: 'S1' });
  upsertTicket(tickets, { subject: 'charlie issue', severity: 'S2', kind: 'perf' });
  const bySeverity = listTickets(tickets).map((t) => t.severity);
  assert.deepEqual(bySeverity, ['S1', 'S2', 'S3']);
  assert.equal(listTickets(tickets, { kind: 'perf' }).length, 1);
  assert.equal(listTickets(tickets, { severity: 'S1' }).length, 1);
  assert.equal(listTickets(tickets, { status: 'closed' }).length, 0);
});

// ---------------------------------------------------------------------------------
// The CLI: list / add / close / show
// ---------------------------------------------------------------------------------

function capture(fn) {
  const realWrite = process.stdout.write.bind(process.stdout);
  let text = '';
  process.stdout.write = (chunk) => { text += chunk; return true; };
  try { fn(); return text; } finally { process.stdout.write = realWrite; }
}

test('tickets add is an upsert onto the fingerprint, filing the same friction twice cheaply', () => {
  const r = repo();
  capture(() => ticketsCommand({ cfg: r.cfg, args: ['add', '--subject', 'the anvil never crafts', '--kind', 'friction'] }));
  const second = capture(() => ticketsCommand({ cfg: r.cfg, args: ['add', '--subject', 'The Anvil never crafts!'] }));
  assert.match(second, /^updated/);
  const rows = loadTickets(ticketsPath(r.cfg));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
});

test('tickets add refuses with no fingerprint or subject', () => {
  const r = repo();
  assert.throws(() => ticketsCommand({ cfg: r.cfg, args: ['add', '--kind', 'bug'] }), /usage/);
});

test('tickets list prints nothing special and tickets show prints the full row as JSON', () => {
  const r = repo();
  capture(() => ticketsCommand({ cfg: r.cfg, args: ['add', '--subject', 'the anvil never crafts', '--title', 'the anvil never crafts'] }));
  const listed = capture(() => ticketsCommand({ cfg: r.cfg, args: ['list'] }));
  assert.match(listed, /anvil never crafts/);
  const rows = loadTickets(ticketsPath(r.cfg));
  const shown = capture(() => ticketsCommand({ cfg: r.cfg, args: ['show', rows[0].id] }));
  assert.deepEqual(JSON.parse(shown), rows[0]);
});

test('tickets list on an empty queue says so rather than printing nothing at all', () => {
  const r = repo();
  const out = capture(() => ticketsCommand({ cfg: r.cfg, args: ['list'] }));
  assert.match(out, /no tickets match/);
});

test('tickets close sets status to closed and records an optional note in history', () => {
  const r = repo();
  capture(() => ticketsCommand({ cfg: r.cfg, args: ['add', '--subject', 'the anvil never crafts'] }));
  const [row] = loadTickets(ticketsPath(r.cfg));
  capture(() => ticketsCommand({ cfg: r.cfg, args: ['close', row.id, '--note', 'fixed on main'] }));
  const [closed] = loadTickets(ticketsPath(r.cfg));
  assert.equal(closed.status, 'closed');
  assert.ok(closed.history.some((h) => h.event === 'note' && h.note === 'fixed on main'));
});

test('tickets close on an unknown id names it and does not write the file', () => {
  const r = repo();
  assert.throws(() => ticketsCommand({ cfg: r.cfg, args: ['close', 't-0000000'] }), /no ticket "t-0000000"/);
  assert.equal(existsSync(ticketsPath(r.cfg)), false);
});

test('tickets is silent and exits cleanly with no config — the off switch bin/orchestra provides', () => {
  // ticketsCommand itself is never reached with no config (bin/orchestra's off switch stops it
  // first); this exercises the same guarantee `test/cli.test.mjs`'s generic verb loop already
  // checks for every registered command, specifically for `tickets list`.
  const r = repo();
  rmSync(join(r.root, '.orchestra', 'config.json'), { force: true });
  const out = execFileSync('node', [BIN, 'tickets', 'list'], { cwd: r.root, encoding: 'utf8' });
  assert.equal(out, '');
});
