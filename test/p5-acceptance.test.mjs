// P5's acceptance (spec §15): "`init` on a bare repository produces a project that ticks; each
// hook is a silent no-op without a config; `install-heartbeat` refuses a label held by another
// root." One test per clause, following the shape of test/p2a-acceptance.test.mjs, p2b, p3 and p4.
//
// WHAT THIS SUITE DOES NOT PROVE, said here rather than discovered later: it does not re-run the
// off-switch matrix hook by hook — that is test/hooks-offswitch.test.mjs's own job, table-driven
// over all seven hooks, spawned as real processes. Duplicating it here would only be a second copy
// to keep in sync; this file instead proves the two files stay coupled (every hook `hooks.json`
// wires is a row that matrix actually covers) and leaves the behavioural proof to the matrix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeState, emptyState } from '../lib/register/state.mjs';
import { installHeartbeat, installedAgents } from '../lib/cli/heartbeat.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BIN = join(ROOT, 'bin', 'orchestra');

const run = (cwd, ...args) => execFileSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });

// ---------------------------------------------------------------------------------------------
// Row 1 — `init` on a bare repository produces a project that ticks.
// ---------------------------------------------------------------------------------------------

// A git repository with NO `.orchestra/` at all — never `test/helpers/fixture.mjs`'s `makeRepo`,
// which commits a config as part of its own setup. "Bare" here means what the acceptance line
// means: nothing about orchestra exists in this checkout yet. A `CLAUDE.md` is committed up
// front, deliberately, so that `init`'s own append to it (spec §11 step 3) shows up in `git
// status` as a MODIFICATION of a file that already existed, not as a third new path — which is
// exactly what lets the assertion below hold `init` to touching only the two paths the acceptance
// line names.
function bareRepo() {
  const root = mkdtempSync(join(tmpdir(), 'orchestra-bare-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture User');
  git('config', 'user.email', 'fixture@example.com');
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  writeFileSync(join(root, 'CLAUDE.md'), '# Project rules\n\nSome existing notes.\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');
  return { root, git };
}

test('init on a bare repository produces a project that ticks', () => {
  const { root, git } = bareRepo();
  try {
    // 1. `init --mode offline` succeeds.
    const initOut = run(root, 'init', '--mode', 'offline');
    assert.match(initOut, /orchestra init: wrote/);

    // 2. `doctor` prints a resolved configuration and exits 0 — spawned rather than called
    // in-process, so a non-zero exit surfaces as `execFileSync` throwing.
    const doctorOut = run(root, 'doctor');
    assert.match(doctorOut, /orchestra — /);
    assert.match(doctorOut, /mode\s+offline/);

    // 3. `git status` shows `.orchestra/config.json` and `.orchestra/.gitignore` as the only new
    // committable paths. `-uall` expands the untracked `.orchestra/` directory into its actual
    // files rather than collapsing it to one line, which is what makes "the only two" checkable at
    // all. `CLAUDE.md` is modified (see `bareRepo`'s own comment), never counted as new.
    const status = git('status', '--porcelain', '-uall');
    const lines = status.trim().split('\n').filter(Boolean);
    const untracked = lines.filter((l) => l.startsWith('??')).map((l) => l.slice(3)).sort();
    assert.deepEqual(untracked, ['.orchestra/.gitignore', '.orchestra/config.json']);
    const modified = lines.filter((l) => !l.startsWith('??'));
    assert.deepEqual(modified.map((l) => l.trim()), ['M CLAUDE.md']);

    // 4. `orchestra tick-gate` answers a line whose first word is `skip`, and whose reason is that
    // no register exists yet — nobody has ever written `.orchestra/state.json` here.
    const gate1 = run(root, 'tick-gate').trim();
    assert.equal(gate1.split(' ')[0], 'skip');
    assert.match(gate1, /no register/);

    // 5. After one non-terminal row is written into the register, the same command answers `run
    // hold-awake`. Written directly through `writeState` (the register's own writer), never by
    // hand-crafting the JSON: this is the shape `orchestra ready` itself would have left behind.
    writeState(root, { ...emptyState(root), adopted: true, tasks: [{ id: 'demo/D1', status: 'todo' }] });
    const gate2 = run(root, 'tick-gate').trim();
    assert.equal(gate2, 'run hold-awake');

    // That progression — init, a resolved doctor, two new paths and nothing else, no register
    // then a held-awake one — IS "a project that ticks".
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// Row 2 — each hook is a silent no-op without a config.
// ---------------------------------------------------------------------------------------------

test('every hook hooks.json wires is a row test/hooks-offswitch.test.mjs actually covers', () => {
  const hooksJson = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const wired = new Set();
  for (const events of Object.values(hooksJson.hooks)) {
    for (const matcher of events) {
      for (const h of matcher.hooks) {
        const m = /hooks\/([a-z-]+\.mjs)/.exec(h.command);
        if (m) wired.add(m[1]);
      }
    }
  }
  // The acceptance line's own count: spec §10 names seven hooks, and this is the positive control
  // against a wiring change that silently drops one — a matrix with fewer rows than `hooks.json`
  // has entries would otherwise pass this coupling check vacuously.
  assert.equal(wired.size, 7, `expected 7 wired hooks, found ${[...wired].join(', ')}`);

  const matrixSource = readFileSync(join(ROOT, 'test', 'hooks-offswitch.test.mjs'), 'utf8');
  const uncovered = [...wired].filter((file) => !matrixSource.includes(`file: '${file}'`));
  assert.deepEqual(uncovered, [],
    'a hook wired in hooks.json has no row in the off-switch matrix — see test/hooks-offswitch.test.mjs');

  // The behavioural proof itself — that each of these seven really does exit 0 and silent with no
  // `.orchestra/config.json`, and really does something with one — is test/hooks-offswitch.test.mjs's
  // own table, run there rather than duplicated here.
});

// ---------------------------------------------------------------------------------------------
// Row 3 — `install-heartbeat` refuses a label held by another root.
// ---------------------------------------------------------------------------------------------

// The real machine this suite runs on, captured before any test mutates anything — never
// `os.homedir()` inside the test body below, which would read whatever HOME this process happens
// to have at that moment rather than the one fact this check exists to pin down.
const REAL_HOME = process.env.HOME;

test('install-heartbeat refuses a label held by another root — temporary HOME, injected runner, real machine untouched', () => {
  // Sanity control, BEFORE: the machine this suite runs on carries no `com.orchestra.*` agent
  // right now. If it did, the refusal below could pass for the wrong reason (colliding with a
  // real agent) and the "never touches the real machine" claim would be untestable either way.
  assert.deepEqual(installedAgents({ home: REAL_HOME }), [],
    'the real machine must carry no com.orchestra.* agent before this test runs');

  const home = mkdtempSync(join(tmpdir(), 'orchestra-heartbeat-home-'));
  const calls = [];
  // The injected runner: records every call and never spawns a real `launchctl` or `systemctl`.
  // `list` answers with the label so the launchd path's verify-by-listing step reports success —
  // the same shape test/heartbeat.test.mjs's own `recorder()` uses.
  const run = (bin, args) => {
    calls.push([bin, ...args]);
    if (args[0] === 'list') return `-\t0\tcom.orchestra.shared1`;
    return '';
  };

  try {
    const rootA = mkdtempSync(join(tmpdir(), 'orchestra-heartbeat-proj-a-'));
    const rootB = mkdtempSync(join(tmpdir(), 'orchestra-heartbeat-proj-b-'));
    try {
      // Two projects sharing the SAME id — hence the same label, `com.orchestra.shared1` — but
      // different roots, exactly the shape the acceptance line names.
      const cfgA = { id: 'shared1', root: rootA };
      const cfgB = { id: 'shared1', root: rootB };

      const first = installHeartbeat(cfgA, { home, run });
      assert.equal(first.ok, true);
      assert.equal(first.action, 'installed');

      const second = installHeartbeat(cfgB, { home, run });
      assert.equal(second.ok, false);
      assert.equal(second.action, 'refused');
      assert.equal(second.existingRoot, rootA);
      assert.match(second.message, /already installed for/);
      assert.match(second.message, new RegExp(rootA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

      // Refused before touching B's checkout at all.
      assert.equal(existsSync(join(rootB, '.orchestra', 'tick.sh')), false);
    } finally {
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }

  // Never `launchctl`/`systemctl` for real: every call the injected runner recorded named one of
  // those two, and the very fact `calls` exists at all (rather than a thrown ENOENT from a real
  // spawn) is the proof nothing outside `run` was ever invoked.
  assert.ok(calls.length > 0, 'the injected runner should have recorded at least one call');
  assert.ok(calls.every(([bin]) => bin === 'launchctl' || bin === 'systemctl'));

  // Sanity control, AFTER: still nothing on the real machine.
  assert.deepEqual(installedAgents({ home: REAL_HOME }), [],
    'the real machine must still carry no com.orchestra.* agent after this test runs');
});
