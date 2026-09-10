// The roadmap grammar's only reader. Pure: text in, task rows out — no git, no gh, no fs.
//
// It reports SHAPE errors (an unknown field, a field written twice, unclosed frontmatter) and
// stops there. Rule violations — a dep that resolves to nothing, a duplicate key, a branch that
// does not name its task — belong to lint.mjs, which needs context this file deliberately lacks.
// A shape error carries `field` and `task` alongside its human-readable `message` whenever it knows
// them, so a consumer that needs the fact (not the sentence) never has to parse the message back
// apart — reword the message here and no downstream rule breaks.
//
// docs/roadmap-format.md is the human-facing contract this file implements. The grammar exists
// because the same three fields were being written four different ways across five roadmaps, on
// one line, where prose could and did run into them.

export const FIELD_NAMES = ['Roadmap', 'Order', 'Deps', 'Touches', 'Branch', 'Design', 'Lane'];

// U+2014. The grammar's explicit "none" — never an empty value, so a missing field and an
// intentionally empty one can never be confused.
export const EMPTY = '—';

const HEADING = /^### (\S+) — (.+?)\s*$/;
const FIELD = /^- \*\*([A-Za-z]+)\*\*\s+(.+?)\s*$/;
const LEAD_IN = /^\*\*(Why|Acceptance|Scope)\.\*\*\s*(.*)$/;

const unquote = (s) => s.trim().replace(/^`|`$/g, '');
const list = (raw) => (raw === EMPTY ? [] : raw.split(',').map(unquote).filter(Boolean));

export function parseRoadmap(text, { source = '<input>' } = {}) {
  const lines = text.split('\n');
  const errors = [];
  const err = (line, message, extra = {}) => errors.push({ source, line, message, ...extra });

  let roadmap = null;
  // WHERE this roadmap publishes, when it is not the project's own mode. A shape error rather than
  // a lint rule: it is frontmatter grammar, like the unclosed `---` below, and a typo here would
  // otherwise publish a roadmap meant to stay on this machine to a public issue tracker.
  let destination = null;
  let i = 0;
  if (lines[0]?.trim() === '---') {
    let j = 1;
    while (j < lines.length && lines[j].trim() !== '---') {
      const m = /^([A-Za-z]+):\s*(.+?)\s*$/.exec(lines[j]);
      if (m && m[1] === 'roadmap') roadmap = m[2];
      if (m && m[1] === 'destination') {
        [, , destination] = m;
        if (destination !== 'local')
          err(j + 1, `unknown destination "${destination}" (known: local) — omit it to publish to the project's own mode`);
      }
      j += 1;
    }
    if (j >= lines.length) err(1, 'frontmatter is never closed');
    i = j + 1;
  }

  const raw = [];
  let cur = null;
  // Which paragraph ('why' | 'acceptance') is still open for continuation lines — reset whenever a
  // blank line, a field, or a new heading closes it, so a stray field-like line can never be
  // swallowed into the prose above it.
  let collecting = null;
  const close = () => { if (cur) raw.push(cur); cur = null; collecting = null; };

  for (; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNo = i + 1;
    const h = HEADING.exec(line);
    if (h) {
      close();
      cur = { id: h[1], title: h[2], line: lineNo, fields: {}, why: null, acceptance: null };
      continue;
    }
    if (!cur) continue;
    if (line.trim() === '') { collecting = null; continue; }
    const f = FIELD.exec(line);
    if (f) {
      collecting = null;
      const [, name, value] = f;
      if (!FIELD_NAMES.includes(name))
        err(lineNo, `unknown field "${name}" (known: ${FIELD_NAMES.join(', ')})`, { field: name, task: cur.id });
      else if (name in cur.fields)
        err(lineNo, `field "${name}" appears twice in ${cur.id}`, { field: name, task: cur.id });
      else cur.fields[name] = { raw: value, line: lineNo };
      continue;
    }
    const l = LEAD_IN.exec(line);
    if (l) {
      const key = l[1].toLowerCase();
      cur[key] = l[2].trim();
      collecting = key;
      continue;
    }
    if (collecting) cur[collecting] += `\n${line.trim()}`;
  }
  close();

  const tasks = raw.map((t) => {
    const get = (name) => t.fields[name]?.raw ?? null;
    const orNull = (name) => {
      const v = get(name);
      return v === null || v === EMPTY ? null : v;
    };
    const order = get('Order');
    const slug = orNull('Roadmap') ?? roadmap;
    const branchRaw = orNull('Branch');
    return {
      id: t.id,
      title: t.title,
      line: t.line,
      roadmap: slug,
      key: slug ? `${slug}/${t.id}` : null,
      order: order === null || order === EMPTY ? null : Number(order),
      deps: list(get('Deps') ?? EMPTY),
      touches: list(get('Touches') ?? EMPTY),
      branch: branchRaw ? unquote(branchRaw) : null,
      design: get('Design') === 'yes',
      lane: orNull('Lane'),
      ...(t.scope !== undefined ? { scope: t.scope } : {}),
      why: t.why,
      acceptance: t.acceptance,
      fields: t.fields,
    };
  });

  return { roadmap, destination, tasks, errors };
}
