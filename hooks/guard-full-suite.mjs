#!/usr/bin/env node
// PreToolUse(Bash) guard: a bare invocation of the project's own `suite` gate is the merge gate's
// run, not a dev-loop check.
//
// In the source project this was ported from (planetCraft), the full suite was ~2300 tests across
// 289 files and saturated a shared machine for minutes whenever an agent ran it out of habit
// instead of its narrower dev-loop command — so that project's version of this hook carried a
// table of runner regexes (`npm test`, `npm t`, `vitest`) because its suite command was hardcoded
// and never varied. This plugin is generalised, not ported: the project already told us its suite
// command (`cfg.gates.find((g) => g.name === 'suite').cmd`), so the rule is exact instead of
// guessed — see `lib/guards/suite.mjs`'s header for the decision itself.
//
// No gate named `suite` means this hook has nothing to guard.
//
// Silent and exit 0 whenever `.orchestra/config.json` is absent (spec §3.1).
import { readPayload, projectFor } from '../lib/guards/payload.mjs';
import { bareSuiteRun } from '../lib/guards/suite.mjs';

const payload = readPayload();
if (!payload) process.exit(0);

const cfg = projectFor(payload.cwd ?? process.cwd());
if (!cfg) process.exit(0);

const gate = cfg.gates.find((g) => g.name === 'suite');
if (!gate) process.exit(0);

// The hook's own environment: `orchestra land` (`lib/gate/land.mjs`'s `gateEnv`) runs the
// configured `suite` gate as a child stamped with `ORCHESTRA_FULL_SUITE=1`, so a project whose
// `suite` gate is itself an agent session gets a session whose hooks inherit the marker — refusing
// that agent's own Bash calls would refuse the very run the gate exists to perform. Read the same
// two ways `guard-main-commit` reads `ORCHESTRA_GATE` (its own header has the fuller reasoning);
// the segment-text reader lives in `bareSuiteRun` itself.
if (process.env.ORCHESTRA_FULL_SUITE === '1') process.exit(0);

const command = payload.tool_input?.command ?? '';
if (!command) process.exit(0);

const blocked = bareSuiteRun(command, gate.cmd);
if (!blocked) process.exit(0);

const alt = cfg.branchTests
  ? `Run what your branch affects instead:\n  ${cfg.branchTests}\n`
  : 'This project has not configured `branchTests` — narrow the run yourself (a file, a `-t` pattern, `--changed`).\n';

process.stderr.write(
  `Blocked: \`${blocked}\` is a bare run of this project's suite gate (\`${gate.cmd}\`), not a dev-loop check.\n`
  + '\n'
  + alt
  + '\n'
  + 'The suite gate itself runs once per landing, through `orchestra land`. Override here with:\n'
  + `  ORCHESTRA_FULL_SUITE=1 ${blocked}\n`,
);
process.exit(2);
