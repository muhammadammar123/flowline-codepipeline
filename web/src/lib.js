import { useCallback, useEffect, useRef, useState } from 'react';

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}
export const enc = encodeURIComponent;

/** Poll an endpoint; pauses while the tab is hidden. */
export function usePoll(path, intervalMs = 4000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const retry = useRef(null);

  const refresh = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api(path);
      if (alive.current) { setData(d); setError(null); }
    } catch (e) {
      if (alive.current) {
        setError(e.message);
        retry.current = setTimeout(() => { if (alive.current) refresh(); }, 2000); // recover quickly after a server restart
      }
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    refresh();
    if (!intervalMs) return () => { alive.current = false; clearTimeout(retry.current); };
    const id = setInterval(() => { if (!document.hidden) refresh(); }, intervalMs);
    const onVis = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive.current = false; clearInterval(id); clearTimeout(retry.current); document.removeEventListener('visibilitychange', onVis); };
  }, [refresh, intervalMs]);

  return { data, error, loading, refresh, setData };
}

/** Re-render every `ms` so relative times and running durations stay fresh. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

export function fmtDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function timeAgo(t, now = Date.now()) {
  if (!t) return '—';
  const s = Math.max(0, Math.round((now - new Date(t).getTime()) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

export const fmtPct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
export const shortId = (id) => (id ? id.slice(0, 8) : '—');
export const shortSha = (sha) => (sha ? sha.replace(/^.*\//, '').slice(0, 7) : '—');

export function execDuration(ex, now = Date.now()) {
  if (!ex?.start) return null;
  const end = ex.end ? new Date(ex.end).getTime() : ex.status === 'InProgress' ? now : new Date(ex.updated).getTime();
  return end - new Date(ex.start).getTime();
}

/** Visual status for an action/stage: approvals waiting on a human read as "Approval". */
export function visualStatus(status, category) {
  if (!status) return 'Idle';
  if (status === 'InProgress' && category === 'Approval') return 'Approval';
  return status;
}

export const STATUS_LABEL = {
  Succeeded: 'Succeeded',
  Failed: 'Failed',
  InProgress: 'In progress',
  Approval: 'Awaiting approval',
  Waiting: 'Waiting',
  Stopped: 'Stopped',
  Stopping: 'Stopping',
  Abandoned: 'Abandoned',
  Superseded: 'Superseded',
  Cancelled: 'Cancelled',
  Idle: "Didn't run",
};
