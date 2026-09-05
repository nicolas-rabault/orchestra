// Is a command a BARE run of the project's own `suite` gate — the merge gate's own run, not a
// dev-loop check?
//
// The source project this is ported from (planetCraft) guessed at the runner from a fixed table
// (`npm test`, `npm t`, `vitest`) because its suite command was hardcoded and never varied. This
// plugin is TOLD the suite command (`cfg.gates.find((g) => g.name === 'suite').cmd`), so the rule
// is exact instead of guessed: a segment whose command, once a leading env assignment and
// report-shaping noise flags are stripped, is that command TOKEN FOR TOKEN and nothing more.
// Token-for-token, not a string prefix, so a suite command of "npm run test" never mistakes a
// sibling script ("npm run test:branch") for itself. Anything that narrows the run (a file path,
// `-t 'name'`, `--changed`) passes straight through — only a run with nothing narrowing it is the
// gate's own run.
import { segments, stripEnv, envAssigned } from './segments.mjs';

// Flags that change how a run REPORTS, not what it runs, so they never count as narrowing. Carried
// over from the source project's own list. A bare `--` (nothing after it) is noise too: it is
// npm's own separator between the script name and its own arguments.
const NOISE = /^(--run|--silent|--reporter(=.*)?|--outputFile(=.*)?|--no-color|--bail(=.*)?|--)$/;

// Returns the blocked segment (truthy), or null when nothing in `command` is a bare run of
// `suiteCmd`.
export function bareSuiteRun(command, suiteCmd) {
  // `suiteCmd` goes through the exact same `stripEnv` pass as the checked segment below, not a
  // bare split. A configured cmd of `CI=1 npm test` (a real shape — a project's suite gate legally
  // carries its own env prefix) must never be compared UN-stripped against a stripped segment: the
  // two token lists could then never become equal again, and the guard would silently never fire
  // for that project — reading, in the config and in `doctor`, exactly like one that works. Fixed
  // 2026-09-05 after a review found `bareSuiteRun('CI=1 npm test', 'CI=1 npm test')` returned
  // `null`.
  const suiteTokens = stripEnv(String(suiteCmd ?? '')).split(/\s+/).filter(Boolean);
  if (!suiteTokens.length) return null;
  const prefix = suiteTokens.join(' ');

  for (const segment of segments(command)) {
    // ORCHESTRA_FULL_SUITE=1 is the override, read from the segment's own text here — the hook
    // itself reads it a second way, from its own environment, for the reason `guard-main-commit`
    // reads `ORCHESTRA_GATE` the same two ways (its own header has the fuller reasoning).
    if (envAssigned(segment, 'ORCHESTRA_FULL_SUITE')) continue;

    const tokens = stripEnv(segment).split(/\s+/).filter(Boolean);
    if (tokens.length < suiteTokens.length) continue;
    if (tokens.slice(0, suiteTokens.length).join(' ') !== prefix) continue;

    const rest = tokens.slice(suiteTokens.length).filter((tok) => !NOISE.test(tok));
    if (rest.length) continue; // something narrows the run — let it through
    return segment;
  }
  return null;
}
