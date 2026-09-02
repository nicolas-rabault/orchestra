const pad = (s, n) => String(s).padEnd(n);

export function doctorText(cfg) {
  if (!cfg) return 'orchestra: no .orchestra/config.json here — this project has not opted in.\nRun `orchestra init` to set it up.\n';
  const rows = [
    ['name', cfg.name], ['id', cfg.id], ['mode', cfg.mode], ['root', cfg.root],
    ['language', cfg.language], ['mainBranch', cfg.mainBranch], ['worktrees', cfg.worktrees],
    ['roadmaps.drafts', cfg.roadmaps.drafts], ['roadmaps.published', cfg.roadmaps.published],
    ['branchTests', cfg.branchTests ?? '—'], ['gates', cfg.gates.map((g) => g.name).join(', ') || '—'],
    ['ledgers', cfg.ledgers.join(', ') || '—'], ['queue', cfg.queue ?? '—'],
    ['monitor.port', cfg.monitor.port], ['tickets.file', cfg.tickets.file],
  ];
  const lines = rows.map(([k, v]) =>
    `  ${pad(k, 20)} ${v}${cfg.defaulted.includes(k) ? '   (default)' : ''}`);
  const note = cfg.mode === 'offline'
    ? '\n  Offline mode: "is somebody already working on this" is answered for this machine only.\n  That question is the whole reason the online mode exists.\n'
    : '';
  return `orchestra — ${cfg.name}\n${lines.join('\n')}\n${note}`;
}

export const doctor = (cfg) => { process.stdout.write(doctorText(cfg)); };
