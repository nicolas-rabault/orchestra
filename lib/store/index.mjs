// One interface, two backends and one destination that crosses them. Every roadmap command is
// written against this and against nothing else, which is what keeps the destinations from drifting
// into three behaviours.
//
// The destination is checked BEFORE the mode, and that order is the design: a destination is a
// property of the ROADMAP (its own frontmatter) and the mode is a property of the PROJECT, so an
// online project publishing its development roadmaps as issues still publishes its `pr` roadmap to
// files nobody else can see. Offline that is the store the mode already picks, and asking for
// `local` there changes nothing.
import { makeFileStore } from './files.mjs';
import { makeGithubStore } from './github/index.mjs';

export function makeStore(cfg, deps = {}, { destination = null } = {}) {
  if (destination === 'local') return makeFileStore(cfg);
  if (cfg.mode === 'offline') return makeFileStore(cfg);
  if (cfg.mode === 'online') return makeGithubStore(cfg, deps);
  throw new Error(`orchestra: unknown mode "${cfg.mode}"`);
}
