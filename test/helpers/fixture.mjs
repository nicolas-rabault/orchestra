// A throwaway git repository with an .orchestra/config.json, built in a temp directory. Every
// suite that touches git, the register or a store uses this rather than the developer's own tree.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeRepo({ mode = 'offline', config = {}, name = 'fixture' } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orchestra-')));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture User');
  git('config', 'user.email', 'fixture@example.com');
  mkdirSync(join(root, '.orchestra'), { recursive: true });
  writeFileSync(
    join(root, '.orchestra', 'config.json'),
    `${JSON.stringify({ name, mode, ...config }, null, 2)}\n`,
  );
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');
  return { root, git, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// One valid task, in the grammar, used by the parse, lint, store and board suites.
export const ROADMAP = `---
roadmap: demo
---

Demo roadmap prose.

### D1 — First thing

- **Roadmap** demo
- **Order** 1
- **Deps** —
- **Touches** \`README.md\`
- **Branch** \`demo/d1-first-thing\`
- **Design** no
- **Lane** —

**Why.** The player sees the first thing.

**Acceptance.** A test asserts it.
`;

// A pull-request review task, in the grammar, for the local destination's suites. Hand-written
// rather than derived from ROADMAP: a task's own `Roadmap` field must agree with the frontmatter
// and its branch's last segment must start with its lowercased id.
export const PR_ROADMAP = `---
roadmap: pr
destination: local
---

Open pull requests, swept 2026-09-07.

### PR91 — merge: bump npm_and_yarn group across 1 directory

- **Roadmap** pr
- **Order** 1
- **Deps** —
- **Touches** \`README.md\`
- **Branch** \`pr91-review\`
- **Design** no
- **Lane** —

**Why.** Dependabot, green CI, scoped bump.

**Acceptance.** PR #91 is merged on GitHub and \`git log main\` carries its commit subjects.
`;
