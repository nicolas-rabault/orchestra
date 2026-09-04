// The two pieces of plumbing every hook needs before it can decide anything: its stdin, and the
// project it is running against.
import { readFileSync } from 'node:fs';
import { loadConfig } from '../config.mjs';

// The hook's stdin as JSON. Anything unreadable — no stdin at all, or stdin that does not parse —
// is `null`, never a thrown error: a hook that crashes is noise, and the off switch (no config,
// spec §3.1) is the only silence this plugin is allowed to promise, not a side effect of a bug.
export function readPayload() {
  let text;
  try { text = readFileSync(0, 'utf8'); } catch { return null; }
  try { return JSON.parse(text); } catch { return null; }
}

// `loadConfig` with every throw swallowed into `null`. The absence of a config IS the off switch
// and `loadConfig` already returns `null` for that; a config that fails to PARSE is a different
// fact — a broken project, not an absent one — and `loadConfig` throws on purpose so that case is
// never mistaken for "orchestra is not set up here". A hook fires on every matching tool call in
// every session, so surfacing that throw here would make one typo noisy everywhere at once,
// instead of once, in `orchestra doctor`, where a human is actually looking for it.
export function projectFor(cwd) {
  try { return loadConfig(cwd); } catch { return null; }
}
