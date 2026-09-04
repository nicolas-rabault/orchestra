// The project strip — level 1, above the developer strip `tabs.mjs` draws. One page serves every
// orchestra on this machine, so the first question a reader asks is "which project", and the
// second is "whose work inside it". These are the two strips, in that order, and this module owns
// only the first.
//
// A tab is a SELECTOR, not a filter: exactly one project's model reaches the canvas, the rail and
// the cards, and everything below this level behaves as it did when the page served one project.
// That is what keeps `tabs.mjs`, `layout.mjs` and every card unchanged by going plural.
//
// Pure, and served to the browser like `tabs.mjs` and `progress.mjs`, because the strip the page
// draws and the tests must group projects the same way.
import { tally } from './progress.mjs';
import { openQuestions } from './answers.mjs';

// Sorted by NAME, and by id where two projects share one — never by activity, the same rule
// `tabsOf` and the corner list already follow: a strip that reorders itself between two-second
// polls is unclickable. Two checkouts of one repository legitimately carry the same name (the id
// is a hash of the path, the name is a directory name), so the id is the tiebreak that makes the
// order total rather than merely stable-ish.
export function projectTabsOf(models, sent = new Set()) {
  return (models ?? [])
    .map((m) => ({
      id: m.project.id,
      name: m.project.name,
      mode: m.project.mode,
      // The WHOLE project, never the selected developer view: this figure answers "what is this
      // project doing", and a count that moved when you changed developer tab would be answering
      // a different question under the same pill.
      counts: tally(m.nodes),
      // `sent` is this tab's own optimistic set for the project concerned — the caller slices it,
      // because a slot key (`nodeKey:itemId`) is only unique WITHIN a project.
      waiting: openQuestions(m.nodes, sent).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// The selected project's model, or null when the project it names has left the machine between two
// polls — a checkout deleted, a config removed. The page falls back to the first tab rather than
// rendering nothing.
export const modelOf = (models, id) => (models ?? []).find((m) => m.project.id === id) ?? null;
