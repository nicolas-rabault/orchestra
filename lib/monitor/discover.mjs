// Which projects the one page shows (spec §2): every live entry of the machine registry, plus the
// project the page was started from if it has a config and has not registered itself yet.
//
// Resolved PER REQUEST, never once at startup. A project that opts in, opts out or is deleted while
// the page is open must follow within one poll, and a server left running for a day must not be
// serving a set that was true yesterday. It is NOT cheap: `loadConfigOrThrow` forks `git rev-parse`
// TWICE per call (`mainCheckout`, once directly and once through `findConfig`'s repository-boundary
// check) — so N known roots plus the one `here()` resolves below costs roughly 2*(N+1) child
// processes. Measured over a 5-project fixture: 12 forks and 123 ms for one call. `server.mjs`
// calls this once per request (the etag and the body share one resolution), never twice.
import { loadConfigOrThrow } from '../config.mjs';
import { liveInstances, recordInstance } from '../machine.mjs';

// The current directory's project. Registering it, if it is not registered yet, happens below in
// `discoverProjects` itself — this function only resolves the config and does no write of its own.
function here(cwd) {
  let cfg = null;
  try { cfg = loadConfigOrThrow(cwd); } catch { return null; }
  return cfg;
}

export function discoverProjects({ cwd = process.cwd(), now = Date.now() } = {}) {
  const roots = new Set();
  for (const e of liveInstances({ now })) roots.add(e.root);

  // The one write this module does, and it is what makes a freshly `init`ed project appear on the
  // page immediately — which is exactly when someone wants to look at it. Only the four fields
  // every writer sends identically: `recordInstance` merges, so a project that later runs
  // `orchestra ready` keeps its worker side.
  const own = here(cwd);
  if (own && !roots.has(own.root)) {
    recordInstance({ id: own.id, name: own.name, root: own.root, mode: own.mode }, { now });
    roots.add(own.root);
  }

  const found = [];
  for (const root of roots) {
    // A registered project whose config has been removed or corrupted since it registered is
    // DROPPED, never thrown: one deleted checkout may not take the page down for every other
    // project on the machine. It leaves the registry on its own, on the next write, when `isLive`
    // stops holding.
    let cfg = null;
    try { cfg = loadConfigOrThrow(root); } catch { continue; }
    if (!cfg) continue;
    found.push({ id: cfg.id, name: cfg.name, root: cfg.root, mode: cfg.mode, cfg });
  }
  // The same total order `projectTabsOf` applies to the strip, so the model's array and the tabs
  // drawn from it can never disagree about which project is first.
  return found.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
