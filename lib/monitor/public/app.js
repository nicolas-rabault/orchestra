// The page. It polls /api/model, lays the nodes out with the same pure module the tests cover,
// and draws. No framework, no build: the file the browser runs is the file in the repository.
import { layout, METRICS } from '/layout.mjs';
import { slotOf, dropClosed, openItems, openQuestions } from '/answers.mjs';
import { clock } from '/clock.mjs';
import { segments } from '/progress.mjs';
import { LOCAL, tabsOf, nodesOf } from '/tabs.mjs';
import { projectTabsOf, modelOf } from '/projects.mjs';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

// ---- how far along it is ----
// Two shapes, one language, and the difference between them is what the register can honestly say.
//
// A SET of tasks has a real fraction, so it gets a segmented bar: under the strip for the whole
// board, under a roadmap's title for that roadmap. `segments` is where the bands are decided, once,
// so the two bars cannot disagree — and it is also why a task in none of the three named states
// still occupies its share of the bar instead of quietly making the rest look longer.
//
// A SINGLE task has no fraction at all. Nothing in the register measures how far into a task its
// session is — there is no percentage to read, and inventing one from its status would be a number
// the page made up. Its line says only which phase it is in, and says it by moving or not moving:
// see `.phase` in style.css.
const BAND_WORDS = { landed: 'landed', active: 'active', waiting: 'waiting', other: 'in another state' };

function progressBar(counts) {
  const bar = el('div', 'progress');
  for (const s of segments(counts)) {
    const seg = el('span', s.band);
    seg.style.width = `${(s.frac * 100).toFixed(3)}%`;
    bar.append(seg);
  }
  return bar;
}

// Built from the same call the bar is, so a band missing from one is missing from the other.
const barWords = (counts) => `${segments(counts).map((s) => `${s.n} ${BAND_WORDS[s.band]}`).join(' · ')} — of ${counts.total}`;

// A CSS animation begins when its element is created, and every repaint replaces every card and
// every bar outright. The model's etag carries a five-second bucket of the clock (the dev-server
// list comes from lsof, not from a file whose mtime could move), so a repaint happens on its own
// every five seconds even when nothing has changed — and every crest on the board snapped back to
// its start together, at exactly that cadence. Dragging a frame did it sixty times a second.
//
// A negative delay says "this has already been running for that long", so anchoring it to the page's
// own clock makes each crest's phase a function of the time it is drawn AT rather than of the moment
// its element happened to be built. It is inherited from the root, so one write covers the cards, the
// roadmap bars and the strip, whatever any of them is rebuilt by. It works on pseudo-elements, which
// is what actually carries the wave and what no inline style could ever reach.
const anchorCrests = () => document.documentElement.style.setProperty('--crest-delay', `-${Math.round(performance.now())}ms`);

// ---- the pictures ----
// Orchestra names a screenshot in a sentence and carries on as if it had been seen. This is where
// the sentence gets its picture — in the rail line, the ask, the note and the per-task log, next to
// the words that mention it rather than gathered into a gallery that says nothing about why.
//
// 44px because it sits INSIDE those blocks and must not push the words off a 340px rail: enough to
// tell the two arms of an A/B apart, and one click from full size.
const SHOT_PX = 44;
const imageUrl = (im) => `/api/image?project=${encodeURIComponent(current().project.id)}&p=${encodeURIComponent(im.rel)}`;

function shots(images) {
  const list = images ?? [];
  if (!list.length) return null;
  const found = list.filter((im) => !im.missing);
  const strip = el('div', 'shots');
  found.forEach((im, i) => {
    const img = el('img');
    img.src = imageUrl(im);
    img.alt = im.raw;
    img.title = im.rel;
    img.width = img.height = SHOT_PX;
    img.loading = 'lazy';
    // stopPropagation, because every host of a strip is itself clickable: a rail line selects its
    // task, and enlarging a picture is not asking to be taken somewhere else.
    img.onclick = (e) => { e.stopPropagation(); openLightbox(found, i); };
    strip.append(img);
  });
  // Named and struck through, never dropped. Orchestra pointed at a file that is not on this machine
  // — a removed worktree, a capture never written, a typo — and a blank space would leave the user
  // reading a sentence about a picture with no way to tell why there is none.
  for (const im of list.filter((im) => im.missing)) strip.append(el('span', 'gone', im.raw));
  return strip;
}

const lightbox = $('lightbox');
const lightImg = $('light-img');
let lightSet = [];
let lightAt = 0;

function paintLight() {
  const im = lightSet[lightAt];
  lightImg.src = imageUrl(im);
  lightImg.alt = im.raw;
  $('light-cap').textContent = `${lightAt + 1}/${lightSet.length} · ${im.rel}`;
  const alone = lightSet.length < 2;
  $('light-prev').hidden = alone;
  $('light-next').hidden = alone;
}

function openLightbox(set, i) {
  lightSet = set;
  lightAt = i;
  paintLight();
  if (!lightbox.open) lightbox.showModal();
}

// ← / → walk the set that was clicked, at one size in one place. Comparing two captures of the same
// frame is what pictures are for in this repository, and a comparison that has to go back out to a
// 44px strip between arms is not a comparison.
const stepLight = (d) => {
  if (lightSet.length < 2) return;
  lightAt = (lightAt + d + lightSet.length) % lightSet.length;
  paintLight();
};
$('light-prev').onclick = () => stepLight(-1);
$('light-next').onclick = () => stepLight(1);
$('light-close').onclick = () => lightbox.close();
// The backdrop is the dialog element itself — everything inside it is one of the children above.
lightbox.onclick = (e) => { if (e.target === lightbox) lightbox.close(); };

// ---- where the user put a roadmap ----
// The automatic flow packs the frames left to right in name order, which is an arrangement nobody
// chose: the roadmaps someone is actually working on are wherever the alphabet left them. A frame
// dragged by its title is remembered here, in graph coordinates, and kept in localStorage — an
// arrangement lost on reload is not an arrangement. Nothing is written to the repository: this is a
// view preference of one browser, and the server writes exactly one file, which is the inbox.
const PLACED_KEY = 'orchestra.monitor.frames';
const PROJECT_KEY = 'orchestra.monitor.project';

// Keyed `<projectId>/<roadmap>`, never by the roadmap slug alone: one page now serves every
// orchestra on this machine, and two projects with a roadmap called `lighting` would otherwise
// share one stored position — the frame you dragged in one moving in the other.
// A bare roadmap slug, with no `/`, is a key from BEFORE this store went per-project — nothing
// still writes one, `placedFor` never reads one back (it only ever matches `<id>/`-prefixed keys),
// and `savePlaced` would otherwise keep rewriting it forever, unread, for the life of the browser
// profile. Dropped here, on load, rather than hunted down and migrated: the position it named is
// already lost (every dragged frame snaps back once, the day this format changed), so there is
// nothing left to carry forward.
const loadPlaced = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(PLACED_KEY) ?? '{}');
    return new Map(Object.entries(raw)
      .filter(([k, v]) => k.includes('/') && Number.isFinite(v?.x) && Number.isFinite(v?.y))
      .map(([k, v]) => [k, { x: v.x, y: v.y }]));
  } catch { return new Map(); }
};

const savePlaced = () => {
  try { localStorage.setItem(PLACED_KEY, JSON.stringify(Object.fromEntries(placed))); }
  catch { /* no storage (private window, quota): the arrangement holds for this session only */ }
};

// Every frame position for every project, in one store; the layout is handed the slice for the
// project on screen, with the prefix stripped so `layout.mjs` keeps taking plain roadmap slugs and
// does not learn what a project is.
const placed = loadPlaced();
const placedFor = (id) => new Map([...placed]
  .filter(([k]) => k.startsWith(`${id}/`))
  .map(([k, v]) => [k.slice(id.length + 1), v]));

// What the reader was last looking at. Without it every reload lands on whichever project sorts
// first, which on a machine with four of them is a different project most mornings.
const loadProject = () => { try { return localStorage.getItem(PROJECT_KEY); } catch { return null; } };
const saveProject = (id) => { try { localStorage.setItem(PROJECT_KEY, id); } catch { /* no storage */ } };

// One view per project, made on first sight. Moving between project tabs must not lose the frame
// you collapsed or the corner you panned to — the whole reason to have tabs rather than four pages.
// `fitted` says whether this project has ever been auto-fit: false until `showProject` (below) has
// run `fit()` for it once, so a later switch back restores the reader's own pan and zoom instead of
// recomputing a fresh "natural" view over it every time.
// `filter` lives here too, not on `state`: it was single-valued until this rule, so a filter typed
// in one project silently applied to every other project's rail — the same collision this map
// already exists to prevent for `collapsed`, `selected` and `view`.
const views = new Map();
const viewFor = (id) => {
  if (!views.has(id)) views.set(id, { collapsed: new Set(), selected: null, view: { x: 24, y: 24, k: 1 }, tab: LOCAL, fitted: false, filter: '' });
  return views.get(id);
};

const state = { model: null, etag: null, project: loadProject() };

// The project on screen, and its model. `state.project` can name a project that has left the
// machine since the last poll, so this falls back to the first tab rather than rendering nothing.
const current = () => modelOf(state.model?.projects, state.project) ?? state.model?.projects?.[0] ?? null;

// One graph per read, from the one set of options: three call sites used to each pass their own, and
// a fourth option would have had to be added to all of them. The tab is a filter over the rows and
// nothing else — the same layout, the same frames, the same cards, whoever they belong to.
const visible = () => nodesOf(current().nodes, viewFor(current().project.id).tab);
const graph = () => {
  const id = current().project.id;
  return layout(visible(), { collapsed: viewFor(id).collapsed, placed: placedFor(id) });
};

// Below this scale a node's title is a smear of a few CSS pixels, not text — measured in
// planetCraft against its real register (28 nodes in one frame computes a natural fit of
// ~0.37-0.49, which is illegible). 0.55 was the first value tried; at 0.55 the 12px title renders at an effective
// 6.6px, which is readable under a loupe but not what a person would call comfortable at a
// glance — checked by rendering and reading the actual PNG, not by the arithmetic alone. 0.85
// puts the title at an effective ~10px, which reads normally. This is a floor for the AUTOMATIC
// views (fit, and landing on a node from the rail); the wheel stays free to zoom out past it when
// the user deliberately asks for the overview.
const MIN_LEGIBLE_K = 0.85;

// A poll is skipped, never queued, while one is still in flight. The interval below is 2s and the
// server can take longer than that to answer when its readers are cold — so without this guard the
// tab issues a second request before the first returns, then a third, and the browser holds four
// open connections to a single-threaded server that is already the bottleneck. Skipping costs
// nothing: the next tick is 2s away and it will fetch the state as it is then, which is the only
// state anybody wants.
let inFlight = false;

// Which project this VIEW is piloting. There is one page now, so the server writes no name into
// the served HTML at all (§6) — this is the ONLY thing that puts a project's name on screen, on
// the very first poll and on every one after, so a project renamed in its config reads right on
// the next poll with no reload. Written to BOTH the tab and the header, because the browser's own
// tab is read before the page itself is looked at.
function nameProject(project) {
  const name = project?.name ?? 'orchestra';
  document.title = `${name} — orchestra`;
  $('project').textContent = name;
}

async function poll() {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await fetch('/api/model', { headers: state.etag ? { 'If-None-Match': state.etag } : {} });
    if (res.status === 200) {
      state.etag = res.headers.get('etag');
      state.model = await res.json();
      // Before anything is drawn: forget what the user typed and sent for items orchestra has
      // closed, per project. A pending id with no id of its own is a hash of row/kind/ask, so the
      // same question asked next round carries the same key — and this tab may have been open for
      // hours.
      for (const m of state.model.projects) {
        dropClosed(cacheFor(answered, m.project.id), m.nodes);
        dropClosed(cacheFor(drafts, m.project.id), m.nodes);
      }
      render();
      refreshCard();
    }
  } catch { /* the server is down; keep the last board on screen rather than blanking it */ }
  finally { inFlight = false; }
}

function applyView() {
  const here = current();
  if (!here) return;                                     // nothing adopted yet: nothing to place
  const { x, y, k } = viewFor(here.project.id).view;
  $('viewport').style.transform = `translate(${x}px, ${y}px) scale(${k})`;
}

// Centers an axis on `naive` when the content overflows it, but never scrolls further than the
// content itself extends — clamped to [box - content, 24]. When the content already fits, the
// axis is simply centered and `naive` is ignored, because nothing needs to scroll at all.
//
// The same rule governs fit()'s view of the WHOLE graph and select()'s view of ONE node: an
// overflowing axis must still keep the graph's own top-left corner — hence every frame's title —
// reachable by a normal pan, not dragged off-screen by an arbitrarily large, unclamped scroll
// (fit()'s old unconditional centering formula went negative once the legibility floor pushed the
// scale past the fit-everything size, panning the frame's own title off the left edge before the
// user had touched anything).
function clampAxis(naive, contentSize, boxSize, k) {
  return contentSize * k <= boxSize ? (boxSize - contentSize * k) / 2 : Math.min(24, Math.max(naive, boxSize - contentSize * k));
}

function fit() {
  if (!current()) return;                                // no project on this machine at all yet
  const g = graph();
  const box = $('canvas').getBoundingClientRect();
  const natural = Math.min(1, (box.width - 48) / Math.max(g.width, 1), (box.height - 48) / Math.max(g.height, 1));
  // A graph too big to fit at a legible scale overflows the canvas instead — normal for a node
  // graph, and far better than shrinking every title into unreadable specks. The first thing on
  // screen is the board's own top-left corner (`naive: 24`, its own margin), never its middle.
  const k = Math.max(MIN_LEGIBLE_K, natural);
  const x = clampAxis(24, g.width, box.width, k);
  const y = clampAxis(24, g.height, box.height, k);
  viewFor(current().project.id).view = { k, x, y };
  applyView();
}

// The automatic call, made whenever the reader arrives at a project rather than asks for a fit: the
// FIRST time a project is shown it gets `fit()`'s natural view, same as before; every time after
// that its stored pan and zoom are restored instead, because by then they are the reader's own, not
// a computed default. The toolbar's own `fit` button and the `f` key go straight to `fit()` and
// ignore this — a deliberate request to re-fit always wins, whatever the flag says.
function showProject() {
  const here = current();
  if (!here) return;
  const view = viewFor(here.project.id);
  if (view.fitted) { applyView(); return; }
  fit();
  view.fitted = true;
}

// A cubic bezier that leaves the bottom of a node and arrives at the top of the next, which is
// what makes a deep chain readable: the curve says "down and across" without any arrowhead.
const edgePath = (a, b) => {
  const x1 = a.x + METRICS.nodeW / 2, y1 = a.y + METRICS.nodeH;
  const x2 = b.x + METRICS.nodeW / 2, y2 = b.y;
  const dy = Math.max(28, (y2 - y1) / 2);
  return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
};

// Everything positional, and nothing else: this is what a frame drag repaints, sixty times a second
// while the pointer moves. The rail is deliberately NOT in here — rebuilding fifty-five lines per
// pointermove costs its scroll position, and none of it moves when a frame does.
function drawGraph() {
  const view = viewFor(current().project.id);
  const shown = visible();
  const g = graph();
  // Before anything is rebuilt, and here rather than in render(): this is the one function on every
  // path that replaces an element carrying a crest — render() calls it first, so the strip's bar
  // drawn later in the same pass is anchored too, and a frame drag calls it alone.
  anchorCrests();

  const svg = $('edges');
  svg.setAttribute('width', g.width + 40);
  svg.setAttribute('height', g.height + 40);
  svg.replaceChildren();
  for (const e of g.edges) {
    const a = g.positions.get(e.from), b = g.positions.get(e.to);
    if (!a || !b) continue;                            // an endpoint inside a collapsed frame
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', edgePath(a, b));
    // setAttribute, not .className: on an SVG element className is a read-only SVGAnimatedString.
    p.setAttribute('class', [e.cross ? 'cross' : '', (view.selected === e.from || view.selected === e.to) ? 'lit' : ''].filter(Boolean).join(' '));
    svg.append(p);
  }

  // Three layers, bottom to top: frames (opaque background) first, then the edges SVG, then the
  // node cards — a curve runs over a frame's background but under the cards it connects, instead
  // of every frame's opaque background painting over every edge inside it (which hid all of them).
  //
  // No file name beside the frame's, unlike the page this was ported from. There, a frame was
  // named by its roadmap file's basename, which two roadmaps could share (docs/ROADMAP.md and
  // docs/council/roadmap.md did), so the file had to be shown to tell them apart. Here the frame's
  // name IS the roadmap slug, which is unique by construction, and the model carries no file path
  // to show.
  const frameHost = $('frames');
  frameHost.replaceChildren();
  // Placed frames last, so a roadmap dragged over another paints its own box and title above it
  // rather than behind it — frames have no z-index of their own (one would lift them over the edges
  // and the nodes, which are separate layers above ALL frames), so DOM order is the whole of it.
  for (const f of [...g.frames].sort((a, b) => Number(a.placed) - Number(b.placed))) {
    const frame = el('div', `frame${f.placed ? ' placed' : ''}`);
    Object.assign(frame.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
    const title = el('div', 'title');
    // The count reads as the bar underneath it does — the landed share first, then what is moving —
    // rather than leading with a total the bar never draws as a number.
    const said = [`${f.counts.landed}/${f.counts.total} landed`,
      f.counts.active ? `${f.counts.active} active` : null,
      f.collapsed ? 'collapsed' : null].filter(Boolean).join(' · ');
    title.append(el('span', null, f.roadmap), el('span', 'count', said));
    if (f.warning) title.append(el('span', 'warn', f.warning));
    // The title is both the collapse toggle and the drag handle, and the gesture itself says which:
    // `dragFrame` decides on pointerup, by whether the pointer travelled. Deliberately NOT an
    // `onclick` alongside it — a drag that ends on a different pixel than it started does not
    // reliably produce a click event at all, so a flag meant to swallow "the click after a drag"
    // instead sat armed and ate the next real one. Measured in planetCraft: the first click after
    // every drag did nothing.
    title.onpointerdown = (e) => dragFrame(f, e);
    // Under the title band and inside it, not below it: a collapsed frame IS its title band, and the
    // roadmap whose progress you most want at a glance is the one you have folded away. It carries no
    // tooltip — the whole frame is deaf to the pointer so that only the title takes a drag — which is
    // why the numbers it draws are also written out in the count beside the name.
    frame.append(title, progressBar(f.counts));
    frameHost.append(frame);
  }

  const host = $('nodes');
  host.replaceChildren();
  const sent = sentSlots();
  for (const n of shown) {
    const p = g.positions.get(n.key);
    if (!p) continue;
    // Waiting on the user, and answered-but-not-collected: both read off the one rule, so a node
    // stops pulsing the instant this tab's answer is accepted rather than at the next tick.
    const open = openItems(n, sent);
    const waiting = open.length > 0;
    const calm = n.pending.length > open.length;
    const node = el('div', `node ${n.status}${calm ? ' answered' : ''}${waiting ? ' attention' : ''}${view.selected === n.key ? ' selected' : ''}`);
    Object.assign(node.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${METRICS.nodeW}px`, height: `${METRICS.nodeH}px` });
    node.append(el('span', 'id', n.id), el('span', 'name', n.title));
    const meta = [n.port ? `:${n.port}` : null, ...n.badges].filter(Boolean).join(' · ');
    if (meta) node.append(el('span', 'meta', meta));
    // One dot, and the alarm wins it: a task with one answered question and one still open is
    // waiting on the user, whatever else it is also waiting for.
    if (waiting || calm) node.append(el('span', waiting ? 'dot' : 'dot answered'));
    // The phase line along the bottom edge. Everything it says is said by the classes already on the
    // card — status, attention, answered — so there is nothing to compute here and nothing that can
    // fall out of step with the border it runs under.
    node.append(el('span', 'phase'));
    node.onclick = () => select(n.key);
    host.append(node);
  }

}

// The banner's text at the moment it was dismissed, or null. Module-level, like everything else the
// card keeps outside its own DOM, because render() rebuilds the page around it.
let dismissedBanner = null;
$('banner-close').onclick = () => { dismissedBanner = $('banner-text').textContent; $('banner').hidden = true; };

function render() {
  const here = current();
  // No project has adopted anything on this machine at all: nothing to select, nothing to draw.
  // `leaveProject`'s own comment claims "every path" moves off a vanishing project — this is the
  // one it used to miss: without it, a card left open here still names a project that no longer
  // exists, `document.title` and `#project` still name it too, and pressing *answer* on that stale
  // card throws inside `postAnswer` ("Cannot read properties of null") because `current()` is null.
  if (!here) {
    leaveProject(state.project);
    state.project = null;
    nameProject(null);
    $('empty').hidden = false;
    $('projects').replaceChildren();
    return;
  }
  // `state.project` can lag `here` right after a poll drops the project it named — follow `here`
  // rather than fighting it, and remember the fallback so the next reload lands where this one did.
  // A card left open for the project that just vanished is closed the same way a manual tab switch
  // closes one (`leaveProject`): this fallback moves `state.project` exactly as a click would, and a
  // card belonging to a checkout that no longer exists is the same stale-card hazard either way.
  if (state.project !== here.project.id) {
    leaveProject(state.project);
    state.project = here.project.id;
    saveProject(state.project);
  }
  nameProject(here.project);
  // A FUNCTION, not `sentSlots()`'s own Set: that Set is only ever the CURRENT project's answered
  // slots, and a slot key (`nodeKey:itemId`) is only unique WITHIN a project — applying one flat
  // Set to every project's badge would let an answer sent here silently drop another project's
  // identical-keyed question off its own count. `projectTabsOf` calls this once per project.
  renderProjects(projectTabsOf(state.model.projects, (id) => new Set(cacheFor(answered, id).keys())));

  const m = here;
  const view = viewFor(m.project.id);
  // A tab whose developer left the board (their last task landed between two polls) falls back to
  // the local view rather than filtering the canvas down to a name nobody holds any more.
  const tabs = tabsOf(m.nodes);
  if (!tabs.some((t) => t.id === view.tab)) view.tab = LOCAL;
  const tab = tabs.find((t) => t.id === view.tab);
  renderTabs(tabs);
  drawGraph();

  const banner = $('banner');
  const notes = [];
  // A failing board is reported with the reader's own error text, which is the one thing this page
  // could not have written itself. There is no "absent board" case to word here, unlike the page
  // this was ported from: `readBoard` shells out to `bin/orchestra`, which always exists beside it
  // whatever project is being served, so a board is only ever ok, stale or failing.
  if (m.source.board !== 'ok') notes.push(m.source.message);
  if (m.ambiguous.length) notes.push(`${m.ambiguous.length} id(s) match more than one roadmap task and stay unfiled: ${m.ambiguous.join(', ')}`);
  // A duplicate is a different failure from an ambiguous id: the roadmap defines the task once,
  // but two register rows both claimed it, so the loser of that race is drawn as its own unfiled
  // node instead of being silently folded into the winner.
  if (m.duplicates.length) notes.push(`${m.duplicates.length} task(s) are claimed twice in orchestra's own records, so the second claim shows as a separate unfiled node: ${m.duplicates.join(', ')}`);
  // Dismissed by its own text, so a banner put away stays away while the situation is unchanged and
  // comes back the moment it says something different. A poll runs every two seconds; a dismissal
  // remembered as a plain boolean would be undone by the next one.
  const said = notes.join(' · ');
  $('banner-text').textContent = said;
  banner.hidden = notes.length === 0 || said === dismissedBanner;

  // No node at all is not an error and not an empty graph to squint at: it is a repository
  // orchestra has never adopted. Said in the words the design's §9 asks for, and only on the local
  // tab: a filter that empties the canvas is not the same fact as an unadopted repository.
  $('empty').hidden = view.tab !== LOCAL || m.nodes.length > 0;
  // Shown only once something has been moved: a button to undo an arrangement nobody has made yet is
  // a button that only ever explains itself.
  $('tidy').hidden = placedFor(m.project.id).size === 0;

  // The input's own displayed text follows the project, exactly like `view.tab` above: switching
  // tabs must not leave last project's typed filter showing while this project's rail is what is
  // actually being filtered by ITS OWN remembered text.
  $('rail-filter').value = view.filter;
  renderRail();
  // Once, for both readers of it.
  const sent = sentSlots();
  const openNow = openQuestions(m.nodes, sent);
  renderNotifs(openNow);
  renderTally(tab.counts, openNow, sent);
}

// ---- dragging a roadmap where you want it ----
// The pointer moves in SCREEN pixels and the frame lives in GRAPH coordinates, so every delta is
// divided by the zoom: at k = 0.5 a frame dragged 100 px on screen must travel 200 graph units, or it
// would lag under the pointer at every scale but 1.
//
// The listeners go on `window`, not on the title: each repaint replaces the frame elements outright,
// so a listener attached to the one under the pointer would be discarded by the first move it caused.
//
// Clamped at zero on both axes. The viewport is translated from the origin and `fit` measures the
// graph from it, so a frame dropped at a negative coordinate is a frame parked where no pan reaches.
const DRAG_SLOP = 4;

function dragFrame(f, e) {
  if (e.button !== 0) return;
  e.preventDefault();
  const id = current().project.id;
  const view = viewFor(id);
  const from = { x: f.x, y: f.y };
  const at = { x: e.clientX, y: e.clientY };
  let moved = false;

  const move = (ev) => {
    if (!moved && Math.abs(ev.clientX - at.x) < DRAG_SLOP && Math.abs(ev.clientY - at.y) < DRAG_SLOP) return;
    moved = true;
    placed.set(`${id}/${f.roadmap}`, {
      x: Math.max(0, from.x + (ev.clientX - at.x) / view.view.k),
      y: Math.max(0, from.y + (ev.clientY - at.y) / view.view.k),
    });
    drawGraph();
  };
  const up = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    // The pointer never travelled, so this was a click on the title: collapse the roadmap, which is
    // what that handle did before it could also be dragged.
    if (!moved) {
      view.collapsed.has(f.roadmap) ? view.collapsed.delete(f.roadmap) : view.collapsed.add(f.roadmap);
      return render();
    }
    savePlaced();
    render();                                            // the tidy button appears with the first move
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
}

// ---- the strip across the top ----
// Two figures from the ACTIVE TAB's tally (in flight, queued — the scheduler's words, counted once
// in tabs.mjs, so the pills and the tab's own tooltip cannot disagree) and a third counted here from
// `openQuestions`, the SAME call the corner list makes. Not a second rule for "waiting on you": one
// function, two readers, so the strip and the corner cannot disagree about how many things are open
// — which they would the moment this counted tasks while the list counted questions.
//
// The first three follow the tab because the canvas does: they are what the bar underneath them is a
// share of, and a filtered graph under an unfiltered count is the page contradicting itself. The
// last two do NOT: a question waiting on you is waiting whichever tab you are looking at, and only
// this machine's tasks can carry one at all.
//
// A zero is drawn for the two board figures, because "0 active" is a fact about the fleet worth
// seeing. The alarm pill is drawn ONLY when something is open, which is what makes it an alarm.
function renderTally(c, open, sent) {
  const host = $('tally');
  host.replaceChildren();
  const pill = (cls, n, label, title) => {
    const s = el('span', cls);
    s.append(el('b', null, String(n)), document.createTextNode(` ${label}`));
    s.title = title;
    host.append(s);
  };
  pill('active', c.active, 'active', 'tasks a session is on right now (claimed or in review)');
  pill('waiting', c.waiting, 'waiting', 'tasks orchestra has adopted and not started yet');
  pill('landed', c.landed, 'landed', `landed tasks, of ${c.total} on this tab`);
  if (open.length) pill('attention', open.length, 'waiting on you', 'questions with no answer yet — the same set the corner lists');
  // The other half of the answer channel, and the half that was invisible: an answer is written the
  // moment it is sent and collected by a conductor tick minutes later. Without this figure the only
  // thing that changed on screen was a node's border, and "did that go through?" had no answer.
  const held = current().nodes.reduce((n, node) => n + node.pending.length - openItems(node, sent).length, 0);
  if (held) pill('held', held, 'answered', 'you have answered these; orchestra has not collected them yet');

  // The whole board as one line, along the bottom edge of the strip. The pills say the three figures
  // the scheduler names; the bar is the only thing on the page that shows what they are a share OF,
  // and the only one that draws the tasks in none of the three at all.
  const bar = progressBar(c);
  bar.title = barWords(c);
  $('top-progress').replaceChildren(bar);
}

// ---- level 1: which project ----
// One page now serves every orchestra on this machine, so this is the first question a reader
// asks. Sorted by name (`projectTabsOf`'s own rule): a strip that reorders itself between
// two-second polls is unclickable.
function renderProjects(tabs) {
  const host = $('projects');
  host.replaceChildren();
  for (const t of tabs) {
    const b = el('button', t.id === current().project.id ? 'on' : null, t.name);
    // The one figure that makes a project tab worth glancing at: how many of its questions are
    // waiting on you. Active counts live in the strip below, for the project you are in.
    if (t.waiting) b.append(el('b', 'attention', String(t.waiting)));
    b.title = `${t.name} · ${t.mode} · ${barWords(t.counts)}`;
    b.onclick = () => {
      if (state.project === t.id) return;
      // Close whatever card is open for the project being LEFT before switching — otherwise it
      // stays on screen showing that project's stale task, and its "answer" button would post that
      // task's ids under the NEW project's id the instant `current()` changes underneath it.
      leaveProject(state.project);
      state.project = t.id;
      saveProject(t.id);
      render();
      showProject();
    };
    host.append(b);
  }
}

// ---- whose view the stage shows ----
// The grouping is tabs.mjs — one rule, tested — and this only draws it. The bar is drawn even when
// the local tab is alone: it names the view you are looking at, and it is where the others appear
// the day a second developer publishes a roadmap.
function renderTabs(tabs) {
  const host = $('tabs');
  host.replaceChildren();
  const view = viewFor(current().project.id);
  for (const t of tabs) {
    const b = el('button', t.id === view.tab ? 'on' : null, t.label);
    // The one figure worth carrying on the tab itself: how much of theirs is moving right now.
    if (t.id !== LOCAL && t.counts.active) b.append(el('b', null, String(t.counts.active)));
    b.title = t.id === LOCAL
      ? "this machine — orchestra's register and your own roadmaps"
      : `${t.label} · ${barWords(t.counts)}`;
    b.onclick = () => { if (view.tab !== t.id) { view.tab = t.id; render(); } };
    host.append(b);
  }
}

// ---- what is waiting on you ----
// A question raised on a node scrolled off the canvas — or inside a collapsed frame — was reachable
// only by finding the node first. This is the same set the red pulse is drawn from (openQuestions
// reads the one `answer === null` rule), listed in the corner, one click from the reply box.
//
// Hidden outright when nothing is open — the strip at the top of the window carries the count, so
// there is nothing to keep a box on screen for: an empty panel announcing "0 waiting on you" is a
// thing to read every time you look at the corner, and the answer is already that there is no box.
// (It said exactly that for months: `hidden` was set here from the first version, and an author
// `display: flex` in style.css silently overrode it — see the `#notifs[hidden]` rule there.)
const NOTIF_EXCERPT_CAP = 90;

function renderNotifs(open) {
  $('notifs').hidden = open.length === 0;
  $('notifs-head').textContent = `${open.length} waiting on you`;
  const list = $('notifs-list');
  list.replaceChildren();
  for (const q of open) {
    const li = el('li');
    const head = el('div', 'who');
    head.append(el('span', 'id', q.id));
    // How many pictures the question carries, so "go and look at this" is visible before the click.
    if (q.images) head.append(el('span', 'shot', `▤ ${q.images}`));
    const short = excerpt(q.ask ?? '', NOTIF_EXCERPT_CAP);
    li.append(head, el('div', 'what', short ? `${short}…` : (q.ask || '(no text)')));
    li.onclick = () => select(q.key, q.item);
    list.append(li);
  }
}

function renderRail() {
  const m = current();
  const list = $('rail-lines');
  const near = list.scrollTop + list.clientHeight > list.scrollHeight - 40;
  list.replaceChildren();
  const f = viewFor(m.project.id).filter.toLowerCase();
  const lines = m.rail.filter((r) => !f || (r.task ?? '').toLowerCase().includes(f) || r.text.toLowerCase().includes(f));
  for (const r of lines) {
    const li = el('li', r.from === 'you' ? 'you' : null);
    const meta = el('div', 'meta');
    // Three fields, in the order the line is read: when, who spoke, and what it is about. The task
    // used to be shown INSTEAD of the kind, and only for orchestra's lines — so an answer typed on
    // the page appeared in this panel as "you" and a sentence, with nothing naming the question it
    // was a reply to. The model has always carried the task on those lines; only the meta dropped it.
    meta.append(el('span', null, clock(r.ts)), el('span', null, r.from === 'you' ? 'you' : r.kind));
    if (r.task) meta.append(el('span', 'task', r.task));
    li.append(meta, el('div', 'text', r.text));
    const strip = shots(r.images);
    if (strip) li.append(strip);
    li.onclick = () => r.task && select(r.task);
    list.append(li);
  }
  $('rail-foot').textContent = [
    `${lines.length}/${m.rail.length} lines`,
    m.journalSkipped ? `${m.journalSkipped} unreadable` : null,
    m.rail.length ? null : 'orchestra has written nothing yet',
  ].filter(Boolean).join(' · ');
  if (near) list.scrollTop = list.scrollHeight;
}

// `focusItem` is the pending id the notification list clicked, so the card lands on that question
// instead of at the top of a card whose first section is something else.
function select(key, focusItem = null) {
  const view = viewFor(current().project.id);
  view.selected = key;
  render();
  // The card opens regardless of whether the node has a position to center on (e.g. selected
  // from the rail while its frame sits collapsed) — the centering below is a separate concern
  // with its own early-out.
  const node = current().nodes.find((n) => n.key === key);
  if (node) openCard(node, focusItem);
  const g = graph();
  const p = g.positions.get(key);
  if (!p) return;
  // Arriving from the rail must land on something readable: raise a sub-floor zoom (e.g. left
  // over from a wheel zoom-out) rather than centering a node at a scale nobody can read.
  view.view.k = Math.max(view.view.k, MIN_LEGIBLE_K);
  const k = view.view.k;
  const box = $('canvas').getBoundingClientRect();
  const naiveX = box.width / 2 - (p.x + METRICS.nodeW / 2) * k;
  const naiveY = box.height / 2 - (p.y + METRICS.nodeH / 2) * k;
  // The same clamp fit() uses: if the graph already fits an axis, centering that node would only
  // drag an already fully-visible frame (title included) off to one side for no reason, so the
  // axis is left centered on the whole graph instead. If it overflows, the node is still centered
  // but never past the graph's own bounds — a node on a deep wrapped line, near its rank's own
  // left edge, cannot scroll its frame's title further off-screen than the content truly extends.
  view.view.x = clampAxis(naiveX, g.width, box.width, k);
  view.view.y = clampAxis(naiveY, g.height, box.height, k);
  applyView();
}

// ---- the card ----
const card = $('card');
$('card-close').onclick = () => card.close();

// How many of the dialog's own `close` events are OURS — triggered by code, rather than by the
// reader pressing Escape or the × button. `close()` removes the `open` attribute the instant it is
// called, but the `close` EVENT it fires is a queued task, not a synchronous callback and not even
// a microtask — measured against a live `<dialog>`, it can land tens of milliseconds later. By the
// time it does, `current()` may already name a different project, or a different node's card may
// already be open again: the listener below cannot recover, at that point, whose close this was. A
// count, not a boolean, because two closes we trigger in quick succession must each consume their
// own queued event rather than the first swallowing both.
let pendingOwnCloses = 0;

// Closes the card, if open, and marks the coming `close` EVENT as ours: "we are closing this, do
// not let the listener guess whose it was." Every caller is responsible for clearing the RIGHT
// `selected` itself, synchronously, right where it calls this — that is knowledge only the caller
// has (`leaveProject` knows which project is being left; `refreshCard` knows its own project's
// selection just went stale), and the delayed event has no way to reconstruct it later.
function closeOurs() {
  if (card.open) { pendingOwnCloses++; card.close(); }
}

// Closes whatever card is open and attributes the closure to `id`, the project actually being
// left — called by every path that moves `state.project` off of one project onto another: the
// reader's own click on a project tab (`renderProjects`), and `render()`'s own silent fallback when
// the remembered project has vanished from the machine between polls. Without this, a card left
// open when either happens stays open showing the OLD project's task indefinitely — no later poll's
// `refreshCard` ever revisits it, since its guard reads the NEW current project's `selected`, which
// has nothing to do with what the dialog is actually displaying — and answering it posts the old
// project's task and item ids under the new project's id: the exact cross-project misroute this
// whole feature exists to prevent.
function leaveProject(id) {
  closeOurs();
  if (id) viewFor(id).selected = null;
}

card.addEventListener('close', () => {
  // A close WE triggered already had the right `selected` cleared, synchronously, by whichever
  // caller closed it (`closeOurs`'s own callers) — by the time this queued event fires, `current()`
  // or the selected node may have moved on, so it must not act a second time on a guess.
  if (pendingOwnCloses > 0) { pendingOwnCloses--; return; }
  const here = current();
  if (here) viewFor(here.project.id).selected = null;
  render();
});

const section = (title, ...children) => {
  const s = el('div', 'sec');
  s.append(el('h3', null, title), ...children);
  return s;
};

const cmdBlock = (lines) => {
  const box = el('div', 'cmd', lines.join('\n'));
  const copy = el('button', null, 'copy');
  copy.onclick = () => { navigator.clipboard.writeText(lines.join('\n')); copy.textContent = 'copied'; };
  box.append(copy);
  return box;
};

// Where the answer went, said as what is KNOWN — two outcomes, both facts, and neither of them a
// claim that anything was started. 'awake' names a conductor that exists: a beat a live process
// wrote seconds ago, whose own watch loop hands it this answer within seconds. 'no-conductor' says
// where the answer is sitting and who will read it.
//
// The page this was ported from had four outcomes, because posting an answer could SPAWN a tick.
// This one starts nothing, ever: delivering an answer had been wired to CREATE a conductor instead
// of to REACH the live one, and it cost six conductor identities in half an hour on 2026-08-13 in
// planetCraft, two merge_agent runs twelve seconds apart on one branch, and three answers left
// unread because the register kept naming a reader that had already died.
const ANSWER_WORDS = {
  awake: 'orchestra is listening — it has this answer already',
  'no-conductor': 'the answer is in the inbox; the next tick will read it',
};

// One send at a time for the WHOLE page: an ask block and the remark box append to the same file,
// and a second POST fired while one is in flight is exactly the double submission this refuses.
// Module-level, so rebuilding the card from a poll cannot reset it.
let sending = false;

// What the user has typed but not sent, and what they have already sent in this page session —
// both keyed by item and held OUTSIDE the card, because the card is rebuilt from every poll. A
// refresh must not eat a draft, and must not re-open a question the user has answered but the
// conductor has not yet cleared. Both are emptied of an item as soon as it leaves the model (see
// poll), because the key repeats for a re-asked question and would otherwise answer for it.
//
// Per project, because a slot key (`nodeKey:itemId`) is only unique WITHIN a project: two projects
// both holding a `lighting/L2` with a question `q1` would otherwise share one entry, and answering
// in one would print a "sent" line under the other's untouched question and disable its reply box.
const answered = new Map();
const drafts = new Map();
const cacheFor = (store, id) => { if (!store.has(id)) store.set(id, new Map()); return store.get(id); };
// What this tab has sent, as the set `openItems` takes. Read on every render, so the first frame
// after a successful POST already treats those questions as answered — the register will agree at
// the next tick, minutes later, and the user needed to know now.
const sentSlots = () => new Set(cacheFor(answered, current().project.id).keys());

// Returns the sentence shown on success, or null on failure, so the caller can both record that
// the item is answered and decide what to re-enable.
async function postAnswer(payload, host) {
  if (sending) return null;
  sending = true;
  host.replaceChildren(el('div', 'sent', 'sending…'));
  try {
    const res = await fetch('/api/answer', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, project: current().project.id }),
    });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error ?? 'refused');
    const line = `sent · ${ANSWER_WORDS[out.conductor] ?? ANSWER_WORDS['no-conductor']}`;
    host.replaceChildren(el('div', 'sent', line));
    state.etag = null;                                  // the inbox moved; take the next model
    return line;
  } catch (e) {
    host.replaceChildren(el('div', 'failed', `not sent: ${e.message}`));
    return null;
  } finally {
    sending = false;
  }
}

function askBlock(node, item) {
  const slot = slotOf(node.key, item.id);
  const answeredHere = cacheFor(answered, current().project.id);
  const draftsHere = cacheFor(drafts, current().project.id);
  // Calmed by EITHER signal: the answer the model has read back out of the inbox, or the one this tab
  // sent a moment ago and no poll has returned yet. Without the second the block stayed alarm-red
  // under a "sent" line, which is the page contradicting itself about the only thing being asked.
  const box = el('div', `ask${item.answer || answeredHere.has(slot) ? ' answered' : ''}`);
  box.append(el('div', 'kind', item.kind + (item.port ? ` · port ${item.port}` : '')), el('p', null, item.ask || '(no text)'));
  // Between the question and the answer box, which is the order the question is read in: a "which of
  // these two?" is unanswerable until the two are on screen.
  const asked = shots(item.images);
  if (asked) box.append(asked);
  // The template's technical footer, under the question and dimmed rather than printed as part of
  // it. It is where the paths of the pictures above are written, so it belongs after them.
  if (item.footer) box.append(el('div', 'footer', item.footer));
  // What the user already said, and the plain fact that it is still sitting in the inbox. Without
  // it the block offered the same question again, as if nothing had been sent — for as long as the
  // conductor took to run its next tick.
  if (item.answer) {
    const said = el('div', 'said');
    said.append(
      el('div', 'when', `you answered at ${clock(item.answeredAt)}`),
      el('p', null, item.answer),
      el('div', 'waiting', 'orchestra has not picked it up yet'),
    );
    box.append(said);
  }
  const status = el('div');
  const form = el('form');
  const text = el('textarea');
  text.placeholder = 'your answer, in your own words';
  text.value = draftsHere.get(slot) ?? '';
  text.oninput = () => draftsHere.set(slot, text.value);
  const submit = el('button', null, 'answer');
  submit.type = 'submit';
  form.append(text, submit);
  const optionButtons = [];
  if (item.options.length) {
    const opts = el('div', 'options');
    for (const o of item.options) {
      const b = el('button', null, `${o.letter}) ${o.text}`);
      opts.append(b);
      optionButtons.push(b);
    }
    box.append(opts);
  }

  // A click on an option after typing free text races the same submission as two clicks on
  // "answer" — the page-wide `sending` flag covers both paths, and it is set synchronously before
  // the first `await`, so a second activation dispatched in the same tick is refused regardless of
  // how fast or slow the network turns out to be. An answered item stays disabled across rebuilds
  // — the conductor takes minutes to clear it, and the card must not offer it again meanwhile; a
  // failed send re-enables everything so the user can retry.
  const controls = [text, submit, ...optionButtons];
  const setDisabled = (v) => { for (const c of controls) c.disabled = v; };
  const already = answeredHere.get(slot);
  if (already) { status.append(el('div', 'sent', already)); setDisabled(true); }

  async function submitOnce(answer) {
    if (sending || answeredHere.has(slot)) return;
    setDisabled(true);
    const line = await postAnswer({ task: node.id, pending: item.id, answer }, status);
    if (!line) return setDisabled(false);
    answeredHere.set(slot, line);
    draftsHere.delete(slot);
    // Immediately, not at the next poll: the corner row disappears, the node stops pulsing and the
    // strip's count drops in the same frame the send is confirmed. The poll is two seconds away and
    // its model can cost a board read; a page that only reacts then reads as a page that lost the
    // answer.
    render();
    // And the card, which is the surface the user is actually looking at. Nothing else rebuilds it:
    // `refreshCard` compares the node it was drawn from, and that node does not change until a tick
    // clears the item — so the block stayed alarm-red underneath its own "sent" line. Its scroll is
    // kept, and the sent line and the disabled controls are rebuilt from `answered`, not from the DOM.
    const top = card.scrollTop;
    openCard(node);
    card.scrollTop = top;
  }

  form.onsubmit = (e) => { e.preventDefault(); if (text.value.trim()) submitOnce(text.value.trim()); };
  optionButtons.forEach((b, i) => { const o = item.options[i]; b.onclick = () => submitOnce(`${o.letter}) ${o.text}`); });
  box.append(form, status);
  return box;
}

// The free remark: an answer that targets no item, which the design's §3.2 defines and the
// unconsumed rule's timestamp half exists to deliver. Without a field for it, it would be
// reachable only by a hand-written POST. Same in-flight guard, same honest reporting as an ask.
const remarkForm = $('remark');
const remarkText = $('remark-text');
const remarkSend = $('remark-send');
const remarkStatus = $('remark-status');
remarkForm.onsubmit = async (e) => {
  e.preventDefault();
  const said = remarkText.value.trim();
  if (!said || sending) return;
  remarkText.disabled = remarkSend.disabled = true;
  const line = await postAnswer({ task: null, pending: null, answer: said }, remarkStatus);
  if (line) remarkText.value = '';
  remarkText.disabled = remarkSend.disabled = false;
};

// A conductor's note is a work log — a place orchestra records what it measured and decided, not
// a description written for a reader who has never seen the code. Showing it in full where "what
// it is" belongs buries the actual description under a technical wall. A short excerpt, cut on a
// word boundary, stands in its place; the full note is one click away rather than gone, and starts
// collapsed again on every card open because nothing here is remembered between opens.
const NOTE_EXCERPT_CAP = 240;

// Cuts `text` to at most `cap` characters without splitting a word, or returns null when the text
// already fits — the caller's signal that no excerpt/toggle is needed at all.
function excerpt(text, cap) {
  if (text.length <= cap) return null;
  const cut = text.slice(0, cap);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
}

function whatItIs(node) {
  // A task with a roadmap block never shows its note here, and the note is exactly where the
  // conductor records what it captured — so its pictures would be the one thing on the card with
  // nowhere to appear. They come along under a line saying whose they are, rather than sitting
  // unexplained beneath a description that never mentioned them.
  if (node.why) {
    const strip = shots(node.noteImages);
    if (!strip) return section('what it is', el('p', null, node.why));
    const wrap = el('div', 'note');
    wrap.append(el('p', null, node.why), el('p', 'muted', "the conductor's note points at:"), strip);
    return section('what it is', wrap);
  }
  if (!node.note) return section('what it is', el('p', 'muted', 'No roadmap block and no conductor note for this task yet.'));

  const label = el('p', 'muted', "No roadmap block for this task. What follows is the conductor's own note — a work log, not a description of the task:");
  const noteShots = shots(node.noteImages);
  const short = excerpt(node.note, NOTE_EXCERPT_CAP);
  if (!short) {
    const wrap = el('div', 'note');
    wrap.append(label, el('p', null, node.note));
    if (noteShots) wrap.append(noteShots);
    return section('what it is', wrap);
  }

  const shortP = el('p', null, `${short}…`);
  const fullP = el('p', 'muted', node.note);
  fullP.hidden = true;
  const toggle = el('button', 'note-toggle', 'show the rest');
  toggle.onclick = () => {
    fullP.hidden = !fullP.hidden;
    shortP.hidden = !fullP.hidden;
    toggle.textContent = fullP.hidden ? 'show the rest' : 'show less';
  };
  const wrap = el('div', 'note');
  // The strip stays out of the collapse: the pictures are what the note is worth looking at, and
  // hiding them behind "show the rest" is hiding the thing that was asked for.
  wrap.append(label, shortP, ...(noteShots ? [noteShots] : []), toggle, fullP);
  return section('what it is', wrap);
}

// The task's own server (the model's per-node `servers`, matched by port or worktree cwd) leads
// and is the one made to look like the thing to click; the whole-machine list — most of it
// irrelevant to this task — folds behind a single expandable line naming how many others there
// are. A task with none of its own is a normal, common state, said plainly rather than left to
// read as a missing/broken list.
function serversSection(node) {
  const own = el('div', 'own');
  // "None" and "I could not look" are different answers, and only one of them is a fact: lsof
  // exits non-zero both when nothing is listening and when it is not installed at all.
  if (!current().serversKnown) {
    own.append(el('p', 'muted', 'unknown — lsof could not be run on this machine, so no port was checked'));
    return section('active game servers', own);
  }
  if (node.servers.length) {
    for (const s of node.servers) {
      const row = el('div', 'own-entry');
      const a = el('a', 'own-link', `open localhost:${s.port} →`);
      a.href = `http://localhost:${s.port}`;
      a.target = '_blank';
      row.append(a);
      if (s.label) row.append(el('span', 'muted', ` — ${s.label}`));
      own.append(row);
    }
  } else {
    own.append(el('p', 'muted', 'no server of its own is running for this task right now'));
  }

  const others = current().servers.filter((s) => !node.servers.some((x) => x.port === s.port));
  const children = [own];
  if (others.length) {
    const list = el('ul');
    for (const s of others) {
      const li = el('li');
      const a = el('a', null, `localhost:${s.port}`);
      a.href = `http://localhost:${s.port}`;
      a.target = '_blank';
      li.append(a);
      if (s.cwd) li.append(el('span', 'muted', ` — ${s.cwd.split('/').pop()}`));
      list.append(li);
    }
    const details = el('details');
    details.append(el('summary', null, `${others.length} other dev server${others.length === 1 ? '' : 's'} running on this machine`), list);
    children.push(details);
  }
  return section('active game servers', ...children);
}

// Everything the card draws, in one string. A poll rebuilds the card only when this changes, so a
// question the conductor has closed disappears within two seconds while an untouched card does not
// flicker under the reader.
const cardSignature = (node) => JSON.stringify([
  node, current().rail.filter((r) => r.task === node.key), current().servers, current().serversKnown,
]);
let cardStamp = null;

// The card is a live view, not a snapshot. It is never rebuilt mid-send (the page-wide guard), and
// what the user typed or already sent lives outside it, by slot, so neither is lost here.
function refreshCard() {
  const here = current();
  if (!here) return;
  const view = viewFor(here.project.id);
  if (!card.open || !view.selected || sending) return;
  const node = here.nodes.find((n) => n.key === view.selected);
  if (!node) {                                           // the task left orchestra's records
    // Attributed the same way `leaveProject` is: this close is ours, not the reader's, so the
    // queued `close` event must not later guess whose `selected` to clear — this project's own is
    // cleared right here, synchronously, before the poll that found the vanished task moves on.
    closeOurs();
    view.selected = null;
    return;
  }
  if (cardSignature(node) === cardStamp) return;
  const top = card.scrollTop;
  openCard(node);
  card.scrollTop = top;
}

function openCard(node, focus = null) {
  cardStamp = cardSignature(node);
  $('card-id').textContent = node.key;
  $('card-status').textContent = node.status;
  $('card-status').className = node.status;
  $('card-badges').replaceChildren(...node.badges.map((b) => el('span', null, b)));
  $('card-title').textContent = node.title;

  const body = $('card-body');
  body.replaceChildren();

  // The heading names the state the whole block is in: still asking, or already answered and
  // waiting on orchestra.
  const blocks = new Map();
  if (node.pending.length) {
    body.append(section(openItems(node, sentSlots()).length ? 'waiting on you' : 'answered — waiting for orchestra',
      ...node.pending.map((p) => {
        const block = askBlock(node, p);
        blocks.set(p.id, block);
        return block;
      })));
  }

  body.append(whatItIs(node));

  if (node.invoke.kind !== 'none') {
    body.append(section(node.invoke.kind === 'resume' ? 'wake its session' : 'launch it', cmdBlock(node.invoke.lines)));
  }

  body.append(serversSection(node));

  const lines = current().rail.filter((r) => r.task === node.key);
  const rail = el('div');
  for (const r of lines) {
    const row = el('div');
    row.append(el('b', null, `${clock(r.ts)} ${r.from === 'you' ? 'you' : r.kind}`), el('span', null, ` ${r.text}`));
    const strip = shots(r.images);
    if (strip) row.append(strip);
    rail.append(row);
  }
  rail.className = 'tech';
  body.append(section('what orchestra said about it', lines.length ? rail : el('p', 'muted', 'nothing yet')));

  const tech = el('div', 'tech');
  const row = (k, v) => { const d = el('div'); d.append(el('b', null, k), el('span', null, v)); tech.append(d); };
  row('branch', node.branch ?? '—');
  row('deps', node.deps.length ? node.deps.join(', ') : '—');
  row('touches', node.touches.length ? node.touches.join(', ') : '—');
  row('order', node.order ?? '—');
  row('session', node.sessionName ? `${node.sessionName} (${(node.session ?? '').slice(0, 8)}) on ${node.model ?? '?'}` : '—');
  if (node.acceptance) row('acceptance', node.acceptance);
  body.append(section('technical', tech));

  if (!card.open) card.showModal();

  // Arriving from the notification list: land on the question that was clicked and put the cursor in
  // its reply box, so the next keystroke is the answer. Done after showModal(), which autofocuses
  // the close button on every open. A refresh passes no focus, so a poll cannot steal the caret or
  // scroll the card out from under a reader.
  const target = focus ? blocks.get(focus) : null;
  if (target) {
    target.scrollIntoView({ block: 'center' });
    target.querySelector('textarea')?.focus();
  }
}

// ---- pan, zoom, keys ----
const canvas = $('canvas');
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.node') || e.target.closest('.title')) return;
  const here = current();
  if (!here) return;                                     // nothing adopted yet: nothing to pan
  const view = viewFor(here.project.id).view;
  drag = { x: e.clientX - view.x, y: e.clientY - view.y };
  canvas.classList.add('dragging');
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const view = viewFor(current().project.id).view;
  view.x = e.clientX - drag.x;
  view.y = e.clientY - drag.y;
  applyView();
});
canvas.addEventListener('pointerup', () => { drag = null; canvas.classList.remove('dragging'); });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const here = current();
  if (!here) return;                                     // nothing adopted yet: nothing to zoom
  const view = viewFor(here.project.id).view;
  const box = canvas.getBoundingClientRect();
  const mx = e.clientX - box.left, my = e.clientY - box.top;
  const k = Math.min(2, Math.max(0.2, view.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  // Zoom at the cursor: the point under the pointer must not move.
  view.x = mx - (mx - view.x) * (k / view.k);
  view.y = my - (my - view.y) * (k / view.k);
  view.k = k;
  applyView();
}, { passive: false });

const zoomBy = (r) => {
  const here = current();
  if (!here) return;
  const view = viewFor(here.project.id).view;
  view.k = Math.min(2, Math.max(0.2, view.k * r));
  applyView();
};
$('zoom-in').onclick = () => zoomBy(1.15);
$('zoom-out').onclick = () => zoomBy(1 / 1.15);
$('fit').onclick = fit;
// Back to the automatic flow, in one click, for every frame at once, for the project on screen —
// clearing the whole store would undo the arrangement of every OTHER project too. Nothing else
// undoes a drag, and an arrangement you cannot get out of is a trap rather than a preference.
$('tidy').onclick = () => {
  const id = current().project.id;
  for (const k of [...placed.keys()]) if (k.startsWith(`${id}/`)) placed.delete(k);
  savePlaced();
  render();
  fit();
};
$('rail-filter').oninput = (e) => {
  const here = current();
  if (!here) return;
  viewFor(here.project.id).filter = e.target.value;
  renderRail();
};
addEventListener('keydown', (e) => {
  // The lightbox owns the keyboard while it is up: ← and → walk the set, and nothing behind it moves
  // — panning the graph under a full-screen picture is a change you cannot see happening.
  if (lightbox.open) {
    if (e.key === 'ArrowLeft') stepLight(-1);
    if (e.key === 'ArrowRight') stepLight(1);
    return;
  }
  if (e.target.matches('input, textarea')) return;
  if (e.key === 'f' || e.key === 'F') fit();
});

applyView();
await poll();
// The first poll can fail (the server was killed between the page load and the fetch), or succeed
// with no project on the machine at all; fitting a graph that is not there would throw and leave a
// blank page with no explanation. `showProject()` carries its own guard for the second case, and
// gives the first project shown its one automatic `fit()` the same way arriving at any other does.
if (state.model) showProject();
setInterval(poll, 2000);
