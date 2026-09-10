import { readState } from './state.mjs';
import { append } from './journal.mjs';

// Workers may append progress through the journal's atomic writer; the conductor remains the
// only writer of state.json. Progress never wakes the conductor or asserts a task status.
export function publishProgress(root, key, message) {
  if (typeof key !== 'string' || !key.includes('/') || !readState(root)?.tasks?.some((row) => row.id === key))
    throw new Error(`progress: no registered task ${key ?? ''}`);
  if (typeof message !== 'string' || !message.trim()) throw new Error('progress: a non-empty message is required');
  return append(root, { kind: 'note', task: key, text: message });
}

export const progressInstructions = (key) => `Publish meaningful progress with orchestra progress ${key} "<message>" in the user's language: when starting a substantive step, when verification returns a result, when blocked, and when finishing. Describe the observed result or next action concisely; do not claim completion before it is verified. Do not post for every tool call or create artificial heartbeat updates. This command appends a monitor journal note; it does not change state.json or wake the conductor.`;
