// Shared by the scheduler, brief renderer, transports and monitor. No runtime discovery here.
export const MODEL_DEFAULTS = {
  claudeExecution: 'sonnet', claudeDesign: 'opus', claudeReview: 'sonnet',
  codexExecution: null, codexDesign: null, codexReview: null,
};
export const THINKING_DEFAULTS = {
  claudeExecution: 'medium', claudeDesign: 'high', claudeReview: 'medium',
  codexExecution: null, codexDesign: null, codexReview: null,
};
export const MAX_AUTO_RESUMES = 3;
export function workerRole(row) {
  const [slug, id] = String(row.key ?? row.id ?? '').includes('/')
    ? String(row.key ?? row.id).split('/') : [row.roadmap, row.id];
  return slug === 'pr' && /^PR\d+$/.test(id) ? 'review' : row.design ? 'design' : 'execution';
}
export function workerSelection(cfg, row, runtime, role = workerRole(row)) {
  if (!['claude', 'codex'].includes(runtime)) throw new Error(`unsupported worker runtime: ${runtime}`);
  if (!['execution', 'design', 'review'].includes(role)) throw new Error(`unsupported worker role: ${role}`);
  const key = runtime + role[0].toUpperCase() + role.slice(1);
  return { role, model: cfg.workerModels?.[key] ?? MODEL_DEFAULTS[key],
    thinking: cfg.workerThinking?.[key] ?? THINKING_DEFAULTS[key] };
}
export const resumeLimit = (row, max = MAX_AUTO_RESUMES) => (row.autoResumes ?? 0) >= max;
