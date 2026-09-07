// lib/monitor/model.mjs: the union of the board and the register into one graph of nodes, and what
// a node's card offers to run. Ported from the source project's `tools/orchestra/monitor/model.mjs`
// and its test suite's `joinRows`, `buildModel` and `invokeCommand` describe blocks, with three
// deltas this phase's plan names:
//
//   - `buildModel` gains a `project` block (`{ name, root, mode, branch, id, port }`), passed
//     straight through to its output — the caller builds it, this module never reads it.
//   - `node.why` and `node.acceptance` come off the board row itself, never from an injected
//     `prose` map: `lib/roadmap/parse.mjs` already collects both as fields and `reconcile`
//     (`lib/roadmap/board.mjs`) spreads them onto every row, so `board --json` already carries
//     them and the source's separate lookup has nothing left to do.
//   - `invokeCommand` takes a third argument, `cfg`, and builds its command lines from
//     `cfg.worktrees`, `cfg.mainBranch` and a session name of `orchestra-<cfg.id>-<task slug>`
//     instead of a hardcoded `.claude/worktrees` and `main` — and drops the source's
//     `npm install` line entirely (`skills/orchestra/SKILL.md`'s launch step carries that ruling).
//
// A test whose only change from the source is a re-slugged fixture (this plugin's register keys a
// roadmap by SLUG, never a file path — `lib/register/state.mjs`'s own comment on `registerRow`) is
// still a port; a test exercising one of the three deltas above is new, and is named as such at its
// own site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinRows, buildModel, invokeCommand } from '../lib/monitor/model.mjs';
import { layout } from '../lib/monitor/layout.mjs';
import { tabsOf } from '../lib/monitor/tabs.mjs';
import { openItems } from '../lib/monitor/answers.mjs';
import { pendingId } from '../lib/register/pending.mjs';
import { PENDING_GRACE_MS } from '../lib/register/inbox.mjs';

// The two readings the page makes of `openItems`, and the only two states a node has: red when
// something is still waiting on the user, teal when an answer exists that orchestra has not
// collected. Both live here rather than as fields on the model, so a node can go calm the instant
// THIS TAB sends an answer — see `openItems`' `sent` argument.
const waitsOnUser = (node, sent) => openItems(node, sent).length > 0;
const hasAnAnswer = (node, sent) => node.pending.length > openItems(node, sent).length;

const boardRow = (over = {}) => ({
  key: 'lod/C2', id: 'C2', roadmap: 'lod', title: 'Derived LOD switch distance', order: 2,
  deps: ['C1'], touches: ['src/lod.js'], branch: 'lod/c2-derived-switch', design: false,
  lane: null, status: 'claimed',
  why: 'The ground stops going chunky.', acceptance: 'Two screenshots.',
  ...over,
});
const regRow = (over = {}) => ({
  id: 'C2', title: 'Derived LOD switch distance', branch: 'lod/c2-derived-switch', status: 'review',
  deps: ['C1'], touches: ['src/lod.js'], session: 'c4a1e4a7-1111-2222-3333-444444444444',
  sessionName: 'orchestra-c2', model: 'opus', port: 5307, note: 'holds planetView.js', pending: [],
  subjects: [], ...over,
});

const PROJECT = { name: 'demo', root: '/repo', mode: 'offline', branch: 'main', id: 'a3f19c', port: 4380 };
const CFG = { id: 'a3f19c', worktrees: '.orchestra/worktrees', mainBranch: 'main' };

// A stub resolver — no filesystem, no temp directory: `imagesIn`'s own resolution and
// deduplication behaviour is `lib/register/images.mjs`'s to prove (and already is, in
// test/monitor-sources.test.mjs, against a real `imageFinder`). What THIS file's image tests must
// prove is narrower — that `buildModel` hands `imagesIn` the right text and the right branch for
// each field it fills — and a stub that echoes both back is enough to see that composition, without
// this module needing anything on disk to be tested at all.
const stubFind = (raw, branch) => ({ rel: `${branch ?? 'root'}:${raw}`, raw, missing: false });

// ---------------------------------------------------------------------------------------------
// joinRows
// ---------------------------------------------------------------------------------------------

test('joinRows joins on the qualified key when the register already carries one', () => {
  const { pairs } = joinRows([boardRow()], [regRow({ id: 'lod/C2' })]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].key, 'lod/C2');
  assert.notEqual(pairs[0].board, null);
});

test('joinRows joins on the branch when the register still keys by bare id', () => {
  const { pairs } = joinRows([boardRow()], [regRow()]);
  assert.equal(pairs[0].key, 'lod/C2');
  assert.equal(pairs[0].reg.port, 5307);
});

test('joinRows joins on an unambiguous bare id when there is no branch to match', () => {
  const { pairs } = joinRows([boardRow()], [regRow({ branch: null })]);
  assert.equal(pairs[0].key, 'lod/C2');
});

test('joinRows leaves an ambiguous bare id unfiled rather than joining it to a guess', () => {
  const two = [boardRow({ key: 'lighting/S4', roadmap: 'lighting', branch: 'light/s4-a', id: 'S4' }),
    boardRow({ key: 'system/S4', roadmap: 'system', branch: 'sys/s4-b', id: 'S4' })];
  const { pairs, ambiguous } = joinRows(two, [regRow({ id: 'S4', branch: null })]);
  assert.equal(pairs.find((p) => p.key === 'unfiled/S4').board, null);
  assert.deepEqual(ambiguous, ['S4']);
});

test('joinRows keeps a board row no session has ever held, and a register row no roadmap defines', () => {
  const { pairs } = joinRows([boardRow({ key: 'lod/C4', id: 'C4', branch: 'lod/c4-prefetch' })], [regRow({ id: 'GT2', branch: 'gate/gt2' })]);
  assert.deepEqual(pairs.map((p) => p.key).sort(), ['lod/C4', 'unfiled/GT2']);
});

test('joinRows claims a board row for at most one register row and names the collision', () => {
  const board = [boardRow()];
  const register = [regRow({ id: 'lod/C2', branch: null }), regRow({ id: 'C2', branch: 'lod/c2-derived-switch', port: 9999 })];
  const { pairs, duplicates } = joinRows(board, register);
  const keys = pairs.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(keys, ['lod/C2', 'unfiled/C2']);
  assert.ok(pairs.every((p) => p.reg !== null));
  assert.deepEqual(duplicates, ['lod/C2']);
});

// The same id written twice — not two ids resolving to one board row, the same STRING — used to
// give both rows the same key, which stalled `layout`'s rank loop and blanked the page for good.
test('joinRows gives two register rows carrying the identical id distinct keys', () => {
  const register = [regRow({ id: 'C2', branch: null }), regRow({ id: 'C2', branch: null, port: 9999 })];
  const { pairs, duplicates } = joinRows([], register);
  assert.deepEqual(pairs.map((p) => p.key), ['unfiled/C2', 'unfiled/C2#2']);
  assert.deepEqual(duplicates, ['unfiled/C2']);
  assert.ok(pairs.every((p) => p.reg !== null));
});

// ---------------------------------------------------------------------------------------------
// buildModel
// ---------------------------------------------------------------------------------------------

const base = {
  project: PROJECT, cfg: CFG,
  board: { status: 'ok', rows: [boardRow()], message: null },
  register: [regRow()],
  journal: { entries: [{ ts: '2026-08-11T14:02:00Z', kind: 'report', task: 'lod/C2', text: 'ready to test on :5307' }], skipped: 0 },
  inbox: { entries: [], skipped: 0 }, servers: [{ port: 5307, pid: 1 }],
  worktrees: new Map([['lod/c2-derived-switch', '/x/c2-derived-switch']]),
};

// New: the delta itself — `buildModel` no longer computes `project`, it only carries whatever the
// caller hands it, verbatim, into the JSON.
test('buildModel passes the project block straight through to the output, unread', () => {
  const project = { name: 'demo', root: '/repo', mode: 'offline', branch: 'feature/x', id: 'deadbe', port: 4391 };
  const m = buildModel({ ...base, project });
  assert.deepEqual(m.project, project);
});

// A finished roadmap must leave the screen. Archiving cannot do it: `lib/register/archive.mjs`
// triggers on a ROW's status and deliberately keeps the row as a stripped tombstone, because
// `computeReadySet` (`lib/register/ready.mjs`) validates deps on every row including terminal ones
// and `progress.mjs` tallies `landed`. So the rule lives here, stated once.
test('buildModel drops the nodes of a roadmap whose programme issue is closed', () => {
  const m = buildModel({ ...base, register: [],
    board: { status: 'ok', message: null, rows: [
      boardRow({ key: 'done/A1', id: 'A1', roadmap: 'done', branch: 'done/a1', status: 'landed', programmeState: 'closed' }),
      boardRow({ key: 'live/B1', id: 'B1', roadmap: 'live', branch: 'live/b1', status: 'todo', programmeState: 'open' }),
    ] } });
  assert.deepEqual(m.nodes.map((n) => n.key), ['live/B1']);
});

// The channel can only close what it has adopted. The register still holds rows from roadmaps that
// predate the shared channel — no task issue, so no programmeState, and the rule above can never
// fire on them. A roadmap nobody adopted has ended when its last row stops moving: every row
// terminal (landed or dropped) and no programme issue saying otherwise. One live row keeps the
// whole frame, landed siblings included — the same way an open roadmap shows its history.
test('buildModel drops a roadmap the channel never adopted once its last row is terminal', () => {
  const m = buildModel({ ...base,
    board: { status: 'ok', message: null, rows: [] },
    register: [
      regRow({ id: 'orchestra/W4', branch: 'orchestra/w4-standdown', status: 'landed' }),
      regRow({ id: 'orchestra/X1', branch: 'orchestra/x1-backup-refs', status: 'dropped' }),
      regRow({ id: 'gate/GT7', branch: 'gate/gt7-vacuous', status: 'landed' }),
      regRow({ id: 'gate/GT8', branch: 'gate/gt8-final-recut', status: 'claimed' }),
    ] });
  const frames = [...new Set(m.nodes.map((n) => n.roadmap))];
  assert.deepEqual(frames, ['gate']);
  assert.ok(m.nodes.map((n) => n.key).includes('gate/GT7'));
});

// An open programme is the channel's word that work remains — but not necessarily HERE. When the
// only undone tasks are another developer's, this register drops its rows and every local row is
// terminal: landed plus dropped is a finished roadmap on this screen, whatever the programme issue
// says (user ruling 2026-09-02, in planetCraft).
test('buildModel drops a roadmap whose remaining work is another developer\'s, even while its programme stays open', () => {
  const m = buildModel({ ...base,
    board: { status: 'ok', message: null, rows: [
      boardRow({ key: 'pixels/Q1', id: 'Q1', roadmap: 'pixels', branch: 'pixels/q1', status: 'landed', programmeState: 'open' }),
      boardRow({ key: 'pixels/Q4', id: 'Q4', roadmap: 'pixels', branch: 'pixels/q4', status: 'todo', mine: false, owner: 'alice', programmeState: 'open' }),
      boardRow({ key: 'menage/Z1', id: 'Z1', roadmap: 'menage', branch: 'clean/z1', status: 'todo', programmeState: 'open' }),
    ] },
    register: [regRow({ id: 'pixels/Q4', branch: 'pixels/q4-dynamic-resolution', status: 'dropped' })] });
  const frames = [...new Set(m.nodes.map((n) => n.roadmap))];
  assert.deepEqual(frames, ['menage']);
});

// The point of publishing everyone's work is that you can SEE another developer's roadmap without
// being able to start it by accident. A card that looks exactly like mine defeats both halves.
test('buildModel badges a foreign roadmap with its owner, and marks an open one as takeable', () => {
  const m = buildModel({ ...base, register: [],
    board: { status: 'ok', message: null, rows: [
      boardRow({ key: 'x/B1', id: 'B1', roadmap: 'x', branch: 'x/b1', mine: false, owner: 'alice', open: true, programmeState: 'open' }),
    ] } });
  assert.equal(m.nodes[0].mine, false);
  assert.ok(m.nodes[0].badges.includes('@alice'));
  assert.ok(m.nodes[0].badges.includes('open'));
});

test('buildModel treats a row with no ownership recorded as mine, and badges nobody', () => {
  const m = buildModel(base);
  assert.equal(m.nodes[0].mine, true);
  assert.ok(!m.nodes[0].badges.join(' ').includes('@'));
});

test('buildModel prefers the register status, which is what this machine is actually doing', () => {
  assert.equal(buildModel(base).nodes[0].status, 'review');
});

test('buildModel carries the board row\'s own Why as the plain-language description', () => {
  assert.equal(buildModel(base).nodes[0].why, 'The ground stops going chunky.');
});

// New: the second delta. `why`/`acceptance` are read straight off whatever board row joined to
// this node, not out of a `prose` map nobody passes in any more.
test('buildModel reads why/acceptance directly off the joined board row', () => {
  const rows = [boardRow({ why: 'Whys are on the row now.', acceptance: 'So is the acceptance test.' })];
  const m = buildModel({ ...base, board: { status: 'ok', rows, message: null } });
  assert.equal(m.nodes[0].why, 'Whys are on the row now.');
  assert.equal(m.nodes[0].acceptance, 'So is the acceptance test.');
});

// New: the other half of the same delta — a register-only node (no board row joined to it at all)
// has neither, rather than throwing on a `prose` lookup that no longer exists.
test('buildModel gives an empty why/acceptance to a register-only node with no board match', () => {
  const m = buildModel({ ...base, board: { status: 'absent', rows: [], message: 'no board' } });
  assert.equal(m.nodes[0].why, '');
  assert.equal(m.nodes[0].acceptance, '');
});

test('buildModel badges a register row with no roadmap block, and one no session has held', () => {
  const m = buildModel({ ...base, board: { ...base.board, rows: [boardRow({ key: 'lod/C4', id: 'C4', branch: 'lod/c4' })] } });
  assert.ok(m.nodes.find((n) => n.key === 'unfiled/C2').badges.includes('unfiled'));
  assert.ok(m.nodes.find((n) => n.key === 'lod/C4').badges.includes('not adopted'));
});

test('buildModel raises attention on a row with an open pending item, and gives the item an id', () => {
  const pending = [{ kind: 'hands-on', ask: 'compare :5307 · A) keep · B) loosen' }];
  const m = buildModel({ ...base, register: [regRow({ pending })] });
  assert.equal(waitsOnUser(m.nodes[0]), true);
  assert.equal(m.nodes[0].pending[0].id, pendingId('C2', pending[0]));
  assert.deepEqual(m.nodes[0].pending[0].options.map((o) => o.letter), ['A', 'B']);
});

// The user answered on the page and the node kept pulsing red, with nothing anywhere acknowledging
// the answer: `pending[]` clears only when the conductor processes the item, which is minutes away
// at best. The inbox already holds the answer and `unconsumed` already knows whether orchestra has
// taken it — this is those two, read.
{
  const item = { id: 'c2-hands-on-1', kind: 'hands-on', ask: 'does it still tremble?' };
  const said = (over = {}) => ({ entries: [{ ts: '2026-08-12T09:00:00.000Z', task: 'C2',
    pending: 'c2-hands-on-1', answer: 'no, it is steady', from: 'monitor', ...over }], skipped: 0 });
  const model = (over) => buildModel({ ...base, register: [regRow({ pending: [item] })], ...over });

  test('buildModel: an unanswered item shouts while nothing has answered it', () => {
    const [node] = model({ inbox: { entries: [], skipped: 0 } }).nodes;
    assert.equal(waitsOnUser(node), true);
    assert.equal(hasAnAnswer(node), false);
    assert.equal(node.pending[0].answer, null);
    assert.equal(node.pending[0].answeredAt, null);
  });

  test('buildModel: an item goes calm once the user has answered and orchestra has not taken it', () => {
    const [node] = model({ inbox: said(), conductor: { inboxSeen: '2026-08-12T08:00:00.000Z' } }).nodes;
    assert.equal(waitsOnUser(node), false);
    assert.equal(hasAnAnswer(node), true);
    assert.equal(node.pending[0].answer, 'no, it is steady');
    assert.equal(node.pending[0].answeredAt, '2026-08-12T09:00:00.000Z');
  });

  // Consumed means BOTH halves of the unconsumed rule are spent: the conductor has stamped past the
  // answer, and it is older than the grace window that exists for a session that died before
  // relaying it. An item still open after that was re-asked, and re-asking must shout again.
  test('buildModel: an item shouts again once orchestra has taken the answer and the question is still open', () => {
    const ts = new Date(Date.now() - PENDING_GRACE_MS - 60_000).toISOString();
    const [node] = model({ inbox: said({ ts }), conductor: { inboxSeen: new Date().toISOString() } }).nodes;
    assert.equal(waitsOnUser(node), true);
    assert.equal(hasAnAnswer(node), false);
    assert.equal(node.pending[0].answer, null);
  });

  test('buildModel: an item still shouts for the question that has no answer when a sibling has one', () => {
    const open = { id: 'c2-question-2', kind: 'question', ask: 'merge it?' };
    const [node] = model({ register: [regRow({ pending: [item, open] })], inbox: said(),
      conductor: { inboxSeen: '2026-08-12T08:00:00.000Z' } }).nodes;
    assert.equal(waitsOnUser(node), true);
    assert.equal(hasAnAnswer(node), true);
    assert.deepEqual(node.pending.map((p) => p.answer), ['no, it is steady', null]);
  });

  // The free remark is an answer to orchestra, not to a question. Nothing on any node may go calm
  // because of it.
  test('buildModel is untouched by a remark that targets no item', () => {
    const [node] = model({ inbox: said({ pending: null }), conductor: {} }).nodes;
    assert.equal(waitsOnUser(node), true);
    assert.equal(node.pending[0].answer, null);
  });
}

test('buildModel resolves a bare dep to a key inside the same roadmap, and keeps a qualified one', () => {
  const rows = [boardRow(), boardRow({ key: 'lod/C1', id: 'C1', branch: 'lod/c1', deps: [] }),
    boardRow({ key: 'gate/GT9', id: 'GT9', roadmap: 'gate', branch: 'gate/gt9', deps: ['lod/C2'] })];
  const m = buildModel({ ...base, board: { ...base.board, rows }, register: [] });
  assert.deepEqual(m.nodes.find((n) => n.key === 'lod/C2').depKeys, ['lod/C1']);
  assert.deepEqual(m.nodes.find((n) => n.key === 'gate/GT9').depKeys, ['lod/C2']);
});

test('buildModel drops a dep that resolves to nothing rather than drawing an edge into the void', () => {
  const m = buildModel({ ...base, board: { ...base.board, rows: [boardRow({ deps: ['NOPE'] })] } });
  assert.deepEqual(m.nodes[0].depKeys, []);
});

test('buildModel merges the journal and the inbox into one rail, in time order, marked by who spoke', () => {
  const inbox = { entries: [{ ts: '2026-08-11T14:05:00Z', task: 'C2', pending: 'p', answer: 'merge it', from: 'monitor' }], skipped: 0 };
  const rail = buildModel({ ...base, inbox }).rail;
  assert.deepEqual(rail.map((r) => r.from), ['orchestra', 'you']);
  assert.equal(rail[1].text, 'merge it');
  assert.equal(rail[1].task, 'lod/C2');
});

// Measured in planetCraft, 2026-08-12: the conductor journalled INTO inbox.jsonl — the monitor's
// file, of which the monitor is the only writer — in its own schema. Mapped blindly, that line came
// out as `{from:'you', ts:undefined, text:'give it to merge agent'}`: the conductor's action
// rendered as the user's own words, duplicating the sentence they really typed, and sorted above
// everything for want of a ts.
test('buildModel does not quote a foreign inbox line as the user, and counts it as unreadable', () => {
  const inbox = { skipped: 0, entries: [
    { ts: '2026-08-12T06:50:00.000Z', task: 'C2', pending: 'c2-11f5d06c', answer: 'give it to merge agent', from: 'monitor' },
    { kind: 'answer', at: '2026-08-12T06:55:52.199Z', task: 'C2', item: 'c2-11f5d06c', answer: 'give it to merge agent', action: 'merge_agent dispatched on lod/c2-derived-switch tip c645c9a3, five commits, no squash of the two dial commits' },
  ] };
  const m = buildModel({ ...base, inbox });
  const mine = m.rail.filter((r) => r.from === 'you');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].text, 'give it to merge agent');
  assert.equal(m.rail.some((r) => r.text.includes('merge_agent dispatched')), false);
  assert.ok(m.rail.every((r) => (typeof r.ts === 'string' && r.ts !== '') || r.from === 'orchestra'));
  assert.equal(m.journalSkipped, 1);
});

// The same defect on the other file, and the same actor: journal.jsonl was written for the first
// time by a conductor that had just put its own schema in the wrong file. A line with no `ts` used
// to be given `''`, which sorts above everything — the worst failure available to a panel whose
// whole job is chronology.
test('buildModel does not speak for orchestra on a wrong-shape journal line, and it cannot sort above the rest', () => {
  const said = (ts, text) => ({ ts, kind: 'report', task: 'C2', text });
  const journal = { skipped: 0, entries: [
    said('2026-08-12T07:10:00.000Z', 'ready to test on :5307'),
    { kind: 'answer', at: '2026-08-12T06:55:52.199Z', task: 'C2', item: 'c2-11f5d06c', answer: 'give it to merge agent', action: 'merge_agent dispatched on lod/c2-derived-switch tip c645c9a3' },
    said('2026-08-12T07:20:00.000Z', 'landed'),
  ] };
  const m = buildModel({ ...base, journal, inbox: { entries: [], skipped: 0 } });
  assert.deepEqual(m.rail.map((r) => r.text), ['ready to test on :5307', 'landed']);
  assert.ok(m.rail.every((r) => r.from === 'orchestra' && r.ts !== ''));
  assert.equal(m.rail.some((r) => r.text.includes('merge_agent dispatched')), false);
  assert.equal(m.journalSkipped, 1);
  assert.equal(m.rail[0].ts, '2026-08-12T07:10:00.000Z');
});

test('buildModel labels a journal line with no kind as a note instead of rejecting it', () => {
  const journal = { skipped: 0, entries: [{ ts: '2026-08-12T07:10:00.000Z', task: null, text: 'nothing changed this tick' }] };
  const m = buildModel({ ...base, journal, inbox: { entries: [], skipped: 0 } });
  assert.equal(m.rail.length, 1);
  assert.equal(m.rail[0].kind, 'note');
  assert.equal(m.rail[0].task, null);
  assert.equal(m.journalSkipped, 0);
});

test('buildModel keeps counting a truly malformed line alongside a foreign one', () => {
  const inbox = { skipped: 2, entries: [{ ts: '2026-08-12T06:55:52.199Z', task: 'C2', answer: 'ok', from: 'orchestra' }] };
  const m = buildModel({ ...base, inbox });
  assert.deepEqual(m.rail.filter((r) => r.from === 'you'), []);
  assert.equal(m.journalSkipped, 3);
});

test('buildModel attaches a listening port to the node that holds it', () => {
  assert.deepEqual(buildModel(base).nodes[0].servers.map((s) => s.port), [5307]);
});

// New: `serverFor` matches on port ALONE (Task 2's `listServers` probes only the ports the
// register names, so there is no `cwd` to match against). Neither server entry below carries a
// `cwd`, so this pair alone would pass unchanged under the source's cwd-fallback implementation
// too (its OR-branch never fires with no `cwd` to compare) — the two tests after these are the
// ones that actually distinguish the two implementations.
test('buildModel labels a matched server by its port, ignoring a server on some other port', () => {
  const m = buildModel({ ...base, servers: [{ port: 5307, pid: 1 }, { port: 9999, pid: 2 }] });
  assert.deepEqual(m.nodes[0].servers, [{ port: 5307, label: '5307' }]);
});

test('buildModel gives an empty server list to a node whose port nothing listens on', () => {
  const m = buildModel({ ...base, register: [regRow({ port: 6000 })], servers: [{ port: 5307, pid: 1 }] });
  assert.deepEqual(m.nodes[0].servers, []);
});

// The match half of the delta, made to actually fail under the source: a server on a DIFFERENT
// port than the node's own (5307, from `base`'s `regRow`), but whose `cwd` equals
// `worktrees.get(node.branch)` (`base`'s worktrees map, `lod/c2-derived-switch` -> the same
// path) — exactly the shape the source's `s.port === node.port || (path && s.cwd === path)`
// matched on the OR-branch alone. Port-only matching must not return it.
test('buildModel does not match a server by its worktree cwd, only by port', () => {
  const m = buildModel({ ...base, servers: [{ port: 9999, pid: 1, cwd: '/x/c2-derived-switch' }] });
  assert.deepEqual(m.nodes[0].servers, []);
});

// The label half, made to actually fail under the source: a server that DOES match on port, but
// also carries a `cwd` — the source labelled a cwd-bearing entry `cwd.split('/').pop()`
// (`'c2-derived-switch'`), never the port.
test('buildModel labels a matched server by its port, never by its cwd\'s basename', () => {
  const m = buildModel({ ...base, servers: [{ port: 5307, pid: 1, cwd: '/x/c2-derived-switch' }] });
  assert.deepEqual(m.nodes[0].servers, [{ port: 5307, label: '5307' }]);
});

test('buildModel passes the board failure through, so the page can say what is missing', () => {
  const m = buildModel({ ...base, board: { status: 'absent', rows: [], message: 'not here yet' } });
  assert.equal(m.source.board, 'absent');
  assert.equal(m.nodes.length, 1);
  assert.equal(m.nodes[0].key, 'unfiled/C2');
});

test('buildModel gives two register rows unique node keys when both resolve to the same board row, and surfaces the collision', () => {
  const register = [regRow({ id: 'lod/C2', branch: null }), regRow({ id: 'C2', branch: 'lod/c2-derived-switch', port: 9999 })];
  const m = buildModel({ ...base, register });
  const keys = m.nodes.map((n) => n.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(keys.sort(), ['lod/C2', 'unfiled/C2']);
  assert.deepEqual(m.duplicates, ['lod/C2']);
});

// Both halves of the blank-page failure, on the path the page actually takes: the model builds
// unique keys, and `layout` — the first statement of render(), inside the poll's catch-all —
// survives them.
test('buildModel survives two register rows carrying the identical id, and the layout of the result does not throw', () => {
  const register = [regRow({ id: 'C2', branch: null }), regRow({ id: 'C2', branch: null, port: 9999 })];
  const m = buildModel({ ...base, board: { status: 'absent', rows: [], message: 'no board' }, register });
  const keys = m.nodes.map((node) => node.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.doesNotThrow(() => layout(m.nodes));
});

test('buildModel renders a half-written register row that carries no id at all', () => {
  const register = [{ status: 'todo', roadmap: 'lighting', pending: [{ kind: 'question', ask: 'which one?' }] }];
  const m = buildModel({ ...base, board: { status: 'absent', rows: [], message: 'no board' }, register });
  assert.equal(m.nodes.length, 1);
  assert.equal(m.nodes[0].key, 'lighting/(unnamed)');
  assert.equal(m.nodes[0].id, 'lighting/(unnamed)');
  assert.equal(m.nodes[0].pending.length, 1);
  assert.doesNotThrow(() => layout(m.nodes));
});

// The register's own shape: bare ids plus a roadmap SLUG (this plugin's register field — never a
// file path, unlike the source project's — see `lib/register/state.mjs`'s own comment on
// `registerRow`). One frame per roadmap is the design's central idea, and `unfiled` means something
// only if it is not on everything.
test('buildModel frames register rows by the roadmap slug they name, and badges unfiled only when there is none', () => {
  const register = [
    regRow({ id: 'S5', roadmap: 'lighting', branch: null }),
    regRow({ id: 'A5', roadmap: 'lighting', branch: null, deps: ['S5'] }),
    regRow({ id: 'M3', roadmap: 'council', branch: null, deps: [] }),
    regRow({ id: 'ZZ', roadmap: undefined, branch: null, deps: [] }),
  ];
  const m = buildModel({ ...base, board: { status: 'absent', rows: [], message: 'no board' }, register });
  assert.deepEqual(m.nodes.map((node) => node.key).sort(),
    ['council/M3', 'lighting/A5', 'lighting/S5', 'unfiled/ZZ']);
  assert.deepEqual(m.nodes.filter((node) => node.badges.includes('unfiled')).map((node) => node.key), ['unfiled/ZZ']);
  // A bare dep still resolves, inside its own frame and not across frames.
  assert.deepEqual(m.nodes.find((node) => node.key === 'lighting/A5').depKeys, ['lighting/S5']);
  assert.deepEqual(layout(m.nodes).frames.map((f) => f.roadmap), ['council', 'lighting', 'unfiled']);
});

// New: the third delta, exercised through buildModel — the resume line's worktree fallback is
// `cfg.worktrees`, not a hardcoded `.claude/worktrees`.
test('buildModel does not throw when a register row has a session but no branch yet, and gives it a usable resume command under cfg.worktrees', () => {
  const register = [regRow({ id: 'X', branch: null, session: 's1', port: null })];
  const m = buildModel({ ...base, register });
  const node = m.nodes.find((n) => n.key === 'unfiled/X');
  assert.equal(node.invoke.kind, 'resume');
  assert.equal(node.invoke.lines[0], 'claude stop s1');
  assert.ok(node.invoke.lines[1].includes(`${CFG.worktrees}/x`));
});

// The strip across the top of the window. The words are the scheduler's: `lib/register/ready.mjs`
// treats `claimed`/`review` as "in flight" and hands work only to `todo`, so the header counts
// those two and never invents a third meaning for "active". It counts the TAB the page is showing,
// which is why the figures come from `tabsOf` rather than from a second tally on the model: the
// strip describes what is on screen, and a filtered canvas under an unfiltered count is the page
// contradicting itself.
{
  const stripRows = [
    regRow({ id: 'lod/C2', status: 'review', branch: 'a' }),
    regRow({ id: 'lod/C3', status: 'claimed', branch: 'b' }),
    regRow({ id: 'lod/C4', status: 'todo', branch: 'c' }),
    regRow({ id: 'lod/C5', status: 'todo', branch: 'd' }),
    regRow({ id: 'lod/C6', status: 'landed', branch: 'e' }),
    regRow({ id: 'lod/C7', status: 'dropped', branch: 'f' }),
    regRow({ id: 'lod/C8', status: 'built-held', branch: 'g' }),
  ];
  const stripNodes = buildModel({ ...base, board: { status: 'absent', rows: [], message: null }, register: stripRows }).nodes;
  const [{ counts: stripCounts }] = tabsOf(stripNodes);

  test('the board counted for the strip: counts in-flight tasks as active and untouched ones as waiting', () => {
    assert.equal(stripCounts.active, 2);
    assert.equal(stripCounts.waiting, 2);
    assert.equal(stripCounts.landed, 1);
  });

  // `dropped` and `built-held` are in none of the three figures, so without a total the strip
  // would read as though 5 of 5 tasks were accounted for and quietly lose two of them.
  test('the board counted for the strip: carries the total, so the three figures cannot be read as everything there is', () => {
    assert.equal(stripCounts.total, 7);
    assert.ok(stripCounts.active + stripCounts.waiting + stripCounts.landed < stripCounts.total);
  });

  test('the board counted for the strip: counts a task the roadmap defines and no session has adopted', () => {
    const m = buildModel({ ...base, register: [] });
    assert.deepEqual(tabsOf(m.nodes)[0].counts, { active: 1, waiting: 0, landed: 0, total: 1 });
  });

  // Each tab counts its own rows alone: the local figures over the local canvas, hers over hers.
  test("the board counted for the strip: keeps this machine's figures apart from another developer's", () => {
    const m = buildModel({ ...base, register: [], board: { status: 'ok', message: null, rows: [
      boardRow(),
      boardRow({ key: 'pixels/Q1', id: 'Q1', roadmap: 'pixels', branch: 'pixels/q1', status: 'claimed', mine: false, owner: 'alice', programmeState: 'open' }),
      boardRow({ key: 'pixels/Q2', id: 'Q2', roadmap: 'pixels', branch: 'pixels/q2', status: 'todo', mine: false, owner: 'alice', programmeState: 'open' }),
    ] } });
    const tabs = tabsOf(m.nodes);
    assert.deepEqual(tabs[0].counts, { active: 1, waiting: 0, landed: 0, total: 1 });
    assert.deepEqual(tabs[1].counts, { active: 1, waiting: 1, landed: 0, total: 2 });
  });
}

// ---------------------------------------------------------------------------------------------
// invokeCommand
// ---------------------------------------------------------------------------------------------

test('invokeCommand gives the resume cycle for a live session, in the worktree that holds it', () => {
  const node = { id: 'C2', branch: 'lod/c2-derived-switch', session: 'c4a1e4a7-1111-2222-3333-444444444444', status: 'review' };
  const { kind, lines } = invokeCommand(node, new Map([['lod/c2-derived-switch', '/x/c2']]), CFG);
  assert.equal(kind, 'resume');
  assert.equal(lines[0], 'claude stop c4a1e4a7');
  assert.ok(lines[1].includes('cd /x/c2'));
  assert.ok(lines[1].includes('--resume c4a1e4a7-1111-2222-3333-444444444444'));
});

test('invokeCommand gives the launch cycle for a task nobody holds', () => {
  const node = { id: 'C4', branch: 'lod/c4-prefetch', session: null, status: 'todo', design: false };
  const { kind, lines } = invokeCommand(node, new Map(), CFG);
  assert.equal(kind, 'launch');
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes(`git worktree add ${CFG.worktrees}/c4 -b lod/c4-prefetch ${CFG.mainBranch}`));
  assert.ok(lines[1].includes(`-n orchestra-${CFG.id}-c4`));
  assert.ok(lines[1].includes('--model opus'));
});

test('invokeCommand offers nothing for a landed task', () => {
  assert.equal(invokeCommand({ id: 'C1', branch: 'lod/c1', session: null, status: 'landed' }, new Map(), CFG).kind, 'none');
});

test('invokeCommand does not throw for a session recorded before its branch, and falls back to the id-derived worktree slug', () => {
  const node = { id: 'X', branch: null, session: 's1', status: 'review' };
  const { kind, lines } = invokeCommand(node, new Map(), CFG);
  assert.equal(kind, 'resume');
  assert.equal(lines[0], 'claude stop s1');
  assert.ok(lines[1].includes(`${CFG.worktrees}/x`));
});

// New: the delta itself, word for word against `skills/orchestra/SKILL.md`'s worked example
// (project `a3f19c`, row `lod/C2` -> `orchestra-a3f19c-lod-c2`) — the session name, the worktree
// path built from `cfg.worktrees` and `cfg.mainBranch`, and no dependency-install line at all.
test('invokeCommand builds the session name and worktree slug from cfg, and drops the dependency-install line', () => {
  const node = { id: 'lod/C2', branch: 'lod/c2-derived-switch', session: null, status: 'todo', design: false };
  const cfg = { id: 'a3f19c', worktrees: '.orchestra/worktrees', mainBranch: 'develop' };
  const { kind, lines } = invokeCommand(node, new Map(), cfg);
  assert.equal(kind, 'launch');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'git worktree add .orchestra/worktrees/lod-c2 -b lod/c2-derived-switch develop');
  assert.equal(lines[1], 'claude --bg -n orchestra-a3f19c-lod-c2 --model opus --dangerously-skip-permissions "<brief>"');
  assert.ok(!lines.some((l) => l.includes('npm install')));
});

// ---------------------------------------------------------------------------------------------
// the images orchestra names in its own prose — where they land in the model
// ---------------------------------------------------------------------------------------------

test('buildModel hangs an ask\'s pictures on the pending item that asks about them, resolved against the task\'s worktree', () => {
  const pending = [{ kind: 'hands-on', ask: 'which arm reads better? c1-main.png vs top.png' }];
  const m = buildModel({ ...base, register: [regRow({ pending })], findImage: stubFind });
  assert.deepEqual(m.nodes[0].pending[0].images.map((i) => i.rel), [
    'lod/c2-derived-switch:c1-main.png',
    'lod/c2-derived-switch:top.png',
  ]);
});

test('buildModel resolves a rail line\'s pictures against the worktree of the task the line is about', () => {
  const journal = { entries: [{ ts: '2026-08-12T09:00:00Z', kind: 'report', task: 'C2', text: 'captured reports/ab.png' }], skipped: 0 };
  const m = buildModel({ ...base, journal, findImage: stubFind });
  assert.equal(m.rail[0].images[0].rel, 'lod/c2-derived-switch:reports/ab.png');
});

test('buildModel carries the conductor note\'s pictures, which the card shows even when a roadmap Why exists', () => {
  const m = buildModel({ ...base, register: [regRow({ note: 'measured on top.png' })], findImage: stubFind });
  assert.deepEqual(m.nodes[0].noteImages.map((i) => i.rel), ['lod/c2-derived-switch:top.png']);
});

// A reader with no filesystem under it cannot honestly report a file as present OR as missing.
test('buildModel claims no image either way when no resolver was given', () => {
  const register = [regRow({ note: 'top.png', pending: [{ kind: 'q', ask: 'top.png' }] })];
  const m = buildModel({ ...base, register, findImage: null });
  assert.deepEqual(m.nodes[0].noteImages, []);
  assert.deepEqual(m.nodes[0].pending[0].images, []);
});
