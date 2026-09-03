// The phase's acceptance (spec §15): the section checklist of §6 is present. It is a pin against
// the risk §16 names — "the protocol document is 1031 lines of hard-won rules and the port could
// quietly drop one" — plus four guards that hold the two transformations of §6's last paragraph.
//
// What it CANNOT do is judge whether a section is right. There is no dead-code gate and no prose
// linter in this repository; the per-task review is the only filter, and this file must never be
// presented as one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SKILL = join(ROOT, 'skills', 'orchestra', 'SKILL.md');
const read = (p) => readFileSync(p, 'utf8');

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
  { item: 'the playtest gate and the unfetched URL', heading: '## The playtest gate',
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
  '## The playtest gate',
  '### The dev-server sweep',
  '## Design→execution handoff (design tasks)',
  '## Worker briefs',
  '## Retiring a long worker (EXPERIMENT — one row at a time)',
  '## The stand-down tick',
  '### The answer net, and what has no net under it yet',
];

// The nine substitutions §6 fixes for the briefs. They are also the ONLY single-word braces the
// document may contain: a config key named in prose is a backticked key name, never a placeholder,
// and a tenth placeholder is a promise the conductor has nothing to fill from.
const PLACEHOLDERS = ['branch', 'task', 'title', 'excerpt', 'language', 'branchTests',
  'specsDir', 'plansDir', 'briefExtra'];

// Every path and command of the source project. A survivor here is transformation 1 or 2 left undone
// — and a false invocation in a protocol is worse than a false comment, because a worker types it.
const FORBIDDEN = [
  'node tools/', 'tools/orchestra', 'tools/merge-queue', 'tools/tickets', 'tools/retex',
  'tools/queue', 'tools/roadmap/', 'tools/usage-scan', 'npm run ', '.claude/orchestra',
  '.claude/worktrees', 'docs/superpowers/', 'docs/local/', 'docs/ROADMAP.md', 'docs/retex',
  'reports/', 'CLAUDE.md', 'com.planetcraft', 'launchctl', 'crontab -',
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
  const text = read(SKILL);
  const missing = [];
  for (const s of SECTIONS) {
    const slice = sectionSlice(text, s.heading);
    if (slice === null) { missing.push(`${s.item}: no heading "${s.heading}"`); continue; }
    for (const a of s.anchors) if (!a.test(slice)) missing.push(`${s.item}: anchor ${a} absent`);
  }
  assert.deepEqual(missing, []);
});

test('the outline is complete and in order', () => {
  const text = read(SKILL);
  const at = OUTLINE.map((h) => [h, text.indexOf(`\n${h}\n`)]);
  assert.deepEqual(at.filter(([, i]) => i < 0).map(([h]) => h), []);
  const order = at.map(([, i]) => i);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('the nine brief placeholders are all used, and nothing else is a placeholder', () => {
  const text = read(SKILL);
  const found = new Set([...text.matchAll(/(?<!\$)\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((m) => m[1]));
  assert.deepEqual([...found].filter((p) => !PLACEHOLDERS.includes(p)), []);
  assert.deepEqual(PLACEHOLDERS.filter((p) => !found.has(p)), []);
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
  const spans = [
    ...[...text.matchAll(FENCED)].flatMap((m) => m[1].split('\n')),
    ...[...text.matchAll(INLINE)].map((m) => m[1]),
  ];
  const out = [];
  for (const raw of spans) {
    const s = raw.trim().replace(/^"\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/orchestra"\s*/, 'orchestra ');
    const m = /^orchestra\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?/.exec(s);
    if (m) out.push(m[1] === 'roadmap' && m[2] ? ['roadmap', m[2]] : [m[1]]);
  }
  return out;
}

test('every command the protocol names either exists or is roll-called with its phase', () => {
  const text = read(SKILL);
  const from = text.indexOf('\n## What is not here yet\n');
  const to = text.indexOf('\n## The six nevers\n');
  assert.ok(from >= 0 && to > from, 'the roll-call section must come before the nevers');
  const rollCall = text.slice(from, to);
  const cmds = registered();
  const verbs = roadmapVerbs();
  const bad = [];
  for (const [head, verb] of invocationsIn(text)) {
    const known = verb ? verbs.has(verb) : cmds.has(head);
    const named = verb ? `orchestra roadmap ${verb}` : `orchestra ${head}`;
    if (!known && !rollCall.includes(`\`${named}\``)) bad.push(named);
  }
  assert.deepEqual([...new Set(bad)], []);
});

test('no path or command of the source project survives', () => {
  const text = read(SKILL);
  assert.deepEqual(FORBIDDEN.filter((f) => text.includes(f)), []);
});

test('the frontmatter names the skill and says when to use it', () => {
  const text = read(SKILL);
  const fm = /^---\nname: orchestra\ndescription: (.+)\n---\n/.exec(text);
  assert.ok(fm, 'frontmatter must open the file with name: orchestra and one description line');
  assert.match(fm[1], /\/orchestra/);
});
