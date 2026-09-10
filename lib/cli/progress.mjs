import { publishProgress } from '../register/progress.mjs';
export function progressCommand({ cfg, args }) {
  const [key, ...message] = args;
  if (!key || !message.length) throw new Error('usage: orchestra progress <task-key> <message>');
  process.stdout.write(`${publishProgress(cfg.root, key, message.join(' '))}\n`);
}
