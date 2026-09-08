// Does a command `git add` a path under the project's drafts directory?
//
// No `-f` requirement. The source project's equivalent (planetCraft's `guard-local-roadmap.mjs`)
// only had to catch the gitignore bypass, because `docs/local/*` was already refused by an
// ordinary `git add` there — the only way past a gitignore refusal is `-f`, so that guard only
// looked for `-f`. Here the drafts directory is hidden from git only once `orchestra init` has
// run — online, by the `.orchestra/.gitignore` it writes; offline, by the line it appends to this
// clone's own `info/exclude`, never committed — so a project that has not run `init` yet, or has
// since edited its own exclusion, has no such floor: an ORDINARY `git add` must be caught too,
// `-f` or not.
//
// What this cannot catch: `git add -A` (or a bare `git add .`) sweeps a draft into the index
// without ever NAMING it, and this hook has no path to inspect there — only that exclusion stops
// that case.
import { segments, stripEnv, stripQuotes } from './segments.mjs';

const normalize = (p) => stripQuotes(p).replace(/^\.\//, '').replace(/\/$/, '');

// Returns the blocked segment (truthy), or null when nothing in `command` adds a path under
// `draftsDir`.
export function draftAdds(command, draftsDir) {
  const dir = normalize(String(draftsDir ?? ''));
  if (!dir) return null;

  for (const segment of segments(command)) {
    const tokens = stripEnv(segment).split(/\s+/).filter(Boolean);
    if (tokens[0] !== 'git') continue;

    // Walk git's own global options (as guard-main-commit does) to find the subcommand.
    let i = 1;
    while (i < tokens.length && tokens[i].startsWith('-')) i += tokens[i] === '-C' ? 2 : 1;
    if (tokens[i] !== 'add') continue;

    const paths = tokens.slice(i + 1).filter((t) => !t.startsWith('-')).map(normalize);
    if (paths.some((p) => p === dir || p.startsWith(`${dir}/`))) return segment;
  }
  return null;
}
