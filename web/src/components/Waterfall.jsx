import { fmtDuration, visualStatus } from '../lib.js';
import { StatusIcon } from './ui.jsx';

/** Gantt-style timeline of every action in one execution (ListActionExecutions). */
export default function Waterfall({ actions, execution, now }) {
  if (!actions?.length) return <div className="small faint">No actions have started in this execution yet.</div>;
  const t0 = Math.min(...actions.map((a) => new Date(a.start).getTime()));
  const ends = actions.map((a) => (a.end ? new Date(a.end).getTime() : now));
  const t1 = Math.max(...ends, execution?.end ? new Date(execution.end).getTime() : 0, t0 + 1000);
  const span = t1 - t0;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => fmtDuration(span * f));
  return (
    <div className="wf" role="table" aria-label="Action timeline">
      <div className="hide-sm" />
      <div className="wf-axis" aria-hidden="true">{ticks.map((t, i) => <span key={i}>{i === 0 ? '0s' : t}</span>)}</div>
      <div className="hide-sm" />
      {actions.map((a, i) => {
        const s = new Date(a.start).getTime();
        const e = ends[i];
        const vs = visualStatus(a.status, a.category);
        return (
          <div key={a.actionExecutionId ?? `${a.stage}-${a.action}-${i}`} style={{ display: 'contents' }} role="row">
            <div className="wf-label" role="cell">
              <StatusIcon status={vs} size={14} />
              <span className="ellipsis">
                <span className="stg">{a.stage} / </span>
                {a.action}
              </span>
            </div>
            <div className="wf-track" role="cell" aria-label={`${a.action}: ${vs}, ${fmtDuration(e - s)}`}>
              <div className={`wf-bar ${vs}`} style={{ left: `${((s - t0) / span) * 100}%`, width: `${Math.max(0.6, ((e - s) / span) * 100)}%` }} />
            </div>
            <div className="wf-dur" role="cell">{fmtDuration(e - s)}</div>
          </div>
        );
      })}
    </div>
  );
}
