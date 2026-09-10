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
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
// The namespace as well, for `statfsSync` alone. It arrived in node 18.15 and this plugin declares
// no `engines`, so a NAMED import of it would throw at module load on an older runtime — taking the
// whole gate down to ask a question whose answer is allowed to be "I could not tell".
import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitEnv, orchestraDir } from '../paths.mjs';
import { appendLine } from '../jsonl.mjs';
import { loadConfigOrThrow } from '../config.mjs';
import { readState, writeState, recordLanding } from '../register/state.mjs';
import { withQueueLock } from '../tickets/lock.mjs';
import * as S from './state.mjs';

const err = (s) => process.stderr.write(`orchestra gate: ${s}\n`);

// Resolved from this module, never from `process.argv[1]`: the child ./run.mjs `detach` forks has
// to be THIS plugin's entry point whatever wrapper invoked the parent — a global install, `npx`, a
// symlinked dev checkout. Exported here rather than resolved a second time in run.mjs, which already
// imports from this file for `gatePaths` and `precheck`: a landing's entry point is a fact about the
// plugin, not about the detach mechanism, and the two modules already depend in this direction.
export const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'orchestra');

// The environment a WRITE inside a landing runs under. ORCHESTRA_GATE marks it as the gate's own
// (spec §5) — the one marker for "the plugin itself is writing to main on purpose" — and
// ORCHESTRA_FULL_SUITE is spec §10's override for `guard-full-suite`, the deliberate whole-suite
// run that hook exists to make deliberate.
//
// `hooks/guard-main-commit.mjs` reads ORCHESTRA_GATE two ways, and its own header has the reasoning
// for both: from the command's TEXT, since a PreToolUse hook sees only that, not this process's
// environment; and from `process.env` — the marker's one real reader — for the case where a
// configured gate is itself an agent session whose hooks inherit this environment. Neither reader
// covers THIS file's own `execFileSync('git', …)` calls below — those never go through the Bash
// tool, so no hook ever fires on them, and the marker was never what let the gate write to main.
const gateEnv = () => ({ ...gitEnv(), ORCHESTRA_GATE: '1', ORCHESTRA_FULL_SUITE: '1' });

// GIT_DIR and GIT_WORK_TREE are exported inside a git hook, and under one of those git ignores
// `cwd` entirely — so a call meant for one checkout silently retargets another. `gitEnv()` strips
// them, once, for every READ this file makes: a read touches neither the working tree nor HEAD and
// needs no exemption from anything, so it carries none — see `gitWriteOk` below for the calls that
// do.
//
// `maxBuffer` explicitly, because Node's default is 1 MB and one of this file's reads is a WHOLE
// DIFF: the offline trace check below hands `git diff <main>...<branch>` to `offlineTraces`.
// Measured 2026-09-10 in duckJam — a branch that rewrote an 834 KB test fixture produced a
// 1 332 756-byte diff, and the landing died with `spawnSync git ENOBUFS` one second in, after the
// rebase and before any gate, so the log named no gate and the branch could never land at all.
const git = (dir, args) =>
  execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv(),
    maxBuffer: 256 * 1024 * 1024,
  }).trim();

// Exported: it is also `queue-list`'s answer to "does this ref exist" (./run.mjs), and one spelling
// of that question is better than two.
export const gitOk = (dir, args) => { try { git(dir, args); return true; } catch { return false; } };

// The only git calls made through a helper (rather than `spawnSync` directly) that carry
// `gateEnv()` instead of `gitEnv()`: a WRITE to the main checkout or one of its worktrees — the
// ledger commit below, and the cleanup calls that remove a worktree, delete a branch, and unpin its
// upstream. Putting the marker on `git`/`gitOk` instead would hand the bypass to every future read
// too, by default, which is the opposite of a guard. `lib/store/files.mjs` has no equivalent split:
// its own git writes never go through the Bash tool either, so a marker there would have had no
// hook to disarm — which is why that file stamps none. The rebase, the gate's own command and the
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
// Measured need, 2026-09-04, in this plugin: one in roughly thirty runs of
// `test/p3-acceptance.test.mjs` had `await`'s first read (fired immediately after `detach` returns)
// land inside the just-spawned child's pid-claim write, mid-truncate — `writeFileSync` truncates
// before it writes, so the read saw an empty file, `parseRun` (correctly) mapped that to no record,
// and `await` reported a killed landing that was in fact still running. `rename` is atomic on every
// filesystem this runs on, so that window is closed.
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
//
// THIS FUNCTION ONLY NAMES THEM, and `gatePaths` below is the one that prepares them. A READER must
// not have to write to ask a question: `orchestra ready` reads the queue on every tick of every
// project, including ones that have never landed a branch, and a single set of names that mkdir'd
// left an empty gate tree behind each time just for being asked where the queue lives.
export function gateFiles(root) {
  const d = join(orchestraDir(root), 'gate');
  return {
    d,
    state: join(d, 'queue.json'),
    waiters: join(d, 'waiters'),
    holder: join(d, 'holder'),
    mutex: join(d, 'mutex'),
    // Append-only, one line per PASSAGE. `runs/` is one file per branch and every attempt rewrites
    // it, which is right for `await` and useless for history — see `attemptLine` in ./state.mjs.
    attempts: join(d, 'attempts.jsonl'),
    runFor: (branch) => join(d, 'runs', `${S.runSlug(branch)}.json`),
    logFor: (branch) => join(d, 'logs', `${S.runSlug(branch)}.log`),
  };
}

// The same names, with the two directories a WRITER is about to need. Every landing goes through
// this; nothing that only reads does.
export function gatePaths(root) {
  const p = gateFiles(root);
  mkdirSync(join(p.d, 'runs'), { recursive: true });
  mkdirSync(join(p.d, 'logs'), { recursive: true });
  return p;
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
  let broke = false;
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
    // the machine: this mutex spans three file writes, never seconds. ONCE, not on every iteration
    // past the threshold: two processes that had both crossed 10 s used to each remove the OTHER's
    // freshly re-acquired mutex on their own next iteration, forever, so neither ever finished its
    // critical section — the exact double-entry this mutex exists to prevent. Breaking it once and
    // falling back to the ordinary mkdir/EEXIST/sleep wait bounds the eviction to a single,
    // deterministic event; still sleeps before the next attempt, like every other iteration —
    // clearing a stale lock is not a reason to spin.
    if (i > 100 && !broke) { rmSync(p.mutex, { recursive: true, force: true }); broke = true; }
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
  // `git worktree list --porcelain` reports what git's OWN registry knows, not what is on disk — a
  // worktree directory removed by hand (rather than through `git worktree remove`) still has an
  // entry here. Without this check the next `git(wt.path, …)` throws `fatal: cannot change to …`,
  // uncaught, crashing the process with an undocumented exit 1 instead of a named precondition —
  // and leaving the queue entry `landing` with no live process to reap it.
  if (!existsSync(wt.path)) {
    err(`'${branch}'s worktree ${wt.path} is registered but its directory is gone`
      + ` — run \`git -C ${cfg.root} worktree prune\`, then recreate the worktree and land again`);
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
// branch owns and a branch may not carry, and the ticket queue (`lib/tickets/`) is the first one
// this plugin ships. The day it lands with nothing committing those files, the clash check below
// refuses every branch that touches one: measured as `t-06gjd4s`, 2026-08-19 in planetCraft, on
// every branch that project's fix queue produced.
//
// THE LOCK THIS WAS MISSING. The mutex above (`withMutex`) serialises LANDINGS against each
// other; it says nothing about a ticket being written between this function's own `git add` and
// its `git commit`. `orchestra tickets` writes the same file this loop reads, through
// `lib/tickets/lock.mjs`'s `withQueueLock`, and a `git add` that catches a write mid-append would
// stage half a JSON line — which `git commit` then makes permanent. So this loop takes that same
// lock first, over every DIRECTORY named by `cfg.ledgers` (not every path: two configured ledgers
// that share a directory would otherwise nest the identical lock inside itself and wait out its
// own deadline), in SORTED order, so two processes committing the same ledger set always acquire
// them in the same order and can never deadlock against each other.
//
// `waitMs` is left at `withQueueLock`'s own 30-second default in production and never shortened
// here — a lock that waited forever would turn a stuck ticket write into a stuck landing with
// nothing in the log, which is exactly what the throw at that deadline prevents. `commitLedgers`
// accepts `{ waitMs }` only so a test can prove that throw without spending 30 real seconds on it;
// nothing else should pass it.
//
// BLOCKING, unlike the best-effort writes after the fast-forward, and the difference is what has
// already happened when each runs: this runs before anything is touched, and if it fails the clash
// check two steps down would refuse the landing anyway, with a message about the branch that is
// really about the gate.

// One lock target per distinct directory `cfg.ledgers` resolves into, sorted — `withQueueLock`
// locks a DIRECTORY (see `lib/tickets/lock.mjs`), so two configured paths that share one must
// nest under a single acquisition rather than two.
function ledgerLockTargets(cfg) {
  const byDir = new Map();
  for (const rel of cfg.ledgers) byDir.set(dirname(join(cfg.root, rel)), join(cfg.root, rel));
  return [...byDir.values()].sort();
}

function withLedgerLocks(files, waitMs, fn) {
  const go = (i) => (i >= files.length ? fn() : withQueueLock(files[i], () => go(i + 1), { waitMs }));
  return go(0);
}

export function commitLedgers(cfg, { waitMs } = {}) {
  return withLedgerLocks(ledgerLockTargets(cfg), waitMs, () => {
    const dirty = git(cfg.root, ['diff', '--name-only', '-z', 'HEAD']).split('\0').filter(Boolean);
    const ledgers = S.ledgerPathsToCommit(dirty, cfg.ledgers);
    if (!ledgers.length) return true;
    // --only, not a bare `git commit`: with no pathspec, `commit` records the WHOLE index, not
    // just what was just `add`ed — so anything else already staged in the main checkout (an
    // agent's own `git add` that never got committed, say) would be swept into a commit whose
    // message names only the ledgers, and the clash check two steps down could never catch it,
    // because by then it is no longer dirty. `--only` restricts the commit to exactly the paths
    // named here, whatever else sits in the index.
    // The body is chosen on the mode, and it is not decoration. Offline, nothing orchestra produces
    // may enter a commit (docs/specs/2026-09-08-offline-leaves-no-trace-design.md), and this
    // message goes into the shared history of a repository whose other developers must not learn
    // the tool exists. Online there is nothing to hide and the explanation is worth having.
    const body = cfg.mode === 'offline'
      ? `${ledgers.join('\n')}\n\nWritten in the main checkout since the last landing.`
      : `${ledgers.join('\n')}\n\nWritten in the main checkout by the tools that file them.`
        + ' Committed by the merge gate, which is the only actor allowed to write the main branch'
        + ' and the only one holding a lock against those writers.';
    const ok = gitWriteOk(cfg.root, ['add', '--', ...ledgers])
      && gitWriteOk(cfg.root, ['commit', '--no-verify', '--only',
        '-m', `chore(ledger): record ${ledgers.length} ledger file(s) written since the last landing`,
        '-m', body,
        '--', ...ledgers]);
    if (!ok) {
      err(`could not commit the main checkout's ledgers (${ledgers.join(', ')})`
        + ' — commit them by hand, nothing was touched');
      return false;
    }
    err(`committed ${ledgers.length} ledger file(s) in ${cfg.root}`);
    return true;
  });
}

// `cfg` is a PARAMETER, and the reason is the bug this cost in the source: it read the checkout path
// out of an enclosing scope where it was not defined, so every call threw on its first git
// invocation, the catch below turned it into its one warning line, and the landing exited 0 looking
// successful while the register was never written. Two days, every landing (`t-1x6goyh`). What makes
// the catch safe now is not care but `test/p3-acceptance.test.mjs`, which runs a whole landing in a
// scratch repository and asserts the row afterwards.
function recordLandedSubjects(cfg, branch, mainBefore) {
  try {
    if (!mainBefore) return null;
    const subjects = git(cfg.root, ['log', '--format=%s', `${mainBefore}..${cfg.mainBranch}`])
      .split('\n').filter(Boolean);
    if (!subjects.length) return null;
    const state = readState(cfg.root);
    if (!state) return null;
    const { state: next, matched } = recordLanding(state, branch, subjects);
    if (!matched) return null;
    writeState(cfg.root, next);
    err(`recorded ${subjects.length} subject(s) on register row '${matched}'`);
    return matched;
  } catch (e) {
    // NOT "the board will read this row as unverified" — `unverified:` fires only through
    // `recordingGap` (lib/roadmap/board.mjs), which requires `reg.status === 'landed'`, and that
    // status was never written here. The real consequence is worse: the row keeps its PRE-landing
    // status (`claimed` or `review`), and once the branch ref is deleted a few lines below,
    // `reconcileTasks` (lib/register/ready.mjs, read by `orchestra tick`) sees a claimed/review row
    // whose ref is gone and emits `ref gone without landing -> todo` — RE-PLANNING work that has, in
    // fact, already landed. Fix the row in `.orchestra/state.json` by hand.
    err(`landed, but the register was not updated (${e.message})`
      + ' — the row keeps its status from before this landing, and once the branch is deleted below'
      + ' `orchestra tick` will read the missing ref as unstarted work and hand it out again'
      + ' — fix the row in `.orchestra/state.json` by hand');
    return null;
  }
}

// The WHOLE reconciler, not a bespoke close: `roadmap sync` closes the issue off the subjects just
// recorded, moves the status labels and ticks the programme's checklist. One code path, idempotent,
// and the conductor's tick runs the same one — so a landing that could not reach the channel is
// caught by the next tick rather than lost.
//
// Bounded, because this runs while the lock is held and a hung network call would block every branch
// behind it.
function syncLandedIssue(cfg, key) {
  const r = spawnSync(process.execPath, [BIN, 'roadmap', 'sync'],
    { cwd: cfg.root, encoding: 'utf8', timeout: 120_000, env: gateEnv() });
  if (r.status === 0) {
    // `orchestra roadmap sync` says on stdout whether it did anything ("sync: nothing to do — …" or
    // "sync: closed …; N label change(s); …") — captured here (spawnSync pipes by default) and, until
    // now, thrown away, so a no-op synced looked exactly like a real one. Free to echo: the pipe
    // already paid for it.
    const said = (r.stdout || '').split('\n').filter(Boolean).pop();
    err(`synced the shared channel for '${key}'${said ? ` — ${said}` : ''}`);
    return;
  }
  const why = (r.stderr || r.error?.message || `exit ${r.status}`).split('\n').filter(Boolean).pop() ?? 'failed';
  err(`landed, but the shared channel was not synced for '${key}' (${why.trim()})`
    + " — run `orchestra roadmap sync` when the channel is reachable");
}

// A project's `queue` template (spec §13), or the command itself when there is none.
//
// FUNCTION REPLACEMENTS, not string ones: `String.replace` interprets `$&`, `$1` and `$'` inside a
// string replacement, so a gate command containing a `$` would be silently rewritten into something
// nobody typed.
const commandFor = (cfg, gate) => (cfg.queue
  ? String(cfg.queue).replace(/\{label\}/g, () => gate.name).replace(/\{cmd\}/g, () => gate.cmd)
  : gate.cmd);

// Moves the LOCAL main branch onto what the remote holds, before anything is rebased onto it.
// Returns an exit code when the landing must stop, and null when it may go on — including the
// ordinary case, where the remote has not moved and this does nothing at all.
//
// WHY THIS EXISTS. Without it a landing is a closed loop: it rebases the branch onto the local main
// branch and fast-forwards that same local branch. While orchestra runs, every landing therefore
// stacks one more unpushed commit on a base the remote left behind, every gate judges a tree nobody
// else will ever have, and the divergence is invisible until somebody finally pulls.
//
// WHY A FETCH IS ALLOWED HERE AT ALL. `docs/plans/2026-09-03-p3-merge-gate.md` leaves the remote
// alone, and its argument is about PUSHING: an outward-facing action no key in the config
// authorises, against a ref that may be another developer's only copy. Reading the remote is neither
// — it writes nothing outward and destroys nothing. The gate still never pushes and still never
// deletes a remote ref.
//
// WHY THE SWITCH IS THE UPSTREAM AND NOT `cfg.mode`. `mode` decides where roadmaps go, not whether
// a remote exists: offline mode's repository is explicitly a SHARED one — that is the whole premise
// of the offline trace check below — so keying on `online` would leave diverging exactly the
// projects whose remote moves under them. A main branch that tracks nothing never reaches the fetch.
function syncMain(cfg) {
  const upstreamRef = `${cfg.mainBranch}@{upstream}`;
  const remote = gitOk(cfg.root, ['config', '--get', `branch.${cfg.mainBranch}.remote`])
    ? git(cfg.root, ['config', '--get', `branch.${cfg.mainBranch}.remote`]) : null;
  // Best effort, and that is a ruling rather than an oversight: a landing is a LOCAL integration and
  // a machine with no network must still be able to make one. A failed fetch leaves the last known
  // upstream in place, and the decision below runs against that.
  if (remote && spawnSync('git', ['-C', cfg.root, 'fetch', '--quiet', remote, cfg.mainBranch],
    { stdio: 'inherit', env: gateEnv() }).status !== 0) {
    err(`could not fetch ${remote}/${cfg.mainBranch} — using the upstream this checkout already`
      + ' knows, which may be behind');
  }

  const upstream = remote && gitOk(cfg.root, ['rev-parse', '--verify', upstreamRef])
    ? git(cfg.root, ['rev-parse', '--abbrev-ref', upstreamRef]) : null;
  const behind = upstream
    ? Number(git(cfg.root, ['rev-list', '--count', `${cfg.mainBranch}..${upstreamRef}`])) : 0;
  // Whole-tree, unlike `clashingPaths` below: a rebase replays commits into this tree and any
  // uncommitted tracked change stops it, whatever path it is on.
  const dirty = !!git(cfg.root, ['status', '--porcelain', '--untracked-files=no']);

  const decision = S.syncMainDecision({ upstream, behind, dirty });
  if (decision === 'skip') return null;
  if (decision === 'refuse') {
    err(`${cfg.mainBranch} is ${behind} commit(s) behind ${upstream} and ${cfg.root} has`
      + ' uncommitted changes — commit or stash them, nothing was touched');
    return S.EXIT.precondition;
  }

  // Rebase, never merge. The branch is about to be rebased onto this branch and fast-forwarded into
  // it, and `--ff-only` is the assertion that holds the whole gate together; a merge commit here
  // would break it on the next landing rather than this one.
  err(`${cfg.mainBranch} is ${behind} commit(s) behind ${upstream} — rebasing it onto ${upstream}`);
  if (spawnSync('git', ['-C', cfg.root, 'rebase', upstream],
    { stdio: 'inherit', env: gateEnv() }).status !== 0) {
    const conflicted = git(cfg.root, ['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
    spawnSync('git', ['-C', cfg.root, 'rebase', '--abort'], { stdio: 'inherit', env: gateEnv() });
    err(`conflict rebasing ${cfg.mainBranch} onto ${upstream}`
      + `${conflicted.length ? ` on ${conflicted.length} file(s): ${conflicted.join(', ')}` : ''}`);
    // Exit 10's standing instruction sends the agent to the branch's worktree, and this conflict is
    // not there: it is between what this checkout landed locally and what the remote has since
    // taken. Naming the place is the whole difference between an actionable code and a wrong one.
    err(`resolve in ${cfg.root}, not in the worktree — then run land again`);
    return S.EXIT.conflict;
  }
  return null;
}

const DEFAULT_WAIT = 540; // under the 600-second ceiling of an agent's Bash tool, so a spent budget
                          // is REPORTED rather than killed mid-wait.

// Every finished passage, appended and never rewritten. It wraps `landing` rather than sitting at
// each of its nine return points, which is the same reasoning `armRelease` uses for the lock: a
// function that ends in nine places gives you nine chances to forget one.
//
// The note is read back out of `queue.json` AFTER the landing, because that is where the refusing
// gate's name is written — and a landing that succeeded has already dropped its entry, so a
// successful passage records no note, which is correct: there is nothing to say about it.
export function land(cfg, branch, waitSeconds = DEFAULT_WAIT) {
  const startedAt = Date.now();
  const exit = landing(cfg, branch, waitSeconds);
  try {
    const p = gatePaths(cfg.root);
    appendLine(p.attempts, S.attemptLine({
      branch, startedAt, endedAt: Date.now(), exit, note: S.findEntry(S.parseState(readFile(p.state)), branch)?.note ?? '',
    }));
  } catch { /* a landing's own outcome matters more than the ledger of it */ }
  return exit;
}

function landing(cfg, branch, waitSeconds) {
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

  // Asked here, under the lock and before anything is written, because everything below writes: the
  // ledger commit, the rebase, and the gates. `statfsSync` answers for the filesystem the worktree is
  // on, which is the one the gates fill up. `bavail` is what an unprivileged process may actually
  // have — `bfree` counts blocks reserved for root and would report space no gate can use.
  const freeBytes = (() => {
    try { const s = fs.statfsSync?.(wt.path); return s ? s.bavail * s.bsize : null; } catch { return null; }
  })();
  const noRoom = S.diskRefusal(freeBytes, wt.path);
  if (noRoom) { mark(p, branch, 'held', 'no disk space'); err(noRoom); return S.EXIT.machine; }
  if (!commitLedgers(cfg)) return S.EXIT.precondition;

  // AFTER the ledger commit, because that commit is exactly the kind of uncommitted change a rebase
  // of the main branch cannot tolerate; BEFORE everything below, so the clash check, the branch's
  // rebase, the offline trace check and the gates all see the base the remote actually holds.
  const syncExit = syncMain(cfg);
  if (syncExit !== null) return syncExit;

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

  // Offline, nothing orchestra produces may enter a commit, and this is the last place that can
  // still be true: the main branch is the only branch pushed and this function is the only way in.
  // AFTER the rebase, so the commits and the diff are what the fast-forward will actually replay;
  // BEFORE the gates, because refusing costs nothing and a suite costs minutes.
  if (cfg.mode === 'offline') {
    const log = git(wt.path, ['log', '-z', '--format=%H%x00%B', `${cfg.mainBranch}..${branch}`]);
    const fields = log.split('\0');
    const commits = [];
    for (let i = 0; i + 1 < fields.length; i += 2) commits.push({ sha: fields[i], body: fields[i + 1] });
    const traces = S.offlineTraces({
      paths: changed ?? [],
      commits,
      diff: git(wt.path, ['diff', `${cfg.mainBranch}...${branch}`]),
    });
    if (traces.length) {
      const note = `offline-trace: ${traces.length} place(s) name the tool`;
      mark(p, branch, 'held', note);
      err(`${note} — '${branch}' would put ${traces.length} trace(s) of orchestra into`
        + ` ${cfg.mainBranch}, held, ${cfg.mainBranch} untouched. Offline mode's repository is`
        + ' shared with developers who must not learn the tool exists; reword and land again:');
      for (const t of traces.slice(0, 10)) err(`  ${t.where}  ${t.text}`);
      if (traces.length > 10) err(`  … and ${traces.length - 10} more`);
      return S.EXIT.refused;
    }
  }

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
      // A real timeout sets BOTH `r.signal` and `r.error.code === 'ETIMEDOUT'` (checked against
      // Node's actual spawnSync behaviour, not assumed); a gate that kills its own process group —
      // `kill -TERM $$`, an OOM kill, a killed dev server — sets only `r.signal`, with no `gate.timeout`
      // to name. The two used to share one branch, which printed "killed after undefineds" for the
      // second case: a false cause, since no timeout was ever configured.
      //
      // And `r.signal` is NULL for the case that actually happens, which is why `gateOutcome`
      // (./state.mjs) reads the status as well: the command runs under `shell: true`, so a killed
      // gate leaves the shell exiting 128+N and the signal never reaches this process at all.
      const { actor, exit, note } = S.gateOutcome({
        name: gate.name, timeout: gate.timeout ?? null,
        status: r.status, signal: r.signal ?? null, errorCode: r.error?.code ?? null,
      });
      mark(p, branch, 'held', note);
      err(actor === 'machine'
        ? `${note} — held, ${cfg.mainBranch} untouched, and '${branch}' is not accused: this machine`
          + ' could not run the gate to a verdict'
        : `gate '${gate.name}' refused '${branch}' — held, ${cfg.mainBranch} untouched`);
      return exit;
    }
  }

  // Read BEFORE the fast-forward — it is what makes the landed subjects computable without asking
  // the branch, which the cleanup below is about to delete.
  const mainBefore = gitOk(cfg.root, ['rev-parse', cfg.mainBranch])
    ? git(cfg.root, ['rev-parse', cfg.mainBranch]) : '';

  // A fast-forward by construction, since the rebase was onto this very main branch and nothing else
  // may move it while we hold the lock. --ff-only is the assertion that it really is.
  if (spawnSync('git', ['-C', cfg.root, 'merge', '--ff-only', branch],
    { stdio: 'inherit', env: gateEnv() }).status !== 0) {
    mark(p, branch, 'held', `merge --ff-only refused — ${cfg.mainBranch} moved under the lock`);
    return S.EXIT.precondition;
  }

  // Two writes the gate makes for others, in the one moment both halves of the fact exist in one
  // process. BOTH ARE BEST EFFORT AND NEITHER MAY CHANGE THE EXIT CODE: the main branch has already
  // moved, and a landing must not report failure because a JSON file could not be written or because
  // a network was down.
  const landedKey = recordLandedSubjects(cfg, branch, mainBefore);
  // Only when a register row actually matched: a fix branch or a study has no issue to close, and
  // spending a round trip under the lock to discover that is waste. Online only — offline `sync`
  // correctly does nothing (spec §4.1) and a spawn per landing to be told so is pure cost.
  if (landedKey && cfg.mode === 'online') syncLandedIssue(cfg, landedKey);

  // The ancestry check is the one thing standing between a cleanup and a lost branch, so it gates
  // the deletion rather than following it.
  if (!gitOk(cfg.root, ['merge-base', '--is-ancestor', branch, cfg.mainBranch])) {
    err(`merged, but '${branch}' is not an ancestor of ${cfg.mainBranch} — nothing deleted`);
    return S.EXIT.precondition;
  }
  // Lowercase -d, never -D, and that is the branch: `cleanupAfterLanding` decides what is attempted
  // here and why. The lazy thunks are not a style choice — `provenMerged` is two git calls and is
  // reached only when git has already refused something, which on an ordinary landing is never.
  const notes = S.cleanupAfterLanding({
    branch,
    worktree: wt.path,
    // -z, because porcelain v1 quotes a path containing a space and the note would name a file
    // nobody can copy; --no-renames, because a rename entry carries TWO paths in one record and the
    // slice below would report the second one mangled. Tracked and untracked alike: the worktree is
    // removed either way, so what this reads is not a decision, it is the list to name.
    dirtyFiles: () => git(wt.path, ['status', '--porcelain', '-z', '--no-renames'])
      .split('\0').filter(Boolean).map((e) => e.slice(3)),
    removeWorktree: () => gitWriteOk(cfg.root, ['worktree', 'remove', '--force', wt.path]),
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
