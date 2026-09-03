// The register's housekeeping verb: move finished prose out to the archive.
//
//   orchestra archive            # what would move, and what it would save
//   orchestra archive --write    # move it
import { dirname, basename } from 'node:path';
import { readState } from '../register/state.mjs';
import { partition, archive, archivePath, sizeOf, TERMINAL, PROSE_FIELDS } from '../register/archive.mjs';
import { liveConductor } from '../register/beat.mjs';
import { imagesDir, sweep, archivePhotos } from '../register/archiveImages.mjs';

const out = (s) => process.stdout.write(`${s}\n`);
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

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

// The other half: sweep the PHOTOGRAPHS a finished run left behind. See `register/archiveImages.mjs`
// for the freshness floor and the two places it refuses to guess.
//
//   orchestra archive-images            # what would go, and what it would save
//   orchestra archive-images --write    # file the record, then remove them
export function archiveImagesCommand({ cfg, args }) {
  const swept = sweep(cfg.root);
  out(`${swept.kept.length + swept.dropped.length} photograph(s) under ${imagesDir(cfg.root)}, ${mb(swept.bytes.total)}`);
  if (swept.unreadable) {
    out(`${swept.unreadable} journal/inbox line(s) could not be read — a citation inside one is invisible here`);
  }
  if (!swept.dropped.length) {
    out(swept.kept.length ? 'every one is still named by live work — nothing to move' : 'nothing to move');
    return;
  }

  const byDir = new Map();
  for (const p of swept.dropped) {
    const dir = dirname(p.rel);
    byDir.set(dir, [...(byDir.get(dir) ?? []), p]);
  }
  out(`\n${swept.dropped.length} belong(s) to finished work, ${mb(swept.bytes.dropped)}:`);
  for (const [dir, list] of [...byDir].sort((a, b) => b[1].length - a[1].length)) {
    out(`  ${dir}/  — ${list.length} file(s), ${mb(list.reduce((n, p) => n + p.bytes, 0))}`);
    for (const p of list.sort((a, b) => b.bytes - a.bytes)) {
      out(`      ${basename(p.rel).padEnd(34)} ${mb(p.bytes).padStart(8)}  ${p.citedBy[0] ?? 'no register or journal line names it'}`);
    }
  }
  out(`\n${swept.kept.length} kept, ${mb(swept.bytes.kept)}:`);
  for (const p of swept.kept) out(`  ${p.rel} — ${p.why[0]}`);

  if (!args.includes('--write')) { out('\nnothing written — pass --write to file the record and remove them'); return; }
  // No conductor refusal here, deliberately: this writes no register. See archiveImages.mjs's header.
  const r = archivePhotos(cfg.root);
  out(`\nfiled ${r.removed} line(s) in ${archivePath(cfg.root)} and removed ${mb(r.bytes)}`
    + `${r.pruned ? `, pruning ${r.pruned} emptied director${r.pruned === 1 ? 'y' : 'ies'}` : ''}`);
}
