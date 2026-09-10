// `orchestra retire <task key> [--for=<seconds>]` — hand a long worker's work to a fresh session.
//
// WHAT THIS DOES AND DELIBERATELY DOES NOT DO. It drives one wrap-up turn, takes the note that turn
// produced onto the row, stops the session and clears it. IT DOES NOT LAUNCH THE REPLACEMENT. What
// it leaves behind is a live row with a branch, a worktree, a note and no session — which
// `orchestra ready` now reports as `RELAUNCH:` — so the replacement is started through the launch
// path that already exists and is already guarded (`guard-bash`'s claim rule watches the worktree
// gesture, the session name carries the project id, the journal records it). A second launch path
// written in here would be a second set of those rules to keep honest.
//
// So a retirement completes across two ticks, and that is the safe way round: if this command dies
// halfway, the row is either untouched or waiting to be relaunched, and both are states the tick
// already knows how to finish.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readState, writeState } from '../register/state.mjs';
import { fleetCost } from '../register/cost.mjs';
import { WRAP_UP, noteFrom } from '../register/retire.mjs';
import { driveSlug, turnVerdict } from '../register/drive.mjs';
import { startTurn } from './drive.mjs';
import { readTurn } from '../register/liveness.mjs';
import { gatherLiveness } from '../register/liveness.mjs';
import { pidAlive } from '../register/beat.mjs';
import { TERMINAL } from '../register/archive.mjs';
import { worktreePaths } from '../monitor/sources.mjs';
import { append } from '../register/journal.mjs';

const out = (s) => process.stdout.write(`${s}\n`);
const sleepMs = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

export const STILL_RUNNING_EXIT = 12;

export function retireCommand({ cfg, args }) {
  const key = args.find((a) => !a.startsWith('--'));
  if (!key) throw new Error('orchestra retire: needs a task key, `<roadmap>/<ID>`');
  const forArg = args.find((a) => a.startsWith('--for='));
  const forSeconds = forArg ? Number(forArg.slice('--for='.length)) : 600;
  if (!Number.isFinite(forSeconds) || forSeconds <= 0)
    throw new Error(`orchestra retire: --for must be a positive number of seconds, got ${JSON.stringify(forArg)}`);

  const state = readState(cfg.root);
  if (!state) throw new Error('orchestra retire: no register');
  const row = (state.tasks ?? []).find((t) => t.id === key);
  if (!row) throw new Error(`orchestra retire: no row ${key} in the register`);

  if (row.runtime === 'codex') throw new Error('Codex usage unavailable: request a wrap-up with send_message_to_thread, wait for completion, create a replacement native task, then codex attach; no Claude retirement');

  // The same verdict `ready` printed, re-asked here against the register as it is NOW: the tick that
  // decided may be minutes old, and a worker that has since been asked a question, finished, or had
  // a turn started in it must not be stopped. `--force` is deliberately absent: every refusal below
  // is a reason the hand-over would lose work or cost more than it saves.
  const [measured] = fleetCost([row], { retireAt: cfg.retireAt, terminal: TERMINAL });
  const verdict = measured?.verdict ?? { ok: false, reason: 'no-session' };
  if (!verdict.ok) throw new Error(`orchestra retire: ${key} is not retirable — ${verdict.reason}`);

  const cwd = worktreePaths(cfg.root).get(row.branch) ?? join(cfg.root, cfg.worktrees, driveSlug(key));
  if (!existsSync(cwd)) throw new Error(`orchestra retire: no worktree at ${cwd} — nothing to hand over`);

  // The wrap-up runs through `orchestra drive`'s own turn machinery — the same stop, record, fork
  // and log, in the same order — so there is one implementation of how a worker is resumed. Its
  // slug is its own (`retire-…`), so the wrap-up's log never overwrites the row's last drive log,
  // which `ready` quotes as its last words.
  const liveness = gatherLiveness(cfg.root, [row]);
  const p = startTurn(cfg, {
    row, cwd, slug: `retire-${driveSlug(key)}`, prompt: WRAP_UP,
    registered: liveness.registered.get(row.session) ?? null,
    extra: { retire: true },
  });
  out(`retiring: ${key} — prefix ${Math.round(measured.cost.prefix / 1000)}k over ${measured.cost.requests} requests;`
    + ` wrap-up turn running in ${cwd} — log ${p.log}`);

  const deadline = Date.now() + forSeconds * 1000;
  for (;;) {
    const turn = readTurn(p.record);
    if (turnVerdict(turn, { alive: pidAlive }) !== 'running') return finish(cfg, row, turn, measured, p);
    if (Date.now() >= deadline) {
      out(`still wrapping up: ${key} (pid ${turn.pid ?? 'starting'}) — run \`orchestra retire ${key}\` again;`
        + ' the turn goes on without you, and nothing has been stopped yet');
      process.exitCode = STILL_RUNNING_EXIT;
      return undefined;
    }
    sleepMs(2000);
  }
}

// The wrap-up turn has returned. Everything from here is one write and one stop, in this order: the
// note onto the row FIRST, so a crash between the two leaves the note recorded and the session
// still alive — the recoverable way round. Stopping first and failing to record the note would
// throw away the only thing that makes the hand-over cheap.
function finish(cfg, row, turn, measured, p) {
  let log = '';
  try { log = readFileSync(p.log, 'utf8'); } catch { /* an unreadable log is a missing note */ }
  const note = noteFrom(log);
  if (!note) {
    out(`NOT retired: ${row.id} — the wrap-up turn produced no note in the required shape (exit ${turn.exit}).`);
    out(`  Its session is untouched and still holds the work. Read ${p.log}, then either run`);
    out('  `orchestra retire ' + row.id + '` again, or leave it running — a hand-over without a note');
    out('  costs the replacement the re-reading this was meant to save.');
    process.exitCode = 1;
    return undefined;
  }

  const retiredAt = new Date().toISOString();
  const state = readState(cfg.root);
  const i = (state.tasks ?? []).findIndex((t) => t.id === row.id);
  const tasks = state.tasks.slice();
  // `session` cleared and `sessionName` KEPT: the name is what `claude stop` was given and what the
  // replacement will be given again, and the cleared session is what makes `ready` report the row
  // as needing a relaunch. `turns` is the request count this session reached, which is what the
  // hand-over brief tells the replacement it is continuing from.
  tasks[i] = {
    ...tasks[i], session: null, note, retiredAt, turns: measured.cost.requests,
    retiredFrom: { session: row.session, prefix: measured.cost.prefix, read: measured.cost.read },
  };
  writeState(cfg.root, { ...state, tasks });

  // Only now, and only if it is still registered: `startTurn` already stopped the background
  // session to resume it, so this is the belt for a session that re-registered itself. A stop
  // before the write above is a stop that can lose the note.
  const name = row.sessionName;
  if (name) spawnSync('claude', ['stop', name], { stdio: 'ignore', timeout: 15_000 });

  append(cfg.root, { kind: 'note', task: row.id,
    text: `Retired at ${measured.cost.requests} requests and a ${Math.round(measured.cost.prefix / 1000)}k prefix`
      + ` (${Math.round(measured.cost.read / 1e6)}M read). Its note is on the row; the replacement continues on the same worktree.` });

  out(`retired: ${row.id} — note on the row (${note.split('\n').length} lines), session cleared`
    + `${name ? `, \`claude stop ${name}\` sent` : ' (no session name on the row — stop it yourself)'}.`);
  out(`  Relaunch it on the same worktree: orchestra brief ${row.id} --handover ${measured.cost.requests}`);
  out(`  \`orchestra ready\` reports it as RELAUNCH: until you do.`);
  return undefined;
}
