import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo } from './helpers/fixture.mjs';
import { loadConfig } from '../lib/config.mjs';
import { roadmapCommand } from '../lib/cli/roadmap.mjs';
import { renderDraft } from '../lib/roadmap/draft.mjs';
import { parseRoadmap } from '../lib/roadmap/parse.mjs';

const repos = [];
after(() => repos.forEach(r => r.cleanup()));
const task = () => ({ id: 'C1', title: 'Copy link', why: 'Users can copy the link.', acceptance: 'Click once; the clipboard contains the current URL.', scope: 'Only the existing screen. Stop after the clipboard check.' });
const input = () => ({ roadmap: 'copy-link', intent: 'Add a copy button.', outcome: 'Copy the current link.', excluded: ['Sharing service'], tasks: [task()] });

test('draft renders deterministically with defaults, scope and forward dependencies', () => {
  const data = input();
  data.tasks[0].deps = ['C2'];
  data.tasks.push({ ...task(), id: 'C2', title: 'Prepare link', touches: ['new src/link.js'] });
  const text = renderDraft(data);
  assert.equal(text, renderDraft(data));
  const parsed = parseRoadmap(text);
  assert.equal(parsed.tasks.length, 2);
  assert.equal(parsed.tasks[0].order, 1);
  assert.equal(parsed.tasks[0].branch, 'codex/copy-link/c1-task');
  assert.equal(parsed.tasks[0].design, false);
  assert.equal(parsed.tasks[0].scope, data.tasks[0].scope);
  assert.match(text, /\*\*Scope\.\*\* Only the existing screen/);
});

test('rejects malformed and overgrown inputs before rendering', () => {
  for (const mutate of [
    d => { d.extra = true; }, d => { d.roadmap = '../escape'; },
    d => { d.tasks = []; }, d => { d.tasks = Array.from({ length: 9 }, task); },
    d => { d.tasks[0].id = 'C-1'; }, d => { d.tasks[0].title += '\n### X — injected'; },
    d => { d.tasks[0].scope = ''; }, d => { d.tasks[0].touches = null; }, d => { d.tasks[0].deps = null; }, d => { d.tasks[0].design = 'no'; },
    d => { d.tasks[0].acceptance = 'word '.repeat(181); },
    d => { d.tasks[0].touches = Array(6).fill('README.md'); },
    d => { d.tasks[0].touches = ['../secret']; }, d => { d.tasks[0].touches = ['/tmp/secret']; },
    d => { d.tasks[0].touches = ['new ../secret']; }, d => { d.tasks[0].touches = ['src/a,b']; },
    d => { d.tasks[0].deps = ['missing']; }, d => { d.tasks[0].order = 4; },
    d => { d.tasks.push(task()); }, d => { d.excluded = 'none'; },
    d => { d.destination = 'online'; }, d => { d.tasks[0].why = 'Text\n**Acceptance.** injected'; },
  ]) {
    const data = input(); mutate(data);
    assert.throws(() => renderDraft(data), undefined, JSON.stringify(data));
  }
});

for (const mode of ['offline', 'online']) test(`CLI ${mode}: writes only a draft and refuses overwrite`, () => {
  const r = makeRepo({ mode }); repos.push(r);
  const cfg = loadConfig(r.root);
  const file = join(r.root, 'input.json');
  writeFileSync(file, JSON.stringify({ ...input(), destination: 'local' }));
  const deps = new Proxy({}, { get() { throw new Error('network/store access forbidden'); } });
  roadmapCommand({ cfg, args: ['draft', file], deps });
  const path = join(r.root, cfg.roadmaps.drafts, 'copy-link.md');
  assert.match(readFileSync(path, 'utf8'), /destination: local/);
  assert.equal(existsSync(join(r.root, cfg.roadmaps.published, 'copy-link.md')), false);
  assert.throws(() => roadmapCommand({ cfg, args: ['draft', file], deps }), /exist/i);
  assert.throws(() => roadmapCommand({ cfg, args: ['draft', file, 'extra'], deps }), /usage/);
  const escaped = input(); escaped.roadmap = 'escape'; escaped.tasks[0].touches = ['new external/file'];
  symlinkSync('/tmp', join(r.root, 'external'));
  writeFileSync(file, JSON.stringify(escaped));
  assert.throws(() => roadmapCommand({ cfg, args: ['draft', file], deps }), /repository/);
});
