// Every subcommand, in one table. `machine` marks the ones that answer without a project config —
// they are the exception to the off switch. Spec §3.1 names three of them (`init`, `doctor`,
// `instances`); all three are registered `machine: true` in `bin/orchestra`.
export const COMMANDS = new Map();

export const register = (name, { machine = false, run }) => COMMANDS.set(name, { machine, run });
