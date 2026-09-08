// Whether each worker's session has a turn running anywhere on this machine — gathered here, from
// three witnesses, and handed to `obligations` (./drive.mjs) as data. Every witness is injectable,
// so the decision stays testable without a `claude` binary behind it.
//
//   - `claude agents --json`: the only source that tells a REGISTERED background session's `busy`
//     from its `idle` (a `--bg` worker stays a live process while it sits at the end of its turn).
//     It costs about two seconds (measured 2026-08-13), which is why `beat.mjs` never asks it for
//     the conductor's liveness and why it is asked once per command here, never in a two-second loop.
//   - the process table: a `claude -p --resume <uuid>` run — by `drive`'s own detached turn, or by a
//     conductor's hand — is not a registered session and shows up nowhere else.
//   - the turn records under `.orchestra/drive/`: the only witness that survives the process that
//     wrote it, and the one that carries the exit and the receipt.
//
// A witness that cannot answer reads as empty and is NAMED in `errors` rather than guessed at: with
// no agent list, a background session at `busy` reads as stopped, and the worst that follows is a
// drive that `claude` refuses with "is running as a background session" — recorded, never harmful.
// The other direction, a stopped worker read as busy, is the whole failure this exists to end.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { orchestraDir } from '../paths.mjs';
import { pidAlive } from './beat.mjs';
import { TERMINAL } from './archive.mjs';

export const driveDir = (root) => join(orchestraDir(root), 'drive');
export const turnPaths = (root, slug) => ({ record: join(driveDir(root), `${slug}.json`), log: join(driveDir(root), `${slug}.out`) });

export const readTurn = (path) => {
  try {
    const turn = JSON.parse(readFileSync(path, 'utf8'));
    return typeof turn?.id === 'string' ? turn : null;
  } catch { return null; }
};

// Through a rename, so a reader polling the record every two seconds sees the previous state or the
// next, never half of one — the same discipline every other record in this plugin keeps.
export function writeTurn(path, turn) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(turn, null, 2)}\n`);
  renameSync(tmp, path);
}

export function readTurns(root) {
  const turns = new Map();
  let names;
  try { names = readdirSync(driveDir(root)); } catch { return turns; }
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const turn = readTurn(join(driveDir(root), n));
    if (turn) turns.set(turn.id, turn);
  }
  return turns;
}

// The background entries of `claude agents --json`, by full session uuid. Interactive sessions carry
// no `status` and are not workers; anything that fails to parse is the caller's error to report.
export function registeredSessions(text) {
  const out = new Map();
  for (const s of JSON.parse(text)) {
    if (s?.kind !== 'background' || typeof s.sessionId !== 'string') continue;
    out.set(s.sessionId, { id: s.id ?? null, status: s.status ?? null, pid: s.pid ?? null });
  }
  return out;
}

// Every session uuid a `claude … --resume <uuid>` process in the table names. Matched on the flag
// and the uuid, not on the binary's path, which differs between a shell's `claude` and an editor's
// bundled one.
export function resumingSessions(psText) {
  const out = new Set();
  for (const line of psText.split('\n')) {
    if (!/\bclaude\b/.test(line)) continue;
    const m = /--resume\s+([0-9a-f-]{8,})/i.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

const AGENTS_TIMEOUT_MS = 15_000;
const runAgents = () => execFileSync('claude', ['agents', '--json'], { encoding: 'utf8', timeout: AGENTS_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] });
const runPs = () => execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] });

const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

export function gatherLiveness(root, tasks, { agents = runAgents, ps = runPs, alive = pidAlive } = {}) {
  const errors = [];
  let registered = new Map();
  let resuming = new Set();
  // Nothing to ask about a register with no live session on it: the two-second agent list is paid
  // for only when a row actually names a worker.
  if (tasks.some((t) => !TERMINAL.has(t.status) && t.session)) {
    try { registered = registeredSessions(agents()); } catch (e) { errors.push(`claude agents --json could not answer (${firstLine(e)}) — background sessions read as stopped`); }
    try { resuming = resumingSessions(ps()); } catch (e) { errors.push(`ps could not answer (${firstLine(e)}) — hand-run resumes read as stopped`); }
  }
  return { registered, resuming, turns: readTurns(root), alive, errors };
}
