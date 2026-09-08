// P1's acceptance. Every assertion here runs against BOTH modes, which is the sharpest available
// statement of what "two modes" means: same grammar, same lint, same board, same enrolment. Where
// the two genuinely differ — a status written to an issue, an owner who is somebody else — the
// difference is asserted explicitly at the bottom rather than left to be discovered.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo, ROADMAP } from './helpers/fixture.mjs';
import { makeFakeGh } from './helpers/gh.mjs';
import { loadConfig } from '../lib/config.mjs';
import { makeStore } from '../lib/store/index.mjs';
import { reconcile, gatherGit } from '../lib/roadmap/board.mjs';
import { startVerdict } from '../lib/roadmap/policy.mjs';
import { enrol } from '../lib/roadmap/enrol.mjs';
import { LABELS, taskTitle } from '../lib/store/github/issues.mjs';
import { parseRoadmap } from '../lib/roadmap/parse.mjs';
import { TRACE } from '../lib/gate/state.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orchestra');
const repos = [];
after(() => repos.forEach((r) => r.cleanup()));

// A throwaway repository, for the one test below that drives the real binary end to end rather
// than the library functions every other test in this file calls directly.
function repo() {
  const r = makeRepo();
  repos.push(r);
  return r;
}

// Seeds a roadmap that is ALREADY PUBLISHED, by the route each mode actually offers — the fixture
// shape whose absence is what let the two stores disagree about `knownKeys` for a whole phase.
//
// Offline, a published roadmap is a committed file, and people name files after dates: a
// hand-authored `docs/roadmaps/2026-09-lighting.md` declaring `roadmap: lighting` is an ordinary
// convention and the only way a published file's basename can disagree with its frontmatter slug.
// Online there are no filenames at all, so the same state — this slug's tasks already on the
// channel — is reached by publishing. Either way the question the tests below ask is one question:
// is re-publishing a slug the channel already holds an UPDATE, or a key collision?
function seedPublished(p, { filename, text }) {
  if (p.cfg.mode === 'offline') {
    const dir = join(p.r.root, p.cfg.roadmaps.published);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), text);
    return;
  }
  const draft = join(p.r.root, p.cfg.roadmaps.drafts, filename);
  writeFileSync(draft, text);
  p.store.publish(draft);
}

// A claim, by the route each mode has. Online a claim is the issue's assignee and `store.claim`
// writes one. Offline `store.claim` is a deliberate no-op — one machine and one register mean the
// branch ref and the register row ARE the claim record (files.mjs says so where it returns
// `{ ok: true }`) — so the branch is what has to exist for the board to derive `claimed`.
function claimHere(p, branch) {
  assert.equal(p.store.claim('demo/D1', p.store.whoami()).ok, true);
  if (p.cfg.mode === 'offline') p.r.git('branch', branch);
}

function project(mode) {
  const r = makeRepo({ mode });
  repos.push(r);
  const cfg = loadConfig(r.root);
  const gh = mode === 'online' ? makeFakeGh() : null;
  const store = makeStore(cfg, gh ? { gh } : {});
  const dir = join(r.root, cfg.roadmaps.drafts);
  mkdirSync(dir, { recursive: true });
  const draftPath = join(dir, 'demo.md');
  writeFileSync(draftPath, ROADMAP);
  return { r, cfg, store, gh, draftPath };
}

for (const mode of ['offline', 'online']) {
  test(`[${mode}] a draft is invisible until it is published`, () => {
    const p = project(mode);
    assert.deepEqual(p.store.list(), []);
    assert.deepEqual(p.store.drafts().map((d) => d.slug), ['demo']);
  });

  test(`[${mode}] publish makes exactly one task visible, keyed the same way`, () => {
    const p = project(mode);
    const res = p.store.publish(p.draftPath);
    assert.equal(res.slug, 'demo');
    assert.deepEqual(res.keys, ['demo/D1']);
    assert.deepEqual(p.store.list().map((t) => t.key), ['demo/D1']);
    assert.deepEqual(p.store.drafts(), []);
  });

  test(`[${mode}] a published task round-trips the whole grammar`, () => {
    const p = project(mode);
    p.store.publish(p.draftPath);
    const t = p.store.list()[0];
    const src = parseRoadmap(ROADMAP).tasks[0];
    for (const field of ['id', 'title', 'key', 'order', 'branch', 'design', 'lane', 'why', 'acceptance']) {
      assert.deepEqual(t[field], src[field], `${field} differs in ${mode}`);
    }
    assert.deepEqual(t.deps, src.deps);
    assert.deepEqual(t.touches, src.touches);
  });

  test(`[${mode}] publish refuses a draft that does not lint and changes nothing`, () => {
    const p = project(mode);
    writeFileSync(p.draftPath, ROADMAP.replace('- **Lane** —', '- **Landed** yes'));
    assert.throws(() => p.store.publish(p.draftPath), /status field/);
    assert.deepEqual(p.store.list(), []);
    assert.deepEqual(p.store.drafts().map((d) => d.slug), ['demo']);
  });

  test(`[${mode}] the board derives todo for a fresh task and reports no correction`, () => {
    const p = project(mode);
    p.store.publish(p.draftPath);
    const b = reconcile({
      tasks: p.store.list(),
      git: gatherGit(p.r.root, { mainBranch: p.cfg.mainBranch }),
      register: [],
      overlay: p.store.overlay(),
    });
    assert.equal(b.rows.length, 1);
    assert.equal(b.rows[0].status, 'todo');
    assert.equal(b.rows[0].schedulable, true);
    assert.deepEqual(b.corrections, []);
  });

  test(`[${mode}] a published task with no register row is an orphan the board names`, () => {
    const p = project(mode);
    p.store.publish(p.draftPath);
    const b = reconcile({
      tasks: p.store.list(),
      git: gatherGit(p.r.root, { mainBranch: p.cfg.mainBranch }),
      register: [],
      overlay: p.store.overlay(),
    });
    assert.deepEqual(b.orphans.inRoadmapOnly, ['demo/D1']);
  });

  test(`[${mode}] enrolment closes that orphan, and is append-only`, () => {
    const p = project(mode);
    p.store.publish(p.draftPath);
    const { state } = enrol({ tasks: [] }, p.store.list(), { at: '2026-09-02T10:00:00Z', host: 'testbox' });
    const b = reconcile({
      tasks: p.store.list(),
      git: gatherGit(p.r.root, { mainBranch: p.cfg.mainBranch }),
      register: state.tasks,
      overlay: p.store.overlay(),
    });
    assert.deepEqual(b.orphans.inRoadmapOnly, []);
    assert.deepEqual(b.orphans.inRegisterOnly, []);
  });

  // Offline REFUSED this and online accepted it — the cross-mode divergence this phase existed to
  // find. `knownKeys` is "every OTHER roadmap's keys"; offline filtered the set by FILENAME, so a
  // published file whose basename differs from its slug handed the roadmap ITS OWN keys and lint
  // rejected every one of them as already taken. The suite could not see it because its only
  // fixture had one roadmap, one task, and a filename equal to the slug.
  test(`[${mode}] re-publishing a slug the channel already holds is an update, not a key collision`, () => {
    const p = project(mode);
    const LIGHTING = ROADMAP.replaceAll('demo', 'lighting');
    seedPublished(p, { filename: '2026-09-lighting.md', text: LIGHTING });
    const second = join(p.r.root, p.cfg.roadmaps.drafts, 'lighting.md');
    writeFileSync(second, LIGHTING);
    assert.deepEqual(p.store.publish(second).keys, ['lighting/D1']);
    assert.ok(p.store.list().some((t) => t.key === 'lighting/D1'));
  });

  // And the shape that makes `knownKeys` non-empty for a real reason: with one roadmap in the
  // project the set is always empty, so nothing above ever exercises what it holds. Two roadmaps
  // also make a QUALIFIED dep resolvable — the other thing lint reads that set for.
  test(`[${mode}] two published roadmaps coexist, and a cross-roadmap dep blocks on the other's key`, () => {
    const p = project(mode);
    const dir = join(p.r.root, p.cfg.roadmaps.drafts);
    const alpha = join(dir, 'alpha.md');
    const beta = join(dir, 'beta.md');
    writeFileSync(alpha, ROADMAP.replaceAll('demo', 'alpha'));
    writeFileSync(beta, ROADMAP.replaceAll('demo', 'beta').replace('- **Deps** —', '- **Deps** alpha/D1'));
    p.store.publish(alpha);
    p.store.publish(beta);
    assert.deepEqual(p.store.list().map((t) => t.key).sort(), ['alpha/D1', 'beta/D1']);

    const b = reconcile({
      tasks: p.store.list(),
      git: gatherGit(p.r.root, { mainBranch: p.cfg.mainBranch }),
      register: [],
      overlay: p.store.overlay(),
    });
    const betaRow = b.rows.find((r) => r.key === 'beta/D1');
    assert.deepEqual(betaRow.blockedBy, ['alpha/D1']);
    assert.equal(betaRow.depsMet, false);
    assert.equal(b.rows.find((r) => r.key === 'alpha/D1').depsMet, true);
  });

  // `claimedByMe` was read by `board.mjs` and by `policy.mjs` and produced by nothing, so
  // `startVerdict` — the decision the worktree guard enforces — could never say yes to a claimed
  // row built from a real board row. It fell through to `unclaimed`, which would refuse the
  // worktree for the very task the user had just claimed. Each store answers for itself: online it
  // knows `gh.me()` and the assignees, offline there is no overlay and one machine, so a locally
  // derived `claimed` IS mine.
  test(`[${mode}] a task claimed here reads claimed BY ME, and startVerdict lets work start on it`, () => {
    const p = project(mode);
    p.store.publish(p.draftPath);
    claimHere(p, 'demo/d1-first-thing');
    const b = reconcile({
      tasks: p.store.list(),
      git: gatherGit(p.r.root, { mainBranch: p.cfg.mainBranch }),
      register: [],
      overlay: p.store.overlay(),
    });
    assert.equal(b.rows[0].status, 'claimed');
    assert.equal(b.rows[0].claimedByMe, true);
    assert.deepEqual(startVerdict(b.rows[0]), { ok: true });
  });
}

test('[offline] the overlay is empty and every command that cannot apply says so', () => {
  const p = project('offline');
  p.store.publish(p.draftPath);
  assert.equal(p.store.overlay().size, 0);
  assert.equal(p.store.openRoadmap('demo').noop, true);

  // Offline there is nowhere to write a status, so `sync` does nothing — and that is correct
  // (spec §4.1), not a gap. It says why and exits 0.
  const s = p.store.sync([]);
  assert.equal(s.noop, true);
  assert.match(s.why, /nowhere/);
});

test('[online] the overlay carries the issue, and claim turns it wip for everyone', () => {
  const p = project('online');
  p.store.publish(p.draftPath);
  assert.equal(p.store.claim('demo/D1', 'nico').ok, true);
  const entry = p.store.overlay().get('demo/D1');
  assert.equal(entry.status, 'claimed');
  assert.ok(p.gh.state.find((i) => i.labels.includes(LABELS.wip)));
  assert.ok(p.gh.state.some((i) => i.title === taskTitle(parseRoadmap(ROADMAP).tasks[0])));
});

// docs/specs/2026-09-08-offline-leaves-no-trace-design.md's whole promise, asserted on the actual
// output of the actual pipeline rather than on any one function that helps keep it: `init` opts a
// real repository into offline mode, a worker does ordinary work on a branch, and `orchestra land`
// carries it onto main through the real gate. Every unit test above (and in test/p3-acceptance and
// test/gate-state) covers one function that contributes to this; none of them can catch a future
// change that keeps every function's own test green while still letting a trace slip through a seam
// between them. This test would.
test('offline, end to end: nothing orchestra produces reaches a commit', () => {
  const r = repo();
  // `makeRepo`'s own initial commit tracks `.orchestra/config.json` (it has to, to give every OTHER
  // test in this suite a config to load without a separate `init` step) — the one thing about this
  // fixture that is not the shape a real offline project starts in. Untracked here, before `init`
  // ever runs, so the assertions below check what the CODE under test did, not a fixture artefact.
  rmSync(join(r.root, '.orchestra'), { recursive: true, force: true });
  r.git('rm', '-q', '--cached', '-r', '--ignore-unmatch', '.orchestra');
  r.git('commit', '-q', '-m', 'clean start', '--allow-empty');
  execFileSync(BIN, ['init', '--mode', 'offline'], { cwd: r.root, encoding: 'utf8' });

  // A worker's branch, landed through the real gate.
  r.git('worktree', 'add', '-q', join(r.root, '.orchestra', 'worktrees', 'w1'), '-b', 'feat', 'main');
  const wt = join(r.root, '.orchestra', 'worktrees', 'w1');
  writeFileSync(join(wt, 'feature.txt'), 'the work itself\n');
  execFileSync('git', ['-C', wt, 'add', 'feature.txt']);
  execFileSync('git', ['-C', wt, 'commit', '-q', '-m', 'feat: the work itself']);
  assert.equal(spawnSync(BIN, ['land', 'feat'], { cwd: r.root, encoding: 'utf8' }).status, 0);

  // The three ways another developer could find out, all silent.
  assert.deepEqual(r.git('ls-files').split('\n').filter((p) => p && TRACE.test(p)), []);
  assert.doesNotMatch(r.git('log', '--format=%B', 'main'), TRACE);
  assert.equal(r.git('status', '--porcelain').trim(), '');
});
