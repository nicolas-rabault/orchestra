// Is `target` inside `dir`? The one place this plugin answers that question, shared by every hook
// that needs it — previously answered twice, once with a bare string compare
// (hooks/guard-main-edit.mjs's `.orchestra/` exemption) and once with `resolve()`
// (hooks/lint-roadmap.mjs's roadmap-directory match), and neither spelling is enough on its own.
//
// `lib/paths.mjs`'s `mainCheckout` — underneath every `cfg.root` a hook computes — runs
// `git rev-parse --git-common-dir`, and git always returns that CANONICAL (symlink-resolved): on
// macOS `/tmp` is a symlink to `/private/tmp`, and a project living under any symlinked directory
// (an aliased volume, a symlinked `~/Projects`) is the ordinary case, not an exotic one. A hook's
// payload carries whatever spelling the calling tool used, which is not guaranteed to be that
// canonical form. Comparing the two with `resolve()` alone cannot close that gap: `resolve()` only
// normalises `.`/`..`/relative segments and never touches a symlink, so it leaves an unresolved
// ancestor exactly as unresolved as it found it. What actually matches `root`'s own resolution is
// `realpathSync` — which throws on a path that does not exist yet (a Write's target, before its
// file is created), so `canonicalPath` walks up to the nearest EXISTING ancestor, realpaths that,
// and rejoins the untouched remainder.
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export function canonicalPath(p) {
  const abs = resolve(p);
  let dir = abs;
  while (!existsSync(dir)) {
    const parent = dirname(dir);
    if (parent === dir) return abs; // nothing on this filesystem exists at all — resolved is all there is
    dir = parent;
  }
  const real = realpathSync(dir);
  return dir === abs ? real : join(real, relative(dir, abs));
}

export function isUnderDir(dir, target) {
  const absDir = canonicalPath(dir);
  const absTarget = canonicalPath(target);
  return absTarget === absDir || absTarget.startsWith(`${absDir}/`);
}
