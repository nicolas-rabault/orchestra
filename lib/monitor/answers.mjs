// Which of the answers typed in this tab still refer to a question that is on screen. Loaded by
// the browser (served at the `/api/answer` route, `lib/monitor/server.mjs`) and imported by the
// tests, the same way inbox.mjs is shared by every reader of the answer channel —
// `lib/register/{tick,relay,watch}.mjs` and the `orchestra-inbox` hook (`hooks/orchestra-inbox.mjs`)
// alike: the rule that decides what the page remembers is written once.
//
// A pending item written before ids existed is identified by a hash of row + kind + ask, with no
// time and no nonce in it. This was the production path in planetCraft: every open item in its
// register was plain `{kind, ask}`, with no id of its own at all — so the SAME id comes back when a
// task is asked an identically worded question in a later round, and the page would poll for hours
// without a reload. A cache kept past the item's life would then answer for the new question: it
// would render a live ask as already sent and disabled, locking the user out with nothing on
// screen suggesting that only a reload returns it. This is the collision the inbox's age bound
// fixes on the server, in its client mirror.
//
// The signal is the item itself. While it is in the model, the question is the one that was
// answered; the moment it is gone, orchestra has closed it and nothing about it is worth
// remembering. An identically worded question that reopens later therefore arrives to an empty
// cache and a live box.
export const slotOf = (nodeKey, itemId) => `${nodeKey}:${itemId}`;

// The slot namespace of a question about the RUN, which hangs on no node. It cannot collide with a
// node key: every node key carries a slash (`<roadmap>/<id>`, keys.mjs) and this one has none.
export const RUN_KEY = 'run';

// `runAsks` is the model's run-level questions. They are passed in rather than read off a node,
// because they belong to no node — and they are open in exactly the state where no node is left:
// every row terminal is what ENDS a run, and the end of a run is when the question is put.
export function openSlots(nodes, runAsks = []) {
  const open = new Set();
  for (const n of nodes ?? []) for (const p of n.pending ?? []) open.add(slotOf(n.key, p.id));
  for (const a of runAsks ?? []) open.add(slotOf(RUN_KEY, a.id));
  return open;
}

// ---- what is still waiting on the user ----
// ONE rule, in one place, plus the one correction the page is entitled to make to it. Everything on
// screen that says "this is waiting on you" — the red pulse, the corner list, the count in the strip
// at the top, the card's own heading — is this function, so no two of them can ever disagree.
//
// The rule: an item with no answer in the register is waiting.
//
// The correction: an item THIS TAB has already sent an answer for is not waiting, whatever the
// register still says. An answer lands in inbox.jsonl immediately and the item leaves `pending` only
// when a conductor tick clears it, which is minutes later — so between the two the page went on
// pulsing red and listing the question in the corner at a user who had already answered it, with no
// way to tell whether their reply had gone anywhere at all.
//
// `sent` is the page's own map of the slots it has successfully posted (`answered` in app.js), which
// `dropClosed` empties of an item the moment the register closes it: a question re-asked later
// arrives to an empty set and is open again. Empty — the shape the tests and the first render use —
// leaves the register's own answer as the only signal.
export function openItems(node, sent = new Set()) {
  return (node?.pending ?? []).filter((p) => p.answer === null && !sent.has(slotOf(node.key, p.id)));
}

// The same rule as `openItems`, for the questions that are about the run. One function per shape and
// not one per surface: the panel that draws them, the corner list and the count in the strip all
// read this, so none of them can go on shouting after the other two have gone quiet.
export function openRunAsks(runAsks, sent = new Set()) {
  return (runAsks ?? []).filter((a) => a.answer === null && !sent.has(slotOf(RUN_KEY, a.id)));
}

// The notification list in the top-right corner: one row per question orchestra is actually blocked
// on, so a question raised on a node scrolled off the canvas is still reachable in one click.
//
// Register order, unsorted: it is orchestra's own order, and a list that reshuffled itself under the
// pointer between two-second polls would be unclickable.
export function openQuestions(nodes, sent = new Set()) {
  const out = [];
  for (const n of nodes ?? []) {
    for (const p of openItems(n, sent)) {
      out.push({ key: n.key, id: n.id, item: p.id, kind: p.kind, ask: p.ask, images: (p.images ?? []).length });
    }
  }
  return out;
}

// Drops every entry of `cache` whose slot is no longer open. Mutates, because the caller's map is
// the page's own live state; returns it so a caller can chain.
export function dropClosed(cache, nodes, runAsks = []) {
  const open = openSlots(nodes, runAsks);
  for (const slot of [...cache.keys()]) if (!open.has(slot)) cache.delete(slot);
  return cache;
}
