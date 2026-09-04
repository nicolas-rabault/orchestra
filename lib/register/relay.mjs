// What the conductor is told about the answers the user typed on the page — the text itself, with
// no opinion about WHO is being told. Two entry points are meant to share it: the `orchestra inbox`
// subcommand, ported here, and the hook that injects it into a live session — P5's, and not yet
// built. Only the hook will have a session gate; the rendering below is written to be identical for
// both by construction, so there is no second copy of the branches here to rot out of sync
// unnoticed once the hook exists.
//
// Idempotence is not this module's job. It emits what inbox.mjs's rule says is unconsumed and asks
// the conductor to stamp conductor.inboxSeen; if the tick dies before stamping, the next one is told
// again. A repeated relay costs a worker one sentence, a lost answer costs a decision.
//
// What it IS this module's job to bound is the size of that repeat. A conductor that never stamps
// gets the whole inbox back on every read, growing forever, with neither jsonl file rotated. So at
// most RELAY_CAP entries are emitted, and the truncation says so in one line rather than dropping
// them quietly.
//
// The batch is the OLDEST unconsumed entries, not the newest, and that direction is load-bearing:
// the conductor is told to stamp inboxSeen to the newest timestamp shown, so a batch drained
// oldest-first stamps past exactly what was relayed and the next read brings the next batch. Newest
// -first would have that same stamp jump over every older answer the conductor was never shown,
// leaving them to the pending rule alone — which is age-bounded at four hours and does not carry a
// free remark at all. That is a lost decision, which is the one failure this channel may not have.
//
// Sorted by INSTANT before the cap is applied — a deliberate divergence from the source project,
// which relies on file order (append-only writes) staying chronological and never sorts. This
// plugin cannot lean on that: a clock adjustment, a late-flushed write, or a hand-edited inbox can
// leave an older `ts` behind a newer one in the file, and slicing on file order alone would drop
// that older entry outside the shown batch — the conductor then stamps `inboxSeen` past it, and a
// free remark (which carries no `pending`, so the four-hour grace rule cannot recover it) is behind
// the cursor for ever. An entry whose `ts` will not parse sorts to the END, never the front: it
// cannot be proven old, and letting it displace a genuinely old, provably unconsumed entry out of a
// capped batch would be the same failure this sort exists to prevent.
import { existsSync } from 'node:fs';
import { readState } from './state.mjs';
import { readJsonl, unconsumed, inboxPath, at, oneLine } from './inbox.mjs';
import { pendingId } from './pending.mjs';

const RELAY_CAP = 20;
const ONE_LINE_CAP = 160;

const instant = (e) => at(e.ts) ?? Infinity;

// Every branch below says what is KNOWN and names what is not. A register rewritten since the answer
// was typed, an item an earlier tick already cleared, a row with no session on it — each is a normal
// state of this channel and each needs a different action from the conductor, so none of them may be
// flattened into the same line.
const sessionOf = (row) => {
  if (!row.session && !row.sessionName) return null;
  const named = row.sessionName ?? 'an unnamed session';
  const id = row.session ? ` (${String(row.session).slice(0, 8)})` : '';
  return `${named}${id}${row.branch ? ` on ${row.branch}` : ''}`;
};

// `lead` because the same fact is a different sentence depending on the line it joins: a question was
// ASKED BY a session, a free remark about the task was not asked by anybody.
const addressee = (row, lead) => {
  const session = sessionOf(row);
  if (session) return `${lead} ${session}`;
  return `no session recorded on this row${row.branch ? ` (branch ${row.branch})` : ''} — this answer is for you to act on, not to forward`;
};

const ON_ROW = 'the session on this row is';

// What the answer is an answer TO, and who has to hear it — resolved out of the register here rather
// than handed over as an id and a hope.
//
// `pending` is a stable key, not a readable one. An item the conductor gave no explicit `id` is keyed
// by a sha1 of row/kind/ask (`c2-11f5d06c`), which names the question in a form only this code can
// invert — and a row carrying two such items leaves NO way to tell which of them was answered. The
// question's own words, and the session that asked it, are both sitting in state.json. Reading them
// out is the difference between relaying an answer verbatim to the worker that is waiting for it and
// working out from a hash which worker that might be.
function about(e, rows) {
  if (!e.task) return ['no task — a remark for you'];
  const row = rows.get(e.task);
  if (!row) return [`${e.task} — NO ROW WITH THIS ID in state.json; the register has been rewritten since, so find where this task went before relaying anything`];
  if (!e.pending) return [`${e.task} — a remark about this task, not an answer to any of its questions`, addressee(row, ON_ROW)];
  const item = (row.pending ?? []).find((p) => pendingId(row.id, p) === e.pending);
  if (!item) return [`${e.task} · item ${e.pending} is NO LONGER in this row's pending[] — an earlier tick most likely cleared it; establish what was asked before relaying`, addressee(row, ON_ROW)];
  return [`${e.task} · item ${e.pending} · ${item.kind ?? 'question'}`, `the question: "${oneLine(item.ask, ONE_LINE_CAP)}"`, addressee(row, 'asked by')];
}

// The empty string means "nothing to say", and both callers write it straight to stdout — so a repo
// with no monitor, no register, or nothing unconsumed costs a tick one silent read.
export function relay(repo, now = Date.now()) {
  const inbox = inboxPath(repo);
  if (!existsSync(inbox)) return '';

  // readState() throws on an unparseable register — a real editing mistake, worth surfacing to
  // whoever caused it. But a register mid-rewrite (state.mjs writes through a temp file and a
  // rename, so this is a narrow window, not a routine one) must not crash a conductor that merely
  // asked for its inbox: stay silent and let the next read see the finished write.
  let state;
  try { state = readState(repo); } catch { return ''; }
  if (!state) return '';

  const { entries } = readJsonl(inbox);
  const fresh = unconsumed(entries, state, now);
  if (!fresh.length) return '';

  const oldestFirst = [...fresh].sort((a, b) => instant(a) - instant(b));
  const shown = oldestFirst.slice(0, RELAY_CAP);
  const omitted = oldestFirst.length - shown.length;

  const rows = new Map();
  for (const t of state.tasks ?? []) if (typeof t?.id === 'string') rows.set(t.id, t);

  const lines = shown.map((e) => `- [${e.ts}] ${about(e, rows).join('\n  ')}\n  the user's answer: "${e.answer}"`);
  if (omitted) lines.push(`- ${omitted} further answers are waiting behind these; the next tick brings them`);

  return `<orchestra-monitor-inbox count="${shown.length}">\n${lines.join('\n')}\n</orchestra-monitor-inbox>\n\n`
    + 'The user answered these from the monitoring page. For each one: relay it verbatim to the session '
    + 'named above (with whatever context that worker needs), remove the item from that row\'s '
    + '`pending` in state.json, and journal an `answer` line. Then set `conductor.inboxSeen` to the '
    + 'newest timestamp above: it covers exactly the answers listed here and nothing else, so anything '
    + 'still waiting reaches you next tick. Leave it unset and these same answers come back.\n';
}
