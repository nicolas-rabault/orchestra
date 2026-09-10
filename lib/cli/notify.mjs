import { notifyConductor } from '../register/notify.mjs';
export function notifyCommand({ cfg, args }) {
  if (args.length !== 1 || !args[0]) throw new Error('usage: orchestra notify <task-key>');
  process.stdout.write(`${notifyConductor(cfg.root, `worker report ready: ${args[0]}`)}\n`);
}
