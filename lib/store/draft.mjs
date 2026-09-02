// A draft's slug, shared by both stores.
//
// A draft's slug is always its own frontmatter, falling back to the filename only when the
// frontmatter names none — the same rule `publish()` uses for the slug it publishes under, so a
// draft named `foo.md` that declares `roadmap: bar` can never be listed as `foo` and published as
// `bar`. `files.mjs` and `github/index.mjs` each carried their own copy of this function until a
// fix round found them drifting apart on exactly this question — the shape a shared-nothing design
// is supposed to prevent. One function, both stores import it.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseRoadmap } from '../roadmap/parse.mjs';

export function draftSlug(path) {
  const { roadmap } = parseRoadmap(readFileSync(path, 'utf8'), { source: path });
  return roadmap ?? basename(path, '.md');
}
