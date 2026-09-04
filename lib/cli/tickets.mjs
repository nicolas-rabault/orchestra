// `orchestra tickets` — list / add / close / show, the queue the heartbeat's stand-down sweep
// reads. Every write goes through `lib/tickets/lock.mjs`'s `withQueueLock`; the read-only verbs
// need no lock, and a reader blocking behind a writer would make `list` wait on somebody else's
// write for no reason.
import {
  ticketsPath, loadTickets, saveTickets, upsertTicket, findTicket, setTicket, listTickets, pushHistory,
} from '../tickets/ledger.mjs';
import { withQueueLock } from '../tickets/lock.mjs';

const out = (s) => process.stdout.write(`${s}\n`);

const line = (t) => `${t.id}  ${t.severity}  ${t.kind.padEnd(8)}  ${t.status.padEnd(12)}  x${String(t.count).padEnd(3)}  ${t.title}`;

const USAGE = `usage:
  orchestra tickets list [--status <s>] [--kind <k>] [--severity <s>] [--json]
  orchestra tickets add (--fingerprint <id> | --subject <text>)
                        [--kind bug|friction|design|perf] [--severity S1|S2|S3]
                        [--title t] [--body b] [--session id] [--anchor a]
                        [--repro url] [--evidence path]... [--at iso] [--build <token>]
  orchestra tickets close <id> [--note <text>]
  orchestra tickets show <id|fingerprint>`;

// The only flags that mean something by their presence alone. Every other flag CARRIES a value,
// so one written without one is a mistake: refusing beats guessing, because there is no value
// this parser could invent that would be better than the caller being told.
const BOOLEAN_FLAGS = new Set(['json']);

function parseFlags(argv) {
  const flags = {}; const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { rest.push(a); continue; }
    const [name, inline] = a.slice(2).split(/=(.*)/s);
    // `--flag=` is an empty string, which is a value the caller wrote on purpose; a bare `--flag`
    // followed by another flag or by nothing at all is not.
    let value = inline;
    if (value === undefined) {
      if (argv[i + 1]?.startsWith('--') === false) value = argv[++i];
      else if (BOOLEAN_FLAGS.has(name)) value = true;
      else throw new Error(`orchestra tickets: --${name} needs a value`);
    }
    if (name === 'evidence') (flags.evidence ??= []).push(value);
    else flags[name] = value;
  }
  return { flags, rest };
}

export function ticketsCommand({ cfg, args }) {
  const [cmd, ...rawArgs] = args;
  const { flags, rest } = parseFlags(rawArgs);
  const file = ticketsPath(cfg);
  // Deferred, not loaded once up front: `add` and `close` must read INSIDE the lock, or a copy
  // loaded before it is a copy of the file another writer is about to replace.
  const read = () => loadTickets(file);

  switch (cmd) {
    case 'list': {
      const rows = listTickets(read(), { status: flags.status, kind: flags.kind, severity: flags.severity });
      if (flags.json) out(JSON.stringify(rows, null, 1));
      else if (!rows.length) out('(no tickets match)');
      else rows.forEach((t) => out(line(t)));
      return;
    }
    case 'add': {
      const hasSource = ['fingerprint', 'subject'].some((k) => flags[k]);
      if (!hasSource) throw new Error(USAGE);
      withQueueLock(file, () => {
        const tickets = read();
        const { ticket, action } = upsertTicket(tickets, flags);
        if (action !== 'unchanged') saveTickets(file, tickets);
        out(`${action}  ${line(ticket)}`);
      });
      return;
    }
    case 'close': {
      const id = rest[0];
      if (!id) throw new Error(USAGE);
      withQueueLock(file, () => {
        const tickets = read();
        const t = findTicket(tickets, id);
        if (!t) throw new Error(`orchestra tickets: no ticket "${id}"`);
        const changed = setTicket(t, { status: 'closed' });
        if (flags.note) pushHistory(t, { at: new Date().toISOString(), event: 'note', note: flags.note });
        if (changed.length || flags.note) saveTickets(file, tickets);
        out(`${changed.length ? changed.join('+') : 'unchanged'}  ${line(t)}`);
      });
      return;
    }
    case 'show': {
      const t = findTicket(read(), rest[0]);
      if (!t) throw new Error(`orchestra tickets: no ticket "${rest[0] ?? ''}"`);
      out(JSON.stringify(t, null, 1));
      return;
    }
    default:
      throw new Error(USAGE);
  }
}
