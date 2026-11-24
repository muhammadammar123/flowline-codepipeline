import { useState } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { Modal } from './ui.jsx';
import { api, enc } from '../lib.js';

/** PutApprovalResult with the action's current token. */
export default function ApprovalModal({ approval, onClose, onDone, toast }) {
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(null);
  const decide = async (status) => {
    setBusy(status);
    try {
      await api(`/pipelines/${enc(approval.pipeline)}/stages/${enc(approval.stage)}/actions/${enc(approval.action)}/approval`, {
        method: 'POST',
        body: { token: approval.token, status, summary },
      });
      toast('ok', `${status === 'Approved' ? 'Approved' : 'Rejected'} ${approval.pipeline} / ${approval.stage}`);
      onDone?.();
      onClose();
    } catch (e) {
      toast('err', e.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal
      title="Review release gate"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn danger" disabled={!!busy} onClick={() => decide('Rejected')}>
            {busy === 'Rejected' ? <Loader2 size={15} className="spin" /> : <X size={15} />} Reject
          </button>
          <button className="btn primary" disabled={!!busy} onClick={() => decide('Approved')}>
            {busy === 'Approved' ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Approve
          </button>
        </>
      }
    >
      <dl className="kv">
        <dt>Pipeline</dt><dd>{approval.pipeline}</dd>
        <dt>Stage</dt><dd>{approval.stage} / {approval.action}</dd>
        {approval.revision?.summary && (<><dt>Change</dt><dd style={{ fontFamily: 'var(--font)', fontSize: 14 }}>{approval.revision.summary}</dd></>)}
      </dl>
      {approval.customData && <div className="callout warn">{approval.customData}</div>}
      <div className="field">
        <label htmlFor="appr-summary">Comment (sent with the decision)</label>
        <textarea id="appr-summary" className="textarea" maxLength={512} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Staging looks good, smoke tests green." />
        <span className="hint">Rejecting fails this stage. The run can't continue past it.</span>
      </div>
    </Modal>
  );
}
