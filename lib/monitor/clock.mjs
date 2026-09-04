// The one place a written instant becomes a time on screen.
//
// Every timestamp this plugin writes is UTC: the register, the journal and the inbox are all
// stamped with `new Date().toISOString()`. Printing that string's own HH:MM slice is a real trap,
// not a hypothetical one — in the project this was extracted from, the page used to do exactly
// that (characters 11..16 of the ISO string), which is the Zulu clock read out as if it were the
// local one: on a machine in Paris, every line in the panel sat two hours behind the system clock
// beside it (one hour in winter, and a line written after 22:00 UTC showed the wrong day's hour
// entirely). Nothing was wrong with the instant in the file; only its rendering.
//
// `toLocaleTimeString` with an EXPLICIT locale, because the two halves of a formatted time have
// different owners: the zone must follow the machine — that is the whole fix — while the format
// must stay a 24-hour HH:MM, and the browser's own locale would put "5:40 PM" in a monospace
// column for a reader in en-US. `hourCycle: 'h23'` rather than `hour12: false`, which renders
// midnight as "24:00" under some locale data.
//
// A `ts` that is not a date at all comes back exactly as it was written, not as an empty cell:
// every jsonl file this plugin appends to is written a line at a time, and a malformed stamp must
// stay visible as one rather than be quietly erased from the line it belongs to.
const HHMM = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };

export function clock(ts) {
  if (typeof ts !== 'string' || !ts) return '';
  const t = Date.parse(ts);
  return Number.isNaN(t) ? ts : new Date(t).toLocaleTimeString('en-GB', HHMM);
}
