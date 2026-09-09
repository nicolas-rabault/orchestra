// The phase's acceptance (spec §15): the section checklist of §6 is present. It is a pin against
// the risk §16 names — "the protocol document is 1031 lines of hard-won rules and the port could
// quietly drop one" — plus four guards that hold the two transformations of §6's last paragraph.
//
// What it CANNOT do is judge whether a section is right. There is no dead-code gate and no prose
// linter in this repository; the per-task review is the only filter, and this file must never be
// presented as one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SKILL = join(ROOT, 'skills', 'orchestra', 'SKILL.md');
const REFDIR = join(ROOT, 'skills', 'orchestra', 'reference');
const read = (p) => readFileSync(p, 'utf8');

// The protocol is a CORE plus references (`SKILL.md`'s own index says which, and why: the core
// used to be 32.6 k tokens and every tick paid all of it). So every guard below reads the whole
// SET — a section that moved to a reference is still carried, and one that vanished is still a
// failure. A guard that read `SKILL.md` alone would have been silently satisfied by the move.
const refs = () => readdirSync(REFDIR).filter((f) => f.endsWith('.md')).sort();
const docs = () => [SKILL, ...refs().map((f) => join(REFDIR, f))];
const readAll = () => docs().map(read).join('\n');

// ---- the §6 checklist -------------------------------------------------------------------------
// One row per item §6 names. `heading` is the section that carries it — several items share one,
// which is why `anchors` exists: each anchor is the MEASUREMENT the item was paid for, so a section
// that survives the port with its evidence stripped fails here too.
const JOURNAL = '## The journal (three mechanical obligations, no decision)';
const SECTIONS = [
  { item: 'the nevers', heading: '## The six nevers', anchors: [/never merge a row/i] },
  { item: "the journal's four keys and the clock", heading: JOURNAL,
    anchors: [/`ts`, `kind`, `task`, `text`/, /Never type the timestamp/] },
  { item: 'pending[] with id, options and askedAt', heading: JOURNAL,
    anchors: [/askedAt/, /A QUESTION THAT IS NOT IN/] },
  { item: 'the shared inboxSeen cursor and the stolen stamp', heading: JOURNAL,
    anchors: [/inboxSeen/, /FIVE answers/] },
  { item: 'the framing pass and the one interruption',
    heading: '## The framing pass, and the one interruption',
    anchors: [/thirteen/, /2026-08-14/] },
  { item: 'the resume cycle; SendMessage does not wake a --bg worker',
    heading: '## The tick', anchors: [/SendMessage does NOT wake/, /claude stop/] },
  { item: 'the two 600-second ceilings',
    heading: '## The tick', anchors: [/TWO 600-SECOND CEILINGS/] },
  { item: 'exit code and CLI status are non-evidence',
    heading: '## The tick', anchors: [/NON-EVIDENCE/, /exit 144/] },
  { item: 'an undelivered relay is an obligation',
    heading: '## The tick', anchors: [/UNDELIVERED:/, /8 h|eight hours/] },
  { item: 'the decision template', heading: '## The decision template',
    anchors: [/Where it stands/] },
  { item: 'the picture rule',
    heading: '### A question about a picture must carry the picture', anchors: [/thumbnail/] },
  { item: 'the hands-on gate and the unfetched URL', heading: '## The hands-on gate',
    anchors: [/Never hand out a URL you have not fetched/] },
  { item: 'the dev-server sweep', heading: '### The dev-server sweep',
    anchors: [/ORPHAN is the only verdict that kills/] },
  { item: 'the conductor beat and the lock', heading: '## The tick',
    anchors: [/conductor\.beat\.json/, /orchestra lock acquire/] },
  { item: 'the stand-down tick, its ticket sweep and its archiving',
    heading: '## The stand-down tick',
    anchors: [/orchestra archive --write/, /orchestra archive-images --write/, /\bS1s?\b/] },
];

// The document's outline, in order. A superset of the headings above: it also pins the sections that
// §6 does not name item by item but that the port must still carry.
const OUTLINE = [
  '## What is not here yet',
  '## The six nevers',
  '## The language you write in',
  '## The journal (three mechanical obligations, no decision)',
  '## The framing pass, and the one interruption',
  "## The machine's capacity — the budget owns it, and you do not",
  '## The tick',
  '## Adoption (first run, or state lost)',
  '## Preflight (once per machine, before the first launch)',
  '## The decision template',
  '### A question about a picture must carry the picture',
  '## The hands-on gate',
  '### The dev-server sweep',
  // `reference/worker-briefs.md`'s own order: the renderer first, then the two hand-overs that
  // call it. It reads the other way round in the source document, where the handoff introduced a
  // brief the reader had not met yet.
  '## Worker briefs',
  '## Design→execution handoff (design tasks)',
  '## Retiring a long worker (EXPERIMENT — one row at a time)',
  '## The stand-down tick',
  '### The answer net, and what has no net under it yet',
];

// Every path and command of the source project. A survivor here is transformation 1 or 2 left undone
// — and a false invocation in a protocol is worse than a false comment, because a worker types it.
//
// `CLAUDE.md` left this list in phase 5: it is no longer a leftover of the source project's own
// checkout, it is the file `orchestra init` writes into WHATEVER project adopts this plugin (every
// Claude Code project can have one, under that exact name) — the skill's own onboarding section
// names it on purpose, and a forbidden-list entry from before `init` existed must not keep the
// section it exists to describe from ever being written.
const FORBIDDEN = [
  'node tools/', 'tools/orchestra', 'tools/merge-queue', 'tools/tickets', 'tools/retex',
  'tools/queue', 'tools/roadmap/', 'tools/usage-scan', 'npm run ', '.claude/orchestra',
  '.claude/worktrees', 'docs/superpowers/', 'docs/local/', 'docs/ROADMAP.md', 'docs/retex',
  'reports/', 'com.planetcraft', 'launchctl', 'crontab -',
];

// The slice of `text` that belongs to ONE heading — from the heading's own line up to (not
// including) the next heading at level 2 or 3. Anchors are tested against this slice, not the
// whole document: several items share a heading, and several headings share a document, so an
// anchor belonging to a section not yet written must not be satisfiable by prose that belongs to
// its neighbour. Returns null when the heading itself is absent.
function sectionSlice(text, heading) {
  const at = text.indexOf(`\n${heading}\n`);
  if (at < 0) return null;
  const bodyStart = at + 1 + heading.length; // index of the heading's own trailing newline
  const next = text.slice(bodyStart).search(/\n#{2,3} /);
  const end = next < 0 ? text.length : bodyStart + next;
  return text.slice(at + 1, end);
}

test('every section of spec §6 is present, with the measurement that paid for it', () => {
  const texts = docs().map(read);
  const missing = [];
  for (const s of SECTIONS) {
    // The slice is taken from whichever document carries the heading — never from the whole set
    // joined together, which would let an anchor be satisfied by a neighbour in another file.
    const slice = texts.map((t) => sectionSlice(t, s.heading)).find((x) => x !== null) ?? null;
    if (slice === null) { missing.push(`${s.item}: no heading "${s.heading}" in any of ${docs().length} documents`); continue; }
    for (const a of s.anchors) if (!a.test(slice)) missing.push(`${s.item}: anchor ${a} absent`);
  }
  assert.deepEqual(missing, []);
});

test('the outline is complete, and each document holds its own sections in order', () => {
  const texts = docs().map((d) => [d, read(d)]);
  // Present SOMEWHERE: this is the anti-loss guarantee, and it is what the split must not weaken.
  const home = OUTLINE.map((h) => [h, texts.find(([, t]) => t.includes(`\n${h}\n`))?.[0] ?? null]);
  assert.deepEqual(home.filter(([, d]) => d === null).map(([h]) => h), []);
  // In order WITHIN each document. Across files there is no order to hold — a reference is read
  // when a tick reaches its situation, not in sequence — so the check is per file.
  for (const [doc, text] of texts) {
    const mine = OUTLINE.filter((h) => text.includes(`\n${h}\n`)).map((h) => text.indexOf(`\n${h}\n`));
    assert.deepEqual(mine, [...mine].sort((a, b) => a - b), `out of order in ${doc}`);
  }
});

// The index is what makes a reference reachable at all: a conductor reads it to know WHEN to open
// one. A reference nothing names is a section that has left the protocol without being deleted, and
// a row naming a file that is not there sends a tick to read nothing.
test("SKILL.md's index names every reference, and every reference is named by it", () => {
  const core = read(SKILL);
  const from = core.indexOf('\n## What is not in this file, and when to read it\n');
  assert.ok(from >= 0, 'the core must carry the index of what is not in it');
  const index = core.slice(from, core.indexOf('\n## ', from + 10));
  assert.deepEqual(refs().filter((f) => !index.includes(`reference/${f}`)), [],
    'a reference file the index does not name');
  const named = [...index.matchAll(/reference\/([a-z-]+\.md)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(named)].sort().filter((f) => !refs().includes(f)), [],
    'the index names a reference file that does not exist');
});

// Every `reference/…` pointer ANYWHERE in the set must resolve. This is the cost of the split: a
// cross-reference that used to be a section name in the same file is now a path, and a path can
// rot.
test('every reference/ pointer in the protocol resolves to a file that exists', () => {
  const bad = [];
  for (const doc of docs())
    for (const m of read(doc).matchAll(/reference\/([a-z-]+\.md)/g))
      if (!refs().includes(m[1])) bad.push(`${doc} -> reference/${m[1]}`);
  assert.deepEqual([...new Set(bad)], []);
});

// This used to assert that the thirteen brief placeholders were all used and that nothing else was
// one — the guarantee that a placeholder off the list is "a promise the conductor has nothing to
// fill from". `orchestra brief` renders the brief now (lib/register/brief.mjs, covered field by
// field in test/brief.test.mjs), so there is no substitution table left to keep honest and the
// guarantee inverts: the protocol must contain NO hand-filled placeholder at all. One reappearing
// means a brief is being composed by hand again, beside a renderer that already does it.
test('nothing in the protocol is a hand-filled placeholder any more', () => {
  const found = new Set([...readAll().matchAll(/(?<!\$)\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((m) => m[1]));
  assert.deepEqual([...found], []);
});

test('the protocol sends launches through `orchestra brief`, not through a template', () => {
  const core = read(SKILL);
  assert.match(core, /orchestra brief <key>/);
  assert.match(core, /IS the brief — do not compose one/);
});

// Every `orchestra …` the document names must be a subcommand `bin/orchestra` actually dispatches,
// or be roll-called in `## What is not here yet` with its phase. Parsed out of the sources rather
// than listed here, so a subcommand renamed in a later phase fails this test instead of rotting.
const registered = () => new Set(
  [...read(join(ROOT, 'bin', 'orchestra')).matchAll(/^register\('([a-z-]+)'/gm)].map((m) => m[1]),
);
const roadmapVerbs = () => new Set(
  [...read(join(ROOT, 'lib', 'cli', 'roadmap.mjs')).matchAll(/^\s*case '([a-z-]+)':/gm)].map((m) => m[1]),
);

// Commands are only ever written inside backticks or a fenced block, so those are the only places
// scanned — prose that happens to contain the word "orchestra" is not an invocation.
//
// The two patterns are BUILT rather than written as literals, and that is not style: a literal
// triple backtick in this file closes the markdown fence of any document quoting it, so every copy
// taken from the plan arrives truncated at this line. Measured while pre-flighting that plan.
const TICK = String.fromCharCode(96);
const FENCED = new RegExp(`${TICK.repeat(3)}[a-z]*\\n([\\s\\S]*?)${TICK.repeat(3)}`, 'g');
const INLINE = new RegExp(`${TICK}([^${TICK}\\n]+)${TICK}`, 'g');

function invocationsIn(text) {
  // The inline pass runs over a copy with fenced blocks blanked out first and every remaining line
  // wrap collapsed to a single space: the SOURCE FILE hard-wraps its prose (not its code), so a
  // backticked command that happens to fall across that wrap — `` `orchestra\n  inbox` `` — carries
  // a literal newline INLINE's `[^`\n]+` refuses to cross, and never becomes a span at all. Fenced
  // blocks are blanked out first so this collapse cannot fuse a fence's own triple backticks into
  // the surrounding prose, which pairs backticks across block boundaries and manufactures spans
  // that span thousands of characters of unrelated code and text.
  const proseOnly = text.replace(FENCED, ' ').replace(/\n\s*/g, ' ');
  const spans = [
    ...[...text.matchAll(FENCED)].flatMap((m) => m[1].split('\n')),
    ...[...proseOnly.matchAll(INLINE)].map((m) => m[1]),
  ];
  const out = [];
  for (const raw of spans) {
    const s = raw.trim().replace(/^"\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/orchestra"\s*/, 'orchestra ');
    // Anchored at the span's own start, OR at a quoted string's start within it: a tool call passes
    // a command as a quoted argument — `Monitor(command: "orchestra watch-answers …")` — and that
    // quote is the only context where a real invocation legitimately sits mid-line. Unanchoring
    // further, to match "orchestra" anywhere at all, also catches it as a plain noun in prose (an
    // example log line reads "orchestra has not been adopted here"), which is not an invocation.
    const m = /(?:^|")orchestra\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?/.exec(s);
    if (m) out.push(m[1] === 'roadmap' && m[2] ? ['roadmap', m[2]] : [m[1]]);
  }
  return out;
}

test('every command the protocol names either exists or is roll-called with its phase', () => {
  const text = readAll();
  // The roll-call moved to its own reference with the rest of "What is not here yet"; it is the
  // whole of that file, so the slice is the file.
  const rollCall = read(join(REFDIR, 'not-here-yet.md'));
  assert.ok(rollCall.includes('## What is not here yet'), 'the roll-call section must be in reference/not-here-yet.md');
  const cmds = registered();
  const verbs = roadmapVerbs();
  const invocations = invocationsIn(text);
  // A positive control: if the extraction regressed to matching nothing, `bad` would still be
  // empty and this test would pass vacuously. At least 50 real invocations are expected in a
  // document this size, so a broken sweep fails loudly instead of going quiet.
  assert.ok(invocations.length >= 50, `expected at least 50 invocations, found ${invocations.length}`);
  const bad = [];
  for (const [head, verb] of invocations) {
    const known = verb ? verbs.has(verb) : cmds.has(head);
    const named = verb ? `orchestra roadmap ${verb}` : `orchestra ${head}`;
    if (!known && !rollCall.includes(`\`${named}\``)) bad.push(named);
  }
  assert.deepEqual([...new Set(bad)], []);
});

test('no path or command of the source project survives', () => {
  const text = readAll();
  assert.deepEqual(FORBIDDEN.filter((f) => text.includes(f)), []);
});

test('the frontmatter names the skill and says when to use it', () => {
  const text = read(SKILL);
  const fm = /^---\nname: orchestra\ndescription: (.+)\n---\n/.exec(text);
  assert.ok(fm, 'frontmatter must open the file with name: orchestra and one description line');
  assert.match(fm[1], /\/orchestra/);
});
