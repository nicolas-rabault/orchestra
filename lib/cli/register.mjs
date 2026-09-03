// The register's small verbs. Each one is the `main()` its module used to carry, with the root
// arriving from the config instead of being walked up from `import.meta.url`.
import { existsSync } from 'node:fs';
import { append, KINDS } from '../register/journal.mjs';
import { relay } from '../register/relay.mjs';
import { conductorState } from '../register/beat.mjs';
import { watch } from '../register/watch.mjs';
import { acquire, lockDir, readHolder, release } from '../register/lock.mjs';

// `-` for "about the tick itself, not about a task": an empty shell argument is too easy to pass by
// accident, so the absence has to be typed.
export function journalCommand({ cfg, args }) {
  const [kind, task, ...rest] = args;
  const text = rest.join(' ');
  if (!kind || !task || !text)
    throw new Error(`usage: orchestra journal <${KINDS.join('|')}> <task|-> "<text>"`);
  process.stdout.write(`${append(cfg.root, { kind, task: task === '-' ? null : task, text })}\n`);
}

// A conductor that came to fetch its answers rather than wait to be handed them. Prints nothing at
// all when there is nothing unconsumed, so a routine tick stays quiet.
export const inboxCommand = ({ cfg }) => process.stdout.write(relay(cfg.root));

// Who is holding the baton, as a fact rather than as an inference. The read half; the write half is
// `watch-answers`, which is the only thing that ever stamps this file.
export function beatCommand({ cfg }) {
  const s = conductorState(cfg.root);
  if (!s) { process.stdout.write('nobody is holding the baton\n'); return; }
  process.stdout.write(`${s.session} (pid ${s.pid}) — ${s.conducting
    ? 'conducting'
    : `beating but silent for ${Math.round(s.silentFor / 60000)} min: the baton is loose`}\n`);
}

// Armed by the conductor itself as a persistent watch at the top of its first tick. It never
// returns: the interval is the point.
export function watchAnswersCommand({ cfg, args }) {
  const [session] = args;
  if (!session) throw new Error('usage: orchestra watch-answers <conductor session id>');
  watch(cfg.root, session);
}

const sayHolder = (h) => (h
  ? `${h.kind}${h.session ? ` ${h.session}` : ''}${h.pid ? ` (pid ${h.pid})` : ''} since ${h.startedAt}`
  : 'an unnamed holder');

// orchestra lock acquire|release|holder [--kind conductor|tick] [--session <id>] [--pid <n>]
// Exit 1 when the lock is held by somebody else, so a shell reads the answer in a code rather than
// by grepping a string.
export function lockCommand({ cfg, args }) {
  const [verb, ...rest] = args;
  const opt = (n, d = null) => { const i = rest.indexOf(n); return i > -1 ? rest[i + 1] : d; };
  const kind = opt('--kind', 'conductor');
  const session = opt('--session');
  const pid = Number(opt('--pid', String(process.pid)));
  if (verb === 'holder') {
    process.stdout.write(existsSync(lockDir(cfg.root)) ? `held by ${sayHolder(readHolder(cfg.root))}\n` : 'free\n');
    return;
  }
  if (verb === 'release') {
    process.stdout.write(release(cfg.root, { kind, session, pid }) ? 'released\n' : 'not yours — left alone\n');
    return;
  }
  if (verb !== 'acquire')
    throw new Error('usage: orchestra lock <acquire|release|holder> [--kind conductor|tick] [--session <id>]');
  const { ok, holder } = acquire(cfg.root, { kind, session, pid });
  process.stdout.write(ok ? 'acquired\n' : `held by ${sayHolder(holder)}\n`);
  if (!ok) process.exitCode = 1;
}
