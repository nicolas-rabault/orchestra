// `orchestra land` — argument parsing and an exit code, and nothing else. Every decision is in
// ../gate/state.mjs and every effect in ../gate/land.mjs.
import { land } from '../gate/land.mjs';
import { EXIT } from '../gate/state.mjs';

const flag = (args, name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

export function landCommand({ cfg, args }) {
  const branch = args.find((a) => !a.startsWith('--'));
  if (!branch) {
    process.stderr.write('usage: orchestra land <branch> [--wait=<seconds>]\n');
    process.exitCode = EXIT.usage;
    return;
  }
  const wait = Number(flag(args, 'wait') ?? 540);
  if (!Number.isInteger(wait) || wait < 0) {
    // Refused loudly rather than silently coerced: a NaN wait would make `acquire` return on its
    // first comparison and report a busy queue that is not busy.
    process.stderr.write(`orchestra land: --wait must be a whole number of seconds, got ${JSON.stringify(flag(args, 'wait'))}\n`);
    process.exitCode = EXIT.usage;
    return;
  }
  process.exitCode = land(cfg, branch, wait);
}
