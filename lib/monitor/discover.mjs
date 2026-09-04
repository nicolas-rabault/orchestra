// Which projects the one page shows (spec §2): every live entry of the machine registry, plus the
// project the page was started from if it has a config and has not registered itself yet.
//
// Resolved PER REQUEST, never once at startup. A project that opts in, opts out or is deleted while
// the page is open must follow within one poll, and a server left running for a day must not be
// serving a set that was true yesterday. It is cheap: one JSON read plus one config read per
// project, no child process.
import { loadConfigOrThrow } from '../config.mjs';
import { liveInstances, recordInstance } from '../machine.mjs';

// The current directory's project, registered on the way. This is the one write this module does,
// and it is what makes a freshly `init`ed project appear on the page immediately — which is
// exactly when someone wants to look at it. Only the four fields every writer sends identically:
// `recordInstance` merges, so a project that later runs `orchestra ready` keeps its worker side.
function here(cwd) {
  let cfg = null;
  try { cfg = loadConfigOrThrow(cwd); } catch { return null; }
  return cfg;
}

export function discoverProjects({ cwd = process.cwd(), now = Date.now() } = {}) {
  const roots = new Map();
  for (const e of liveInstances({ now })) roots.set(e.root, e.id);

  const own = here(cwd);
  if (own && !roots.has(own.root)) {
    recordInstance({ id: own.id, name: own.name, root: own.root, mode: own.mode }, { now });
    roots.set(own.root, own.id);
  }

  const found = [];
  for (const root of roots.keys()) {
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
