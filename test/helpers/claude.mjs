// A `claude` on PATH that records what it was asked and answers from files, for every suite that
// drives a worker: nothing here may ever spend a real session. It answers the three calls the resume
// cycle makes — `agents --json` (from `agents.json`, `[]` by default), `stop <id>`, and `-p --resume
// <uuid> --dangerously-skip-permissions <prompt>`, whose prompt it writes to `prompt-<uuid>.txt`.
// A `hold` file keeps the turn running until the test removes it — a wall-clock `sleep` used to,
// and a loaded machine outran it: see `hold`'s own note below. A `refuse` file is printed instead
// of a report.
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
    for arg do prompt="$arg"; done
    printf '%s' "$prompt" > "$D/prompt-$3.txt"
    while [ -f "$D/hold" ]; do sleep 0.05; done
    if [ -f "$D/refuse" ]; then cat "$D/refuse";
    elif [ -f "$D/answer" ]; then cat "$D/answer";
    else echo "report: turn done for $3"; fi ;;
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
    // A turn that runs until the test says otherwise, rather than for N seconds. The seconds were a
    // race the test could only lose: everything a test does while the turn runs — a `ready`, a second
    // `drive`, each its own node boot — had to fit inside them, and on 2026-09-08 a loaded machine
    // did not, so `drive` correctly reported a turn that had genuinely ended and the test read it as
    // a defect. Held, the window cannot close early whatever the machine is doing.
    hold: () => writeFileSync(join(dir, 'hold'), ''),
    release: () => rmSync(join(dir, 'hold'), { force: true }),
    refuse: (text) => writeFileSync(join(dir, 'refuse'), `${text}\n`),
    // What a turn PRINTS when it succeeds — a worker's report, or the hand-over note a wrap-up
    // turn is asked for. `refuse` is the same mechanism for the opposite outcome, and the two are
    // separate files so a suite cannot accidentally assert a refusal against a successful reply.
    answer: (text) => writeFileSync(join(dir, 'answer'), `${text}\n`),
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
