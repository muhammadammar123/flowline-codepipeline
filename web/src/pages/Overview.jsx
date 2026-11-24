import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, Timer, TrendingUp, ShieldCheck, Inbox, Gauge, Hand, ArrowRight, Workflow } from 'lucide-react';
import { useApp } from '../context.js';
import { fmtDuration, fmtPct, timeAgo, useNow, execDuration } from '../lib.js';
import { StatusBadge, StatusIcon, Skeleton, Empty, useToast } from '../components/ui.jsx';
import { DailyBars, Ring } from '../components/charts.jsx';
import ApprovalModal from '../components/ApprovalModal.jsx';

function Kpi({ icon: Icon, label, value, foot, accent }) {
  return (
    <div className={`card kpi fade-in ${accent ? 'accent' : ''}`}>
      <div className="kpi-label"><Icon size={15} aria-hidden="true" /> {label}</div>
      <div className="kpi-value tnum">{value}</div>
      <div className="kpi-foot">{foot}</div>
    </div>
  );
}

export default function Overview() {
  const { overview } = useApp();
  const { data, error, refresh } = overview;
  const now = useNow(1000);
  const nav = useNavigate();
  const toast = useToast();
  const [reviewing, setReviewing] = useState(null);

  if (error && !data) return <div className="error-box">Couldn't load overview: {error}</div>;
  if (!data)
    return (
      <div className="stack">
        <Skeleton h={34} w={260} />
        <div className="grid kpis">{[...Array(6)].map((_, i) => <Skeleton key={i} h={104} />)}</div>
        <div className="grid two-col"><Skeleton h={300} /><Skeleton h={300} /></div>
      </div>
    );

  const s = data.stats;
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Delivery overview</h1>
          <p>Every pipeline in the account, measured over the last {s.windowDays} days. Metrics follow DORA definitions, computed from CodePipeline execution history.</p>
        </div>
        <div className="actions">
          <Link to="/lab" className="btn">Try the Demo Lab</Link>
          <Link to="/pipelines" className="btn primary"><Workflow size={16} /> All pipelines</Link>
        </div>
      </div>

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <Kpi icon={Workflow} label="Pipelines" value={data.pipelines.length} foot={`${data.running} running now`} />
        <Kpi icon={TrendingUp} label="Deploy frequency" value={`${s.deploysPerDay.toFixed(1)}/d`} foot={`${s.succeeded} successful runs`} />
        <Kpi icon={ShieldCheck} label="Success rate" value={fmtPct(s.successRate)} foot={`${s.failed} failed of ${s.succeeded + s.failed}`} />
        <Kpi icon={Timer} label="Lead time (avg run)" value={fmtDuration(s.avgDurationMs)} foot="Source → last stage" />
        <Kpi icon={Gauge} label="MTTR" value={fmtDuration(s.mttrMs)} foot="Failure → next green run" />
        <Kpi icon={Inbox} label="Awaiting approval" value={data.approvals.length} foot={data.approvals.length ? 'Release gates need you' : 'Inbox zero'} accent={data.approvals.length > 0} />
      </div>

      {data.approvals.length > 0 && (
        <div className="card fade-in" style={{ marginBottom: 16, borderColor: 'rgba(245,158,11,.45)' }}>
          <div className="card-head">
            <Hand size={18} className="c-Approval" />
            <h2>Release gates waiting on you</h2>
            <div className="right"><Link to="/approvals" className="btn sm ghost">Open inbox <ArrowRight size={14} /></Link></div>
          </div>
          <ul className="feed">
            {data.approvals.slice(0, 3).map((a) => (
              <li key={a.token}>
                <StatusIcon status="Approval" />
                <div style={{ minWidth: 0 }}>
                  <div className="title ellipsis"><span className="mono">{a.pipeline}</span> › {a.stage}</div>
                  <div className="meta ellipsis">{a.revision?.summary ?? a.customData} · waiting {timeAgo(a.since, now).replace(' ago', '')}</div>
                </div>
                <button className="btn warn sm" onClick={() => setReviewing(a)}>Review</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid two-col" style={{ marginBottom: 16 }}>
        <section className="card">
          <div className="card-head">
            <Activity size={17} />
            <h2>Executions per day</h2>
            <div className="right legend">
              <span><i style={{ background: 'var(--green)' }} />Succeeded</span>
              <span><i style={{ background: 'repeating-linear-gradient(45deg,var(--red) 0 3px,#b91c1c 3px 6px)' }} />Failed</span>
              <span className="hide-sm"><i style={{ background: 'var(--slate)' }} />Other</span>
            </div>
          </div>
          <div className="card-pad"><DailyBars daily={s.daily} /></div>
        </section>
        <section className="card">
          <div className="card-head"><ShieldCheck size={17} /><h2>Pipeline health</h2></div>
          <div className="card-pad stack" style={{ gap: 12 }}>
            {data.pipelines.map((p) => (
              <button key={p.name} className="btn ghost" style={{ justifyContent: 'flex-start', height: 'auto', padding: '8px 10px', gap: 12, textAlign: 'left' }} onClick={() => nav(`/pipelines/${encodeURIComponent(p.name)}`)}>
                <Ring value={p.stats.successRate} size={44} stroke={5} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="mono ellipsis" style={{ fontWeight: 600, color: 'var(--fg)' }}>{p.name}</div>
                  <div className="strip" style={{ marginTop: 6 }} aria-hidden="true">
                    {p.stages.map((st) => <div key={st.name} className={`seg ${st.status ?? ''}`} />)}
                  </div>
                </div>
                <StatusIcon status={p.latest?.status ?? 'Idle'} />
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head"><Activity size={17} /><h2>Recent activity</h2><span className="sub">across all pipelines</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Status</th><th>Pipeline</th><th className="hide-sm">Change</th><th>Duration</th><th className="hide-sm">Trigger</th><th>Updated</th></tr></thead>
            <tbody>
              {data.feed.length === 0 && (
                <tr><td colSpan={6}><Empty icon={Workflow} title="No executions yet">Release a change or open the Demo Lab to create your first run.</Empty></td></tr>
              )}
              {data.feed.map((e) => (
                <tr key={e.id} className="clickable" onClick={() => nav(`/pipelines/${encodeURIComponent(e.pipeline)}?exec=${e.id}`)}>
                  <td><StatusBadge status={e.status} /></td>
                  <td className="mono small">{e.pipeline}</td>
                  <td className="hide-sm" style={{ maxWidth: 360 }}><div className="ellipsis small">{e.sourceRevisions?.[0]?.summary ?? '—'}</div></td>
                  <td className="mono small tnum">{fmtDuration(execDuration(e, now))}</td>
                  <td className="hide-sm small muted">{e.trigger?.type ?? '—'}</td>
                  <td className="small muted">{timeAgo(e.updated, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {reviewing && <ApprovalModal approval={reviewing} onClose={() => setReviewing(null)} onDone={refresh} toast={toast} />}
    </>
  );
}
