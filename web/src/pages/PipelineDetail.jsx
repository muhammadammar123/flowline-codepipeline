import { useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { Play, StopCircle, Loader2, GitCommit, Timer, ShieldCheck, Gauge, TrendingUp, ArrowLeft, Workflow, ExternalLink } from 'lucide-react';
import { api, enc, usePoll, useNow, fmtDuration, fmtPct, timeAgo, shortSha, shortId, execDuration } from '../lib.js';
import { StatusBadge, Skeleton, Empty, Modal, useAction, useToast } from '../components/ui.jsx';
import FlowGraph from '../components/FlowGraph.jsx';
import Waterfall from '../components/Waterfall.jsx';
import LogDrawer from '../components/LogDrawer.jsx';
import ApprovalModal from '../components/ApprovalModal.jsx';
import { DurationSpark } from '../components/charts.jsx';

export default function PipelineDetail() {
  const { name } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: p, error, refresh } = usePoll(`/pipelines/${enc(name)}`, 3000);
  const now = useNow(1000);
  const toast = useToast();
  const { busy, run } = useAction();
  const [approval, setApproval] = useState(null);
  const [logs, setLogs] = useState(null);
  const [gate, setGate] = useState(null);
  const [gateReason, setGateReason] = useState('');
  const [stopping, setStopping] = useState(false);
  const [abandon, setAbandon] = useState(false);

  const selectedId = params.get('exec') ?? p?.executions?.[0]?.id;
  const selected = p?.executions?.find((e) => e.id === selectedId) ?? p?.executions?.[0];
  const timeline = usePoll(selected ? `/pipelines/${enc(name)}/executions/${selected.id}` : null, selected?.status === 'InProgress' ? 3000 : 0);

  if (error && !p)
    return (
      <div className="stack">
        <Link to="/pipelines" className="btn ghost" style={{ width: 'fit-content' }}><ArrowLeft size={16} /> Pipelines</Link>
        <div className="error-box">Couldn't load {name}: {error}</div>
      </div>
    );
  if (!p) return <div className="stack"><Skeleton h={40} w={320} /><Skeleton h={340} /><Skeleton h={240} /></div>;

  const latest = p.executions[0];
  const running = p.executions.filter((e) => e.status === 'InProgress');
  const after = () => { refresh(); timeline.refresh(); };

  const start = () => run('start', () => api(`/pipelines/${enc(name)}/start`, { method: 'POST' }), (r) => `Release started · ${shortId(r.executionId)}`).then((r) => { if (r) setParams({}); after(); });
  const stop = () =>
    run('stop', () => api(`/pipelines/${enc(name)}/executions/${running[0].id}/stop`, { method: 'POST', body: { abandon } }), abandon ? 'Execution abandoned' : 'Stopping after in-flight actions finish').then(() => { setStopping(false); after(); });
  const retry = (stage) =>
    run(`retry-${stage.name}`, () => api(`/pipelines/${enc(name)}/stages/${enc(stage.name)}/retry`, { method: 'POST', body: { executionId: stage.latest.executionId } }), `Retrying failed actions in ${stage.name}`).then(after);
  const applyGate = () => {
    const enabled = gate.inboundTransition?.enabled === false;
    run(`gate-${gate.name}`, () => api(`/pipelines/${enc(name)}/stages/${enc(gate.name)}/transition`, { method: 'POST', body: { enabled, reason: gateReason } }), enabled ? `Transition into ${gate.name} enabled` : `Transition into ${gate.name} disabled`).then(() => { setGate(null); setGateReason(''); after(); });
  };

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <h1 className="page-title mono ellipsis">{p.name}</h1>
            <StatusBadge status={latest?.status} />
            <span className="chip">{p.pipelineType}</span>
            <span className="chip">{p.executionMode}</span>
            <span className="chip">v{p.version}</span>
          </div>
          <p className="small">
            Created {timeAgo(p.created, now)} · last edited {timeAgo(p.updated, now)}
            {p.arn && <> · <span className="mono tiny">{p.arn}</span></>}
          </p>
        </div>
        <div className="actions">
          {running.length > 0 && (
            <button className="btn danger" onClick={() => setStopping(true)}><StopCircle size={16} /> Stop run</button>
          )}
          <button className="btn primary" onClick={start} disabled={busy === 'start'}>
            {busy === 'start' ? <Loader2 size={16} className="spin" /> : <Play size={16} />} Release change
          </button>
        </div>
      </div>

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <div className="card kpi"><div className="kpi-label"><ShieldCheck size={15} /> Success rate</div><div className="kpi-value">{fmtPct(p.stats.successRate)}</div><div className="kpi-foot">{p.stats.succeeded} ok · {p.stats.failed} failed</div></div>
        <div className="card kpi"><div className="kpi-label"><Timer size={15} /> Avg duration</div><div className="kpi-value">{fmtDuration(p.stats.avgDurationMs)}</div><div className="kpi-foot">successful runs</div></div>
        <div className="card kpi"><div className="kpi-label"><TrendingUp size={15} /> Deploys / day</div><div className="kpi-value">{p.stats.deploysPerDay.toFixed(1)}</div><div className="kpi-foot">last 14 days</div></div>
        <div className="card kpi"><div className="kpi-label"><Gauge size={15} /> MTTR</div><div className="kpi-value">{fmtDuration(p.stats.mttrMs)}</div><div className="kpi-foot">failure → recovery</div></div>
        <div className="card kpi" style={{ gridColumn: 'span 2' }}><div className="kpi-label">Duration of last 20 runs</div><DurationSpark durations={p.stats.durations} height={46} /></div>
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <Workflow size={17} />
          <h2>Pipeline flow</h2>
          <span className="sub hide-sm">Latest state per stage · lock buttons toggle stage transitions</span>
          <div className="right">{running.length > 0 && <span className="chip" style={{ color: '#93c5fd' }}><span className="dot pulse" /> live</span>}</div>
        </div>
        <FlowGraph
          pipeline={p}
          now={now}
          busy={busy}
          onApprove={(stage, a) => setApproval({ pipeline: p.name, stage: stage.name, action: a.name, token: a.token, customData: a.configuration?.CustomData, revision: p.executions.find((e) => e.id === a.pipelineExecutionId)?.sourceRevisions?.[0] })}
          onRetry={retry}
          onGate={(stage) => { setGate(stage); setGateReason(''); }}
          onLogs={(stage, a) => setLogs({ buildId: a.externalExecutionId, title: `${stage.name} / ${a.name}` })}
        />
      </section>

      <div className="grid two-col">
        <section className="card">
          <div className="card-head">
            <Timer size={17} />
            <h2>Execution timeline</h2>
            {selected && <span className="sub mono">{shortId(selected.id)}</span>}
            <div className="right">{selected && <StatusBadge status={selected.status} />}</div>
          </div>
          <div className="card-pad stack">
            {selected ? (
              <>
                <div className="row wrap small muted" style={{ gap: 16 }}>
                  <span><GitCommit size={14} style={{ verticalAlign: -2 }} /> {selected.sourceRevisions?.[0]?.summary ?? 'No source summary'}</span>
                  <span className="mono">{fmtDuration(execDuration(selected, now))}</span>
                  <span>{selected.trigger?.type}{selected.trigger?.detail ? ` · ${selected.trigger.detail}` : ''}</span>
                </div>
                {selected.statusSummary && <div className="callout warn small">{selected.statusSummary}</div>}
                {timeline.data ? (
                  <Waterfall actions={timeline.data} execution={selected} now={now} />
                ) : timeline.error ? (
                  <div className="error-box">{timeline.error}</div>
                ) : (
                  <div className="stack" style={{ gap: 8 }}>{[...Array(5)].map((_, i) => <Skeleton key={i} h={20} />)}</div>
                )}
                {timeline.data?.some((a) => a.provider === 'CodeBuild' && a.externalExecutionId) && (
                  <div className="row wrap">
                    {timeline.data.filter((a) => a.provider === 'CodeBuild' && a.externalExecutionId).map((a) => (
                      <button key={a.actionExecutionId} className="btn sm" onClick={() => setLogs({ buildId: a.externalExecutionId, title: `${a.stage} / ${a.action}` })}>Logs · {a.action}</button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <Empty icon={Timer} title="No executions yet">Release a change to see its timeline.</Empty>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><GitCommit size={17} /><h2>History</h2><span className="sub">{p.executions.length} runs</span></div>
          <div className="table-wrap" style={{ maxHeight: 460, overflowY: 'auto' }}>
            <table className="table">
              <thead><tr><th>Status</th><th>Change</th><th>Took</th><th>Started</th></tr></thead>
              <tbody>
                {p.executions.map((e) => (
                  <tr key={e.id} className={`clickable ${e.id === selected?.id ? 'selected' : ''}`} onClick={() => setParams({ exec: e.id })} aria-selected={e.id === selected?.id}>
                    <td><StatusBadge status={e.status} /></td>
                    <td style={{ maxWidth: 200 }}>
                      <div className="row" style={{ minWidth: 0 }}>
                        <span className="sha">{shortSha(e.sourceRevisions?.[0]?.revisionId)}</span>
                        <span className="ellipsis small">{e.sourceRevisions?.[0]?.summary ?? '—'}</span>
                        {e.sourceRevisions?.[0]?.url && (
                          <a href={e.sourceRevisions[0].url} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} aria-label="Open commit"><ExternalLink size={13} className="faint" /></a>
                        )}
                      </div>
                    </td>
                    <td className="mono small tnum" style={{ whiteSpace: 'nowrap' }}>{fmtDuration(execDuration(e, now))}</td>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{timeAgo(e.start, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {approval && <ApprovalModal approval={approval} onClose={() => setApproval(null)} onDone={after} toast={toast} />}
      {logs && <LogDrawer buildId={logs.buildId} title={logs.title} onClose={() => setLogs(null)} />}
      {gate && (
        <Modal
          title={gate.inboundTransition?.enabled === false ? `Enable transition into ${gate.name}?` : `Disable transition into ${gate.name}?`}
          onClose={() => setGate(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setGate(null)}>Cancel</button>
              <button className={`btn ${gate.inboundTransition?.enabled === false ? 'primary' : 'warn'}`} onClick={applyGate} disabled={busy === `gate-${gate.name}`}>
                {busy === `gate-${gate.name}` && <Loader2 size={15} className="spin" />}
                {gate.inboundTransition?.enabled === false ? 'Enable transition' : 'Disable transition'}
              </button>
            </>
          }
        >
          {gate.inboundTransition?.enabled === false ? (
            <p className="muted" style={{ margin: 0 }}>Runs waiting before <b>{gate.name}</b> will continue right away.{gate.inboundTransition.reason && <> It was disabled because: “{gate.inboundTransition.reason}”.</>}</p>
          ) : (
            <>
              <p className="muted" style={{ margin: 0 }}>Runs stop before <b>{gate.name}</b> until you enable it again. Use this for change freezes or to hold a release.</p>
              <div className="field">
                <label htmlFor="gate-reason">Reason (shown to your team)</label>
                <input id="gate-reason" className="input" maxLength={300} value={gateReason} onChange={(e) => setGateReason(e.target.value)} placeholder="Change freeze during the Black Friday window" />
              </div>
            </>
          )}
        </Modal>
      )}
      {stopping && running[0] && (
        <Modal
          title="Stop this run?"
          onClose={() => setStopping(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setStopping(false)}>Keep running</button>
              <button className="btn danger" onClick={stop} disabled={busy === 'stop'}>{busy === 'stop' && <Loader2 size={15} className="spin" />} Stop run</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>Run <span className="mono">{shortId(running[0].id)}</span>: “{running[0].sourceRevisions?.[0]?.summary}”.</p>
          <label className="switch">
            <input type="checkbox" checked={abandon} onChange={(e) => setAbandon(e.target.checked)} />
            <span className="track" />
            <span>Abandon in-flight actions. Otherwise they finish first.</span>
          </label>
        </Modal>
      )}
    </>
  );
}
