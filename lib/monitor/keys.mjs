// What a task's frame is called on the board, and what a question OFFERS. Pure: no filesystem, no
// git, no child process — which is what makes the page's layout testable without a repository.
// `pendingId`, the third id this plugin computes, is NOT here: it is `lib/register/pending.mjs`'s,
// shared by the relay and this page, and importing it a second time under a second name is exactly
// the drift this module exists to avoid.

// A register row that names no roadmap at all still has to be drawn somewhere, so it gets a frame
// of its own rather than being dropped.
export const UNFILED = 'unfiled';
// A row whose id is missing or is not a string still gets a key. state.json is rewritten by the
// conductor at every tick, so a half-written row is a real transient state — and in planetCraft's
// own monitor server, `row.id.includes` on one of them threw out of the request handler and killed
// the whole server, answer channel included.
const UNNAMED = '(unnamed)';

const idOf = (row) => (typeof row?.id === 'string' && row.id.trim() ? row.id.trim() : null);

// The register names its roadmap by SLUG — `lib/register/state.mjs`'s own comment on `registerRow`
// already carries the reason: the source project stored a file path here (`docs/local/lighting.md`)
// and had to carry a rule about not confusing the two, so this port stores the slug both stores
// already key on. The frame is that slug, trimmed, so a bare id lands in its own roadmap's frame
// instead of a single grey `unfiled` box holding everything: "one frame per roadmap, each an
// independent network" is the whole design of the canvas. A row naming no roadmap is genuinely
// unfiled and is the only kind still badged so.
function roadmapFrame(row) {
  if (typeof row?.roadmap !== 'string') return null;
  const slug = row.roadmap.trim();
  return slug || null;
}

export function registerKey(row) {
  const id = idOf(row);
  if (id?.includes('/')) return id;
  return `${roadmapFrame(row) ?? UNFILED}/${id ?? UNNAMED}`;
}

// The decision template writes `Options: A) … · B) … · C) …`. Most asks carry none — a hands-on
// item is an instruction, not a choice — so finding none is the ordinary case, not a failure.
//
// `:` opens the alternation alongside `·` and a newline because the template's own lead-in is
// `Options:`, so the FIRST option is introduced by a colon and no separator at all. Leaving it out
// silently dropped option A and kept B and C, which is worse than finding none.
export function parseOptions(ask) {
  if (!ask) return [];
  const out = [];
  const re = /(?:^|[:·|\n])\s*([A-Z])\)\s*([^·|\n]+)/g;
  for (const m of ask.matchAll(re)) out.push({ letter: m[1], text: m[2].trim() });
  return out;
}

// A labelled line of the decision template — `Where it stands: …`, `La question : …`. Matched by
// SHAPE and not by name, because the conductor writes the body in the user's language: duckJam's
// own asks say `Où on en est :`, with the space French puts before a colon, and a parser keyed on
// the template's English wording would read a whole ask as one unlabelled paragraph.
//
// A label is 2 to 40 characters carrying no sentence punctuation, and its colon is followed by
// whitespace or the end of the line. Both halves of that earn their keep on real asks: the cap is
// what stops `Two shapes, and the row is one or the other: a project that serves…` (43 characters)
// from being read as a heading, and the lookahead is what stops a line opening on `http://…` from
// being read as a label `http` with the text `//127.0.0.1:8073`.
const LABEL = /^([^\s:.!?/][^:.!?/\n]{0,38}[^\s:.!?/])\s*:(?=\s|$)/;

// The labels the template reserves for its technical footer. The only two names in this module,
// and they degrade gracefully: an ask that labels its footer in another language keeps it in the
// body, which is exactly where it is today.
const FOOTER_LABEL = /^(?:technical|pictures)$/i;

// The body cut into the sections its labels declare, in source order. Text before the first label
// is a section of its own with no label, so an ask that carries none at all still comes back as
// one piece. `from` is the line the section opens on — `splitAsk` needs it to slice the original
// string rather than rebuild it, which would quietly rewrite `Où on en est :` as `Où on en est:`.
function sectionsOf(body) {
  const lines = String(body).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LABEL);
    if (m) out.push({ label: m[1], lines: [lines[i].slice(m[0].length)], from: i });
    else if (out.length) out[out.length - 1].lines.push(lines[i]);
    else out.push({ label: '', lines: [lines[i]], from: i });
  }
  return out.map((s) => ({ label: s.label, text: s.lines.join('\n').trim(), from: s.from }));
}

// The trailing run of footer sections, when the ask ends on one and the tags are missing. Every ask
// leLab's conductor wrote in 2026-09 put `Technical:` in the body with no `<sub>` around it, so
// seven hundred characters of PR numbers, commit shas and pids were printed as part of the
// question. The template says that block IS the footer; the tags are how it is usually marked, not
// what makes it one.
//
// The run has to reach the END of the ask: a `Technical:` line with a question under it is a body
// that happens to mention its numbers early, and swallowing everything after it would swallow the
// question. `at === 0` — an ask that is nothing but a footer — is left as a body, because a card
// with an empty question and a dimmed footer says less than the footer does.
function tailFooter(body) {
  let at = -1;
  for (const s of sectionsOf(body)) {
    if (!FOOTER_LABEL.test(s.label)) at = -1;
    else if (at === -1) at = s.from;
  }
  if (at <= 0) return null;
  const lines = body.split('\n');
  return { body: lines.slice(0, at).join('\n').trim(), footer: lines.slice(at).join('\n').trim() };
}

// The decision template ends every ask with a `<sub>…</sub>` footer holding the numbers, the names
// and the paths of the screenshots the question is about. The page renders text, never markup (an
// ask is whatever the register happens to hold), so those tags would otherwise be printed literally
// in the middle of the question. Splitting them off here means the footer can be drawn as what it
// is, quietly, under the question, instead of read as part of it.
//
// The FIRST `<sub>` only, and the rest of the string comes back as the body: an ask carrying two of
// them is malformed, and inventing a rule for it would be inventing a shape the template does not
// have. Nothing is dropped either way — whatever is not the first footer stays in the body.
export function splitAsk(ask) {
  if (typeof ask !== 'string' || !ask) return { body: '', footer: '' };
  const m = ask.match(/<sub>([\s\S]*?)<\/sub>/i);
  if (m) return { body: (ask.slice(0, m.index) + ask.slice(m.index + m[0].length)).trim(), footer: m[1].trim() };
  return tailFooter(ask) ?? { body: ask.trim(), footer: '' };
}

// A section that says nothing the option buttons do not already say. The template writes its
// choices twice — once as `Options: A) … · B) …` in the body, once as the item's `options` — and
// the page draws the second as buttons three lines under the first, so the line in the body is the
// same sentence printed twice.
//
// Dropped only when the buttons carry EVERY letter it names: a body offering A, B and C beside
// buttons for A alone is a choice the user would lose sight of, and the page must never narrow
// what orchestra offered. The text has to OPEN on an option too, so `Where it stands: option A)
// was tried` — a sentence that merely mentions one — is not mistaken for the list.
function spentOptions(text, letters) {
  if (!/^[A-Z]\)/.test(text)) return false;
  const found = [...text.matchAll(/(?:^|[\s·|])([A-Z])\)/g)].map((mm) => mm[1]);
  return found.length > 0 && found.every((l) => letters.has(l));
}

// The body read as what the template makes it: some context, and the one question being put. The
// page draws them in THAT order whatever order they arrive in — the template puts `Why it is yours
// to decide` after the question, and a reader who has to hold a question in mind across a
// paragraph of justification is reading it twice.
//
// The question is the LAST section ending on a question mark. Last, because the template's own
// rule is that the question is one sentence ending in `?`, and the sections around it can end on a
// rhetorical one of their own; the one the options belong to is the one the template puts last.
// A body that asks nothing comes back as context with no question rather than with a guess —
// a hands-on item is an instruction, and inventing a question for it would put words on the card
// that orchestra never asked.
export function askSections(body, options = []) {
  const letters = new Set((options ?? []).map((o) => o?.letter));
  const secs = sectionsOf(body ?? '')
    .filter((s) => s.text && !spentOptions(s.text, letters))
    .map((s) => ({ label: s.label, text: s.text }));
  let at = -1;
  for (let i = 0; i < secs.length; i++) if (secs[i].text.endsWith('?')) at = i;
  return { context: secs.filter((_, i) => i !== at), question: at === -1 ? null : secs[at] };
}

// What the user is actually offered. The conductor's own `options` when it wrote them down, the
// ask's text when it did not — and NOTHING when neither has any, whatever the item's kind. The
// page must never put words in the user's mouth: an invented option would be shown as a choice
// orchestra offered, and one click would send it back as the user's decision.
//
// The written field wins over the parse: it is what the conductor formulated, while the parse is a
// best effort at a sentence that was never meant to be machine-read. An entry missing a letter or
// a text is dropped rather than rendered as a blank button, and an `options` that yields nothing
// usable falls back to the text, which is where every option lived until the conductor was asked
// to write them down.
export function itemOptions(item) {
  const written = (Array.isArray(item?.options) ? item.options : [])
    .filter((o) => typeof o?.letter === 'string' && o.letter.trim() && typeof o?.text === 'string' && o.text.trim())
    .map((o) => ({ letter: o.letter.trim(), text: o.text.trim() }));
  return written.length ? written : parseOptions(item?.ask);
}
