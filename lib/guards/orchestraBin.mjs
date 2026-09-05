// Where `bin/orchestra` sits, relative to this plugin's own layout on disk — a fact about the
// plugin, not about any one hook, so it is resolved once, here, rather than once per hook that
// needs to shell out to the CLI (`guard-claim` and `lint-roadmap` both do). Resolved from THIS
// module's own file location (`lib/guards/`, two levels below the plugin root, beside `bin/`),
// never from an environment variable — `CLAUDE_PLUGIN_ROOT` is not guaranteed to be set in a
// hook's environment.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ORCHESTRA_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'orchestra');
