import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, NavLink, useLocation, Link } from 'react-router-dom';
import { LayoutDashboard, Workflow, Inbox, FlaskConical, KeyRound, Menu, ChevronRight } from 'lucide-react';
import './styles.css';
import { ToastProvider } from './components/ui.jsx';
import { usePoll } from './lib.js';
import Overview from './pages/Overview.jsx';
import Pipelines from './pages/Pipelines.jsx';
import PipelineDetail from './pages/PipelineDetail.jsx';
import Approvals from './pages/Approvals.jsx';
import DemoLab from './pages/DemoLab.jsx';
import Connect from './pages/Connect.jsx';

import { SessionCtx } from './context.js';

function Logo() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#111a2e" stroke="#243049" />
      <path d="M7 21c4 0 5-10 9-10s5 10 9 10" fill="none" stroke="#22C55E" strokeWidth="3" strokeLinecap="round" />
      <circle cx="7" cy="21" r="2.5" fill="#22C55E" />
      <circle cx="25" cy="21" r="2.5" fill="#3B82F6" />
    </svg>
  );
}

function Shell() {
  const session = usePoll('/session', 15000);
  const overview = usePoll('/overview', 5000);
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const mode = session.data?.mode;
  const pending = overview.data?.approvals?.length ?? 0;

  const crumbs = loc.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const title = { '': 'Overview', pipelines: 'Pipelines', approvals: 'Approvals', lab: 'Demo Lab', connect: 'Connect AWS' }[crumbs[0] ?? ''];

  return (
    <SessionCtx.Provider value={{ session, overview }}>
      <div className="shell">
        <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Primary">
          <Link to="/" className="brand">
            <Logo />
            <div>
              <div className="brand-name">Flowline</div>
              <div className="brand-sub">CodePipeline</div>
            </div>
          </Link>
          <nav className="nav">
            <NavLink to="/" end><LayoutDashboard size={18} /> Overview</NavLink>
            <NavLink to="/pipelines"><Workflow size={18} /> Pipelines</NavLink>
            <NavLink to="/approvals">
              <Inbox size={18} /> Approvals {pending > 0 && <span className="count" aria-label={`${pending} pending`}>{pending}</span>}
            </NavLink>
            <NavLink to="/lab"><FlaskConical size={18} /> Demo Lab</NavLink>
            <NavLink to="/connect"><KeyRound size={18} /> Connect AWS</NavLink>
          </nav>
          <div className="sidebar-foot">
            {session.data && (
              <Link to="/connect" className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className={`chip ${mode === 'aws' ? 'live' : 'sim'}`} style={{ width: 'fit-content' }}>
                  <span className="dot pulse" /> {mode === 'aws' ? 'LIVE AWS' : 'SIMULATOR'}
                </span>
                <span className="tiny faint mono ellipsis">{session.data.identity?.account} · {session.data.identity?.region}</span>
              </Link>
            )}
          </div>
        </aside>
        {open && <div className="overlay" style={{ zIndex: 54 }} onClick={() => setOpen(false)} />}
        <div className="main">
          <header className="topbar">
            <button className="btn ghost icon menu-btn" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
            <nav className="crumbs" aria-label="Breadcrumb">
              {crumbs.length > 1 ? (
                <>
                  <Link to={`/${crumbs[0]}`} className="hide-sm">{title}</Link>
                  <ChevronRight size={14} className="hide-sm" />
                  <b className="mono">{crumbs[1]}</b>
                </>
              ) : (
                <b>{title}</b>
              )}
            </nav>
            <div className="spacer" />
            {overview.data && overview.data.running > 0 && (
              <span className="chip" style={{ color: '#93c5fd' }}><span className="dot pulse" /> {overview.data.running} running</span>
            )}
            {session.data && (
              <span className={`chip ${mode === 'aws' ? 'live' : 'sim'} hide-sm`}>{mode === 'aws' ? `aws · ${session.data.region}` : 'simulated data'}</span>
            )}
          </header>
          <main className="content" id="main">
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/pipelines" element={<Pipelines />} />
              <Route path="/pipelines/:name" element={<PipelineDetail />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/lab" element={<DemoLab />} />
              <Route path="/connect" element={<Connect />} />
            </Routes>
          </main>
        </div>
      </div>
    </SessionCtx.Provider>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
