// The worker's brief, rendered by code.
//
// It was a table of fourteen substitutions and four prose templates in the conductor's own skill,
// filled BY HAND, once per launch. That shape was paid for twice.
//
// The conductor paid for it in turns and in output: `orchestra doctor` read for six of the
// fourteen fields, the roadmap read for the excerpt, then five hundred words composed — measured
// 2026-09-09, 123 times in duckJam alone, and every one of them a chance for the brief to come out
// slightly different from the last.
//
// THE WORKER PAID FOR IT IN REDISCOVERY, which is the larger half. A brief that names a task and
// nothing else leaves the worker to find the project for itself, and that is exactly what every
// session sampled in duckJam did with its first turns: `ls`, `git log --oneline -8`, `find design
// -type f`, `wc -l` over the files it hoped were the right ones, `ls docs/roadmaps/`. Four to
// eleven Bash calls before the first productive one — and, because a session's context only ever
// grows, every byte of that rediscovery was still being re-read at turn 150. One worker ran the
// same failing grep four times with different flags.
//
// So this module answers, once and in code, the questions those calls were asking: where the
// task's own files are and how big they are, which spec and plan already exist for it, and what
// commit the worktree was cut from. Nothing here guesses at a project — a toolchain probe (`node
// --version`, "is Chrome installed") is a fact only the project knows, and `briefExtra` is where
// it already says so.
import { progressInstructions } from './progress.mjs';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderTaskBlock } from '../store/github/issues.mjs';

// The task's own section, in the one canonical form both stores already agree on: online it IS the
// issue body, offline it is what `publish` wrote to the file. Rendering it from the parsed row
// rather than slicing the source means the two modes cannot drift, and a worker never reads a
// stray neighbouring heading that a line-range slice would have caught.
export const excerptOf = (row) => renderTaskBlock(row).trimEnd();

// `new src/thing.js` is the grammar, not a path: `Touches` writes `new` before a path that does
// not exist yet (docs/roadmap-format.md). Reading it as part of the filename is how a real duckJam
// row came out as `new arena/clocks.py — does not exist yet`, which is true of a path nobody meant
// to name and says nothing about `arena/clocks.py`.
const TOUCH = /^new\s+(.+)$/;
const pathOf = (entry) => TOUCH.exec(entry)?.[1] ?? entry;

// How big a path is, in the words the worker would otherwise have spent a call finding out. A
// directory reports how many files it holds; a file reports its lines.
//
// The two answers that are not sizes are the ones that carry the most: a path the row declared
// `new` and that is now THERE means the row's own assumption is already false — someone created it,
// on main or on this branch — and a worker that is told so does not overwrite it; a path declared
// new and absent is simply the row being right, and needs no warning.
function sizeOf(root, entry) {
  const rel = pathOf(entry);
  const declaredNew = rel !== entry;
  let st;
  try { st = statSync(join(root, rel)); } catch { return declaredNew ? 'to create — not there yet, as the row says' : 'does not exist yet'; }
  const size = () => {
    if (st.isDirectory()) {
      try { const n = readdirSync(join(root, rel)).length; return `directory, ${n} entr${n === 1 ? 'y' : 'ies'}`; }
      catch { return 'directory'; }
    }
    try { return `${readFileSync(join(root, rel), 'utf8').split('\n').length} lines`; } catch { return `${st.size} bytes`; }
  };
  return declaredNew ? `${size()} — ALREADY EXISTS, though the row declares it new: read it before you write it` : size();
}

// The spec and the plan this task already has, found the way a worker would look for them and
// then not have to: a file under `docs.specs` or `docs.plans` whose name carries the task's own id.
// Case-insensitive, because a task called `AD10` is filed as `ad10-…`.
function docsFor(cfg, id) {
  const needle = id.toLowerCase();
  const hits = [];
  for (const dir of [cfg.docs.specs, cfg.docs.plans]) {
    if (!dir) continue;
    const abs = join(cfg.root, dir);
    if (!existsSync(abs)) continue;
    try {
      for (const f of readdirSync(abs).sort()) {
        if (f.toLowerCase().includes(needle)) hits.push(`${join(dir, f)} — ${sizeOf(cfg.root, join(dir, f))}`);
      }
    } catch { /* unreadable directory — nothing to name */ }
  }
  return hits;
}

// What the worktree was cut from, so nobody spends a call on `git log --oneline -N` to find out.
// A git that cannot answer contributes no line at all, rather than a wrong one.
function branchPoint(cfg, git) {
  try {
    const line = git(['log', '-1', '--format=%h %s', cfg.mainBranch]).trim();
    return line ? `Your worktree is cut from ${cfg.mainBranch} at ${line}` : null;
  } catch { return null; }
}

// The block that replaces the rediscovery. Every line of it is a fact about THIS task, and every
// one of them was measured being asked for by hand.
export function orientation(cfg, row, { git }) {
  const lines = [];
  const cut = branchPoint(cfg, git);
  if (cut) lines.push(cut);
  if (row.touches?.length)
    lines.push('Your `Touches` files, already located and sized:',
      ...row.touches.map((t) => `  ${pathOf(t)} — ${sizeOf(cfg.root, t)}`));
  const docs = docsFor(cfg, row.id);
  if (docs.length) lines.push("This task's own spec and plan already on disk:", ...docs.map((d) => `  ${d}`));
  return lines;
}

// The rules every brief carries, whatever model the row is on.
//
// The context rule is the one that is new, and it is the measured one: 4.03 billion tokens of
// context were read to produce 30.7 million tokens of output across duckJam's 123 worker sessions —
// 131 to 1 — because 91 % of a worker's tool calls are Bash and every byte a Bash call returns
// stays in front of every later request of that session. A repository-wide sweep is the worst
// shape of that: it is large, it is mostly irrelevant, and it is paid for until the session ends.
// A subagent's sweep costs the subagent's context and returns the conclusion.
function hardRules(cfg, runtime) {
  const tests = cfg.branchTests
    ? `run ${cfg.branchTests} on every iteration, never the project's\nfull suite`
    : "run the project's own tests for what you changed, and say which — this project has\nconfigured no narrower command, so never run its full suite out of habit";
  return `Hard rules: never work on the main branch; ${tests}; everything you commit is English.
Keep your own context small — it is the whole cost of this session. Everything a Bash call prints
stays in front of every later request you make, so a repository-wide sweep at turn 10 is still
being paid for at turn 200. Start from the files named above. When you genuinely must search the
whole repository, ${runtime === 'codex' ? 'use a bounded search and keep only relevant results' : 'dispatch an Explore subagent and keep its conclusion, not its output'}. Read a
range (\`sed -n 120,180p\`) in preference to a whole file you only need part of.`;
}

const PROTOCOL = `Protocol: your conductor will message you a hello. SENDING A MESSAGE BACK DOES NOT WORK — a worker
session cannot resolve the conductor's address, measured three times, and a report sent that way
reaches nobody. Instead: STATE YOUR REPORT OR QUESTION AS YOUR FINAL MESSAGE AND STOP. The conductor
watches for your session leaving the working state and resumes you, and what you printed comes back
on that resume.`;

// The project's own rules, when offline mode keeps them out of the committed CLAUDE.md.
function projectRules(cfg) {
  const p = join(cfg.root, '.orchestra', 'CLAUDE-rules.md');
  if (!existsSync(p)) return null;
  try { return readFileSync(p, 'utf8').trim() || null; } catch { return null; }
}

// `execution` | `design` | `review`, decided by the row and never by the caller: a review row's
// `Design` is always `no`, and what makes it a review is BOTH halves of the shape the sweep writes
// — the standing `pr` roadmap slug and a `PR<number>` id. Either alone is a guess: a project is
// free to open a roadmap it happens to call `pr`, and a task called `PR2` on any other roadmap is
// an ordinary task.
export const modelFor = (row) => (row.roadmap === 'pr' && /^PR\d+$/.test(row.id) ? 'review'
  : row.design ? 'design' : 'execution');

// `model` overrides what the row implies, and the design->execution handoff is its one use: that
// row's `Design` stays `yes` — it is a fact about how the task was WRITTEN, not about which session
// is running now — so the second session on that worktree would be handed the design brief again,
// and told once more not to write implementation code.
export function renderBrief(cfg, row, { git, base = null, note = null, relaunch = false, handover = null, repo = null, model: forced = null, runtime = row.runtime ?? 'claude' } = {}) {
  if (!['claude', 'codex'].includes(runtime)) throw new Error(`unsupported brief runtime: ${runtime}`);
  const model = forced ?? modelFor(row);
  const parts = [];

  if (relaunch) {
    parts.push(`A previous session worked this task and died. Its worktree is intact. Before anything else: read
git log ${cfg.mainBranch}..${row.branch} and git status in this worktree, and continue from
what exists — do not restart the task from scratch.`);
  } else if (handover) {
    parts.push(`A previous session took this task to ${handover} turns and was retired to drop its accumulated context. It
committed its work and wrote where it had got to. Before anything else: read
git log ${cfg.mainBranch}..${row.branch}, git status in this worktree, and the note below.
Continue from there — do not restart, and do not re-read files the note tells you are already done.${note ? `\nIts note: ${note}` : ''}`);
  }

  parts.push(`Worker runtime: ${runtime}.`);

  if (model === 'review') {
    const pr = row.id.replace(/^PR/, '');
    parts.push(`You are reviewing pull request #${pr} on ${repo ?? '<repo>'}, in this worktree, checked out at the PR's own head.
Task ${row.key} — ${row.title}. Your roadmap excerpt, verbatim:
${excerptOf(row)}
Follow the pr-triage skill exactly; its hard rules are yours. Never publish anything on GitHub
except a PENDING review. Never merge, close, label or assign. Never write a direction principle the
maintainer did not state.
Before anything else: git fetch origin pull/${pr}/head, and say whether it has moved since ${base ?? '<base>'}.`);
  } else {
    // The orientation block sits BETWEEN the excerpt and the rules, not after them: `hardRules`
    // tells the worker to start from the files named above it, and a block that arrived below that
    // sentence would make it false.
    const orient = orientation(cfg, row, { git });
    parts.push(`You are a dev agent working ONLY in this worktree, on branch ${row.branch}.
Task ${row.key} — ${row.title}. Your roadmap excerpt, verbatim:
${excerptOf(row)}${orient.length ? `\n${orient.join('\n')}` : ''}
${hardRules(cfg, runtime)}`);
  }

  const rules = projectRules(cfg);
  if (rules) parts.push(rules);
  if (cfg.briefExtra) parts.push(cfg.briefExtra.trim());

  parts.push(`Write to me in ${cfg.language} — questions, reports, anything of yours that reaches me. That is not in
tension with the rule above: what you commit is English, what you say to me reaches one person on
one machine.`);

  parts.push(progressInstructions(row.key));
  parts.push(`Before returning a final report or question, call orchestra notify ${row.key}. It sends a wake event, not the report; your final message remains the report. If notification is unavailable, still return your final message and do not retry in a loop.`);

  parts.push(runtime === 'codex'
    ? 'Protocol: you are an independent native Codex task, not a conductor sub-agent. Work in this task and its assigned worktree. State your report or question as your FINAL MESSAGE and stop. The conductor reads it with wait_threads/read_thread and continues this same task with send_message_to_thread. Never start or resume Claude workers, and never write the conductor register.'
    : PROTOCOL);

  if (model === 'design') {
    parts.push(`This task's design is open. Use superpowers:brainstorming, then superpowers:writing-plans. Your
deliverable is the committed spec (${cfg.docs.specs}) and plan (${cfg.docs.plans}) on this branch, with a
recommended approach stated. Do not write implementation code. State your done-report as your final
message; your session ends there.`);
  } else if (model === 'review') {
    parts.push(`When this PR ships something a human reads or runs, start the dev server and report the port it
ACTUALLY bound plus its pid: the maintainer tests it themselves at the hands-on gate. If it has
somewhere of its own to be looked at — a preview deployment, a published report, the failing run —
report that URL too, named in plain words, and only if you have fetched and read it.
Record your verdict before you stop:
  orchestra pr log ${row.id.replace(/^PR/, '')} <verdict> --head <sha> --comment <id> --note "…"`);
  } else {
    parts.push(`Design question → state it and stop until answered. Built → say so; put it in front of me only
when told, with the project's own command, and report exactly how it is reached — the port you
ACTUALLY bound plus its pid if you started a server, otherwise the one command that shows the
change (servers are killed by pid here, never by pattern). You never merge, and whether your branch
needs a human look first is your conductor's call, not yours.`);
  }

  return `${parts.join('\n')}\n`;
}
