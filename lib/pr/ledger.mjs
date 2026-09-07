// The pull-request ledger: what was reviewed, at which head, and what was decided.
//
// Its whole purpose is the WATERMARK. A PR counts as moved since anyone last looked when its
// `headRefOid` differs from the recorded `head`, or when a comment from somebody other than the
// maintainer is newer than the recorded id — which is what lets a sweep tell a PR that has changed
// from twenty that have not, and is why a record with no head is refused rather than written.
//
// Append-only, one object per line, the LAST line for a PR being its current state. Never rewritten:
// parallel triage workers append concurrently, and a read-modify-write would lose records.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendLine } from '../jsonl.mjs';

export const ledgerPath = (cfg) => join(cfg.root, cfg.pr.ledger);

// `dismissed`, not `dismiss`: the record says what happened, and the sweep's own escape hatch reads
// it back as a state rather than as an instruction.
export const VERDICTS = ['review', 'merge', 'decline', 'dismissed'];

export function line({
  pr, verdict, head, lastOtherCommentId = null, note = '', direction = null, now = new Date(),
}) {
  if (!Number.isInteger(pr) || pr <= 0)
    throw new Error(`a ledger record needs a pull request number, got ${JSON.stringify(pr)}`);
  if (!VERDICTS.includes(verdict))
    throw new Error(`unknown verdict "${verdict}" — one of ${VERDICTS.join(', ')}`);
  if (typeof head !== 'string' || !head.trim())
    throw new Error('a ledger record needs the head sha it reviewed: without it nothing can tell whether the PR has moved since');
  const rec = {
    pr, verdict, head, last_other_comment_id: lastOtherCommentId,
    // Taken from the clock, never typed. The date this is written IS the date it was seen.
    seen: now.toISOString().slice(0, 10),
    note,
  };
  if (direction) rec.direction = direction;
  return JSON.stringify(rec);
}

// Returns the RECORD, not the file it went into: the worker that logs a verdict has to carry it in
// its report, and `appendLine`'s own return is the path — which told a worker where the ledger
// lives and nothing about what it just wrote.
export const append = (cfg, record) => {
  const text = line(record);
  appendLine(ledgerPath(cfg), text);
  return text;
};

// A malformed line is SKIPPED, never thrown on. This file outlives every process that writes it and
// is edited by hand when a sweep goes wrong; one bad line must cost its own record and never the
// whole ledger, which is the difference between a sweep that under-reports one PR and a sweep that
// cannot run.
export function readLedger(cfg) {
  const p = ledgerPath(cfg);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').flatMap((l) => {
    if (!l.trim()) return [];
    try {
      const rec = JSON.parse(l);
      return Number.isInteger(rec?.pr) ? [rec] : [];
    } catch { return []; }
  });
}

// The current state of every PR the ledger knows: its last line, in file order.
export const latest = (records) => new Map(records.map((r) => [r.pr, r]));
