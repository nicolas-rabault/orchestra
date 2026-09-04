// A forest, not a tree. Each roadmap is an independent network inside a titled frame; a roadmap
// may hold several disjoint sub-networks and isolated single nodes, and nothing is attached to a
// root or to a convergence node. The first sketch had every task edge into a `main` node, copied
// from a compositing app's node view: it carried no information the status colour does not
// already carry and turned the graph into a hairball.
//
// The frame is a LABEL, not a graph node. No edge enters it, or it would lie about dependencies.
import { tally } from './progress.mjs';

export const METRICS = {
  nodeW: 176, nodeH: 52, gapX: 28, gapY: 64,
  framePad: 20, frameTitle: 34, frameGap: 40, canvasWidth: 1680,
  // A single rank can hold ten-plus tasks — planetCraft's own register put ~14 at rank 0 alone —
  // and an unbounded row turns the frame into a strip the user pans along rather than a board they
  // read. 6 keeps a frame roughly canvas-width-sized even for a wide rank, checked by eye against
  // that real register.
  wrapWidth: 6,
};

const orderOf = (n) => (n.order ?? Number.POSITIVE_INFINITY);
const byOrderThenKey = (a, b) => orderOf(a) - orderOf(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const byFromThenTo = (a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));

// Kahn over the deps that stay inside this frame. A cross-roadmap dep is drawn but never ranked:
// ranking it would couple two frames' vertical positions, so one roadmap's depth would deform
// another's.
//
// A cycle means a mis-written roadmap. The view must render a wrong roadmap rather than refuse
// it, so when the frontier runs dry with nodes still unranked, that is a real cycle: break it
// minimally by placing its lowest-Order (then lowest-key) stalled node at rank 0 and letting
// Kahn resume around it. That node is the only one the warning names — everything else stalled
// behind it (including a node merely downstream of the cycle, not part of it) gets its true rank
// once the break makes it reachable. Each break ranks exactly one node, so the unranked set
// shrinks every iteration and the loop always terminates.
//
// The loop is bounded by the number of distinct KEYS, never by nodes.length: two rows sharing a
// key are ranked together by the first of them, so counting rows waits forever for a node already
// placed. Measured in planetCraft: that stall reached `const [victim] = [].sort()` and threw on
// `.key` — inside the page's render step, inside the poll's catch-all that says "the server is
// down", so the page became a blank canvas that never polled again and a reload reproduced it.
// Bounded by keys, the loop cannot stall with nothing to break: rank.size < keys.size means some
// key is unranked, and at least one node carries that key. Sharing a key is still wrong — two
// nodes are drawn on the same spot — so the frame says so.
function rankFrame(nodes) {
  const keys = new Set(nodes.map((n) => n.key));
  const inside = new Map(nodes.map((n) => [n.key, n.depKeys.filter((d) => keys.has(d))]));
  const rank = new Map();
  const broken = [];

  let frontier = nodes.filter((n) => inside.get(n.key).length === 0);
  for (const n of frontier) rank.set(n.key, 0);

  while (rank.size < keys.size) {
    frontier = nodes.filter((n) => !rank.has(n.key) && inside.get(n.key).every((d) => rank.has(d)));
    if (frontier.length) {
      for (const n of frontier) rank.set(n.key, 1 + Math.max(...inside.get(n.key).map((d) => rank.get(d))));
      continue;
    }
    const [victim] = nodes.filter((n) => !rank.has(n.key)).sort(byOrderThenKey);
    rank.set(victim.key, 0);
    broken.push(victim);
  }

  const warnings = [
    broken.length ? `${broken.length} task(s) in a dependency cycle, placed by Order` : null,
    nodes.length > keys.size ? `${nodes.length - keys.size} task(s) share a key and are drawn on top of each other` : null,
  ].filter(Boolean);
  return { rank, warning: warnings.length ? warnings.join(' · ') : null };
}

// `placed` is where the USER has put a frame: a map of roadmap -> {x, y} in graph coordinates, which
// wins over the automatic flow for that frame and for every node inside it. Two consequences are
// deliberate. A placed frame is taken OUT of the flow entirely — it never advances the pen — so the
// roadmaps still flowing close up behind it instead of leaving a hole where it used to be. And the
// graph's own width and height are measured over every frame afterwards, placed ones included, so a
// roadmap dragged out to the right stays reachable by a normal pan and by `fit`.
export function layout(nodes, { collapsed = new Set(), placed = new Map() } = {}) {
  const byRoadmap = new Map();
  for (const n of nodes) byRoadmap.set(n.roadmap, [...(byRoadmap.get(n.roadmap) ?? []), n]);

  const frames = [];
  const positions = new Map();
  let penX = 0;
  let penY = 0;
  let rowH = 0;

  for (const roadmap of [...byRoadmap.keys()].sort()) {
    const own = byRoadmap.get(roadmap);
    const isCollapsed = collapsed.has(roadmap);
    const { rank, warning } = rankFrame(own);

    const rows = new Map();
    for (const n of own) rows.set(rank.get(n.key), [...(rows.get(rank.get(n.key)) ?? []), n]);
    const ranked = [...rows].sort((a, b) => a[0] - b[0]);

    // Each rank flows onto as many LINES as it needs — `wrapWidth` nodes per line — instead of
    // one unbounded row: a rank's nodes stay together and every one of them sits above every
    // node of the next rank (ranks are pushed in order, never interleaved), but a rank wider than
    // `wrapWidth` wraps onto a second line rather than stretching the frame arbitrarily wide.
    const lines = [];
    for (const [, rowNodes] of ranked) {
      const sorted = [...rowNodes].sort(byOrderThenKey);
      for (let i = 0; i < sorted.length; i += METRICS.wrapWidth) lines.push(sorted.slice(i, i + METRICS.wrapWidth));
    }
    const depth = lines.length;
    // Any rank wider than wrapWidth contributes at least one full-width line, so the frame's
    // width comes from the wrap width, not from how many tasks happen to share a rank; a rank
    // that never wraps just uses less than that.
    const widest = Math.min(Math.max(...ranked.map(([, r]) => r.length)), METRICS.wrapWidth);

    const w = METRICS.framePad * 2 + widest * METRICS.nodeW + (widest - 1) * METRICS.gapX;
    const h = isCollapsed ? METRICS.frameTitle
      : METRICS.frameTitle + METRICS.framePad * 2 + depth * METRICS.nodeH + (depth - 1) * METRICS.gapY;

    // Where the user put it, or the next slot in the flow. A placed frame leaves the pen untouched:
    // it is no longer part of the row being filled, so it neither reserves a gap nor pushes the
    // frame after it sideways.
    const put = placed.get(roadmap);
    let x;
    let y;
    if (put) {
      x = put.x;
      y = put.y;
    } else {
      if (penX > 0 && penX + w > METRICS.canvasWidth) { penX = 0; penY += rowH + METRICS.frameGap; rowH = 0; }
      x = penX;
      y = penY;
      penX = x + w + METRICS.frameGap;
      rowH = Math.max(rowH, h);
    }

    if (!isCollapsed) {
      lines.forEach((line, li) => {
        line.forEach((n, i) => positions.set(n.key, {
          x: x + METRICS.framePad + i * (METRICS.nodeW + METRICS.gapX),
          y: y + METRICS.frameTitle + METRICS.framePad + li * (METRICS.nodeH + METRICS.gapY),
        }));
      });
    }

    // The frame's own tally, from the same function the strip across the window is counted with, so
    // a roadmap's bar and the board's bar can never disagree about what "landed" means.
    frames.push({ roadmap, x, y, w, h, collapsed: isCollapsed, warning, placed: Boolean(put),
      counts: tally(own) });
  }

  // Sorted by (from, to) rather than left in input order: the frames and positions above already
  // depend only on the node set, not its array order, and edges must hold to the same guarantee.
  const edges = [];
  const roadmapOf = new Map(nodes.map((n) => [n.key, n.roadmap]));
  for (const n of nodes) for (const d of n.depKeys) {
    if (!roadmapOf.has(d)) continue;
    edges.push({ from: d, to: n.key, cross: roadmapOf.get(d) !== n.roadmap });
  }
  edges.sort(byFromThenTo);

  return {
    frames, positions, edges,
    width: Math.max(...frames.map((f) => f.x + f.w), 0),
    height: Math.max(...frames.map((f) => f.y + f.h), 0),
  };
}
