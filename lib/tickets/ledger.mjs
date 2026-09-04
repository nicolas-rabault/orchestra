// A project's own ticket queue, as one file — `<tickets.file>` in the main checkout (default
// `.orchestra/tickets.jsonl`), one JSON line per ticket. No login, no service, no network: a
// heartbeat tick can read and write it, a diff shows exactly what a run changed, and the queue
// survives the machine it was filed on.
//
// Ported from planetCraft's `tools/tickets.mjs` (2026-09-04, at 869 lines). What travelled and
// what stayed behind is docs/plans/2026-09-04-p5-hooks-init-tickets-heartbeat.md's scope answer
// 7: everything that reads or writes a ticket ROW travelled; everything that judges a ticket
// against that project's own sessions, evidence rows, builds or its oracle table, and the Notion
// export, did not — a project files a defect once no matter how many times it recurs, and closes
// it by hand. The row shape is unchanged regardless: a `tickets.jsonl` the source project wrote
// must still load here, even though nothing in this module will ever again populate
// `verification`, or a `builds`/`reach` entry with the meaning that project's own tooling gave it.
//
// The one thing this module exists to get right is IDENTITY. A queue that appends is a queue
// nobody reads: a check that trips every run would file thirty tickets in a month instead of one
// ticket seen thirty times. So everything upserts onto a FINGERPRINT — "what makes two
// observations the same defect" — and that fingerprint is deliberately coarse. A caller cannot
// hand this module a free-form one: it declares WHICH KIND of observation it holds (a
// pre-computed identity string a project's own crash/error reporter filed, or a note's subject)
// and the fingerprint is computed from that. Timestamps, line numbers, coordinates and counts
// cannot get a vote on identity because they never reach the function that computes it — they
// ride in the body, where a reader wants them.
import fs from 'node:fs';
import path from 'node:path';

export const KINDS = ['bug', 'friction', 'design', 'perf'];
export const STATUSES = ['open', 'fixing', 'needs-review', 'verified', 'closed'];
export const SEVERITIES = ['S1', 'S2', 'S3'];

// A subject folds to at most this many significant words. Coarse on purpose: two notes that open
// the same way are the same complaint far more often than they are two different ones, and the
// cost of over-folding (one ticket with two bodies) is much cheaper than the cost of
// under-folding (a queue of near-duplicates nobody triages).
const SUBJECT_WORDS = 8;
const SUBJECT_MAX = 60;
// Words that discriminate nothing. Kept deliberately short — every word removed here is a word
// that can no longer tell two defects apart.
const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'is', 'it',
  'and', 'or', 'for', 'with', 'my', 'i', 'this', 'that', 'was', 'were', 'be']);
// A ticket carries its own log. The cap bounds a file that is read in a diff, and since
// re-sighting is deduplicated against this log (`alreadySeen` below), it is also the window in
// which "this session already filed it" stays true.
const HISTORY_MAX = 200;
const EVIDENCE_MAX = 20;
const BUILDS_MAX = 50;
// A sighting whose build is unknown or unstamped is recorded as this rather than dropped: a build
// set that quietly omitted it would claim a `count` covers only the builds it can name.
export const UNKNOWN_BUILD = 'unknown';

// ---------------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------------

// Numbers are the occurrence, not the defect: a cell, a count, a clock. Pure-numeric tokens are
// dropped whole; digits glued to letters are kept, because `mk2` and `mk3` are two different
// things and folding them would be a lie the other direction.
export function normalizeSubject(subject) {
  const words = String(subject ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // accents: "café" and "cafe" are one word
    .replace(/\b\d[\d.,:%-]*\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w));
  const slug = words.slice(0, SUBJECT_WORDS).join('-').slice(0, SUBJECT_MAX).replace(/-+$/, '');
  if (!slug) throw new Error(`tickets: subject "${subject}" normalises to nothing — it is all punctuation and numbers`);
  return slug;
}

// An already-canonical identifier gets punctuation folding and nothing else: stop-word removal
// and the word cap exist to fold the many ways a human writes one complaint, and applying them to
// an identifier a project's own tooling already computed would only create collisions.
export function normalizeId(id) {
  const slug = String(id ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) throw new Error(`tickets: identifier "${id}" normalises to nothing`);
  return slug;
}

// Exactly one source, named. There is no free-form `fingerprint` argument accepted here on
// purpose: the moment a caller can pass its own string, the first one to include a timestamp
// reopens its ticket on every run and nobody notices for a month.
export function fingerprintFor(obs = {}) {
  const named = ['fingerprint', 'subject'].filter((k) => String(obs[k] ?? '').trim() !== '');
  if (named.length !== 1) {
    throw new Error(`tickets: an observation needs exactly one of fingerprint/subject, got [${named.join(', ')}]`);
  }
  if (named[0] === 'fingerprint') return `fingerprint:${normalizeId(obs.fingerprint)}`;
  return `note:${normalizeSubject(obs.subject)}`;
}

// djb2, the same stable-short-name trick a project's own error fingerprinting can use. Restated
// in four lines rather than imported so this module depends on nothing outside `lib/`.
function shortHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(7, '0').slice(0, 7);
}

// The id is a short handle for the fingerprint, derived from it — never a counter. Two machines
// filing the same defect offline must produce the same id, or merging the queue would produce two
// rows for one defect, which is the bug this module exists to prevent. The fingerprint stays the
// identity; the id is what a person types.
export const ticketIdFor = (fingerprint) => `t-${shortHash(fingerprint)}`;

// ---------------------------------------------------------------------------------
// The path: the main checkout's, never the caller's cwd
// ---------------------------------------------------------------------------------

// Resolved against `cfg.root` — already the main checkout (`lib/config.mjs` calls
// `mainCheckout()`) — and never against the directory a caller happens to be standing in. The
// source project paid for this: its own CLI resolved on its own script location, so run inside a
// worktree it read and wrote THAT worktree's copy of the queue — `set <id>` answered "no ticket"
// for everything filed since the branch was cut, and a landing deletes the worktree, so the
// ticket died with it.
export const ticketsPath = (cfg) => path.join(cfg.root, cfg.tickets.file);

// ---------------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------------

// Field order is fixed so a change rewrites one line in a way a human can read in a diff.
const FIELD_ORDER = ['id', 'fingerprint', 'kind', 'severity', 'status', 'title', 'body',
  'source', 'repro', 'evidence', 'branch', 'fix', 'reach', 'verification',
  'firstSeen', 'lastSeen', 'count', 'builds', 'history'];

const serialize = (t) => JSON.stringify(Object.fromEntries(FIELD_ORDER.map((k) => [k, t[k]])));

export function loadTickets(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n')
    .map((l) => l.trim()).filter(Boolean)
    .map((l, i) => {
      try { return JSON.parse(l); } catch { throw new Error(`tickets: ${file} line ${i + 1} is not JSON`); }
    });
}

// Creation order is never re-sorted: a new ticket appends a line, an update rewrites its own
// line, and the diff of one run is exactly what that run did.
export function saveTickets(file, tickets) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, tickets.length ? `${tickets.map(serialize).join('\n')}\n` : '');
}

// ---------------------------------------------------------------------------------
// Ticket rows
// ---------------------------------------------------------------------------------

const oneOf = (value, allowed, what) => {
  if (!allowed.includes(value)) throw new Error(`tickets: ${what} must be one of ${allowed.join('|')}, got "${value}"`);
  return value;
};

export function pushHistory(ticket, entry) {
  ticket.history.push(entry);
  if (ticket.history.length > HISTORY_MAX) {
    // The first entry is the ticket's birth certificate and is never dropped.
    ticket.history = [ticket.history[0], ...ticket.history.slice(-(HISTORY_MAX - 1))];
  }
}

// `count` is an aggregate over however many times an observation was filed, and a ticket carries
// the distinct builds it has been sighted on, in first-seen order, so an aggregate never silently
// claims to cover a build set it cannot name. A sighting with no build stamp lands as
// `UNKNOWN_BUILD` rather than being dropped. This module derives nothing from git or from any
// other source of truth: a caller stamps the build, exactly as a caller stamps the session.
const addBuild = (builds, build) => {
  if (builds.includes(build)) return builds;
  const next = [...builds, build];
  // Oldest and newest are the two that matter — the build it first appeared on, and the ones it
  // still happens on. The middle is what a wider history reconstructs anyway.
  return next.length <= BUILDS_MAX ? next : [next[0], ...next.slice(next.length - (BUILDS_MAX - 1))];
};

// Has this exact session already been folded in? Without it, a filer that runs twice over one
// session would double every count and the queue would report activity that never happened. An
// observation with no session id cannot be deduplicated and always counts.
const alreadySeen = (ticket, session) => !!session
  && ticket.history.some((h) => h.session === session);

/**
 * Fold one observation into the queue. Returns `{ ticket, action }` where action is
 * 'created' | 'updated' | 'unchanged'. Mutates `tickets` (and the matched row) in place.
 *
 * An observation: { fingerprint|subject, kind, severity, title, body, session, anchor, repro,
 *                   evidence[], at, build, reach }
 */
export function upsertTicket(tickets, obs = {}, { now = new Date() } = {}) {
  const fingerprint = fingerprintFor(obs);
  const kind = oneOf(obs.kind ?? 'bug', KINDS, 'kind');
  const severity = oneOf(obs.severity ?? 'S2', SEVERITIES, 'severity');
  const at = obs.at ? new Date(obs.at).toISOString() : now.toISOString();
  const session = obs.session ? String(obs.session) : null;
  const anchor = obs.anchor ?? null;
  const build = String(obs.build ?? '').trim() || UNKNOWN_BUILD;
  const evidence = (Array.isArray(obs.evidence) ? obs.evidence : obs.evidence ? [obs.evidence] : [])
    .map(String).filter(Boolean);
  // An arbitrary progress number the caller defines the meaning of — how far into a run the
  // observation that saw it had got. Absent means zero, which is the honest default: a defect no
  // caller ever attaches a reach to makes no demand of anything.
  const reach = Number.isFinite(obs.reach) ? Math.max(0, Math.floor(obs.reach)) : 0;
  const title = String(obs.title ?? '').trim() || fingerprint;

  const existing = tickets.find((t) => t.fingerprint === fingerprint);
  if (!existing) {
    const ticket = {
      id: ticketIdFor(fingerprint),
      fingerprint,
      kind,
      severity,
      status: 'open',
      title,
      body: String(obs.body ?? ''),
      source: { session, anchor },
      repro: obs.repro ?? null,
      evidence: [...new Set(evidence)].slice(0, EVIDENCE_MAX),
      branch: null,
      // The build a fix for this landed on, named by whoever landed it — never derived here, and
      // null until then.
      fix: null,
      reach,
      verification: null,
      firstSeen: at,
      lastSeen: at,
      count: 1,
      builds: [build],
      history: [{ at, event: 'created', session, anchor, build }],
    };
    tickets.push(ticket);
    return { ticket, action: 'created' };
  }

  if (alreadySeen(existing, session)) return { ticket: existing, action: 'unchanged' };

  existing.count += 1;
  // Written before the row is saved, and never derived after the fact: `count` and `builds` are
  // one statement, "seen this many times, across these builds".
  existing.builds = addBuild(existing.builds ?? [], build);
  existing.lastSeen = at > existing.lastSeen ? at : existing.lastSeen;
  if (at < existing.firstSeen) existing.firstSeen = at;
  // Severity is the worst ever observed, never the latest: a defect that once cost something
  // serious does not become a nuisance because this sighting only cost a little.
  if (SEVERITIES.indexOf(severity) < SEVERITIES.indexOf(existing.severity)) {
    pushHistory(existing, { at, event: 'severity', from: existing.severity, to: severity });
    existing.severity = severity;
  }
  // The kind is decided by the first sighting — a ticket that renames its own category every run
  // is a ticket nobody can filter on — but a disagreement is on record.
  if (kind !== existing.kind) pushHistory(existing, { at, event: 'kind-conflict', kept: existing.kind, offered: kind });
  // The title is stable for the same reason; the body is the freshest detail, because that is
  // where the specifics live and the newest sighting is the one worth reproducing.
  if (obs.body) existing.body = String(obs.body);
  // The SHALLOWEST observation that ever saw it wins: a defect witnessed once early cannot be
  // excused from a later, shorter one — lowering the bar is the direction that risks nothing.
  if (reach < (existing.reach ?? 0)) existing.reach = reach;
  // A repro stamp points at a reproduction on a build. The freshest one is the one that still
  // applies, so a newer sighting replaces it; the older anchors stay in the history.
  if (obs.repro) existing.repro = obs.repro;
  if (evidence.length) {
    const merged = [...new Set([...existing.evidence, ...evidence])];
    existing.evidence = merged.length <= EVIDENCE_MAX ? merged
      : [merged[0], ...merged.slice(merged.length - (EVIDENCE_MAX - 1))];
  }
  pushHistory(existing, { at, event: 'seen', session, anchor, build });
  return { ticket: existing, action: 'updated' };
}

// By id, by fingerprint, or by an unambiguous id prefix — a CLI you can type at.
export function findTicket(tickets, ref) {
  const key = String(ref ?? '').trim();
  if (!key) return null;
  const exact = tickets.find((t) => t.id === key || t.fingerprint === key);
  if (exact) return exact;
  const hits = tickets.filter((t) => t.id.startsWith(key));
  if (hits.length > 1) throw new Error(`tickets: "${key}" matches ${hits.length} tickets`);
  return hits[0] ?? null;
}

const SETTABLE = {
  status: (v) => oneOf(v, STATUSES, 'status'),
  branch: (v) => String(v) || null,
  // The build a fix landed on. A token, not a claim this module checks — nothing here reasons
  // about builds any more, it only remembers the one it was told.
  fix: (v) => String(v).trim() || null,
};

// The only human-driven transition. Returns what actually changed, so a caller that sets a ticket
// to what it already is says "unchanged" rather than logging a lie.
export function setTicket(ticket, changes, { now = new Date() } = {}) {
  const at = now.toISOString();
  const changed = [];
  for (const [key, raw] of Object.entries(changes)) {
    if (!(key in SETTABLE)) throw new Error(`tickets: cannot set "${key}" — settable fields are ${Object.keys(SETTABLE).join(', ')}`);
    const value = SETTABLE[key](raw);
    if (ticket[key] === value) continue;
    pushHistory(ticket, { at, event: key, from: ticket[key], to: value });
    ticket[key] = value;
    changed.push(key);
  }
  return changed;
}

// The open queue, worst first, then loudest, then freshest.
export function listTickets(tickets, { status, kind, severity } = {}) {
  return tickets
    .filter((t) => (!status || t.status === status) && (!kind || t.kind === kind)
      && (!severity || t.severity === severity))
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)
      || b.count - a.count
      || String(b.lastSeen).localeCompare(String(a.lastSeen)));
}
