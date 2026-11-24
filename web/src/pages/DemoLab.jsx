import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Database, Hammer, UserCheck, PackageCheck, Rocket, Loader2, Send, Trash2, Eye, ArrowRight, FlaskConical, Bug, Layers, RefreshCw } from 'lucide-react';
import { api, enc, usePoll, useNow, timeAgo, fmtDuration, execDuration } from '../lib.js';
import { StatusBadge, Modal, useAction, useToast, Skeleton, Empty } from '../components/ui.jsx';
import FlowGraph from '../components/FlowGraph.jsx';
import LogDrawer from '../components/LogDrawer.jsx';
import ApprovalModal from '../components/ApprovalModal.jsx';
import { useApp } from '../context.js';

const ACCENTS = ['#22C55E', '#3B82F6', '#A855F7', '#F59E0B', '#EC4899', '#14B8A6'];

function Arch() {
  const nodes = [
    [Database, 'S3 source', 'source.zip'],
    [Hammer, 'CodeBuild', 'test + build'],
    [UserCheck, 'Manual approval', 'release gate'],
    [PackageCheck, 'S3 deploy', 'live site'],
  ];
  return (
    <div className="arch" aria-label="Demo pipeline architecture">
      {nodes.map(([Icon, title, sub], i) => (
        <div key={title} style={{ display: 'flex', alignItems: 'center' }}>
          {i > 0 && <span className="arch-link" aria-hidden="true" />}
          <div className="arch-node"><Icon size={18} className="c-Succeeded" /><div><b>{title}</b><span>{sub}</span></div></div>
        </div>
      ))}
    </div>
  );
}

export default function DemoLab() {
  const { session } = useApp();
  const demo = usePoll('/demo', 2500);
  const ready = demo.data?.state === 'ready';
  const pipe = usePoll(ready ? `/pipelines/${enc(demo.data.pipelineName)}` : null, 2500);
  const now = useNow(1000);
  const toast = useToast();
  const { busy, run } = useAction();
  const [appName, setAppName] = useState('Flowline Demo Store');
  const [accent, setAccent] = useState(ACCENTS[0]);
  const [message, setMessage] = useState('');
  const [breakBuild, setBreakBuild] = useState(false);
  const [confirmTeardown, setConfirmTeardown] = useState(false);
  const [logs, setLogs] = useState(null);
  const [approval, setApproval] = useState(null);
  const [siteKey, setSiteKey] = useState(0);

  const isAws = session.data?.mode === 'aws';
  const d = demo.data;
  const p = pipe.data;
  const latest = p?.executions?.[0];
  const nextVersion = `1.${p?.executions?.length ?? 0}.0`;
  const lastDeploy = p?.executions?.find((e) => e.status === 'Succeeded');

  const provision = () => run('provision', () => api('/demo/provision', { method: 'POST', body: { appName, accent, message: 'Initial release from Flowline' } }), 'Provisioning started').then(demo.refresh);
  const ship = (e) => {
    e.preventDefault();
    run('ship', () => api('/demo/ship', { method: 'POST', body: { appName, accent, version: nextVersion, message: message || `Release ${nextVersion}`, breakBuild, author: 'you' } }), (r) => `Shipped v${r.release.version}, pipeline started`).then((r) => {
      if (r) setMessage('');
      pipe.refresh();
    });
  };
  const teardown = () => run('teardown', () => api('/demo/teardown', { method: 'POST' }), 'Teardown started').then(() => { setConfirmTeardown(false); demo.refresh(); });

  const approveStage = p?.stages?.find((s) => s.name === 'Approve');
  const steps = [
    ['Provision stack', ready],
    ['Ship a change', (p?.executions?.length ?? 0) > 0],
    ['Approve the gate', approveStage?.latest?.status === 'Succeeded'],
    ['See it live', !!lastDeploy],
  ];
  const current = steps.findIndex(([, done]) => !done);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Demo Lab</h1>
          <p>Provision a real four-stage pipeline with one CloudFormation stack, ship code changes into it, approve the release, and watch the site update.</p>
        </div>
        {ready && (
          <div className="actions">
            <Link to={`/pipelines/${enc(d.pipelineName)}`} className="btn"><Layers size={16} /> Open full view</Link>
            <button className="btn danger" onClick={() => setConfirmTeardown(true)}><Trash2 size={16} /> Tear down</button>
          </div>
        )}
      </div>

      {!d ? (
        <Skeleton h={260} />
      ) : d.state === 'none' ? (
        <section className="card lab-hero fade-in">
          <span className="chip live" style={{ marginBottom: 14 }}><FlaskConical size={13} /> one-click sandbox</span>
          <h2>Build a working CodePipeline in about a minute</h2>
          <p className="muted" style={{ maxWidth: '68ch', margin: 0 }}>
            Flowline creates a versioned S3 source bucket, then deploys the <span className="mono">flowline-demo</span> CloudFormation stack: an artifact bucket, a site bucket, IAM roles, a CodeBuild project and a V2 pipeline.
            {isAws ? ' This runs in your connected AWS account.' : ' You are in simulator mode, so nothing is created in AWS.'}
          </p>
          <Arch />
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: 24, alignItems: 'end' }}>
            <div className="field">
              <label htmlFor="appname">App name</label>
              <input id="appname" className="input" value={appName} maxLength={60} onChange={(e) => setAppName(e.target.value)} />
            </div>
            <div className="field">
              <span id="accent-l" style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-2)' }}>Brand colour</span>
              <div className="swatches" role="group" aria-labelledby="accent-l">
                {ACCENTS.map((c) => <button key={c} className="swatch" style={{ background: c }} aria-pressed={accent === c} aria-label={`Accent ${c}`} onClick={() => setAccent(c)} />)}
              </div>
            </div>
            <button className="btn primary" style={{ minHeight: 42 }} onClick={provision} disabled={busy === 'provision'}>
              {busy === 'provision' ? <Loader2 size={16} className="spin" /> : <Rocket size={16} />} Provision demo pipeline
            </button>
          </div>
          {isAws && <p className="tiny faint" style={{ marginTop: 14, marginBottom: 0 }}>Cost: the CodeBuild and CodePipeline free tiers cover a short demo; afterwards it's cents per run. Tear the stack down when you're finished.</p>}
        </section>
      ) : d.state === 'creating' || d.state === 'deleting' ? (
        <section className="card fade-in">
          <div className="card-head">
            <Loader2 size={17} className="spin c-InProgress" />
            <h2>{d.state === 'creating' ? 'Provisioning flowline-demo' : 'Tearing down flowline-demo'}</h2>
            <span className="sub mono">{d.stackStatus}</span>
          </div>
          <div className="card-pad stack">
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((d.progress ?? 0.5) * 100)}>
              <div style={{ width: `${Math.round((d.progress ?? (d.state === 'deleting' ? 0.5 : 0.4)) * 100)}%` }} />
            </div>
            <span className="small muted">{d.state === 'creating' ? 'CloudFormation is creating resources. IAM roles usually take the longest.' : 'Emptying buckets and deleting the stack.'}</span>
          </div>
          <StackEvents events={d.events} now={now} />
        </section>
      ) : d.state === 'failed' ? (
        <section className="card card-pad stack">
          <div className="error-box">The stack is in <b className="mono">{d.stackStatus}</b>. Check the events below, then tear it down and try again.</div>
          <StackEvents events={d.events} now={now} />
          <button className="btn danger" style={{ width: 'fit-content' }} onClick={() => setConfirmTeardown(true)}><Trash2 size={16} /> Tear down</button>
        </section>
      ) : (
        <div className="stack">
          <div className="steps" aria-label="Demo progress">
            {steps.map(([label, done], i) => (
              <div key={label} className={`step ${done ? 'done' : i === current ? 'current' : ''}`}>
                <span className="num">{i + 1}</span>{label}
              </div>
            ))}
          </div>

          <div className="grid two-col">
            <section className="card">
              <div className="card-head"><Send size={17} /><h2>Ship a change</h2><span className="sub">uploads source.zip, then StartPipelineExecution</span></div>
              <form className="card-pad stack" onSubmit={ship}>
                <div className="grid" style={{ gridTemplateColumns: '120px 1fr' }}>
                  <div className="field"><label htmlFor="ver">Version</label><input id="ver" className="input mono" value={nextVersion} readOnly /></div>
                  <div className="field"><label htmlFor="msg">Commit message</label><input id="msg" className="input" maxLength={200} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Add holiday banner to homepage" /></div>
                </div>
                <div className="field">
                  <span id="accent2" style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-2)' }}>Brand colour for this release</span>
                  <div className="swatches" role="group" aria-labelledby="accent2">
                    {ACCENTS.map((c) => <button type="button" key={c} className="swatch" style={{ background: c }} aria-pressed={accent === c} aria-label={`Accent ${c}`} onClick={() => setAccent(c)} />)}
                  </div>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={breakBuild} onChange={(e) => setBreakBuild(e.target.checked)} />
                  <span className="track" />
                  <span className="small"><Bug size={14} style={{ verticalAlign: -2 }} /> Ship a failing test, to see a red build, its logs and a retry</span>
                </label>
                <button className="btn primary" type="submit" disabled={busy === 'ship'} style={{ width: 'fit-content' }}>
                  {busy === 'ship' ? <Loader2 size={16} className="spin" /> : <Send size={16} />} Push v{nextVersion}
                </button>
              </form>
            </section>

            <section className="card" style={{ overflow: 'hidden' }}>
              <div className="browser-bar">
                <div className="dots" aria-hidden="true"><i /><i /><i /></div>
                <div className="url ellipsis"><Eye size={13} style={{ marginRight: 6 }} />s3://{d.outputs?.SiteBucket ?? 'site-bucket'}/index.html</div>
                <button className="btn sm icon ghost" onClick={() => setSiteKey((k) => k + 1)} aria-label="Reload site preview"><RefreshCw size={14} /></button>
              </div>
              {lastDeploy ? (
                <SitePreview version={`${lastDeploy.id}-${siteKey}`} />
              ) : (
                <div className="site-frame" style={{ display: 'grid', placeItems: 'center' }}>
                  <Empty icon={Eye} title="Nothing deployed yet">The site appears here after a run passes the release gate and the Deploy stage publishes it to S3.</Empty>
                </div>
              )}
            </section>
          </div>

          <section className="card">
            <div className="card-head">
              <Layers size={17} />
              <h2 className="mono">{d.pipelineName}</h2>
              {latest && <StatusBadge status={latest.status} />}
              <span className="sub hide-sm">{latest ? `${latest.sourceRevisions?.[0]?.summary ?? ''} · ${fmtDuration(execDuration(latest, now))}` : 'Waiting for the first run'}</span>
            </div>
            {p ? (
              <FlowGraph
                pipeline={p}
                now={now}
                busy={busy}
                onApprove={(stage, a) => setApproval({ pipeline: p.name, stage: stage.name, action: a.name, token: a.token, customData: a.configuration?.CustomData, revision: latest?.sourceRevisions?.[0] })}
                onRetry={(stage) => run(`retry-${stage.name}`, () => api(`/pipelines/${enc(p.name)}/stages/${enc(stage.name)}/retry`, { method: 'POST', body: { executionId: stage.latest.executionId } }), `Retrying ${stage.name}`).then(pipe.refresh)}
                onGate={(stage) => run(`gate-${stage.name}`, () => api(`/pipelines/${enc(p.name)}/stages/${enc(stage.name)}/transition`, { method: 'POST', body: { enabled: stage.inboundTransition?.enabled === false, reason: 'Paused from Demo Lab' } }), 'Transition updated').then(pipe.refresh)}
                onLogs={(stage, a) => setLogs({ buildId: a.externalExecutionId, title: `${stage.name} / ${a.name}` })}
              />
            ) : (
              <div className="card-pad"><Skeleton h={200} /></div>
            )}
          </section>
          <details className="card">
            <summary className="card-head" style={{ cursor: 'pointer', borderBottom: 0 }}><h3>Stack events</h3><span className="sub mono">{d.stackStatus}</span></summary>
            <StackEvents events={d.events} now={now} />
          </details>
        </div>
      )}

      {logs && <LogDrawer buildId={logs.buildId} title={logs.title} onClose={() => setLogs(null)} />}
      {approval && <ApprovalModal approval={approval} onClose={() => setApproval(null)} onDone={pipe.refresh} toast={toast} />}
      {confirmTeardown && (
        <Modal
          title="Tear down the demo?"
          onClose={() => setConfirmTeardown(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirmTeardown(false)}>Cancel</button>
              <button className="btn danger" onClick={teardown} disabled={busy === 'teardown'}>{busy === 'teardown' && <Loader2 size={15} className="spin" />} Delete everything</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            This empties and deletes the source, artifact and site buckets, then deletes the <span className="mono">flowline-demo</span> stack: the pipeline, the CodeBuild project, the IAM roles and the log group. You can't undo it, but you can provision again at any time.
          </p>
        </Modal>
      )}
    </>
  );
}

/** Loads the deployed index.html (S3 GetObject via the API) into a script-less sandboxed frame. */
function SitePreview({ version }) {
  const [html, setHtml] = useState(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/demo/site?v=${encodeURIComponent(version)}`).then((r) => r.text()).then((t) => live && setHtml(t)).catch(() => live && setHtml(null));
    return () => { live = false; };
  }, [version]);
  if (html == null) return <div className="site-frame skel" />;
  return <iframe className="site-frame fade-in" title="Deployed site preview" srcDoc={html} sandbox="allow-same-origin" />;
}

function StackEvents({ events, now }) {
  if (!events?.length) return null;
  const color = (s) => (/COMPLETE$/.test(s) && !/ROLLBACK|DELETE/.test(s) ? 'c-Succeeded' : /FAILED|ROLLBACK/.test(s) ? 'c-Failed' : 'c-InProgress');
  return (
    <ul className="events" aria-label="CloudFormation stack events">
      {events.map((e, i) => (
        <li key={i} className="fade-in">
          <span className="faint">{timeAgo(e.t, now)}</span>
          <span className="ellipsis">{e.resource} <span className="faint">{e.type}</span>{e.reason && <span className="faint"> · {e.reason}</span>}</span>
          <span className={color(e.status)}>{e.status}</span>
        </li>
      ))}
    </ul>
  );
}

export { ArrowRight };
