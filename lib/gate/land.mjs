// One branch lands at a time, and the whole landing is ONE PROCESS from the lock to the
// fast-forward.
//
// WHY A PROCESS AND NOT AN AGENT FOLLOWING INSTRUCTIONS. Two landings at once is not merely
// wasteful: each rebases onto the main branch it saw and runs the gates against that base, and the
// first to merge invalidates the other's run — the second either merges a base it never gated, or
// pays for a second rebase and a second run of everything. The fix has to be a lock, and a lock
// needs an observable holder. An agent session is not observable: it is dozens of tool calls over
// minutes with nothing to `kill -0`. A lease with an expiry is the only alternative, and an expiry
// long enough to be safe for a real landing (a suite is minutes) is far too long to unwedge a
// crashed one. As a process, `land` frees its lock by dying.
//
// Nothing here decides anything. Every decision worth a test is in ./state.mjs.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitEnv, orchestraDir } from '../paths.mjs';
import { loadConfigOrThrow } from '../config.mjs';
import * as S from './state.mjs';

const err = (s) => process.stderr.write(`orchestra gate: ${s}\n`);

// Resolved from this module, never from `process.argv[1]`: the child ./run.mjs `detach` forks has
// to be THIS plugin's entry point whatever wrapper invoked the parent — a global install, `npx`, a
// symlinked dev checkout. Exported here rather than resolved a second time in run.mjs, which already
// imports from this file for `gatePaths` and `precheck`: a landing's entry point is a fact about the
// plugin, not about the detach mechanism, and the two modules already depend in this direction.
export const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'orchestra');

// The environment a WRITE inside a landing runs under. ORCHESTRA_GATE marks it as the gate's own
// (spec §5), so a later integrate-only guard can recognise a landing's write without exempting git
// generally, and ORCHESTRA_FULL_SUITE is spec §10's override for `guard-full-suite` — the gate IS
// the deliberate whole-suite run that hook exists to make deliberate.
//
// NEITHER HAS A READER YET, and the honest reason is worth writing down for P5, which will add one:
// a PreToolUse hook fires on the AGENT's Bash command and reads that command's text; it does not
// inherit this process's environment. So P5 must decide whether `guard-main-commit` matches an
// `ORCHESTRA_GATE=1` prefix on a command line, reads its own environment, or recognises `orchestra
// land` directly — and it must reconcile TWO MARKERS FOR ONE FACT: this one, and
// `ORCHESTRA_WRITES_MAIN` which `lib/store/files.mjs` already stamps on its two git writes. Two ways
// to spell the same fact is how they start disagreeing. Not renamed here: that is P2a's file and
// P5's decision.
const gateEnv = () => ({ ...gitEnv(), ORCHESTRA_GATE: '1', ORCHESTRA_FULL_SUITE: '1' });

// GIT_DIR and GIT_WORK_TREE are exported inside a git hook, and under one of those git ignores
// `cwd` entirely — so a call meant for one checkout silently retargets another. `gitEnv()` strips
// them, once, for every READ this file makes: a read touches neither the working tree nor HEAD and
// needs no exemption from anything, so it carries none — see `gitWriteOk` below for the calls that
// do.
const git = (dir, args) =>
  execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv(),
  }).trim();

// Exported: it is also `queue-list`'s answer to "does this ref exist" (./run.mjs), and one spelling
// of that question is better than two.
export const gitOk = (dir, args) => { try { git(dir, args); return true; } catch { return false; } };

// The only git calls made through a helper (rather than `spawnSync` directly) that carry
// `gateEnv()` instead of `gitEnv()`: a WRITE to the main checkout or one of its worktrees — the
// ledger commit below, and the cleanup calls that remove a worktree, delete a branch, and unpin its
// upstream. Putting the marker on `git`/`gitOk` instead would hand the bypass to every future read
// too, by default, which is the opposite of a guard; `lib/store/files.mjs` keeps the same split
// between `git` and `gitWrite`, for the same reason. The rebase, the gate's own command and the
// fast-forward merge carry `gateEnv()` directly through their own `spawnSync` calls further down —
// those need `stdio: 'inherit'`, which this helper does not give them.
const gitWrite = (dir, args) =>
  execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gateEnv(),
  }).trim();

const gitWriteOk = (dir, args) => { try { gitWrite(dir, args); return true; } catch { return false; } };
const readFile = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

// Through a temp file and a rename, never a direct `writeFileSync` — the same discipline
// `lib/register/state.mjs`'s `writeState` and `lib/register/lock.mjs`'s `acquire` already use: a
// reader must see a whole record, old or new, never half of one. Exported for ./run.mjs, which has
// no writer of its own to add — `detach`/`recordOutcome`'s run record and `queue-list`'s read of
// `queue.json` need the identical guarantee this file's own state writes do.
//
// Measured need: one in roughly thirty runs of `test/p3-acceptance.test.mjs` had `await`'s first
// read (fired immediately after `detach` returns) land inside the just-spawned child's pid-claim
// write, mid-truncate — `writeFileSync` truncates before it writes, so the read saw an empty file,
// `parseRun` (correctly) mapped that to no record, and `await` reported a killed landing that was in
// fact still running. `rename` is atomic on every filesystem this runs on, so that window is closed.
export const writeAtomic = (p, text) => {
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, p);
};

// A pid on this host is the authoritative answer, which is the whole reason the lock is held by a
// process. `process.kill(pid, 0)` sends no signal; it only asks.
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// Atomics.wait, not a busy loop: `land` blocks for minutes at a time waiting for its turn, and a
// spin would take a core away from the very gates it is queueing behind.
const sleepMs = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

// Under the main checkout, never under the worktree the caller is standing in: the queue is shared
// by every worktree of this project, and `lib/paths.mjs` is the one place that resolves that.
//
// `runs` outlives every process involved and is the only witness a detached landing leaves; `logs`
// is what an agent reads instead of a scrollback it no longer has.
export function gatePaths(root) {
  const d = join(orchestraDir(root), 'gate');
  mkdirSync(join(d, 'runs'), { recursive: true });
  mkdirSync(join(d, 'logs'), { recursive: true });
  return {
    d,
    state: join(d, 'queue.json'),
    waiters: join(d, 'waiters'),
    holder: join(d, 'holder'),
    mutex: join(d, 'mutex'),
    runFor: (branch) => join(d, 'runs', `${S.runSlug(branch)}.json`),
    logFor: (branch) => join(d, 'logs', `${S.runSlug(branch)}.log`),
  };
}

// mkdir is atomic on every filesystem that matters, which is the whole reason it is the mutex. It
// guards a few file writes (and, for `queue-list` in ./run.mjs, a read paired with the write that
// depends on it — a few `git rev-parse` calls, not a landing) and is NEVER held across a landing —
// the landing is guarded by `holder`, which is a pid. Exported for that same reason: `queue-list`
// reads `queue.json` and, when it reaps a vanished entry, writes it back, and that pair has to run
// under the same lock `mark` takes, or a `queue-list` reading mid-`mark` sees a state `mark` has
// already truncated and persists that emptiness right back — a torn read turned into a wipe, one
// mutex would have prevented either way.
export function withMutex(p, fn) {
  for (let i = 0; ; i++) {
    try { mkdirSync(p.mutex); break; } catch (e) {
      // EEXIST is the only expected reason `mkdir` refuses this directory: another process holds
      // the mutex. Anything else — EACCES, ENOSPC, an ENOENT because the gate directory was removed
      // mid-landing — is a real error, and reading it as "held" would spin `mkdir` + `rmSync` on
      // every later iteration with no message, no pause and no exit — including when this runs from
      // the `'exit'` handler that releases the lock, which would hang a process trying to die.
      if (e.code !== 'EEXIST') throw e;
    }
    // Past 10 s the holder died between its mkdir and its cleanup. Break it rather than deadlock
    // the machine: this mutex spans three file writes, never seconds. Still sleeps before the next
    // attempt below, like every other iteration — clearing a stale lock is not a reason to spin.
    if (i > 100) rmSync(p.mutex, { recursive: true, force: true });
    sleepMs(100);
  }
  try { return fn(); } finally { rmSync(p.mutex, { recursive: true, force: true }); }
}

// Liveness, not a timeout. Call with the mutex held.
function reap(p) {
  const holder = S.reapHolder(S.parseHolder(readFile(p.holder)), alive);
  const waiters = S.reapWaiters(S.parseWaiters(readFile(p.waiters)), alive);
  writeFileSync(p.holder, S.formatHolder(holder));
  writeFileSync(p.waiters, S.formatWaiters(waiters));
  return { holder, waiters };
}

const mark = (p, branch, next, note = '') => withMutex(p, () => {
  writeAtomic(p.state,
    S.formatState(S.setEntryState(S.parseState(readFile(p.state)), branch, next, note)));
});

// The lock is released by handlers, never by the caller remembering to: a landing ends in nine
// different places and each one would be a chance to forget.
let holding = null;
function release() {
  if (!holding) return;
  const p = holding;
  holding = null;
  withMutex(p, () => {
    const holder = S.parseHolder(readFile(p.holder));
    if (holder && holder.pid === process.pid) writeFileSync(p.holder, '');
    writeFileSync(p.waiters, S.formatWaiters(
      S.parseWaiters(readFile(p.waiters)).filter((x) => x.pid !== process.pid)));
  });
}

function armRelease(p) {
  holding = p;
  // 'exit' covers every ordinary return path, including a throw. The signals cover the two ways an
  // agent session ends a command it is tired of waiting for.
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { release(); process.exit(130); });
  }
}

// Register as a waiter, then take the lock when we are the oldest live one. Returns false when the
// wait budget is spent — the caller exits `busy` and is expected to run `land` again, which is
// cheaper than one process blocking past its tool timeout.
function acquire(p, branch, waitSeconds) {
  const me = { pid: process.pid, branch, epoch: Math.floor(Date.now() / 1000) };
  const deadline = Date.now() + waitSeconds * 1000;
  let said = '';
  for (;;) {
    const verdict = withMutex(p, () => {
      const { holder, waiters } = reap(p);
      if (!waiters.some((x) => x.pid === me.pid)) {
        waiters.push(me);
        writeFileSync(p.waiters, S.formatWaiters(waiters));
      }
      const v = S.mayTake({ holder, waiters, pid: me.pid });
      if (v.ok) {
        writeFileSync(p.holder, S.formatHolder(me));
        // Waiters are the processes NOT holding, so leaving ourselves in both would make the next
        // reader count us twice.
        writeFileSync(p.waiters, S.formatWaiters(waiters.filter((x) => x.pid !== me.pid)));
      }
      return v;
    });
    if (verdict.ok) { armRelease(p); return true; }
    if (Date.now() >= deadline) return false;
    if (verdict.reason !== said) { err(`waiting — ${verdict.reason}`); said = verdict.reason; }
    sleepMs(2000);
  }
}

// --porcelain, not the human form: the plain output is `<path> <sha> [branch]`, which a path
// containing a space silently splits in the wrong place.
function worktrees(root) {
  const list = [];
  let cur = null;
  for (const line of git(root, ['worktree', 'list', '--porcelain']).split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9), branch: null }; list.push(cur); }
    else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
  }
  return list;
}

// Cheap and lock-free: a branch that does not exist must not occupy a place in the queue while it
// waits to be told so. `detach` (./run.mjs) runs this too, so a typo is refused by the command the
// agent actually watched rather than surfacing one poll later, out of a log.
export function precheck(cfg, branch) {
  if (!gitOk(cfg.root, ['rev-parse', '--verify', `refs/heads/${branch}`])) {
    err(`no such branch '${branch}'`);
    return { exit: S.EXIT.precondition };
  }
  const wt = worktrees(cfg.root).find((w) => w.branch === branch) ?? null;
  if (!wt) {
    err(`'${branch}' has no worktree — land it from the tree it was developed in`);
    return { exit: S.EXIT.precondition };
  }
  return { wt };
}

// The gates that judge a branch are the BRANCH'S OWN (spec §3.2): the config is committed, so the
// worktree carries the rules that ship with the code being landed. Everything else — `mainBranch`,
// `ledgers`, `queue`, `mode` — stays the invoking config's, because those are facts about the
// project rather than about the branch, and because a branch that could add a path to `ledgers`
// could make the gate commit that path onto the main branch.
function gatesFor(cfg, worktreePath) {
  let branchCfg = null;
  try {
    branchCfg = loadConfigOrThrow(worktreePath);
  } catch (e) {
    // A branch that broke its own config is refused BEFORE the gates run, naming the file, rather
    // than judged by the main branch's rules behind its back.
    return { error: `the config in ${worktreePath} is not usable (${e.message})` };
  }
  if (!branchCfg) return { gates: cfg.gates, from: 'the main checkout (the branch has no config)' };
  return { gates: branchCfg.gates, from: 'the branch' };
}

// Step 4: commit the tracked ledgers this project's tooling keeps dirty in the MAIN checkout.
//
// WHO commits them, and WHEN: this process, at the head of every landing, and the reasons are the
// three that make it the gate's job at all — it is the only actor allowed to write the main branch,
// it is the only one holding a lock while it does, and it runs often enough that no line ages more
// than one landing. A ticket filed by a review is a fact about the main branch, not a change a
// branch authored, so it belongs in a commit of the main branch's own.
//
// `cfg.ledgers` IS EMPTY IN EVERY PROJECT TODAY and this loop runs zero times — that is not dead
// code and must not be deleted. A project configures `ledgers` when it has a tracked file the main
// branch owns and a branch may not carry, and P5's ticket queue is the first one this plugin ships.
// The day it lands with nothing committing those files, the clash check below refuses every branch
// that touches one: measured as `t-06gjd4s`, 2026-08-19 in planetCraft, on every branch that
// project's fix queue produced.
//
// NO CROSS-PROCESS LOCK, and P5 owes one. The project this was extracted from takes its ticket
// queue's own lock here, because those files have several writers and committing one mid
// read-modify-write puts a torn line in the index. This plugin has no ticket queue yet, so there is
// no lock to take and a lock-shaped no-op would be just-in-case code. P5 adds both together.
//
// BLOCKING, unlike the best-effort writes after the fast-forward, and the difference is what has
// already happened when each runs: this runs before anything is touched, and if it fails the clash
// check two steps down would refuse the landing anyway, with a message about the branch that is
// really about the gate.
function commitLedgers(cfg) {
  const dirty = git(cfg.root, ['diff', '--name-only', '-z', 'HEAD']).split('\0').filter(Boolean);
  const ledgers = S.ledgerPathsToCommit(dirty, cfg.ledgers);
  if (!ledgers.length) return true;
  // --only, not a bare `git commit`: with no pathspec, `commit` records the WHOLE index, not just
  // what was just `add`ed — so anything else already staged in the main checkout (an agent's own
  // `git add` that never got committed, say) would be swept into a commit whose message names only
  // the ledgers, and the clash check two steps down could never catch it, because by then it is no
  // longer dirty. `--only` restricts the commit to exactly the paths named here, whatever else sits
  // in the index.
  const ok = gitWriteOk(cfg.root, ['add', '--', ...ledgers])
    && gitWriteOk(cfg.root, ['commit', '--no-verify', '--only',
      '-m', `chore(ledger): record ${ledgers.length} ledger file(s) written since the last landing`,
      '-m', `${ledgers.join('\n')}\n\nWritten in the main checkout by the tools that file them.`
        + ' Committed by the merge gate, which is the only actor allowed to write the main branch'
        + ' and the only one holding a lock against those writers.',
      '--', ...ledgers]);
  if (!ok) {
    err(`could not commit the main checkout's ledgers (${ledgers.join(', ')})`
      + ' — commit them by hand, nothing was touched');
    return false;
  }
  err(`committed ${ledgers.length} ledger file(s) in ${cfg.root}`);
  return true;
}

// A project's `queue` template (spec §13), or the command itself when there is none.
//
// FUNCTION REPLACEMENTS, not string ones: `String.replace` interprets `$&`, `$1` and `$'` inside a
// string replacement, so a gate command containing a `$` would be silently rewritten into something
// nobody typed.
const commandFor = (cfg, gate) => (cfg.queue
  ? String(cfg.queue).replace(/\{label\}/g, () => gate.name).replace(/\{cmd\}/g, () => gate.cmd)
  : gate.cmd);

const DEFAULT_WAIT = 540; // under the 600-second ceiling of an agent's Bash tool, so a spent budget
                          // is REPORTED rather than killed mid-wait.

export function land(cfg, branch, waitSeconds = DEFAULT_WAIT) {
  const p = gatePaths(cfg.root);

  const pre = precheck(cfg, branch);
  if (pre.exit !== undefined) return pre.exit;
  const { wt } = pre;

  withMutex(p, () => {
    writeAtomic(p.state, S.formatState(S.upsertEntry(S.parseState(readFile(p.state)),
      { branch, worktree: wt.path, at: Math.floor(Date.now() / 1000) }).state));
  });

  if (!acquire(p, branch, waitSeconds)) {
    err(`still waiting after ${waitSeconds}s — run land again`);
    return S.EXIT.busy;
  }
  mark(p, branch, 'landing');

  // Preconditions AFTER the lock, not before: a dirty main checkout or a dirty worktree is exactly
  // what the branch ahead of us was busy creating, so checking before the wait would check a state
  // that no longer holds.
  if (git(cfg.root, ['rev-parse', '--abbrev-ref', 'HEAD']) !== cfg.mainBranch) {
    err(`${cfg.root} is not on ${cfg.mainBranch}`);
    return S.EXIT.precondition;
  }
  // --untracked-files=no, and this is not a detail: a bare `status --porcelain` counts untracked
  // files, and a main checkout has one essentially always — a stray note, a scratch directory. What
  // a rebase can clobber is an uncommitted change to a TRACKED file; an untracked one git itself
  // refuses loudly if the merge would overwrite it, so it is git's business, not this check's.
  //
  // The WORKTREE is checked whole, because the rebase below happens in it and a rebase needs the
  // tree clean whatever the paths are.
  if (git(wt.path, ['status', '--porcelain', '--untracked-files=no'])) {
    err(`the worktree of '${branch}' has uncommitted changes — commit or clean them,`
      + ' nothing was touched');
    return S.EXIT.precondition;
  }
  if (!commitLedgers(cfg)) return S.EXIT.precondition;

  // The main checkout is checked NARROWLY, against the paths this landing would write (see
  // `clashingPaths`). `<main>...<branch>` (three dots) is the branch's own changes since the two
  // diverged, which is what the fast-forward will replay. Two dots would also count what landed
  // since, and would refuse a landing because of a file some OTHER branch changed this morning.
  const clash = S.clashingPaths(
    git(cfg.root, ['diff', '--name-only', '-z', 'HEAD']).split('\0').filter(Boolean),
    git(cfg.root, ['diff', '--name-only', '-z', `${cfg.mainBranch}...${branch}`]).split('\0').filter(Boolean),
  );
  if (clash.length) {
    err(`${clash.length} uncommitted file(s) in the main checkout are also changed by '${branch}'`
      + ' — commit or stash them, nothing was touched:');
    for (const c of clash) err(`  ${c}`);
    return S.EXIT.precondition;
  }

  // Rebase in the worktree, so the main working tree stays untouched until the fast-forward.
  if (spawnSync('git', ['-C', wt.path, 'rebase', cfg.mainBranch],
    { stdio: 'inherit', env: gateEnv() }).status !== 0) {
    const conflicted = git(wt.path, ['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
    spawnSync('git', ['-C', wt.path, 'rebase', '--abort'], { stdio: 'inherit', env: gateEnv() });
    if (!conflicted.length) {
      // A rebase can fail without a conflict — a stale index, an unborn ref. Reporting that as a
      // conflict would send the agent to resolve files that are not conflicted.
      err('rebase failed with no conflicted paths (see above)');
      return S.EXIT.precondition;
    }
    mark(p, branch, 'blocked', conflicted.join(', '));
    err(`conflict on ${conflicted.length} file(s): ${conflicted.join(', ')}`);
    err('resolve in the worktree, rebase --continue, then run land again');
    return S.EXIT.conflict;
  }

  // Read AFTER the rebase, so it is the change as the main branch will receive it. A git that
  // cannot answer is a null, which RUNS every gate (`gateSkipped`).
  let changed = null;
  try {
    changed = git(wt.path, ['diff', '--name-only', `${cfg.mainBranch}...${branch}`])
      .split('\n').filter(Boolean);
  } catch { /* unreadable — every gate runs */ }

  const { gates, from, error } = gatesFor(cfg, wt.path);
  if (error) { mark(p, branch, 'held', error); err(error); return S.EXIT.precondition; }
  if (!gates.length) err(`no gates configured in ${from} — nothing to run before the fast-forward`);
  for (const gate of gates) {
    if (S.gateSkipped(gate, changed)) {
      err(`gate '${gate.name}' skipped — every changed path matches`
        + ` ${gate.skipWhenAllPathsMatch.join(', ')}`);
      continue;
    }
    err(`gate '${gate.name}' (from ${from}) running in ${wt.path}`);
    // In the worktree, under the lock, on the rebased tree — the same tree that lands. Run anywhere
    // else it would judge code that is not what merges.
    //
    // stdio inherited, never captured: a detached landing's stdout IS the log file, so a gate's
    // output reaches `await`'s tail with no capture code at all. What must never be lost is the
    // gate's NAME, and that travels in the line below, in the queue entry's note, and in `await`'s
    // own report.
    const r = spawnSync(commandFor(cfg, gate), {
      cwd: gate.cwd ? join(wt.path, gate.cwd) : wt.path,
      shell: true,
      stdio: 'inherit',
      env: gateEnv(),
      timeout: gate.timeout ? gate.timeout * 1000 : undefined,
    });
    if (r.status !== 0) {
      const why = r.error?.code === 'ETIMEDOUT' || r.signal
        ? `gate "${gate.name}" refused (killed after ${gate.timeout}s)`
        : `gate "${gate.name}" refused`;
      mark(p, branch, 'held', why);
      err(`gate '${gate.name}' refused '${branch}' — held, ${cfg.mainBranch} untouched`);
      return S.EXIT.refused;
    }
  }

  // A fast-forward by construction, since the rebase was onto this very main branch and nothing else
  // may move it while we hold the lock. --ff-only is the assertion that it really is.
  if (spawnSync('git', ['-C', cfg.root, 'merge', '--ff-only', branch],
    { stdio: 'inherit', env: gateEnv() }).status !== 0) {
    mark(p, branch, 'held', `merge --ff-only refused — ${cfg.mainBranch} moved under the lock`);
    return S.EXIT.precondition;
  }

  // The ancestry check is the one thing standing between a cleanup and a lost branch, so it gates
  // the deletion rather than following it.
  if (!gitOk(cfg.root, ['merge-base', '--is-ancestor', branch, cfg.mainBranch])) {
    err(`merged, but '${branch}' is not an ancestor of ${cfg.mainBranch} — nothing deleted`);
    return S.EXIT.precondition;
  }
  // Lowercase -d, never -D: `cleanupAfterLanding` decides what is attempted here and why. The lazy
  // thunks are not a style choice — `provenMerged` and `untrackedFiles` are two git calls each and
  // are reached only when git has already refused something, which on an ordinary landing is never.
  const notes = S.cleanupAfterLanding({
    branch,
    worktree: wt.path,
    hasUncommittedTracked: () => !!git(wt.path, ['status', '--porcelain', '--untracked-files=no']),
    // -z, because porcelain v1 quotes a path containing a space and the note would name a file
    // nobody can copy. `?? ` is the untracked marker.
    untrackedFiles: () => git(wt.path, ['status', '--porcelain', '-z'])
      .split('\0').filter((e) => e.startsWith('?? ')).map((e) => e.slice(3)),
    removeWorktree: () => gitWriteOk(cfg.root, ['worktree', 'remove', wt.path]),
    deleteBranch: () => gitWriteOk(cfg.root, ['branch', '-d', branch]),
    // BOTH halves, which is what makes unpinning the upstream safe: identical tips say the branch is
    // exactly what the main branch carries, and --is-ancestor says it really descends from it.
    provenMerged: () => gitOk(cfg.root, ['merge-base', '--is-ancestor', branch, cfg.mainBranch])
      && git(cfg.root, ['rev-parse', branch]) === git(cfg.root, ['rev-parse', cfg.mainBranch]),
    unsetUpstream: () => gitWriteOk(cfg.root, ['branch', '--unset-upstream', branch]),
  });
  for (const note of notes) err(`landed; ${note}`);

  withMutex(p, () => {
    writeAtomic(p.state, S.formatState(S.dropEntry(S.parseState(readFile(p.state)), branch)));
  });
  err(`landed '${branch}' on ${cfg.mainBranch}`);
  return S.EXIT.ok;
}
