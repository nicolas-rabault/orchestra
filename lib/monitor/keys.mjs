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
  if (!m) return { body: ask.trim(), footer: '' };
  return { body: (ask.slice(0, m.index) + ask.slice(m.index + m[0].length)).trim(), footer: m[1].trim() };
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
