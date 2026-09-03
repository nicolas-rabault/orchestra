// The other half of the archive: the PHOTOGRAPHS a finished run left behind.
//
//   orchestra archive-images            # what would go, and what it would save
//   orchestra archive-images --write    # file the record, then remove them
//
// `archive.mjs` moves a terminal row's prose out of the register. It has nothing to say about the
// pictures that prose points at, and those are the weight: measured 2026-09-02, `.claude/orchestra/`
// held **70.2 MB in 199 files**, of which 68 MB was 114 screenshots and boards — 33 MB for one
// A/B board of the render gate (`x4-gate-board/`, shot 2026-08-19), 16 MB for `shots/`, and
// 19 MB of loose comparison PNGs at the top level. Every one of them belonged to a run that had
// landed weeks earlier, and every conclusion drawn from them is written down somewhere a picture
// is not needed to read it — `docs/superpowers/results/` for the results, the row's own note for
// the rest.
//
// So this sweep asks ONE question of each photograph, and it is not the question a `find -mtime`
// would ask: **can any live surface of the register still draw it?** Three surfaces can, and they
// are exactly the three P4's monitoring page (`monitor/model.mjs`) will scan, which is why the
// citation scanner lives in its own module (`images.mjs`) rather than being written again here:
//
//   - an open `pending` ask, on ANY row whatever its status — `lib/register/tick.mjs`'s gate
//     honours an open question on any row "whatever that row's status", and `archive.mjs`
//     deliberately keeps `pending` out of the prose it moves for that reason.
//   - the `note` of a row that is NOT terminal.
//   - a journal or inbox line about a row that is not terminal, or a line young enough that the
//     run it belongs to may still be going.
//
// A photograph no live surface names is a photograph of a finished run, and it goes — with a
// `kind: 'photo'` line in the same `archive.jsonl` the prose lands in, carrying its size, when it
// was shot, and every DEAD surface that named it. That line is the difference between an archive
// and a purge: the register keeps the trace of what the picture was and which run it belonged to,
// which is the only thing anybody ever went back to a two-month-old screenshot for.
//
// THE FRESHNESS FLOOR IS THE GUARD AGAINST A LIVE CONDUCTOR, and it is the reason this command
// carries no `liveConductor` refusal while `archive --write` correctly does. That refusal
// exists because the prose pass REWRITES the register under a conductor holding it in memory for
// a whole tick; this pass writes no register at all. The hazard here is a different one — a
// picture a worker has just taken and the conductor has not cited YET — and a clock answers it
// where a lock cannot. Measured over the 22 photographs the journal names: the gap between a file
// being written and the first line citing it is **at most 1.2 hours**, and negative for three of
// them (the file was rewritten after the sentence). Seven days is 140x the worst measured gap.
//
// TWO PLACES WHERE THIS REFUSES TO GUESS, because the cost of guessing wrong is a deleted file:
//
//   - a register with no task list is a register that did not parse, and reading it as "nothing is
//     cited" would sweep the lot. It throws instead.
//   - a journal line naming a task the register cannot show, or carrying a stamp that will not
//     parse, is a line whose run cannot be proven finished. Its pictures are KEPT.
//
// Unreadable journal lines are reported and not refused on. `readJsonl` skips a torn line and a
// torn line does not heal; refusing on one would wedge the sweep for good, and the directory this
// exists to bound would grow back to 70 MB while the tool sat there being careful.
//
// THE SWEEP ROOT IS `.orchestra/images/`, NEVER `.orchestra/` — the one place this port diverges
// from its source on purpose. In the source project the swept directory holds nothing but runtime
// state; in this plugin `.orchestra/` is also where `config.json` lives (spec §3.1) and where
// `worktrees/` defaults to (spec §3.2), so a sweep that walked it would descend into every live
// worktree, find the project's own `.png` assets, decide that no register line names them, and
// remove them. Spec §7 already names `.orchestra/images/` as where a picture is resolved; that
// directory is the sweep's whole world. A photograph a worker took inside its worktree is the
// project's file, and this command must never be able to touch it.
import fs from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { orchestraDir } from '../paths.mjs';
import { archivePath, TERMINAL } from './archive.mjs';
import { readState, statePath, STRUCTURAL } from './state.mjs';
import { journalPath } from './journal.mjs';
import { inboxPath, readJsonl } from './inbox.mjs';
import { IMAGE_EXTENSIONS, scanImagePaths } from './images.mjs';

// The sweep's whole world. See the header: this plugin's `.orchestra/` also holds `config.json` and
// defaults to holding `worktrees/`, so sweeping it would walk into a live worktree, find the
// project's own pictures, and remove them. Narrowing the root to `images/` makes that impossible
// rather than merely unlikely.
export const imagesDir = (root) => join(orchestraDir(root), 'images');

// What the sweep considers a photograph. The page's list plus `html`, because a board — one page
// of montages with relative hrefs — is how this repository photographs a whole render-gate run,
// and the single heaviest file in the directory is one (`shots/gt9-viewmodel-ab.html`, 10.2 MB).
// The monitor cannot render an `.html` as a thumbnail and must never try, which is why the wider
// list lives here and not in `images.mjs`.
export const PHOTO_EXTENSIONS = [...IMAGE_EXTENSIONS, 'html'];

// How long a photograph is untouchable whatever the register says. See the header for the
// measurement behind it.
export const FRESH_MS = 7 * 24 * 60 * 60 * 1000;

// How big a page may be and still be read for the montages it names. Above this it is not an index
// of files, it is a page with the pictures INSIDE it — `shots/gt9-viewmodel-ab.html` is 10.2 MB of
// inlined frames — so there is nothing on disk for it to protect and nothing to gain by reading it.
// The cap is also load-bearing for a second reason, measured the hard way: a path pattern whose
// character class contains base64's own alphabet backtracks quadratically over an inlined image,
// and the first run of this sweep sat on that file for two minutes without printing a line.
const FOLLOW_MAX_BYTES = 1 << 20;

const isPage = (rel) => rel.toLowerCase().endsWith('.html');

// Every photograph under `.orchestra/images/`, deepest first so a directory is considered after
// what it holds.
function photosUnder(root) {
  const dir = imagesDir(root);
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = join(d, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!PHOTO_EXTENSIONS.includes(extname(e.name).slice(1).toLowerCase())) continue;
      try {
        const s = fs.statSync(abs);
        out.push({ rel: relative(root, abs), bytes: s.size, mtimeMs: s.mtimeMs });
      } catch { /* removed under us; it is not there to archive */ }
    }
  };
  walk(dir);
  return out;
}

// A task key as the journal writes it, resolved to the row it means. Exact id first, then the bare
// id after the slash — a journal or inbox line may name a task by its short id while a register key
// is always qualified `roadmap/id`. A bare id that two roadmaps share resolves to NOTHING rather
// than to the first of them: an ambiguous key is one this sweep cannot prove is finished, and the
// caller reads a miss as "keep".
function rowLookup(tasks) {
  const byId = new Map();
  const bare = new Map();
  for (const t of tasks) {
    if (typeof t?.id !== 'string') continue;
    byId.set(t.id, t);
    const short = t.id.split('/').pop();
    bare.set(short, bare.has(short) ? null : t);
  }
  return (key) => {
    if (typeof key !== 'string') return null;
    return byId.get(key) ?? bare.get(key.split('/').pop()) ?? null;
  };
}

// Whether a journal or inbox line is a surface a live conductor can still be showing about a
// running task.
const lineIsLive = (entry, rowOf, now, freshMs) => {
  const ts = Date.parse(entry?.ts ?? '');
  // Written as `!(… >= …)` so a stamp that will not parse (NaN) reads as live, never as ancient.
  if (!(now - ts >= freshMs)) return true;
  // A line about no task is a line about the tick itself, and that tick is over.
  if (entry?.task == null) return false;
  const row = rowOf(entry.task);
  return row ? !TERMINAL.has(row.status) : true;
};

// Which SWEPT photograph a string in the prose names — and nothing else. The page's own resolver
// (P4) answers a wider question, "which file should I serve", and searches the checkout and the
// worktrees to do it; that answer is exactly what this command must not have, because everything it
// resolves is a file it may remove. Here a path resolves only if it lands inside `.orchestra/images/`,
// so a `docs/screenshot.png` in the project's tree is unresolvable by construction rather than by
// care. Tried as written (relative to the checkout), then relative to the images directory, so both
// `.orchestra/images/a.png` and a bare `a.png` name the same file.
const resolver = (root, byRel) => (raw) => {
  for (const base of [root, imagesDir(root)]) {
    const rel = relative(root, resolve(base, raw));
    if (byRel.has(rel)) return rel;
  }
  return null;
};

// The whole decision over one checkout: which photographs a live surface still names, which are
// only named by finished work, and what each one cost. Touches no file it does not read.
export function sweep(root, { now = Date.now(), freshMs = FRESH_MS } = {}) {
  const state = readState(root);
  if (!state || !Array.isArray(state.tasks)) {
    throw new Error(`${statePath(root)} has no task list — refusing to read an unparsed register as "nothing is cited"`);
  }
  const photos = photosUnder(root);
  const byRel = new Map(photos.map((p) => [p.rel, p]));
  const journal = readJsonl(journalPath(root));
  const inbox = readJsonl(inboxPath(root));
  const rowOf = rowLookup(state.tasks);
  const find = resolver(root, byRel);

  // Two ledgers, same shape: what still points at a photograph, and what used to. The second is
  // not a decision, it is the provenance the archive line carries once the file is gone.
  const live = new Map();
  const dead = new Map();
  const add = (where, rel, why) => {
    if (!byRel.has(rel)) return;
    const at = where.get(rel) ?? [];
    if (!at.includes(why)) at.push(why);
    where.set(rel, at);
  };
  const scan = (where, text, why) => {
    for (const raw of scanImagePaths(typeof text === 'string' ? text : '', PHOTO_EXTENSIONS)) {
      const rel = find(raw);
      if (rel) add(where, rel, why);
    }
  };

  for (const t of state.tasks) {
    for (const p of t?.pending ?? []) scan(live, typeof p === 'string' ? p : p?.ask, `open ask on ${t.id}`);
    // A terminal row's note is itself on its way to `archive.jsonl`; the prose pass takes it. So
    // the two passes agree whichever order they run in — before it, this reads a finished note and
    // files it as provenance; after it, the note is not here to read.
    const done = TERMINAL.has(t?.status);
    scan(done ? dead : live, t?.note, `${done ? `${t.status} row` : 'note on'} ${t.id}`);
  }
  // The conductor's standing lessons at the top of the register are about no single run, so a
  // picture one points at lives as long as the lesson does.
  for (const [k, v] of Object.entries(state)) {
    if (STRUCTURAL.has(k)) continue;
    scan(live, typeof v === 'string' ? v : JSON.stringify(v), `register lesson ${k}`);
  }
  for (const [feed, entries, textOf] of [
    ['journal', journal.entries, (e) => e.text],
    ['inbox', inbox.entries, (e) => e.answer],
  ]) {
    for (const e of entries) {
      const where = lineIsLive(e, rowOf, now, freshMs) ? live : dead;
      scan(where, textOf(e), `${feed} ${e?.ts ?? 'undated'}${e?.task ? ` (${e.task})` : ''}`);
    }
  }

  for (const p of photos) {
    if (now - p.mtimeMs < freshMs) add(live, p.rel, 'younger than the freshness floor');
  }

  // A surviving board is a citation source of its own. `board.html` names its montages with
  // relative hrefs and no register line ever names them one by one, so a sweep blind to this would
  // archive the page's contents and leave the page — a wall of broken frames, which is worse than
  // either keeping or removing the pair. Resolved against the page's OWN directory, because that
  // is how the browser reading it resolves them.
  const follow = (where, rel) => {
    if ((byRel.get(rel)?.bytes ?? 0) > FOLLOW_MAX_BYTES) return [];
    let text;
    try { text = fs.readFileSync(join(root, rel), 'utf8'); } catch { return []; }
    const found = [];
    for (const raw of scanImagePaths(text, PHOTO_EXTENSIONS)) {
      const named = relative(root, resolve(dirname(join(root, rel)), raw));
      if (!byRel.has(named) || named === rel) continue;
      const first = !where.has(named);
      add(where, named, `named by ${rel}`);
      if (first) found.push(named);
    }
    return found;
  };
  const work = [...live.keys()].filter(isPage);
  while (work.length) work.push(...follow(live, work.pop()).filter(isPage));

  const kept = photos.filter((p) => live.has(p.rel)).map((p) => ({ ...p, why: live.get(p.rel) }));
  const dropped = photos.filter((p) => !live.has(p.rel));
  // The same walk over the pages that are LEAVING, so an archive line can say which board a
  // montage belonged to instead of the bare truth that nothing living names it.
  for (const p of dropped) if (isPage(p.rel)) follow(dead, p.rel);

  const sum = (list) => list.reduce((n, p) => n + p.bytes, 0);
  return {
    kept,
    dropped: dropped.map((p) => ({ ...p, citedBy: dead.get(p.rel) ?? [] })),
    bytes: { total: sum(photos), kept: sum(kept), dropped: sum(dropped) },
    unreadable: journal.skipped + inbox.skipped,
  };
}

// Directories the sweep emptied. Never the images directory itself: a worker can write a fresh
// screenshot into it mid-run, and removing the directory out from under one would turn a missing
// folder into a worker crash instead of an empty one.
function pruneEmpty(root) {
  const dir = imagesDir(root);
  let pruned = 0;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory()) walk(join(d, e.name));
    if (d === dir) return;
    try { fs.rmdirSync(d); pruned += 1; } catch { /* not empty, and that is the answer */ }
  };
  walk(dir);
  return pruned;
}

// The record goes down BEFORE the file does, and into the same archive the prose pass writes. If
// this dies in the middle, the archive claims a photograph that is still on disk — a duplicate a
// reader can see — rather than a file that vanished with no line saying it existed. Same order,
// and the same reason, as `archive()`.
export function archivePhotos(root, { now = Date.now(), freshMs = FRESH_MS } = {}) {
  const at = new Date(now).toISOString();
  const swept = sweep(root, { now, freshMs });
  if (!swept.dropped.length) return { removed: 0, bytes: 0, pruned: 0 };
  fs.appendFileSync(archivePath(root), `${swept.dropped.map((p) => JSON.stringify({
    archivedAt: at, kind: 'photo', path: p.rel, bytes: p.bytes,
    shotAt: new Date(p.mtimeMs).toISOString(), citedBy: p.citedBy,
  })).join('\n')}\n`);
  for (const p of swept.dropped) fs.rmSync(join(root, p.rel), { force: true });
  return { removed: swept.dropped.length, bytes: swept.bytes.dropped, pruned: pruneEmpty(root) };
}
