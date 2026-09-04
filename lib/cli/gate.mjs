// `orchestra land` — argument parsing and an exit code, and nothing else. Every decision is in
// ../gate/state.mjs and every effect in ../gate/land.mjs or ../gate/run.mjs.
import { land } from '../gate/land.mjs';
import { detach, awaitRun, queueList, recordOutcome } from '../gate/run.mjs';
import { EXIT } from '../gate/state.mjs';

const flag = (args, name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

export function landCommand({ cfg, args }) {
  const branch = args.find((a) => !a.startsWith('--'));
  if (!branch) {
    process.stderr.write('usage: orchestra land <branch> [--wait=<seconds>] [--detach]\n');
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
  if (args.includes('--detach')) { process.exitCode = detach(cfg, branch, wait); return; }
  // Set only by `detach` on the child it forks. The child is an ordinary `land` in every other
  // respect — the outcome record is bookkeeping laid over it, not a second code path.
  if (process.env.ORCHESTRA_GATE_RUN_FILE) recordOutcome(process.env.ORCHESTRA_GATE_RUN_FILE);
  process.exitCode = land(cfg, branch, wait);
}

export function awaitCommand({ cfg, args }) {
  const branch = args.find((a) => !a.startsWith('--'));
  if (!branch) {
    process.stderr.write('usage: orchestra await <branch> [--for=<seconds>]\n');
    process.exitCode = EXIT.usage;
    return;
  }
  const forSeconds = Number(flag(args, 'for') ?? 540);
  if (!Number.isInteger(forSeconds) || forSeconds < 0) {
    process.stderr.write(`orchestra await: --for must be a whole number of seconds, got ${JSON.stringify(flag(args, 'for'))}\n`);
    process.exitCode = EXIT.usage;
    return;
  }
  process.exitCode = awaitRun(cfg, branch, forSeconds);
}

export const queueListCommand = ({ cfg }) => { process.exitCode = queueList(cfg); };
