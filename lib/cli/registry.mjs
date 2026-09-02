// Every subcommand, in one table. `machine` marks the ones that answer without a project config —
// they are the exception to the off switch, and there are exactly three of them.
export const COMMANDS = new Map();

export const register = (name, { machine = false, run }) => COMMANDS.set(name, { machine, run });
