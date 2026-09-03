// The register's housekeeping verb: move finished prose out to the archive.
//
//   orchestra archive            # what would move, and what it would save
//   orchestra archive --write    # move it
import { readState } from '../register/state.mjs';
import { partition, archive, archivePath, sizeOf, TERMINAL, PROSE_FIELDS } from '../register/archive.mjs';
import { liveConductor } from '../register/beat.mjs';

const out = (s) => process.stdout.write(`${s}\n`);

export function archiveCommand({ cfg, args }) {
  const state = readState(cfg.root);
  if (!state) { out('no register — nothing to archive'); return; }
  const { next, archived } = partition(state);
  const rows = archived.filter((r) => r.kind === 'task').length;
  const before = sizeOf(state);
  const after = sizeOf(next);
  if (!rows) { out('nothing terminal in the register — nothing to move'); return; }
  const survivingDeps = new Set(state.tasks.filter((t) => !TERMINAL.has(t.status)).flatMap((t) => t.deps ?? []));
  const held = archived.filter((r) => r.kind === 'task' && survivingDeps.has(r.id)).length;
  out(`${rows} finished row(s) move to ${archivePath(cfg.root)}; ${rows - held} leave the register entirely`
    + `, ${held} stay stripped of their ${PROSE_FIELDS.join('/')} because a live row still depends on them.`);
  const lessons = archived.find((r) => r.kind === 'lessons');
  if (lessons) out(`prose moving with them: ${lessons.keys.join(', ')}`);
  out(`register ${before} -> ${after} bytes (${(100 * (before - after) / before).toFixed(1)}% smaller)`);
  if (!args.includes('--write')) { out('\nnothing written — pass --write to move it'); return; }
  // Never while a tick is running: the register is rewritten in place and the conductor holds it
  // in memory across its whole tick, so a write underneath one silently loses everything that
  // tick decided.
  const live = liveConductor(cfg.root);
  if (live) throw new Error(`refused: a conductor is live (${live.session}, pid ${live.pid}) — it would overwrite this`);
  const r = archive(cfg.root);
  out(`\nmoved ${r.archived} line(s); register ${r.before} -> ${r.after} bytes`);
}
