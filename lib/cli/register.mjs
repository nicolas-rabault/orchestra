// The register's small verbs. Each one is the `main()` its module used to carry, with the root
// arriving from the config instead of being walked up from `import.meta.url`.
import { append, KINDS } from '../register/journal.mjs';
import { relay } from '../register/relay.mjs';

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
