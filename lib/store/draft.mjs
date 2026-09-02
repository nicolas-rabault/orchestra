// A roadmap's slug, shared by both stores.
//
// A roadmap's slug is always its own frontmatter, falling back to the filename only when the
// frontmatter names none — one rule for a draft, for a published file and for the slug `publish()`
// writes under, so a draft named `foo.md` that declares `roadmap: bar` can never be listed as `foo`
// and published as `bar`. `files.mjs` and `github/index.mjs` each carried their own copy of this
// until a fix round found them drifting apart on exactly this question — the shape a shared-nothing
// design is supposed to prevent — and a later round found a THIRD copy in `lib/cli/roadmap.mjs`
// that had regressed to the filename outright. One expression, every caller imports it.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseRoadmap } from '../roadmap/parse.mjs';

// For a caller that has already parsed the file (every `publish`, and the offline store's reader of
// a published file) — re-reading and re-parsing it just to ask its name would be the same work twice.
export const slugOf = (parsed, path) => parsed.roadmap ?? basename(path, '.md');

// For a caller that has not: `drafts()`, which needs a name per file and nothing else.
export function draftSlug(path) {
  const parsed = parseRoadmap(readFileSync(path, 'utf8'), { source: path });
  return slugOf(parsed, path);
}
