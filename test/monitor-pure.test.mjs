// lib/monitor/clock.mjs, layout.mjs, progress.mjs, tabs.mjs and answers.mjs: the small pure
// modules the page and this suite share, ported from the source project's
// `tools/orchestra/monitor/{clock,layout,progress,tabs,answers}.mjs` and their test suite's
// "the clock", `layout`, "the progress bar", "the developer tabs" and "what the page remembers of
// an answer" describe blocks (plus the images group's "the notification list"). None of this phase's
// three deltas touch these five modules — every test here is a straight port, adjusted only from
// vitest's `describe`/`it`/`expect` to `node:test`'s flat `test` and `assert/strict`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clock } from '../lib/monitor/clock.mjs';
import { layout, METRICS } from '../lib/monitor/layout.mjs';
import { segments } from '../lib/monitor/progress.mjs';
import { LOCAL, tabsOf, nodesOf } from '../lib/monitor/tabs.mjs';
import { slotOf, openSlots, dropClosed, openItems, openQuestions } from '../lib/monitor/answers.mjs';
import { buildModel } from '../lib/monitor/model.mjs';

// The two readings the page makes of `openItems` — see the identical helper and comment in
// test/monitor-model.test.mjs; duplicated rather than imported because it is test-only, two lines,
// and not part of either module's exported surface.
const waitsOnUser = (node, sent) => openItems(node, sent).length > 0;
const hasAnAnswer = (node, sent) => node.pending.length > openItems(node, sent).length;

// ---------------------------------------------------------------------------------------------
// the clock
// ---------------------------------------------------------------------------------------------

// Node re-reads process.env.TZ on the next Date/Intl call, so a zone can be pinned in-process;
// restored either way, because a leaked TZ would silently re-zone every test after this one.
const inZone = (tz, fn) => {
  const had = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { if (had === undefined) delete process.env.TZ; else process.env.TZ = had; }
};

test("clock renders a UTC instant on the machine's own clock, whatever its offset is that day", () => {
  inZone('Europe/Paris', () => {
    assert.equal(clock('2026-08-12T15:40:00.000Z'), '17:40');   // CEST, +2
    assert.equal(clock('2026-01-05T15:40:00.000Z'), '16:40');   // CET, +1 — the offset is not a constant
    assert.equal(clock('2026-08-12T22:10:00.000Z'), '00:10');   // an hour a string slice cannot reach at all
  });
  inZone('Asia/Tokyo', () => assert.equal(clock('2026-08-12T15:40:00.000Z'), '00:40'));
});

// The zone follows the machine; the FORMAT does not. This column is monospace HH:MM, and a reader's
// own locale would have put "11:40 AM" in it.
test('clock stays on the 24-hour clock, and renders midnight as 00:00 rather than 24:00', () => {
  inZone('America/New_York', () => assert.equal(clock('2026-08-12T15:40:00.000Z'), '11:40'));
  inZone('UTC', () => assert.equal(clock('2026-08-12T00:00:00.000Z'), '00:00'));
});

// A stamp with no zone designator is local time by the language's own rule, so a conductor that
// forgets the Z is shown the hour it wrote, not one shifted by an offset it never meant.
test('clock takes a stamp written without a zone as local, which is what the language says it is', () => {
  inZone('Europe/Paris', () => assert.equal(clock('2026-08-12T15:40:00'), '15:40'));
});

test('clock shows a stamp it cannot read exactly as it was written, and an absent one as nothing', () => {
  assert.equal(clock('not a date at all'), 'not a date at all');
  assert.equal(clock(''), '');
  assert.equal(clock(null), '');
  assert.equal(clock(undefined), '');
});

// ---------------------------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------------------------

const n = (key, depKeys = [], over = {}) => ({
  key, roadmap: key.split('/')[0], order: 1, depKeys, status: 'todo', ...over,
});

test('layout ranks a chain by dependency depth inside its frame', () => {
  const { positions } = layout([n('lod/C1'), n('lod/C2', ['lod/C1']), n('lod/C4', ['lod/C2'])]);
  const y = (k) => positions.get(k).y;
  assert.ok(y('lod/C1') < y('lod/C2'));
  assert.ok(y('lod/C2') < y('lod/C4'));
});

test('layout puts two independent tasks side by side, at the same rank', () => {
  const { positions } = layout([n('lod/C1', [], { order: 1 }), n('lod/C9', [], { order: 2 })]);
  assert.equal(positions.get('lod/C1').y, positions.get('lod/C9').y);
  assert.ok(positions.get('lod/C1').x < positions.get('lod/C9').x);
});

test('layout orders a rank by Order, and a task with none sorts last', () => {
  const { positions } = layout([n('a/Z', [], { order: null }), n('a/B', [], { order: 5 }), n('a/A', [], { order: 1 })]);
  const xs = ['a/A', 'a/B', 'a/Z'].map((k) => positions.get(k).x);
  assert.ok(xs[0] < xs[1]);
  assert.ok(xs[1] < xs[2]);
});

// The user drags a roadmap by its title to arrange the board. The automatic flow packs frames left
// to right in NAME order, which is an arrangement nobody chose.
{
  const placedNodes = [n('lighting/S5'), n('lod/C1'), n('lod/C2', ['lod/C1']), n('zz/Z1')];
  const placed = new Map([['lod', { x: 900, y: 400 }]]);

  test('layout: a placed roadmap sits exactly where it was dropped, and takes its own nodes with it', () => {
    const g = layout(placedNodes, { placed });
    const lod = g.frames.find((f) => f.roadmap === 'lod');
    assert.deepEqual([lod.x, lod.y], [900, 400]);
    assert.equal(lod.placed, true);
    for (const key of ['lod/C1', 'lod/C2']) {
      assert.ok(g.positions.get(key).x >= 900);
      assert.ok(g.positions.get(key).y >= 400);
    }
    assert.ok(g.positions.get('lod/C1').y < g.positions.get('lod/C2').y);
  });

  // Out of the flow, not merely moved out of the way: otherwise the frames still flowing would keep
  // a hole where it used to be, and a board arranged by hand would be full of gaps.
  test('layout: a placed roadmap leaves no gap behind it — the frames still flowing close up', () => {
    const g = layout(placedNodes, { placed });
    const withoutIt = layout(placedNodes.filter((x) => x.roadmap !== 'lod'), {});
    for (const roadmap of ['lighting', 'zz']) {
      const a = g.frames.find((f) => f.roadmap === roadmap);
      const b = withoutIt.frames.find((f) => f.roadmap === roadmap);
      assert.deepEqual([a.x, a.y], [b.x, b.y]);
    }
    assert.equal(g.frames.find((f) => f.roadmap === 'zz').placed, false);
  });

  test('layout: a placed roadmap is inside the graph the view is measured against', () => {
    const g = layout(placedNodes, { placed });
    const lod = g.frames.find((f) => f.roadmap === 'lod');
    assert.ok(g.width >= lod.x + lod.w);
    assert.ok(g.height >= lod.y + lod.h);
  });

  test('layout lays the board out exactly as before when nothing has been placed', () => {
    assert.deepEqual(layout(placedNodes, { placed: new Map() }), layout(placedNodes));
  });
}

test('layout gives each roadmap its own frame, counted and never overlapping', () => {
  const { frames } = layout([n('lod/C1', [], { status: 'landed' }), n('lod/C2'), n('lighting/S5')]);
  const lod = frames.find((f) => f.roadmap === 'lod');
  assert.deepEqual(lod.counts, { active: 0, waiting: 1, landed: 1, total: 2 });
  const light = frames.find((f) => f.roadmap === 'lighting');
  assert.ok(light.x + light.w <= lod.x);
});

test('layout draws a cross-roadmap dep as an edge without letting it move a rank', () => {
  const { positions, edges } = layout([n('lod/C2'), n('gate/GT9', ['lod/C2'])]);
  assert.deepEqual(edges, [{ from: 'lod/C2', to: 'gate/GT9', cross: true }]);
  assert.equal(positions.get('gate/GT9').y, positions.get('lod/C2').y);
});

test('layout breaks a dependency cycle by Order and warns on the frame instead of refusing to draw', () => {
  const { frames, positions } = layout([n('a/A', ['a/B'], { order: 1 }), n('a/B', ['a/A'], { order: 2 })]);
  assert.match(frames[0].warning, /cycle/i);
  assert.notEqual(positions.get('a/A'), undefined);
  assert.notEqual(positions.get('a/B'), undefined);
});

test('layout does not blame a task merely downstream of a cycle, and gives it its true rank', () => {
  const { frames, positions } = layout([
    n('a/A', ['a/B'], { order: 1 }),
    n('a/B', ['a/A'], { order: 2 }),
    n('a/F', ['a/A'], { order: 3 }),
  ]);
  assert.match(frames[0].warning, /^1 task/);
  assert.notEqual(positions.get('a/F').y, positions.get('a/A').y);
});

test('layout collapses a frame to its title bar and keeps its nodes out of the canvas', () => {
  const { frames, positions } = layout([n('lod/C1'), n('lighting/S5')], { collapsed: new Set(['lod']) });
  const lod = frames.find((f) => f.roadmap === 'lod');
  assert.equal(lod.collapsed, true);
  assert.equal(lod.h, METRICS.frameTitle);
  assert.equal(positions.has('lod/C1'), false);
});

test('layout is deterministic — the same nodes in a different array order give byte-identical geometry', () => {
  const nodes = [n('lod/C2', ['lod/C1']), n('lod/C1'), n('lighting/S5'), n('gate/GT9', ['lighting/S5'])];
  const reordered = [nodes[3], nodes[1], nodes[2], nodes[0]];
  const snapshot = (r) => JSON.stringify({ frames: r.frames, positions: [...r.positions], edges: r.edges, width: r.width, height: r.height });
  assert.equal(snapshot(layout(nodes)), snapshot(layout(reordered)));
});

test('layout wraps frames onto a second row once the canvas width is exceeded', () => {
  const many = Array.from({ length: 12 }, (_, i) => n(`r${i}/T`));
  const { frames } = layout(many);
  assert.ok(frames.some((f) => f.y > frames[0].y));
});

test('layout wraps a rank wider than the wrap width onto more than one line', () => {
  const wide = Array.from({ length: METRICS.wrapWidth + 2 }, (_, i) => n(`a/T${i}`, [], { order: i }));
  const { positions } = layout(wide);
  const ys = new Set(wide.map((node) => positions.get(node.key).y));
  assert.ok(ys.size > 1);
});

test('layout keeps every node of a wrapped rank above every node of the next rank', () => {
  const wide = Array.from({ length: METRICS.wrapWidth + 3 }, (_, i) => n(`a/T${i}`, [], { order: i }));
  const downstream = n('a/D', [wide[0].key], { order: 100 });
  const { positions } = layout([...wide, downstream]);
  const maxWideY = Math.max(...wide.map((node) => positions.get(node.key).y));
  assert.ok(positions.get('a/D').y > maxWideY);
});

test('layout bounds the frame width by the wrap width, not by how many tasks share a rank', () => {
  const many = Array.from({ length: METRICS.wrapWidth * 3 }, (_, i) => n(`a/T${i}`, [], { order: i }));
  const { frames } = layout(many);
  const expectedW = METRICS.framePad * 2 + METRICS.wrapWidth * METRICS.nodeW + (METRICS.wrapWidth - 1) * METRICS.gapX;
  assert.equal(frames[0].w, expectedW);
});

test('layout is deterministic for a wrapped rank too — the same nodes in a different array order give byte-identical geometry', () => {
  const nodes = Array.from({ length: METRICS.wrapWidth + 4 }, (_, i) => n(`a/T${i}`, [], { order: i }));
  const reordered = [...nodes].reverse();
  const snapshot = (r) => JSON.stringify({ frames: r.frames, positions: [...r.positions], edges: r.edges, width: r.width, height: r.height });
  assert.equal(snapshot(layout(nodes)), snapshot(layout(reordered)));
});

test('layout returns zero width and height for an empty node list, not -Infinity', () => {
  const { frames, positions, edges, width, height } = layout([]);
  assert.deepEqual(frames, []);
  assert.equal(positions.size, 0);
  assert.deepEqual(edges, []);
  assert.equal(width, 0);
  assert.equal(height, 0);
});

test('layout lays out a single node inside its own frame', () => {
  const { frames, positions } = layout([n('a/A')]);
  assert.equal(frames.length, 1);
  assert.deepEqual(positions.get('a/A'), { x: METRICS.framePad, y: METRICS.frameTitle + METRICS.framePad });
});

test('layout ignores a dependency naming a key absent from the entire input', () => {
  const { positions, edges } = layout([n('a/A', ['a/ghost'])]);
  assert.notEqual(positions.get('a/A'), undefined);
  assert.deepEqual(edges, []);
});

test('layout ignores a collapsed roadmap name that does not appear in the input', () => {
  const { frames, positions } = layout([n('a/A')], { collapsed: new Set(['ghostRoadmap']) });
  assert.equal(frames[0].collapsed, false);
  assert.notEqual(positions.get('a/A'), undefined);
});

test('layout treats a self-dependency as a one-node cycle rather than crashing', () => {
  const { frames, positions } = layout([n('a/A', ['a/A'])]);
  assert.match(frames[0].warning, /^1 task/);
  assert.notEqual(positions.get('a/A'), undefined);
});

// The rank loop counted ROWS while ranking KEYS, so a repeated key left it one short forever; it
// then stalled with nothing to break and threw on `undefined.key`, inside the page's render step,
// inside the poll's catch-all — a blank canvas that never polled again. It must place them and say
// so.
test('layout places nodes that share a key instead of throwing, and warns that they overlap', () => {
  const { frames, positions } = layout([n('a/A'), n('a/A'), n('a/B', ['a/A'])]);
  assert.match(frames[0].warning, /share a key/);
  assert.notEqual(positions.get('a/A'), undefined);
  assert.ok(positions.get('a/B').y > positions.get('a/A').y);
});

// ---------------------------------------------------------------------------------------------
// the progress bar
// ---------------------------------------------------------------------------------------------

const counts = (over) => ({ active: 0, waiting: 0, landed: 0, total: 0, ...over });
const frac = (segs) => segs.reduce((sum, s) => sum + s.frac, 0);

test('segments splits the total into bands in the order the bar is read', () => {
  const segs = segments(counts({ landed: 5, active: 2, waiting: 3, total: 10 }));
  assert.deepEqual(segs.map((s) => s.band), ['landed', 'active', 'waiting']);
  assert.deepEqual(segs.map((s) => s.n), [5, 2, 3]);
  assert.ok(Math.abs(frac(segs) - 1) < 1e-9);
});

// `dropped`, `built-held` and `paused` are in none of the three figures the scheduler names. Left
// out, they would not leave a gap in the bar — they would make every other band proportionally
// WIDER, and a roadmap holding three paused tasks out of ten would draw as finished.
test('segments gives every task not in one of the three named states a band of its own', () => {
  const segs = segments(counts({ landed: 5, active: 1, waiting: 1, total: 10 }));
  assert.equal(segs.find((s) => s.band === 'other').n, 3);
  assert.ok(Math.abs(frac(segs) - 1) < 1e-9);
  assert.ok(Math.abs(segs.find((s) => s.band === 'landed').frac - 0.5) < 1e-9);
});

test('segments draws no band for a state nobody is in, so a bar and a legend built from it agree', () => {
  const segs = segments(counts({ landed: 4, total: 4 }));
  assert.deepEqual(segs.map((s) => s.band), ['landed']);
  assert.equal(segs[0].frac, 1);
});

// An empty register is the page's own documented state ("orchestra has not adopted anything yet"),
// and a bar is not the thing that should discover it by dividing by zero.
test('segments is empty for a board with no task at all, rather than NaN-wide', () => {
  assert.deepEqual(segments(counts({})), []);
});

// ---------------------------------------------------------------------------------------------
// the developer tabs
// ---------------------------------------------------------------------------------------------

const tabNode = (over = {}) => ({ key: 'lod/C2', id: 'C2', roadmap: 'lod', title: 'Derived switch',
  status: 'claimed', mine: true, owner: null, open: false, ...over });
const foreign = (over = {}) => tabNode({ mine: false, owner: 'alice', roadmap: 'pixels',
  key: 'pixels/Q1', id: 'Q1', status: 'claimed', ...over });

test('tabsOf puts the local view first, and keeps it before orchestra has adopted anything', () => {
  assert.deepEqual(tabsOf([]).map((t) => t.id), [LOCAL]);
  assert.deepEqual(tabsOf([foreign()]).map((t) => t.id), [LOCAL, 'alice']);
});

test('tabsOf gives a developer a tab only while they have unfinished work', () => {
  const done = [foreign({ status: 'landed' }), foreign({ key: 'pixels/Q2', id: 'Q2', status: 'dropped' })];
  assert.deepEqual(tabsOf(done).map((t) => t.id), [LOCAL]);
  assert.deepEqual(tabsOf([...done, foreign({ key: 'pixels/Q3', id: 'Q3', status: 'todo' })]).map((t) => t.id),
    [LOCAL, 'alice']);
});

test('tabsOf sorts the other developers by name, so the bar is stable between polls', () => {
  const tabs = tabsOf([foreign({ owner: 'zoe' }), foreign({ key: 'x/B1', id: 'B1', owner: 'bob' })]);
  assert.deepEqual(tabs.map((t) => t.id), [LOCAL, 'bob', 'zoe']);
  assert.deepEqual(tabs.map((t) => t.label), ['local', '@bob', '@zoe']);
});

// A null author is a real state; a row someone owns must not silently fold into the local view just
// because the channel could not say who.
test('tabsOf names a developer the channel did not identify rather than folding them into local', () => {
  const tabs = tabsOf([foreign({ owner: null })]);
  assert.deepEqual(tabs.map((t) => t.id), [LOCAL, '?']);
});

test('tabsOf counts each tab from its own nodes alone', () => {
  const tabs = tabsOf([tabNode(), tabNode({ key: 'lod/C3', id: 'C3', status: 'landed' }),
    foreign(), foreign({ key: 'pixels/Q2', id: 'Q2', status: 'todo' })]);
  assert.deepEqual(tabs[0].counts, { active: 1, waiting: 0, landed: 1, total: 2 });
  assert.deepEqual(tabs[1].counts, { active: 1, waiting: 1, landed: 0, total: 2 });
});

// A tab is a filter and nothing else: the same frames, the same cards, the same graph, drawn from a
// subset of the rows. What another developer's rows lack — a session, a pending question — the page
// already renders honestly for a task no session here has taken.
test('nodesOf gives the local tab my rows, including the ones with no ownership recorded', () => {
  const mine = tabNode();
  const unowned = tabNode({ key: 'unfiled/X1', id: 'X1', mine: true });
  assert.deepEqual(nodesOf([mine, foreign(), unowned], LOCAL), [mine, unowned]);
});

test("nodesOf gives a developer's tab their rows and nobody else's", () => {
  const hers = foreign();
  assert.deepEqual(nodesOf([tabNode(), hers, foreign({ key: 'x/B1', id: 'B1', owner: 'bob' })], 'alice'), [hers]);
});

// Every terminal row of theirs stays on their tab: a roadmap shows its history the same way mine
// does. What ends is the TAB (tabsOf above), not the rows inside it.
test("nodesOf keeps their landed rows, so their tab reads like any other roadmap view", () => {
  const done = foreign({ key: 'pixels/Q0', id: 'Q0', status: 'landed' });
  assert.deepEqual(nodesOf([done, foreign()], 'alice').map((n) => n.id), ['Q0', 'Q1']);
});

test('nodesOf draws nothing for a developer the board no longer names', () => {
  assert.deepEqual(nodesOf([foreign()], 'bob'), []);
});

// ---------------------------------------------------------------------------------------------
// what the page remembers of an answer
// ---------------------------------------------------------------------------------------------

{
  const item = { kind: 'hands-on', ask: 'does it tremble standing still, or only while moving?' };
  const answerModel = (pending) => buildModel({
    project: { name: 'p', root: '/r', mode: 'offline', branch: 'main', id: 'abc123', port: 4380 },
    cfg: { id: 'abc123', worktrees: '.orchestra/worktrees', mainBranch: 'main' },
    board: { status: 'absent', rows: [], message: 'no board' },
    register: [{ id: 'C2', roadmap: 'ROADMAP', title: 'Derived LOD switch distance', status: 'review', deps: [], touches: [], pending }],
    journal: { entries: [], skipped: 0 }, inbox: { entries: [], skipped: 0 },
    servers: [],
  });

  // The sequence a tab left open for a day actually goes through. The pending id of an item with no
  // id of its own is a hash of row/kind/ask — no time, no nonce — so the SAME slot key comes back
  // when the same question is asked again. Cached past the item's life, the second round would
  // render as already answered and disabled, with only a reload to get out of it.
  test('dropClosed forgets an answered item once orchestra closes it, so an identical question later is live again', () => {
    const asked = answerModel([item]);
    const slot = slotOf(asked.nodes[0].key, asked.nodes[0].pending[0].id);
    const answered = new Map();

    answered.set(slot, 'sent · orchestra was asked to start');
    dropClosed(answered, asked.nodes);
    assert.equal(answered.has(slot), true);

    dropClosed(answered, answerModel([]).nodes);
    assert.equal(answered.has(slot), false);

    const again = answerModel([{ ...item }]);
    const slotAgain = slotOf(again.nodes[0].key, again.nodes[0].pending[0].id);
    assert.equal(slotAgain, slot);
    assert.equal(answered.has(slotAgain), false);
    assert.equal(openSlots(again.nodes).has(slotAgain), true);
  });

  test('dropClosed keeps what it remembers of the items that are still open', () => {
    const other = { kind: 'question', ask: 'ship it?' };
    const both = answerModel([item, other]);
    const [a, b] = both.nodes[0].pending.map((p) => slotOf(both.nodes[0].key, p.id));
    const answered = new Map([[a, 'sent'], [b, 'sent']]);
    dropClosed(answered, answerModel([other]).nodes);
    assert.deepEqual([...answered.keys()], [b]);
  });

  test('dropClosed drops everything when the task itself leaves the register', () => {
    const asked = answerModel([item]);
    const slot = slotOf(asked.nodes[0].key, asked.nodes[0].pending[0].id);
    assert.equal(dropClosed(new Map([[slot, 'sent']]), []).size, 0);
  });

  // The user clicked "answer", the page said "sent", and the question went on pulsing red and
  // sitting in the corner list — for as long as the conductor took to run a tick, which is minutes.
  // The answer is in the inbox the moment the POST returns; from then on this tab knows something
  // the register does not, and every view of "waiting on you" has to account for it.
  {
    const other = { kind: 'question', ask: 'ship it?' };
    const both = answerModel([item, other]);
    const [answeredNode] = both.nodes;
    const [a, b] = answeredNode.pending.map((p) => slotOf(answeredNode.key, p.id));

    test('a question this tab has just answered is not waiting on the user any more, before any poll has run', () => {
      assert.equal(waitsOnUser(answeredNode), true);
      assert.equal(waitsOnUser(answeredNode, new Set([a, b])), false);
      assert.equal(hasAnAnswer(answeredNode, new Set([a, b])), true);
    });

    test('a question this tab has just answered leaves its sibling waiting, and leaves the corner list showing only that one', () => {
      const sent = new Set([a]);
      assert.equal(waitsOnUser(answeredNode, sent), true);
      assert.equal(hasAnAnswer(answeredNode, sent), true);
      assert.deepEqual(openQuestions(both.nodes, sent).map((q) => q.item), [answeredNode.pending[1].id]);
    });

    test('a question this tab has just answered says nothing about a task whose questions this tab never touched', () => {
      assert.deepEqual(openQuestions(both.nodes, new Set(['some/other:item'])).map((q) => q.item),
        answeredNode.pending.map((p) => p.id));
    });
  }
}

// ---------------------------------------------------------------------------------------------
// the notification list
// ---------------------------------------------------------------------------------------------

const listNode = (over = {}) => ({ key: 'lod/C2', id: 'C2', pending: [], ...over });

test('openQuestions lists one row per unanswered question, and says how many pictures it carries', () => {
  const nodes = [listNode({ pending: [{ id: 'q1', kind: 'hands-on', ask: 'look at this', answer: null, images: [{ rel: 'top.png' }] }] })];
  assert.deepEqual(openQuestions(nodes), [{ key: 'lod/C2', id: 'C2', item: 'q1', kind: 'hands-on', ask: 'look at this', images: 1 }]);
});

// The same rule the red pulse is drawn from: a task with one question answered and one still open
// is waiting on exactly one thing, and the list must not disagree with the node.
test('openQuestions drops an answered question and keeps the open one from the same task', () => {
  const nodes = [listNode({ pending: [
    { id: 'q1', kind: 'question', ask: 'done', answer: 'yes', images: [] },
    { id: 'q2', kind: 'question', ask: 'still open', answer: null, images: [] },
  ] })];
  assert.deepEqual(openQuestions(nodes).map((q) => q.item), ['q2']);
});

test('openQuestions is empty for a register with nothing pending, and for no register at all', () => {
  assert.deepEqual(openQuestions([listNode()]), []);
  assert.deepEqual(openQuestions(undefined), []);
});
