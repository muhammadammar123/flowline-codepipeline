import { useState } from 'react';
import { Link } from 'react-router-dom';
import { UserCheck, Inbox, Clock, GitCommit } from 'lucide-react';
import { useApp } from '../context.js';
import { useNow, timeAgo, shortSha } from '../lib.js';
import { Empty, Skeleton, useToast } from '../components/ui.jsx';
import ApprovalModal from '../components/ApprovalModal.jsx';

export default function Approvals() {
  const { overview } = useApp();
  const { data, refresh } = overview;
  const now = useNow(5000);
  const toast = useToast();
  const [reviewing, setReviewing] = useState(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Approvals inbox</h1>
          <p>Every Manual approval action that's waiting, across all pipelines. Decisions go through PutApprovalResult with the action's current token.</p>
        </div>
      </div>
      {!data ? (
        <div className="stack">{[...Array(2)].map((_, i) => <Skeleton key={i} h={110} />)}</div>
      ) : data.approvals.length === 0 ? (
        <div className="card"><Empty icon={Inbox} title="Inbox zero">No release gates are waiting. When a run reaches a Manual approval action it shows up here.</Empty></div>
      ) : (
        <div className="stack">
          {data.approvals.map((a, i) => (
            <article key={a.token} className="card approval-card fade-in" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="approval-ico"><UserCheck size={22} /></div>
              <div className="stack" style={{ gap: 10, minWidth: 0 }}>
                <div className="row wrap" style={{ gap: 10 }}>
                  <Link to={`/pipelines/${encodeURIComponent(a.pipeline)}`} className="mono" style={{ fontWeight: 600 }}>{a.pipeline}</Link>
                  <span className="faint">›</span>
                  <span style={{ fontWeight: 600 }}>{a.stage}</span>
                  <span className="chip">{a.action}</span>
                  <span className="small faint row" style={{ gap: 4 }}><Clock size={13} /> waiting {timeAgo(a.since, now).replace(' ago', '')}</span>
                </div>
                {a.revision && (
                  <div className="revision"><GitCommit size={14} className="faint" /><span className="sha">{shortSha(a.revision.revisionId)}</span><span className="ellipsis">{a.revision.summary}</span></div>
                )}
                {a.customData && <div className="small muted">{a.customData}</div>}
                <div className="row">
                  <button className="btn warn" onClick={() => setReviewing(a)}>Review &amp; decide</button>
                  <Link to={`/pipelines/${encodeURIComponent(a.pipeline)}`} className="btn ghost">Open pipeline</Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {reviewing && <ApprovalModal approval={reviewing} onClose={() => setReviewing(null)} onDone={refresh} toast={toast} />}
    </>
  );
}
