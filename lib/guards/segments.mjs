// The shell-splitting rule, shared by every command guard (`guard-main-commit` here, plus
// `guard-full-suite`, `guard-draft` and `guard-claim` later): where one shell command ends and
// the next begins, and how to read a leading `NAME=value` assignment off the front of a segment
// without the rest of a guard doing string work of its own.
//
// A backslash-newline is a shell line CONTINUATION, not a command boundary: an ordinary
// multi-line `git -C <path> \` / `  commit -m x` is one shell command split across two lines, and
// a plain `\n` split would cut it into two segments that neither one alone matches — silently
// letting a main-checkout commit through. A shell removes the backslash and the newline together,
// as one unit, so this does the same, joining with nothing (not a space): `wor\<newline>ktree`
// becomes `worktree`, never `wor ktree`. Splitting is then on `\n`, `;`, `&&`, `||` and `|`.
export function segments(command) {
  const joined = String(command).replace(/\\\r?\n/g, '');
  return joined.split(/\n|;|&&|\|\||\|/).map((s) => s.trim()).filter(Boolean);
}

// A leading `NAME=value` token, repeated: `FOO=1 BAR=2 git commit` is `git commit` prefixed by
// two assignments, and a prefix must not be able to hide the command word from a guard that only
// looks at the first token. Matched on whitespace alone, like the shell itself does for an
// unquoted assignment — a quoted value (`FOO="a b" cmd`) is not handled, the same limitation the
// ported source guards carried.
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(\S*)\s*/;

// What is left of a segment after every leading assignment is stripped, so a guard can look at
// its first REAL token (the command word) without tripping over an env prefix.
export function stripEnv(segment) {
  let s = String(segment).trimStart();
  for (let m = s.match(ASSIGNMENT); m; m = s.match(ASSIGNMENT)) s = s.slice(m[0].length);
  return s;
}

// Whether `segment` carries a leading `name=1` assignment — the override idiom every guard here
// reads (`ORCHESTRA_GATE=1`, `ORCHESTRA_FULL_SUITE=1`): exactly `1`, not merely truthy, and only
// among the LEADING assignments, never an argument further into the command that happens to look
// like one.
export function envAssigned(segment, name) {
  let s = String(segment).trimStart();
  for (let m = s.match(ASSIGNMENT); m; m = s.match(ASSIGNMENT)) {
    if (m[1] === name && m[2] === '1') return true;
    s = s.slice(m[0].length);
  }
  return false;
}

// A shell argument's surrounding quotes (`-b "my-branch"`, `git add ".orchestra/drafts/foo.md"`),
// stripped once here rather than reimplemented per guard: `guard-claim` and `guard-draft` both
// pull a value off a command line and both need this, and two identical one-line copies is exactly
// the shape that starts disagreeing later.
export const stripQuotes = (s) => s.replace(/^['"]|['"]$/g, '');
