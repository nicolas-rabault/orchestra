<!-- orchestra:claude-rules -->
## Working with orchestra

- **Work happens on a worktree, never on the main branch.** Branch a worktree from latest local
  main before touching anything; main is where work lands, never where it happens.
- **A dev agent never merges its own branch.** When a branch is ready, hand it to `merge_agent`,
  which lands it through `orchestra land <branch>` — one branch at a time, through the merge gate.
- **Run the tests your change affects while you work, and leave a run of the whole suite to the
  gate.** The gate runs it once per landing; running it on every iteration is redundant work paid
  by every agent sharing the machine.
- **What is committed is in English** — code, comments, commit messages, docs: whatever is written
  to be read later. Whatever is said between a person and an agent along the way can be any
  language.
- **Nothing that is committed names orchestra** — not a commit message, not a spec, not a plan, not
  a comment. The work is the project's; the tool that scheduled it is not part of the record. In
  offline mode the merge gate refuses a landing that breaks this, naming the file and line.
- **Consider `git config rerere.enabled true`** in a repository whose branches are rebased all
  day: the merge gate rebases every landing onto main, and rerere remembers how a conflict was
  resolved instead of asking the next rebase to re-fight it. A recommendation, not a rule this
  project enforces — nothing here refuses a landing because it is off.
