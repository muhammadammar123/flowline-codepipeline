import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2, XCircle, Loader2, Hand, Square, SkipForward, CircleDashed, Clock,
  GitBranch, Hammer, FlaskConical, Rocket, UserCheck, Zap, Box, Database, Container, Layers, X, Info, PackageCheck,
} from 'lucide-react';
import { STATUS_LABEL } from '../lib.js';

// ---------- status ----------
const STATUS_ICON = {
  Succeeded: CheckCircle2,
  Failed: XCircle,
  InProgress: Loader2,
  Approval: Hand,
  Waiting: Clock,
  Stopped: Square,
  Stopping: Square,
  Abandoned: Square,
  Superseded: SkipForward,
  Cancelled: Square,
  Idle: CircleDashed,
};

export function StatusIcon({ status, size = 16 }) {
  const Icon = STATUS_ICON[status] ?? CircleDashed;
  return <Icon size={size} className={`c-${status}${status === 'InProgress' ? ' spin' : ''}`} aria-hidden="true" />;
}

export function StatusBadge({ status }) {
  const s = status || 'Idle';
  return (
    <span className={`status s-${s}`}>
      <StatusIcon status={s} size={14} />
      {STATUS_LABEL[s] ?? s}
    </span>
  );
}

// ---------- providers ----------
export function ProviderIcon({ category, provider, size = 15 }) {
  let Icon = Box;
  if (category === 'Source') Icon = provider === 'S3' ? Database : GitBranch;
  else if (category === 'Build') Icon = provider === 'ECR' ? Container : Hammer;
  else if (category === 'Test') Icon = FlaskConical;
  else if (category === 'Deploy') Icon = provider?.includes('ECS') ? Layers : provider === 'S3' ? PackageCheck : Rocket;
  else if (category === 'Approval') Icon = UserCheck;
  else if (category === 'Invoke') Icon = Zap;
  return (
    <span className="prov-ico" aria-hidden="true">
      <Icon size={size} />
    </span>
  );
}
export const providerLabel = (p) => (p === 'CodeStarSourceConnection' ? 'GitHub (Connection)' : p === 'CodeDeployToECS' ? 'CodeDeploy → ECS' : p);

// ---------- toasts ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((kind, text) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'ok' ? <CheckCircle2 size={18} className="c-Succeeded" /> : t.kind === 'err' ? <XCircle size={18} className="c-Failed" /> : <Info size={18} className="c-InProgress" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Wraps an async action with busy state and toasts. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const run = useCallback(
    async (key, fn, okText) => {
      setBusy(key);
      try {
        const r = await fn();
        if (okText) toast('ok', typeof okText === 'function' ? okText(r) : okText);
        return r;
      } catch (e) {
        toast('err', e.message);
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast]
  );
  return { busy, run };
}

// ---------- overlays ----------
function useEscape(onClose) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
}

export function Modal({ title, children, footer, onClose, labelledBy = 'modal-title' }) {
  useEscape(onClose);
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector('textarea, input, button')?.focus(); }, []);
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref}>
        <div className="modal-body">
          <h3 id={labelledBy}>{title}</h3>
          {children}
        </div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </>
  );
}

export function Drawer({ title, subtitle, children, onClose, actions }) {
  useEscape(onClose);
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 className="ellipsis">{title}</h3>
            {subtitle && <div className="small faint ellipsis">{subtitle}</div>}
          </div>
          {actions}
          <button className="btn ghost icon" onClick={onClose} aria-label="Close panel">
            <X size={18} />
          </button>
        </div>
        {children}
      </aside>
    </>
  );
}

export function Empty({ icon: Icon = Box, title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-ico"><Icon size={24} /></div>
      <div style={{ fontWeight: 600, color: 'var(--fg)' }}>{title}</div>
      {children && <div className="small" style={{ maxWidth: 420 }}>{children}</div>}
      {action}
    </div>
  );
}

export const Skeleton = ({ h = 16, w = '100%', style }) => <div className="skel" style={{ height: h, width: w, ...style }} />;
