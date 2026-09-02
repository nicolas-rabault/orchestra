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
