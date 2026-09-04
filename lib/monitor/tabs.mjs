// Whose work the stage shows. The board carries every developer's published roadmaps down one
// pipe (`mine`/`owner` on each row, from `lib/store/github/ownership.mjs`), and one mixed canvas
// would hide the answer to "what is MINE doing" behind everyone else's frames. So the page splits
// into tabs: the local view first and by default, then one tab per developer the board names — a
// tab that exists only while they have unfinished work, because a developer whose every task has
// landed is history, not a view.
//
// A tab is a FILTER and nothing else. It decides which nodes reach the layout; the frames, the
// cards, the bars and the graph are the same ones, drawn the same way, whoever the tab belongs to
// (user ruling 2026-09-02, in planetCraft). Another developer's rows carry no session and no
// pending question — their register never reaches this machine — and the page already renders
// exactly that, badged `not adopted`, for a roadmap task no session here has taken.
//
// Pure, and served to the browser like progress.mjs, because the tab bar the page draws and the
// tests must group the same way.
import { tally } from './progress.mjs';

export const LOCAL = 'local';

const TERMINAL = new Set(['landed', 'dropped']);

// An unowned row is mine (model.mjs defaults `mine` to true for register-only nodes); a foreign
// row whose author the channel could not name still is not — it groups under '?' rather than
// silently folding into the local view.
const ownerOf = (n) => n.owner ?? '?';

export const nodesOf = (nodes, tab) => nodes.filter((n) => (tab === LOCAL ? n.mine !== false : n.mine === false && ownerOf(n) === tab));

export function tabsOf(nodes) {
  const others = new Map();
  for (const n of nodes) {
    if (n.mine !== false) continue;
    others.set(ownerOf(n), [...(others.get(ownerOf(n)) ?? []), n]);
  }
  const tabs = [{ id: LOCAL, label: 'local', counts: tally(nodesOf(nodes, LOCAL)) }];
  // Sorted by name, not by activity: a bar that reorders itself between two-second polls is
  // unclickable, the same rule the corner list follows.
  for (const owner of [...others.keys()].sort()) {
    const theirs = others.get(owner);
    if (!theirs.some((n) => !TERMINAL.has(n.status))) continue;
    tabs.push({ id: owner, label: `@${owner}`, counts: tally(theirs) });
  }
  return tabs;
}
