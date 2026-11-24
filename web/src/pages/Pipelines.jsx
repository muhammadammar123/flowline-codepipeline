import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Loader2, Search, Workflow, Lock } from 'lucide-react';
import { api, enc, usePoll, useNow, fmtDuration, fmtPct, timeAgo, shortSha, execDuration } from '../lib.js';
import { StatusBadge, Skeleton, Empty, useAction } from '../components/ui.jsx';
import { DurationSpark } from '../components/charts.jsx';
import { stageStatus } from '../components/FlowGraph.jsx';

const FILTERS = ['All', 'InProgress', 'Failed', 'Succeeded'];

export default function Pipelines() {
  const { data, error, refresh } = usePoll('/pipelines', 5000);
  const now = useNow(1000);
  const nav = useNavigate();
  const { busy, run } = useAction();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('All');

  const list = useMemo(
    () => (data ?? []).filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) && (filter === 'All' || p.latest?.status === filter)),
    [data, q, filter]
  );

  const release = (e, name) => {
    e.stopPropagation();
    run(`start-${name}`, () => api(`/pipelines/${enc(name)}/start`, { method: 'POST' }), (r) => `Started ${name} · ${r.executionId.slice(0, 8)}`).then(refresh);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Pipelines</h1>
          <p>Live stage status for each pipeline, from ListPipelines and GetPipelineState. Select one to open its flow view.</p>
        </div>
        <div className="actions">
          <div style={{ position: 'relative' }}>
            <Search size={16} className="faint" style={{ position: 'absolute', left: 11, top: 12 }} aria-hidden="true" />
            <input className="input" style={{ paddingLeft: 34, width: 240 }} placeholder="Filter by name" aria-label="Filter pipelines by name" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="tabs" role="tablist" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>{f === 'InProgress' ? 'Running' : f}</button>
            ))}
          </div>
        </div>
      </div>

      {error && !data && <div className="error-box">Couldn't list pipelines: {error}</div>}
      {!data && !error && <div className="grid pcards">{[...Array(4)].map((_, i) => <Skeleton key={i} h={230} />)}</div>}
      {data && list.length === 0 && (
        <div className="card"><Empty icon={Workflow} title={data.length ? 'No pipelines match' : 'No pipelines in this region'}>{data.length ? 'Clear the filter to see all pipelines.' : 'Open the Demo Lab to provision a ready-made pipeline in one click.'}</Empty></div>
      )}

      <div className="grid pcards">
        {list.map((p, idx) => {
          const rev = p.latest?.sourceRevisions?.[0];
          const locked = p.stages.filter((s) => s.inboundTransition?.enabled === false);
          return (
            <article
              key={p.name}
              className="card pcard fade-in"
              style={{ animationDelay: `${idx * 50}ms` }}
              onClick={() => nav(`/pipelines/${enc(p.name)}`)}
              onKeyDown={(e) => e.key === 'Enter' && nav(`/pipelines/${enc(p.name)}`)}
              tabIndex={0}
              aria-label={`Open pipeline ${p.name}`}
            >
              <div className="pcard-title">
                <h3 className="ellipsis">{p.name}</h3>
                <span className="chip">{p.pipelineType}</span>
                <div style={{ marginLeft: 'auto' }}><StatusBadge status={p.latest?.status} /></div>
              </div>
              <div>
                <div className="strip" aria-hidden="true">{p.stages.map((s) => <div key={s.name} className={`seg ${stageStatus(s)}`} />)}</div>
                <div className="strip-labels" style={{ marginTop: 5 }} aria-hidden="true">{p.stages.map((s) => <span key={s.name}>{s.name}</span>)}</div>
              </div>
              <div className="revision">
                {rev ? <><span className="sha">{shortSha(rev.revisionId)}</span><span className="ellipsis">{rev.summary}</span></> : <span className="faint">No source revision yet</span>}
              </div>
              {locked.length > 0 && (
                <div className="tiny" style={{ color: 'var(--amber)', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Lock size={13} /> Transition into {locked.map((s) => s.name).join(', ')} disabled
                </div>
              )}
              <DurationSpark durations={p.stats.durations} />
              <div className="pcard-meta">
                <div><div className="v tnum">{fmtPct(p.stats.successRate)}</div><div className="l">success · 14d</div></div>
                <div><div className="v tnum">{fmtDuration(p.stats.avgDurationMs)}</div><div className="l">avg duration</div></div>
                <div><div className="v tnum">{p.latest ? fmtDuration(execDuration(p.latest, now)) : '—'}</div><div className="l">last run · {timeAgo(p.latest?.start, now)}</div></div>
              </div>
              <div className="row">
                <span className="tiny faint">{p.executionMode} mode · v{p.version}</span>
                <button className="btn primary sm" style={{ marginLeft: 'auto' }} onClick={(e) => release(e, p.name)} disabled={busy === `start-${p.name}`}>
                  {busy === `start-${p.name}` ? <Loader2 size={14} className="spin" /> : <Play size={14} />} Release change
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
