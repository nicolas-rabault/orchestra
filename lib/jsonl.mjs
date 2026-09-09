// One complete line per append, into a file two processes may hold open.
//
// Lifted out of lib/register/journal.mjs when the pull-request ledger became a second file with the
// identical requirement. Four lines of the 2026-08-12/14 journal in planetCraft are truncated
// mid-JSON, missing their closing brace — two conductors appending at once — and a file that does
// not end in a newline glues the next record onto the last one. Both are survived here rather than
// in two copies free to drift.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

// True when the file exists and its last byte is not a newline — the state that turns the next
// append into a corrupted line. Reads one byte, never the file.
function needsLeadingNewline(path) {
  let fd;
  try {
    const { size } = statSync(path);
    if (size === 0) return false;
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(1);
    readSync(fd, buf, 0, 1, size - 1);
    return buf[0] !== 0x0a;
  } catch {
    return false; // no file yet: the first append creates it, and needs no repair
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function appendLine(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${needsLeadingNewline(path) ? '\n' : ''}${text}\n`);
  return path;
}

// Every line that parses, and a count of the ones that did not. A torn line — two writers appending
// at once, a crash mid-append — is SKIPPED and counted, never thrown on: this reader is what the
// monitoring page, the archiver and the tick gate all read the register's channels through, and one
// bad byte must not take any of them down. Callers that care print the count.
export function readJsonl(path) {
  if (!existsSync(path)) return { entries: [], skipped: 0 };
  const entries = [];
  let skipped = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { skipped += 1; }
  }
  return { entries, skipped };
}
