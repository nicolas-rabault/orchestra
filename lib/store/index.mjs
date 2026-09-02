// One interface, two backends. Every roadmap command is written against this and against nothing
// else, which is what keeps the two modes from drifting into two behaviours.
import { makeFileStore } from './files.mjs';
import { makeGithubStore } from './github/index.mjs';

export function makeStore(cfg, deps = {}) {
  if (cfg.mode === 'offline') return makeFileStore(cfg);
  if (cfg.mode === 'online') return makeGithubStore(cfg, deps);
  throw new Error(`orchestra: unknown mode "${cfg.mode}"`);
}
