// A `claude` on PATH that records what it was asked and answers from files, for every suite that
// drives a worker: nothing here may ever spend a real session. It answers the three calls the resume
// cycle makes — `agents --json` (from `agents.json`, `[]` by default), `stop <id>`, and `-p --resume
// <uuid> --dangerously-skip-permissions <prompt>`, whose prompt it writes to `prompt-<uuid>.txt`.
// A `sleep` file holds the turn that many seconds; a `refuse` file is printed instead of a report.
//
// The directory travels in `FAKE_CLAUDE_DIR`, which a detached turn inherits like everything else in
// its environment. Restores PATH itself, so a failure inside `fn` does not leak the fake into a later test.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = `#!/bin/sh
D="$FAKE_CLAUDE_DIR"
printf '%s\\n' "$*" >> "$D/calls.log"
case "$1" in
  agents) cat "$D/agents.json" 2>/dev/null || echo '[]' ;;
  stop) echo "stopped $2" ;;
  -p)
    printf '%s' "$5" > "$D/prompt-$3.txt"
    [ -f "$D/sleep" ] && sleep "$(cat "$D/sleep")"
    if [ -f "$D/refuse" ]; then cat "$D/refuse"; else echo "report: turn done for $3"; fi ;;
esac
`;

export function withFakeClaude(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'fake-claude-'));
  writeFileSync(join(dir, 'claude'), SCRIPT);
  chmodSync(join(dir, 'claude'), 0o755);
  const saved = { PATH: process.env.PATH, FAKE_CLAUDE_DIR: process.env.FAKE_CLAUDE_DIR };
  process.env.PATH = `${dir}:${saved.PATH}`;
  process.env.FAKE_CLAUDE_DIR = dir;
  const fake = {
    dir,
    agents: (list) => writeFileSync(join(dir, 'agents.json'), JSON.stringify(list)),
    sleep: (seconds) => writeFileSync(join(dir, 'sleep'), String(seconds)),
    refuse: (text) => writeFileSync(join(dir, 'refuse'), `${text}\n`),
    clear: (name) => rmSync(join(dir, name), { force: true }),
    calls: () => { try { return readFileSync(join(dir, 'calls.log'), 'utf8'); } catch { return ''; } },
    prompt: (uuid) => { try { return readFileSync(join(dir, `prompt-${uuid}.txt`), 'utf8'); } catch { return null; } },
  };
  try { return fn(fake); } finally {
    process.env.PATH = saved.PATH;
    if (saved.FAKE_CLAUDE_DIR === undefined) delete process.env.FAKE_CLAUDE_DIR;
    else process.env.FAKE_CLAUDE_DIR = saved.FAKE_CLAUDE_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
}
