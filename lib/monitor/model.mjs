// The union of two sources: the board is what the ROADMAP says (title, order, deps, why,
// acceptance), the register is what THIS MACHINE is doing (session, port, note, pending). Neither
// owns the other's fields.
//
// Nothing is ever dropped. A key on one side only is rendered and badged, because dropping it
// silently is a real failure, not a hypothetical one: measured in planetCraft, 2026-08-11, seven
// register rows named a roadmap that did not define them and thirteen roadmap tasks were absent
// from the register, and both went unnoticed because nothing looked (`lib/roadmap/board.mjs`'s own
// header carries the same measurement, for `reconcile`'s narrower orphan report).
import { workerRuntime } from '../register/runtime.mjs';
import { codexStatus } from '../register/codex.mjs';
import { registerKey, itemOptions, splitAsk, askSections, UNFILED } from './keys.mjs';
import { pendingId, runAskId } from '../register/pending.mjs';
import { unconsumed } from '../register/inbox.mjs';
import { imagesIn } from '../register/images.mjs';

export function joinRows(boardRows, register) {
  const byKey = new Map(boardRows.map((r) => [r.key, r]));
  const byBranch = new Map();
  const byBareId = new Map();
  for (const r of boardRows) {
    if (r.branch && !byBranch.has(r.branch)) byBranch.set(r.branch, r);
    byBareId.set(r.id, [...(byBareId.get(r.id) ?? []), r]);
  }

  const pairs = [];
  const ambiguous = [];
  const duplicates = [];
  const taken = new Set();

  // Two node keys must never be equal, whatever the register holds. Two rows carrying the SAME id
  // string derive the same fallback key, and a repeated key is not cosmetic: `layout.mjs`'s rank
  // loop is bounded by distinct KEYS, so counting rows while ranking keys waits forever for a node
  // already placed and throws (`layout.mjs`'s own comment on `rankFrame` carries the measurement:
  // in planetCraft this reached the page's render step, inside the poll's catch-all, and left a
  // blank canvas that never polled again). The first row keeps the plain key; a later one is
  // suffixed, which is stable for a given register order and reported like any other double claim.
  const used = new Set();
  const claim = (key) => {
    if (!used.has(key)) { used.add(key); return key; }
    if (!duplicates.includes(key)) duplicates.push(key);
    let i = 2;
    while (used.has(`${key}#${i}`)) i += 1;
    used.add(`${key}#${i}`);
    return `${key}#${i}`;
  };

  for (const reg of register) {
    const bare = byBareId.get(reg.id) ?? [];
    let board = byKey.get(reg.id) ?? (reg.branch ? byBranch.get(reg.branch) : null) ?? null;
    if (!board && bare.length === 1) [board] = bare;
    if (!board && bare.length > 1) ambiguous.push(reg.id);
    // A board row may be claimed by at most one register row. A second register row that
    // resolves to an already-taken board loses the race — this is the bare-id/qualified-id
    // migration state colliding with itself (one register row already on the qualified key,
    // one still bare) — so it falls back to its own key instead of drawing the same task twice,
    // and the collision is recorded rather than silently preferring whichever row came first.
    if (board && taken.has(board.key)) {
      if (!duplicates.includes(board.key)) duplicates.push(board.key);
      board = null;
    }
    if (board) taken.add(board.key);
    pairs.push({ key: claim(board ? board.key : registerKey(reg)), board, reg });
  }
  for (const r of boardRows) if (!taken.has(r.key)) pairs.push({ key: claim(r.key), board: r, reg: null });
  return { pairs, ambiguous, duplicates };
}

// One bare-id lookup, used twice with two different fallbacks. A name resolves to itself when it
// is already a key, to `<roadmap>/<name>` inside its own frame, or to the single node carrying it
// as a bare id.
//
// A dependency that resolves to nothing falls back to null and is dropped: an edge into the void
// is worse than a missing edge, because it makes the graph look wrong rather than incomplete. A
// rail line falls back to the raw string instead, because the rail never hides text.
function resolveKey(name, roadmap, byKey, byBareId, fallback) {
  if (byKey.has(name)) return name;
  const inRoadmap = `${roadmap}/${name}`;
  if (roadmap && byKey.has(inRoadmap)) return inRoadmap;
  const bare = byBareId.get(name);
  return bare?.length === 1 ? bare[0] : fallback;
}

// What this row's card offers to run: nothing for a settled row, a resume for a live session, a
// launch for one nobody holds. The two shapes mirror the orchestra protocol's own launch and resume
// cycles (`skills/orchestra/SKILL.md`, "Launch, and the names" and "Liveness — and the resume
// cycle") — this is that protocol typed out as a copyable command block, never a second definition
// of it, so the two must agree word for word on the facts.
export function invokeCommand(node, cfg) {
  if (node.status === 'landed' || node.status === 'dropped') return { kind: 'none', lines: [] };
  // The register row's own id, lowercased, with every run of non-alphanumeric characters replaced
  // by a single dash — `lod/C2` -> `lod-c2`. The SAME slug names the worktree directory and the
  // task half of the session name below: a command block offering two different slugging rules for
  // one task would be offering two facts that can quietly drift apart.
  const slug = String(node.id).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  // The session name is `orchestra-<project id>-<task slug>` and it is not optional (spec §8.4):
  // without the project id, `orchestra-<task id>` alone collides the moment two projects on this
  // machine have a task called the same thing, and both `SendMessage` and `claude agents --json`
  // are matched by name.
  const session = `orchestra-${cfg.id}-${slug}`;
  // The resume cycle of the orchestra protocol is `orchestra drive` (lib/cli/drive.mjs): it stops
  // the background registration, resumes the session in its worktree with the row's own relay at
  // the head of the nudge, and stamps the receipt when the turn returns. The three-line form this
  // block used to print carried a GENERIC nudge, and a conductor copying it resumed three workers
  // past the relays sitting on their rows (2026-09-08, duckJam) — so it is not offered any more.
  if (node.session) return { kind: 'resume', lines: [`orchestra drive ${node.id}`] };
  if (node.runtime === 'codex') return { kind: 'launch', lines: [`orchestra brief ${node.key ?? node.id} --runtime codex`, 'Use create_thread to launch an independent Codex task with this brief and its assigned worktree.'] };
  // No dependency-install line. The project this was extracted from ran `npm install` here,
  // equipping a fresh worktree for its one JS toolchain — but a portable plugin cannot know
  // whether a Rust, Python or Go project needs a bootstrap step at all, let alone which one.
  // `skills/orchestra/SKILL.md`'s "Launch, and the names" already carries the ruling ("Do not run
  // a dependency install here") and the command shape below agrees with it word for word: a
  // project that does need one says so in `briefExtra`, which reaches the worker's own brief,
  // never this copyable block.
  // `design ? 'fable' : 'opus'` is the same choice `planLaunches` makes in
  // `lib/register/ready.mjs` — that module is the AUTHORITY on it, not this one. It cannot be
  // imported here to own the choice in one place, but not because this file is browser-served
  // (it is not, unlike its five siblings `layout.mjs`, `progress.mjs`, `tabs.mjs`, `answers.mjs`
  // and `clock.mjs` — `progress.mjs`'s own header says which are; `model.mjs` already reaches
  // `node:fs` through `../register/inbox.mjs` and `node:crypto` through `../register/pending.mjs`,
  // so a read is already tolerated here). `ready.mjs` is a different kind of import: it reaches
  // `node:child_process` directly (`gatherGit`, for `git branch`/`git log`), and that would put a
  // LIVE GIT PROCESS behind what this phase calls "the pure half of the monitor" — the one thing
  // the Global Constraints actually forbid these modules reaching (filesystem, git, or a child
  // process), not merely a browser-loadability nicety. Left duplicated on purpose; if the two ever
  // disagree, `ready.mjs` is right.
  // `node.base ?? cfg.mainBranch`: this line hardcoded the main branch, which was wrong for any
  // task that must be cut from somewhere else and is wrong by construction for a review row, whose
  // branch is a pull request's own head.
  return { kind: 'launch', lines: [
    `git worktree add ${cfg.worktrees}/${slug} -b ${node.branch ?? '<branch>'} ${node.base ?? cfg.mainBranch}`,
    `claude --bg -n ${session} --model ${node.design ? 'fable' : 'opus'} --dangerously-skip-permissions "<brief>"`,
  ] };
}

// Where a pull-request review row's own pull request lives, or null for every other row — which is
// most of them, and for a project whose `origin` is not on GitHub, all of them.
//
// Nothing new is written on the row to make this work, and nothing needed to be: the sweep already
// states the number twice. `skills/pr-sweep/SKILL.md` fixes the ID as `PR<number>` and requires the
// branch's last segment to start with `pr<number>-`, and that branch prefix is what a re-sweep and
// the reconciliation both match on already. The id is read first because it is the field the sweep
// calls THE id; the branch is the fallback for a row whose id was written some other way.
//
// The number is matched anchored on both sides, so an ordinary task cannot fall in: `PRINT` is not
// `PR<digits>`, and a button pointing at the wrong pull request is worse than no button.
export function pullRequestUrl(id, branch, repo) {
  if (!repo) return null;
  const number = /^PR(\d+)$/.exec(String(id ?? '').split('/').pop())?.[1]
    ?? /^pr(\d+)-/.exec(String(branch ?? '').split('/').pop())?.[1];
  return number ? `https://github.com/${repo}/pull/${number}` : null;
}

// Everything this task can be opened in, as one ordered list the card draws as one row of buttons.
// The dev server leads because it is the EPHEMERAL one and the thing the hands-on gate is asking
// the user to try right now; the pull request and whatever else orchestra wrote on the row are
// standing context that was there before the gate and outlives it.
//
// One list rather than one renderer per kind. The pull request is DERIVED (`pullRequestUrl`) and
// poured in HERE rather than drawn beside the others, which is the whole reason it is not a second
// source of truth for the same URL: a conductor who also writes it by hand — which the protocol
// invites on any row — collapses onto one button, because entries are deduplicated by URL.
//
// Only `http:` and `https:` survive, and that is a security boundary rather than tidiness. Every
// URL here but the server's own is written by an agent into `state.json`, the page sets `href` as a
// property, and `javascript:` in an `<a href>` runs on click — nothing downstream would catch it.
// `lib/monitor/server.mjs` proves no script under `public/` writes markup; this is the same
// property for the one attribute that is not markup and still executes.
//
// A half-written entry costs the reader that one button and nothing else — never the card, never
// the request. Same reason `registerRow` states for the register at large: it is hand-edited by a
// conductor under time pressure, and a malformed row must not crash a request handler.
const OPENABLE_SCHEMES = new Set(['http:', 'https:']);

const openable = (label, url) => {
  if (typeof label !== 'string' || !label.trim() || typeof url !== 'string') return null;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (!OPENABLE_SCHEMES.has(parsed.protocol)) return null;
  // `where` is what the button says UNDER its own words: the reader knows which host they are
  // about to leave for before they click, which a label alone cannot promise — the label is
  // written by the same agent as the URL.
  return { label: label.trim(), url, where: parsed.host };
};

export function openablesFor(reg, prUrl, servers) {
  const written = Array.isArray(reg?.links) ? reg.links : [];
  const all = [
    ...servers.map((s) => openable('the dev server', `http://localhost:${s.port}`)),
    openable('the pull request on GitHub', prUrl),
    ...written.map((l) => openable(l?.label, l?.url)),
  ].filter(Boolean);
  const seen = new Set();
  return all.filter((o) => {
    if (seen.has(o.url)) return false;
    seen.add(o.url);
    return true;
  });
}

// `findImage` is injected rather than imported: this module must stay loadable and testable without
// a repository under it, and resolving a written path against a root is the one part of the image
// story that needs stat(). Absent — the shape every existing caller has — nothing claims an image
// either way, because a reader with no filesystem cannot honestly report a file as missing.
//
// `project` is opaque to this function: the caller builds `{ name, root, mode, branch, id }` from
// `cfg` and its own reader (`currentBranch`) and this module passes it straight through to the
// returned JSON, unread. It is the page's answer to "which of my tabs is this", and the `<title>`
// and the header are its only readers.
//
// `cfg` reaches only as far as `invokeCommand`, above: the worktrees root, the main branch and the
// project id its command lines are built from.
export function buildModel({
  project, board, register, runAsks = [], runAnswered = [], conductor = null, journal, inbox,
  servers, serversKnown = true, findImage = null, cfg,
}) {
  const { pairs, ambiguous, duplicates } = joinRows(board.rows, register);
  const byKey = new Map(pairs.map((p) => [p.key, p]));
  const byBareId = new Map();
  for (const p of pairs) {
    const bare = p.key.split('/').pop();
    byBareId.set(bare, [...(byBareId.get(bare) ?? []), p.key]);
  }

  // Servers are matched on PORT ALONE. `listServers` (`lib/monitor/sources.mjs`) probes exactly the
  // ports the register names — the register's `reg.port` and every `pending[].port` — in one call,
  // so there is no `cwd` here to compare a worktree path against the way the project this was
  // extracted from once did; a server entry is `{ port, pid }` and nothing else. The label is the
  // port itself. The cost is stated where `listServers` is: a dev server on a port no register row
  // names is invisible to the page.
  const serverFor = (node) => servers.filter((s) => s.port === node.port).map((s) => ({ port: s.port }));

  // The rail carries the conductor's journal AND the user's own answers. Without the second, an
  // answer typed on the page leaves the panel silent until a tick has journalled it.
  //
  // The same rule on both files, because a conductor has now demonstrated on the live files that it
  // will write the wrong keys into the wrong one: a line joins the rail only if it can be PLACED IN
  // TIME (a non-empty string `ts`) and actually SAYS something (a string in the field that file
  // uses). An inbox line must additionally be `from: 'monitor'` — the monitor is that file's only
  // writer, so anything else in it came from elsewhere, and measured in planetCraft, 2026-08-12, the
  // conductor's own journal line (`{kind, at, task, item, answer, action}`) landed there and was
  // rendered as the USER's own words, duplicating the sentence they really typed. `ts` is the
  // load-bearing half: `?? ''` gave a shapeless line an empty timestamp, which sorts above
  // everything, so one bad line reordered the whole panel — the worst failure available to a view
  // whose entire job is chronology. `kind` only chooses a label, so a missing one is a `note` rather
  // than grounds for rejection, and `task` is legitimately null on a line about the tick itself.
  //
  // What is rejected is counted into the same "unreadable" tally a malformed line already feeds, so
  // a foreign line costs the footer's count and never the panel's order.
  const timed = (e) => typeof e?.ts === 'string' && e.ts !== '';
  const spoken = journal.entries.filter((e) => timed(e) && typeof e.text === 'string');
  const mine = inbox.entries.filter((e) => timed(e) && typeof e.answer === 'string' && e.from === 'monitor');
  const unreadable = (journal.entries.length - spoken.length) + (inbox.entries.length - mine.length);

  // The third state, between "waiting on you" and "nothing to do": the user has answered and
  // orchestra has not taken the answer yet. `pending[]` alone cannot see it — it clears only when
  // the conductor processes the item, minutes or hours later, so the node kept shouting at a user
  // who had already replied. The inbox holds what they said, and `unconsumed` is the same rule
  // `lib/register/tick.mjs`, `relay.mjs` and `watch.mjs` already read to decide whether the
  // conductor has taken it — and the monitor's `/api/answer` route (`lib/monitor/server.mjs`) and
  // the `orchestra-inbox` hook (`hooks/orchestra-inbox.mjs`) read it too: one rule, every reader.
  //
  // A free remark targets no item and decorates none. The file is append-only, so the last line
  // carrying an item's id is the latest thing the user said about it.
  const waiting = new Map();
  for (const e of unconsumed(mine, { conductor, tasks: register, runAsks })) {
    if (typeof e.pending === 'string') waiting.set(e.pending, { answer: e.answer, ts: e.ts });
  }

  // One question, whatever it hangs on: a row's `pending[]` item and a run-level ask are the same
  // object on screen, and are built here once. `branch` is the worktree a written picture path is
  // relative to, and is null for a question about the run — which ran in no worktree.
  const askItem = (id, item, branch) => {
    const said = waiting.get(id) ?? null;
    // The options are parsed from the RAW ask, before the footer is split off it: the template
    // writes them in the body, and reading them from a trimmed string would be reading a
    // different string than the one the conductor wrote.
    const { body, footer } = splitAsk(item.ask ?? '');
    // The two halves the template declares, read apart so the page can draw the context as context
    // and put the question where the reader looks — in the card, and in the corner list, which
    // excerpted the body and therefore only ever showed the opening of the context. `body` is kept
    // beside them: it is the whole of what the conductor wrote, and the halves are a reading of it.
    const options = itemOptions(item);
    const { context, question } = askSections(body, options);
    return {
      id, kind: item.kind ?? 'question',
      ask: body, footer, context, question, options, port: item.port ?? null,
      answer: said?.answer ?? null, answeredAt: said?.ts ?? null,
      // The whole point of the feature: a question that says "look at this" is unanswerable
      // until the thing is on screen, and orchestra asks it that way.
      images: imagesIn(item.ask ?? '', findImage, branch),
    };
  };

  const joined = pairs.map(({ key, board: b, reg }) => {
    const roadmap = key.split('/')[0];
    // Hoisted out of the literal below, because the images of an ask are looked for in this task's
    // own worktree and the pending map is built inside the literal, before `node.branch` exists.
    const branch = b?.branch ?? reg?.branch ?? null;
    // `answered[]` is where a question goes when it dies: the conductor MOVES the item there
    // instead of deleting it, so the `askedAt`/`answeredAt` pair a retrospective needs survives —
    // the one stamped pair in orchestra that no model ever wrote. That array is authority over
    // `pending[]` HERE, and that is what makes the invariant structural: an item the page does not
    // render cannot be offered again. The register is rewritten whole at every tick, and a
    // half-written row — moved into `answered[]`, still listed in `pending[]` — is a real transient
    // state. Trusting `pending[]` alone would put a dead question back on screen for exactly as
    // long as that write lasts, and "the page will hide it" is the assumption that failed on
    // 2026-08-12, when a question answered in chat at 17:56 was answered again from the page at
    // 22:09 and the two readings contradicted each other.
    const answeredIds = new Set((reg?.answered ?? []).map((item) => pendingId(reg?.id, item)));
    const node = {
      key,
      // `b.id` unguarded threw on the pair a register row with no id produces (board is null
      // there, by construction), which is the same half-written row keys.mjs now survives.
      id: reg?.id ?? b?.id ?? key,
      roadmap,
      // Whose roadmap this is. Publishing everyone's work is only useful if you can SEE another
      // developer's without being able to start it by accident, and a card that looks exactly like
      // mine defeats both halves. A row with no ownership recorded — a register-only node, or a
      // board built before ownership existed — is mine, which is what this page showed before.
      owner: b?.owner ?? null,
      mine: b?.mine !== false,
      open: b?.open ?? false,
      programmeState: b?.programmeState ?? null,
      title: b?.title ?? reg?.title ?? key,
      // The register wins on status: the board derives it from git, the register knows this
      // machine handed the task to a session and is waiting on a hands-on check.
      status: reg?.status ?? b?.status ?? 'todo',
      order: b?.order ?? reg?.order ?? null,
      deps: b?.deps ?? reg?.deps ?? [],
      touches: b?.touches ?? reg?.touches ?? [],
      branch,
      // Where this task's branch is cut from, when it is not the main branch. A pull-request review
      // row carries the PR's own head here — the sweep fetches it and writes the sha — which is the
      // one fact that makes the copyable launch block below correct for a review.
      base: reg?.base ?? null,
      design: b?.design ?? reg?.design ?? false,
      lane: b?.lane ?? reg?.lane ?? null,
      // The board row's own prose, straight off `reconcile()`'s output — never a second lookup
      // against an injected map. `lib/roadmap/parse.mjs` already collects both `**Why.**` and
      // `**Acceptance.**` as the task's own fields, and `reconcile` (`lib/roadmap/board.mjs`)
      // spreads them onto every row it returns, so `board.rows[i].why` and `.acceptance` are
      // already there for the taking. A register-only row (no board match at all) has neither.
      why: b?.why ?? '',
      acceptance: b?.acceptance ?? '',
      note: reg?.note ?? null,
      // A screenshot orchestra named in its work log, shown where that log is shown. The conductor
      // writes both kinds of line — "compare the two arms" belongs to an ask, "measured on this
      // frame" to the note — and neither is worth reading without the picture beside it.
      noteImages: imagesIn(reg?.note ?? '', findImage, branch),
      model: reg?.model ?? null,
      session: reg?.session ?? null,
      sessionName: reg?.sessionName ?? null,
      runtime: workerRuntime({ ...b, ...reg, id: key, roadmap }, { roadmapRuntimes: cfg.roadmapRuntimes, conductorRuntime: conductor?.runtime ?? 'claude' }),
      workerStatus: reg?.runtime === 'codex' ? codexStatus(reg) : 'unknown',
      port: reg?.port ?? null,
      pending: (reg?.pending ?? []).filter((item) => !answeredIds.has(pendingId(reg.id, item)))
        .map((item) => askItem(pendingId(reg.id, item), item, branch)),
      badges: [],
    };
    if (!node.mine) node.badges.push(`@${node.owner ?? 'someone else'}`);
    if (!node.mine && node.open) node.badges.push('open');
    if (roadmap === UNFILED) node.badges.push('unfiled');
    if (!reg) node.badges.push('not adopted');
    if (node.design) node.badges.push('design');
    if (node.lane) node.badges.push(`lane ${node.lane}`);
    // Whether this task is waiting on the user is NOT decided here. `pending[].answer` is the fact
    // and `openItems` in answers.mjs is the rule — one function, read by the pulse, the corner list,
    // the top strip and the card heading alike, and the only one able to account for an answer this
    // tab has just sent that no tick has cleared yet. Deciding it here as well put the same rule in
    // two places, and the copy the page could not correct is the copy that kept shouting.
    node.depKeys = node.deps.map((d) => resolveKey(d, roadmap, byKey, byBareId, null)).filter(Boolean);
    node.invoke = invokeCommand(node, cfg);
    node.servers = serverFor(node);
    // `prUrl` is not hung on the node: nothing reads a pull request's URL on its own, and the one
    // place it is wanted is the list below.
    node.openables = openablesFor(reg, pullRequestUrl(node.id, node.branch, project?.repo ?? null), node.servers);
    return node;
  })
    // A roadmap that ended leaves the screen. This is NOT archiving: `lib/register/archive.mjs`
    // triggers on a ROW's status and deliberately keeps the row as a stripped tombstone, because
    // `computeReadySet` (`lib/register/ready.mjs`) validates `deps` on every row including terminal
    // ones and progress.mjs tallies `landed`. What the monitor shows was never the same question as
    // what the register holds.
    .filter((n) => n.programmeState !== 'closed');

  // The closed-programme rule can only end what the channel has adopted. Register rows from before
  // the channel have no task issue, so no programmeState, and would hold their frame on the screen
  // forever. And an open programme is the channel's word that work remains — but not necessarily
  // HERE: when the only undone tasks are another developer's, this register drops its rows, and
  // landed plus dropped is a finished roadmap on this screen whatever the issue says (user ruling
  // 2026-09-02, in planetCraft). So a frame stays only while a row in it can still move; that one
  // live row keeps the whole frame, landed siblings included — the way a running roadmap shows its
  // history.
  const TERMINAL = new Set(['landed', 'dropped']);
  const liveFrames = new Set();
  for (const n of joined) if (!TERMINAL.has(n.status)) liveFrames.add(n.roadmap);
  const nodes = joined.filter((n) => liveFrames.has(n.roadmap));

  // ---- the question that is about the RUN, and about no row ----
  // A run ENDS when its last row goes terminal, and the protocol makes a question obligatory at
  // exactly that moment (the stand-down tick). So the one question orchestra is REQUIRED to put is
  // the one no row can carry: the rule just above had cleared every frame off the screen, correctly
  // — those rows had all finished — and it took the question with it. In planetCraft on 2026-09-02,
  // at the end of the `inertes` roadmap, that is what happened, and nothing could detect it: the
  // item was well formed, the journal had its `question` line, the ask had its options, and the
  // user's own words were "je ne vois pas de question sur la page" (ticket `t-0antbtb`). It works
  // some nights and not others, depending on the order the rows finish in, which is the worst kind
  // of fault to leave standing.
  //
  // So a question about the run lives at the top of the register, in `runAsks[]`, and leaves this
  // function OUTSIDE `nodes` — nothing that filters rows can filter it, and it needs no row to hang
  // on. The rule for rows above is untouched and exactly as strong: a finished roadmap's frame still
  // leaves the screen. This is one more frame beside it, not an exception carved into it.
  //
  // `runAnswered[]` is authority over `runAsks[]`, the way `answered[]` is over a row's `pending[]`
  // and for the same reason: the register is rewritten whole at every tick, so an ask moved and
  // still listed is a real transient state, and a dead question put back on screen is a
  // contradiction the user has no way to see coming.
  const runRetired = new Set((runAnswered ?? []).map((item) => runAskId(item)));
  const runQuestions = (runAsks ?? []).filter((item) => !runRetired.has(runAskId(item))).map((item) => ({
    ...askItem(runAskId(item), item, null),
    // Which run it is about, and when it was put. Neither is a row's business: a run-level ask names
    // its roadmap as a label — the frame it belongs beside — never as a join key.
    roadmap: typeof item.roadmap === 'string' ? item.roadmap : null,
    askedAt: typeof item.askedAt === 'string' ? item.askedAt : null,
  }));

  const keyOfTask = (task) => (task ? resolveKey(task, null, byKey, byBareId, task) : null);
  // A rail line's images are looked for in the worktree of the task the line is about — that is
  // where the worker that wrote it ran, and where a path like `reports/x.png` is relative to. A line
  // about no task (the tick itself) still gets the two repository-wide roots.
  const branchOfKey = new Map(nodes.map((n) => [n.key, n.branch]));
  const railLine = (e, kind, text, from) => {
    const task = keyOfTask(e.task);
    return { ts: e.ts, kind, task, text, from, images: imagesIn(text, findImage, branchOfKey.get(task) ?? null) };
  };
  const rail = [
    ...spoken.map((e) => railLine(e, typeof e.kind === 'string' ? e.kind : 'note', e.text, 'orchestra')),
    ...mine.map((e) => railLine(e, 'answer', e.answer, 'you')),
  ].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  return {
    project,
    source: { board: board.status, message: board.message },
    // No board-wide tally here. The strip counts the TAB the page is showing, and `tabsOf` in
    // tabs.mjs computes every tab's figures from the same `tally` — a second one on the whole
    // register would be a number nothing on screen is a share of.
    nodes, runAsks: runQuestions, rail, servers, serversKnown, ambiguous, duplicates,
    journalSkipped: journal.skipped + inbox.skipped + unreadable,
  };
}
