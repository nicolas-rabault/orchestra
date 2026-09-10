// Structured input to a bounded, reproducible draft. No store or network access.
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { renderTaskBlock } from '../store/github/issues.mjs';
import { parseRoadmap } from './parse.mjs';
import { lintRoadmap, formatViolations } from './lint.mjs';

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const id = /^[A-Za-z][A-Za-z0-9]{0,11}$/;
const fail = message => { throw new Error(`draft: ${message}`); };
function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${label}: unknown key "${key}"`);
}
function line(value, label) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n\x00-\x1f\x7f]/.test(value)) fail(`${label} must be non-empty, single-line text`);
  return value.trim();
}
function strings(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value.map(v => line(v, label));
}
function touch(value) {
  const path = value.startsWith('new ') ? value.slice(4) : value;
  if (!path || isAbsolute(path) || /[\\`,:]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..'))
    fail(`Touches must name paths inside the repository: ${value}`);
  return value;
}

export function renderDraft(input, { fileExists = () => true } = {}) {
  object(input, ['roadmap', 'intent', 'outcome', 'excluded', 'tasks', 'destination'], 'input');
  const roadmap = line(input.roadmap, 'roadmap');
  if (roadmap.length > 64 || !slug.test(roadmap)) fail('roadmap must be a lowercase slug (maximum 64 characters)');
  if (input.destination !== undefined && input.destination !== 'local') fail('destination must be local or omitted');
  const intent = line(input.intent, 'intent');
  const outcome = line(input.outcome, 'outcome');
  const excluded = strings(input.excluded, 'excluded');
  if (!Array.isArray(input.tasks) || input.tasks.length < 1 || input.tasks.length > 8) fail('tasks must contain 1–8 tasks; narrow or split the request');
  const tasks = input.tasks.map((t, index) => {
    object(t, ['id', 'title', 'why', 'acceptance', 'scope', 'touches', 'deps', 'design', 'lane'], `tasks[${index}]`);
    if (typeof t.id !== 'string' || !id.test(t.id)) fail('task id must start with a letter and contain at most 12 alphanumeric characters');
    const why = line(t.why, 'why'), acceptance = line(t.acceptance, 'acceptance'), scope = line(t.scope, 'scope');
    if (`${why} ${acceptance} ${scope}`.split(/\s+/u).length > 180) fail(`${t.id}: why + acceptance + scope exceed 180 words`);
    const touches = strings(t.touches === undefined ? [] : t.touches, 'touches').map(touch);
    if (touches.length > 5) fail(`${t.id}: at most 5 Touches; narrow or split the task`);
    const deps = strings(t.deps === undefined ? [] : t.deps, 'deps');
    for (const dep of deps) if (!(id.test(dep) || /^[a-z0-9]+(?:-[a-z0-9]+)*\/[A-Za-z][A-Za-z0-9]{0,11}$/.test(dep))) fail(`invalid dependency: ${dep}`);
    if (t.design !== undefined && typeof t.design !== 'boolean') fail('design must be a boolean');
    const lane = t.lane === undefined ? null : line(t.lane, 'lane');
    if (lane !== null && !slug.test(lane)) fail('lane must be a lowercase slug');
    return { id: t.id, roadmap, title: line(t.title, 'title'), order: index + 1, branch: `codex/${roadmap}/${t.id.toLowerCase()}-task`, why, acceptance, scope, touches, deps, design: t.design ?? false, lane };
  });
  if (new Set(tasks.map(t => t.id.toLowerCase())).size !== tasks.length) fail('task ids must be unique, ignoring case');
  const text = [
    '---', `roadmap: ${roadmap}`, ...(input.destination ? ['destination: local'] : []), '---', '',
    `**Intent.** ${intent}`, '', `**Outcome.** ${outcome}`, '',
    `**Excluded.** ${excluded.length ? excluded.join('; ') : '—'}`, '',
    ...tasks.map(renderTaskBlock), '',
  ].join('\n');
  const errors = lintRoadmap(parseRoadmap(text), { fileExists }).filter(v => v.level === 'error');
  if (errors.length) fail(formatViolations(errors).join('\n'));
  return text;
}

export function writeDraft(cfg, input) {
  const root = realpathSync(cfg.root);
  const inside = path => {
    let existing = path;
    while (!existsSync(existing)) existing = dirname(existing);
    const rel = relative(root, realpathSync(existing));
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) fail(`path leaves the repository: ${path}`);
  };
  const text = renderDraft(input, { fileExists: path => existsSync(join(root, path)) });
  for (const t of input.tasks) for (const p of t.touches ?? []) inside(resolve(root, p.replace(/^new /, '')));
  const path = resolve(root, cfg.roadmaps.drafts, `${input.roadmap}.md`);
  inside(path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { flag: 'wx' });
  return path;
}
