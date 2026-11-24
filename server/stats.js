// Delivery metrics computed from CodePipeline execution summaries.
// Works identically for live AWS data and the simulator.

const DAY = 86_400_000;
const TERMINAL = new Set(['Succeeded', 'Failed', 'Stopped', 'Superseded', 'Cancelled']);

export function durationMs(ex) {
  if (!ex.start) return null;
  const end = ex.end ?? (TERMINAL.has(ex.status) ? ex.updated : Date.now());
  return Math.max(0, new Date(end) - new Date(ex.start));
}

export function computeStats(executions, days = 14) {
  const now = Date.now();
  const since = now - days * DAY;
  const recent = executions.filter((e) => new Date(e.start).getTime() >= since);
  const finished = recent.filter((e) => e.status === 'Succeeded' || e.status === 'Failed');
  const succeeded = finished.filter((e) => e.status === 'Succeeded');
  const failed = finished.filter((e) => e.status === 'Failed');

  const durations = succeeded.map(durationMs).filter((d) => d != null);
  const avgDurationMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  // MTTR: time from a failed run finishing to the next successful run finishing.
  const chrono = [...finished].sort((a, b) => new Date(a.start) - new Date(b.start));
  const recoveries = [];
  let openFailure = null;
  for (const ex of chrono) {
    const end = new Date(ex.end ?? ex.updated).getTime();
    if (ex.status === 'Failed' && openFailure == null) openFailure = end;
    if (ex.status === 'Succeeded' && openFailure != null) {
      recoveries.push(end - openFailure);
      openFailure = null;
    }
  }
  const mttrMs = recoveries.length ? recoveries.reduce((a, b) => a + b, 0) / recoveries.length : null;

  // Daily buckets, oldest → newest.
  const daily = [];
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = startOfToday.getTime() - i * DAY;
    const dayEnd = dayStart + DAY;
    const inDay = recent.filter((e) => {
      const t = new Date(e.start).getTime();
      return t >= dayStart && t < dayEnd;
    });
    daily.push({
      date: new Date(dayStart).toISOString().slice(0, 10),
      succeeded: inDay.filter((e) => e.status === 'Succeeded').length,
      failed: inDay.filter((e) => e.status === 'Failed').length,
      other: inDay.filter((e) => e.status !== 'Succeeded' && e.status !== 'Failed').length,
    });
  }

  return {
    windowDays: days,
    total: recent.length,
    succeeded: succeeded.length,
    failed: failed.length,
    successRate: finished.length ? succeeded.length / finished.length : null,
    avgDurationMs,
    deploysPerDay: succeeded.length / days,
    mttrMs,
    daily,
    durations: chrono
      .slice(-20)
      .map((e) => ({ id: e.id, status: e.status, ms: durationMs(e) })),
  };
}
