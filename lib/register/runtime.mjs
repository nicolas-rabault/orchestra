// Roadmap assignments choose future workers. A live session keeps its original runtime.
export const RUNTIMES = ['claude', 'codex'];
export const roadmapSlug = (row) => row.roadmap ?? String(row.key ?? row.id ?? '').split('/')[0];
export function workerRuntime(row, { roadmapRuntimes = {}, conductorRuntime = 'claude' } = {}) {
  const runtime = row.session ? row.runtime ?? 'claude'
    : (Object.hasOwn(roadmapRuntimes, roadmapSlug(row)) ? roadmapRuntimes[roadmapSlug(row)] : conductorRuntime);
  if (!RUNTIMES.includes(runtime)) throw new Error(`unsupported worker runtime: ${runtime}`);
  return runtime;
}
