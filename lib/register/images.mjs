// The images a register's prose names, found by reading it.
//
// Orchestra writes screenshot paths into an ask, a note or a journal line and then carries on as if
// the picture had arrived — there is no field for the conductor to fill and nothing for it to
// remember: the paths come out of the text it already writes, which is also why this works on the
// notes already on disk rather than only on the ones written after today.
//
// Pure: no filesystem here. Resolving a path against a root is the CALLER's job — `archiveImages.mjs`'s
// own resolver for its narrower question ("is this file still cited, so I may remove it"),
// `lib/monitor/sources.mjs`'s `imageFinder` for the page's wider one ("which file should I serve") —
// and `imagesIn` below composes with whichever one it is handed. This module itself only ever says
// which strings in a block of text look like a path to an image.

// What counts as an image the browser will render from a local file. No SVG: it is a document the
// browser executes, and this route serves whatever the register happens to name.
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

// The longest run of path characters ending in one of those extensions. `:` and whitespace are
// deliberately OUTSIDE the class — that is what stops a sentence, a bracket or a markdown link from
// being swallowed into the path, so `![two arms](.orchestra/images/a.png)` yields the path alone.
// The character immediately before the dot must be a name character, so "the .png file" is prose
// and not a path to look for.
//
// Built per extension list and cached, because `archiveImages.mjs` sweeps a WIDER vocabulary than
// the page renders: a `board.html` is a photograph of a run too, named in the conductor's prose
// exactly the way a `.png` is, and it is the single heaviest file the sweep has to reason about.
// One pattern, two vocabularies — a second regex in the archiver would be a second definition of
// "a path in the prose", and the two would eventually disagree about what is still referenced.
const PATTERNS = new Map();
const patternFor = (exts) => {
  const key = exts.join('|');
  let re = PATTERNS.get(key);
  if (!re) {
    re = new RegExp(String.raw`[A-Za-z0-9_@./~+-]*[A-Za-z0-9_~+-]\.(?:${key})\b`, 'gi');
    PATTERNS.set(key, re);
  }
  return re;
};

// The raw path strings, in the order they are written, each once. Order is the conductor's own: an
// A/B pair reads "branch, then main" because that is how the sentence around it reads.
export function scanImagePaths(text, exts = IMAGE_EXTENSIONS) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  for (const m of text.matchAll(patternFor(exts))) {
    // A remote image is not a file on this machine and this tool serves nothing but the repository.
    // `:` being outside the character class means an http(s) URL arrives here as `//host/x.png` —
    // the one shape that is never a path.
    if (m[0].startsWith('//')) continue;
    if (!out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

// Every image `text` names, resolved. `findImage(raw, branch)` returns `{ rel, raw, missing }` —
// `lib/monitor/sources.mjs`'s `imageFinder` is the one this page uses, injected rather than
// imported here, which is what keeps this module filesystem-free.
//
// A path that resolves to no file is KEPT and marked, never dropped: "orchestra pointed at an
// image that is not on this machine" is a fact worth showing, and dropping it silently would be the
// same failure this module's header already describes for the paths themselves — a screenshot
// nothing looks at is a screenshot that quietly goes missing without anyone noticing.
//
// Deduplicated on the RESOLVED path, not the written one: `c1-main.png` and
// `.orchestra/images/c1-main.png` in one note are one screenshot mentioned twice, and showing it
// twice reads as two arms of a comparison.
export function imagesIn(text, findImage, branch = null) {
  if (typeof findImage !== 'function') return [];
  const out = [];
  const seen = new Set();
  for (const raw of scanImagePaths(text)) {
    const found = findImage(raw, branch);
    const key = found.rel ?? found.raw;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(found);
  }
  return out;
}
