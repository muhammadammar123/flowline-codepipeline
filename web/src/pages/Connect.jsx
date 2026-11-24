import { useState } from 'react';
import { Cloud, CloudOff, RefreshCw, Loader2, ShieldCheck, Terminal, KeyRound, Copy, FlaskConical } from 'lucide-react';
import { useApp } from '../context.js';
import { api } from '../lib.js';
import { useAction, useToast } from '../components/ui.jsx';

const ENV_SNIPPET = `# flowline/.env  (never commit this file)
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
# FLOWLINE_MODE=auto   # auto | aws | mock`;

const PROFILE_SNIPPET = `aws configure --profile flowline
# then start Flowline with that profile:
$env:AWS_PROFILE="flowline"; npm run dev`;

export default function Connect() {
  const { session } = useApp();
  const s = session.data;
  const { busy, run } = useAction();
  const toast = useToast();
  const [policy, setPolicy] = useState(null);

  const switchMode = (mode) => run(mode, () => api('/session', { method: 'POST', body: { mode } }), mode === 'aws' ? 'Switched to live AWS' : 'Switched to the simulator').then(() => { session.refresh(); setTimeout(() => window.location.reload(), 300); });
  const recheck = () => run('recheck', () => api('/session/recheck', { method: 'POST' })).then((r) => { session.refresh(); toast(r?.ok ? 'ok' : 'err', r?.ok ? `Credentials valid for account ${r.identity.account}` : r?.error ?? 'Check failed'); });
  const showPolicy = async () => {
    if (policy) return setPolicy(null);
    const res = await fetch('/api/iam-policy').catch(() => null);
    setPolicy(res?.ok ? await res.text() : 'See iam-policy.json in the project root.');
  };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast('ok', 'Copied'); } catch { toast('err', 'Copy failed'); } };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Connect AWS</h1>
          <p>Flowline runs a small local server that signs AWS API calls. Your keys stay on your machine and are never sent to the browser.</p>
        </div>
      </div>

      <div className="grid two-col" style={{ marginBottom: 16 }}>
        <section className="card">
          <div className="card-head"><ShieldCheck size={17} /><h2>Current connection</h2></div>
          <div className="card-pad stack">
            {s && (
              <>
                <div className="row wrap" style={{ gap: 10 }}>
                  <span className={`chip ${s.mode === 'aws' ? 'live' : 'sim'}`}><span className="dot pulse" />{s.mode === 'aws' ? 'LIVE AWS' : 'SIMULATOR'}</span>
                  <span className="chip">{s.region}</span>
                </div>
                <dl className="kv">
                  <dt>Account</dt><dd>{s.identity?.account}</dd>
                  <dt>Identity</dt><dd>{s.identity?.arn}</dd>
                  <dt>AWS credentials</dt>
                  <dd style={{ color: s.aws.available ? 'var(--green)' : 'var(--fg-muted)' }}>
                    {s.aws.available ? `Valid · ${s.aws.identity.arn}` : s.aws.error}
                  </dd>
                </dl>
                <div className="row wrap">
                  {s.mode === 'aws' ? (
                    <button className="btn" onClick={() => switchMode('mock')} disabled={!!busy}>{busy === 'mock' ? <Loader2 size={15} className="spin" /> : <FlaskConical size={15} />} Use the simulator</button>
                  ) : (
                    <button className="btn primary" onClick={() => switchMode('aws')} disabled={!!busy || !s.aws.available}>{busy === 'aws' ? <Loader2 size={15} className="spin" /> : <Cloud size={15} />} Switch to live AWS</button>
                  )}
                  <button className="btn ghost" onClick={recheck} disabled={!!busy}>{busy === 'recheck' ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Re-check credentials</button>
                </div>
                {!s.aws.available && (
                  <div className="callout"><CloudOff size={18} style={{ flex: 'none' }} /><span>No usable credentials yet. Add them with one of the options below, restart <span className="mono">npm run dev</span>, then select <b>Re-check credentials</b>.</span></div>
                )}
              </>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><KeyRound size={17} /><h2>Use a dedicated IAM user</h2></div>
          <div className="card-pad stack small">
            <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }} className="muted">
              <li>In the IAM console, create a user named <span className="mono">flowline</span>. It doesn't need console access.</li>
              <li>Attach the policy below as an inline policy, or <span className="mono">AdministratorAccess</span> on a throwaway account.</li>
              <li>Create an <b>access key</b> for the user, choosing “Local code”.</li>
              <li>Put the key in <span className="mono">.env</span> or an AWS CLI profile (shown below). Never paste it into a chat or commit it.</li>
            </ol>
            <button className="btn sm" style={{ width: 'fit-content' }} onClick={showPolicy}>{policy ? 'Hide' : 'Show'} least-privilege IAM policy</button>
            {policy && (
              <div style={{ position: 'relative' }}>
                <pre className="code" style={{ maxHeight: 260 }}>{policy}</pre>
                <button className="btn sm icon" style={{ position: 'absolute', top: 8, right: 8 }} onClick={() => copy(policy)} aria-label="Copy policy"><Copy size={14} /></button>
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="grid two-col">
        <section className="card">
          <div className="card-head"><Terminal size={17} /><h2>Option A: .env file</h2></div>
          <div className="card-pad stack">
            <pre className="code">{ENV_SNIPPET}</pre>
            <span className="small muted">Copy <span className="mono">.env.example</span> to <span className="mono">.env</span> in the project folder and fill in the key. <span className="mono">.gitignore</span> already excludes it.</span>
          </div>
        </section>
        <section className="card">
          <div className="card-head"><Terminal size={17} /><h2>Option B: AWS CLI profile</h2></div>
          <div className="card-pad stack">
            <pre className="code">{PROFILE_SNIPPET}</pre>
            <span className="small muted">This keeps keys in <span className="mono">~/.aws/credentials</span>, outside the project.</span>
          </div>
        </section>
      </div>
    </>
  );
}
