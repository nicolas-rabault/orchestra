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

// Structural regression checks only: behavioral scenarios still require review.
test('the compact core retains lifecycle boundaries without loading historical anecdotes', () => {
 const core = read(SKILL);
 for (const evidence of [/yield-check/, /conductor lock/, /inboxSeen/, /pending\[\]/,
   /answered\[\]/, /relay.text/, /orchestra land/, /orchestra await/, /roadmap claim/,
   /relaunch/, /design handoff/, /LIMIT/, /--renew/, /--compact/, /Codex/, /Claude/])
   assert.match(core, evidence);
 assert.ok(core.split(/\s+/).length < 2200, 'core instructions must stay bounded');
 assert.ok(read(join(ROOT, 'skills/roadmap/SKILL.md')).split(/\s+/).length < 800);
});

// The index is what makes a reference reachable at all: a conductor reads it to know WHEN to open
// one. A reference nothing names is a section that has left the protocol without being deleted, and
// a row naming a file that is not there sends a tick to read nothing.
test("SKILL.md's index names every reference, and every reference is named by it", () => {
  const core = read(SKILL);
  const from = core.indexOf('\n## Read only what this tick needs\n');
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
  assert.match(core, /Use its prompt exactly/);
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
