// Wake the existing conductor, never create a second session. The inbox/report remains authority.
import { spawnSync } from 'node:child_process';
import { readState } from './state.mjs';

export function notifyConductor(root, event, { run = spawnSync } = {}) {
  let conductor;
  try { conductor = readState(root)?.conductor; } catch { return 'unavailable'; }
  if (conductor?.runtime !== 'codex' || conductor.eventTransport !== 'codex-queue') return 'watch';
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(conductor.session ?? '') || (conductor.hostId && conductor.hostId !== 'local')) return 'unavailable';
  const message = `Orchestra event: ${event}. Project: ${root}. Read orchestra inbox and the current worker/gate evidence, then conduct the authorized next step. This is a wake signal, not a new user decision. Keep one conductor and acquire its lock before writing. Do not reply to this signal by emitting another notification.`;
  try {
    const result = run('codex', ['queue', '--thread', conductor.session, '--message', message], {
      cwd: root, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return !result.error && result.status === 0 ? 'queued' : 'unavailable';
  } catch { return 'unavailable'; }
}
