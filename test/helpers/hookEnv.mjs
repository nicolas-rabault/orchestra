// The environment a hook test spawns a guard under. ONE definition, because three suites each had
// their own and all three drifted the same way.
//
// NEVER a bare `process.env`. `lib/gate/land.mjs`'s `gateEnv()` exports `ORCHESTRA_GATE=1` and
// `ORCHESTRA_FULL_SUITE=1` into the command the merge gate runs, and those are precisely the two
// documented off switches for `guard-main-commit` and `guard-full-suite`. A hook test that inherits
// the ambient environment therefore spawns the guard it is testing WITH THAT GUARD DISARMED — so
// every "the guard REFUSES" assertion in it flips from exit 2 to exit 0 the moment the suite runs
// from inside a landing, and only then.
//
// Measured 2026-09-05: seven such tests failed, `orchestra land` refused on gate `suite`, and the
// branch it refused had not touched a hook. Reproduced on `main` alone with nothing but
// `ORCHESTRA_GATE=1 ORCHESTRA_FULL_SUITE=1` in front of `node --test` — so the gate was refusing
// every branch, not that one. `gateEnv` has exported both since phase 3; the tests arrived in phase
// 5 and inherited the environment, which is when the two met.
//
// The ambient overrides are stripped and the caller's own `env` is applied ON TOP, so a test that
// sets one DELIBERATELY — proving the override itself works — still gets it. That is the whole
// distinction this helper exists to keep: an override a test asked for is the subject of the test;
// an override the shell happened to be carrying is contamination.
export const AMBIENT_OVERRIDES = ['ORCHESTRA_GATE', 'ORCHESTRA_FULL_SUITE'];

export function hookEnv(env = {}) {
  const base = { ...process.env };
  for (const key of AMBIENT_OVERRIDES) delete base[key];
  return { ...base, ...env };
}
