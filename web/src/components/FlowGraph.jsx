import { Fragment } from 'react';
import { Lock, Unlock, RotateCcw, ScrollText, ExternalLink, Hand, Loader2 } from 'lucide-react';
import { StatusBadge, StatusIcon, ProviderIcon, providerLabel } from './ui.jsx';
import { timeAgo, visualStatus } from '../lib.js';

function stageStatus(stage) {
  if (stage.actions.some((a) => a.category === 'Approval' && a.status === 'InProgress')) return 'Approval';
  return stage.latest?.status ?? 'Idle';
}

export default function FlowGraph({ pipeline, now, busy, onApprove, onRetry, onGate, onLogs }) {
  const stages = pipeline.stages;
  return (
    <div className="flow-wrap">
      <div className="flow">
        {stages.map((stage, i) => {
          const st = stageStatus(stage);
          const next = stages[i + 1];
          const orders = [...new Set(stage.actions.map((a) => a.runOrder))].sort((a, b) => a - b);
          return (
            <Fragment key={stage.name}>
              <section className={`stage st-${st}`} aria-label={`Stage ${stage.name}, ${st}`}>
                <header className="stage-head">
                  <StatusIcon status={st} />
                  <h4 className="ellipsis">{stage.name}</h4>
                  <span style={{ marginLeft: 'auto' }} className="tiny faint mono">
                    {stage.actions.length} action{stage.actions.length > 1 ? 's' : ''}
                  </span>
                </header>
                <div className="stage-body">
                  {orders.map((order) => (
                    <Fragment key={order}>
                      {orders.length > 1 && <div className="runorder">Run order {order}</div>}
                      {stage.actions
                        .filter((a) => a.runOrder === order)
                        .map((a) => {
                          const vs = visualStatus(a.status, a.category);
                          return (
                            <article key={a.name} className={`action a-${vs}`}>
                              <div className="action-top">
                                <ProviderIcon category={a.category} provider={a.provider} />
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div className="action-name ellipsis">{a.name}</div>
                                  <div className="action-prov ellipsis">{providerLabel(a.provider)}</div>
                                </div>
                                <StatusIcon status={vs} />
                              </div>
                              {a.errorMessage ? (
                                <div className="action-error">{a.errorMessage}</div>
                              ) : a.summary ? (
                                <div className="action-summary" title={a.summary}>{a.summary}</div>
                              ) : vs === 'Approval' && a.configuration?.CustomData ? (
                                <div className="action-summary">{a.configuration.CustomData}</div>
                              ) : null}
                              <div className="row" style={{ justifyContent: 'space-between' }}>
                                <span className="tiny faint">{a.lastStatusChange ? timeAgo(a.lastStatusChange, now) : 'Not run yet'}</span>
                                <div className="action-btns">
                                  {vs === 'Approval' && a.token && (
                                    <button className="btn warn sm" onClick={() => onApprove(stage, a)}>
                                      <Hand size={14} /> Review
                                    </button>
                                  )}
                                  {a.provider === 'CodeBuild' && a.externalExecutionId && (
                                    <button className="btn sm" onClick={() => onLogs(stage, a)} aria-label={`View build logs for ${a.name}`}>
                                      <ScrollText size={14} /> Logs
                                    </button>
                                  )}
                                  {a.externalUrl && (
                                    <a className="btn sm icon ghost" href={a.externalUrl} target="_blank" rel="noreferrer" aria-label={`Open ${a.name} in the AWS console`}>
                                      <ExternalLink size={14} />
                                    </a>
                                  )}
                                </div>
                              </div>
                            </article>
                          );
                        })}
                    </Fragment>
                  ))}
                </div>
                {st === 'Failed' && stage.latest?.executionId && (
                  <div className="stage-foot">
                    <button className="btn sm danger" style={{ width: '100%' }} disabled={busy === `retry-${stage.name}`} onClick={() => onRetry(stage)}>
                      {busy === `retry-${stage.name}` ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />} Retry failed actions
                    </button>
                  </div>
                )}
              </section>
              {next && <Connector from={st} to={stageStatus(next)} stage={next} busy={busy} onGate={onGate} sameRun={stage.latest?.executionId === next.latest?.executionId} />}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function Connector({ from, to, stage, onGate, busy, sameRun }) {
  const open = stage.inboundTransition?.enabled !== false;
  const cls = !open ? 'locked' : to === 'InProgress' || to === 'Approval' ? 'flowing' : from === 'Succeeded' && to === 'Succeeded' && sameRun ? 'done' : '';
  const label = open
    ? `Transition into ${stage.name} is enabled. Click to disable it.`
    : `Transition into ${stage.name} is disabled${stage.inboundTransition.reason ? `: ${stage.inboundTransition.reason}` : ''}. Click to enable it.`;
  return (
    <div className={`connector ${cls}`}>
      <button className={`gate ${open ? '' : 'closed'}`} onClick={() => onGate(stage)} aria-label={label} title={label} disabled={busy === `gate-${stage.name}`}>
        {busy === `gate-${stage.name}` ? <Loader2 size={15} className="spin" /> : open ? <Unlock size={15} /> : <Lock size={15} />}
      </button>
    </div>
  );
}

export { stageStatus, StatusBadge };
