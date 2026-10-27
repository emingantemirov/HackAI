import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from './api';
import { AuthCtx, Meta, Modal, ROLE_LABEL, ToastCtx, User, Loading, Field } from './ui';
import { Dashboard } from './pages/Dashboard';
import { Kriterien, CriterionDetail } from './pages/Kriterien';
import { Testfaelle, TestcaseDetail } from './pages/Testfaelle';
import { Pruefungen, CampaignDetail, RunDetail } from './pages/Pruefungen';
import { Freigaben } from './pages/Freigaben';
import { Berichte, ReportDetail } from './pages/Berichte';
import { Einstellungen } from './pages/Einstellungen';

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <main style={{ maxWidth: 460 }}>
      <h1>EEL Prüfportal</h1>
      <p className="lead">Prüfung von Entgeltabrechnungssoftware für den Datenaustausch Entgeltersatzleistungen. <span className="principle">KI unterstützt. Menschen entscheiden.</span></p>
      <form className="card accent" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await api.post('/api/auth/login', { email, password: pw }); onDone(); } catch (x: any) { setErr(x instanceof ApiError ? x.message : 'Anmeldung nicht möglich.'); } finally { setBusy(false); } }}>
        <h2>Anmelden</h2>
        {err && <div className="banner bad" role="alert">{err}</div>}
        <Field id="email" label="E-Mail"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field id="pw" label="Passwort"><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
        <button className="primary" disabled={busy}>Anmelden</button>
      </form>
      <details className="card"><summary>Demo-Zugänge (nur Entwicklung)</summary>
        <p className="hint">Alle Konten sind synthetisch. Das Passwort steht in der README.</p>
        <ul><li><span className="mono">admin@demo.example</span> – Administrator</li><li><span className="mono">fachbearbeitung@demo.example</span> – Fachbearbeitung</li><li><span className="mono">pruefer@demo.example</span>, <span className="mono">pruefer2@demo.example</span> – Prüfer/Freigeber</li><li><span className="mono">kunde@demo.example</span> – Kunde/Hersteller</li></ul>
      </details>
    </main>
  );
}

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string; err?: boolean }[]>([]);
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const nav = useNavigate(); const loc = useLocation();

  const load = useCallback(async () => {
    try { const [me, m] = await Promise.all([api.get('/api/auth/me'), api.get('/api/meta')]); setUser(me.user); setMeta(m); } catch { setUser(null); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const h = () => setUser(null); window.addEventListener('eel-unauthenticated', h); return () => window.removeEventListener('eel-unauthenticated', h); }, []);
  useEffect(() => { setOpen(false); document.getElementById('main')?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, [loc.pathname]);

  // Ungespeicherte Änderungen: Klicks auf interne Links abfangen
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!(window as any).__eelDirty) return;
      const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
      if (a && a.origin === location.origin && !a.hasAttribute('download') && !window.confirm('Es gibt ungespeicherte Änderungen. Wirklich verlassen?')) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('click', h, true);
    return () => document.removeEventListener('click', h, true);
  }, []);

  const toast = useCallback((msg: string, err?: boolean) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), err ? 9000 : 5000);
  }, []);

  if (user === undefined) return <main><Loading what="Portal" /></main>;
  if (!user || !meta) return <ToastCtx.Provider value={toast}><Login onDone={load} /></ToastCtx.Provider>;

  const staff = user.role !== 'kunde';
  const can = (p: string) => user.permissions.includes(p);
  const logout = async () => { await api.post('/api/auth/logout'); setUser(null); nav('/'); };
  const items: [string, string][] = staff
    ? [['/', 'Übersicht'], ['/kriterien', 'Kriterien'], ['/testfaelle', 'Testfälle'], ['/pruefungen', 'Prüfungen'], ['/freigaben', 'Freigaben'], ['/berichte', 'Berichte']]
    : [['/pruefungen', 'Prüfungen'], ['/berichte', 'Berichte']];

  return (
    <AuthCtx.Provider value={{ user, meta, can, staff, logout }}>
      <ToastCtx.Provider value={toast}>
        <a href="#main" className="skip">Zum Inhalt springen</a>
        <header className="top">
          <NavLink to={staff ? '/' : '/pruefungen'} className="brand">EEL Prüfportal<small>KI unterstützt. Menschen entscheiden.</small></NavLink>
          <button className="menu-btn" aria-expanded={open} aria-controls="mainnav" onClick={() => setOpen(!open)}>Menü</button>
          <nav id="mainnav" className={`main ${open ? 'open' : ''}`} aria-label="Hauptnavigation">
            {items.map(([to, t]) => <NavLink key={to} to={to} end={to === '/'}>{t}</NavLink>)}
          </nav>
          <div className="userbox">
            <button onClick={() => setHelp(true)} aria-label="Abkürzungen erklären">Abkürzungen</button>
            {staff && <NavLink to="/einstellungen">Einstellungen</NavLink>}
            <span className="who" title={user.org}>{user.name}<small>{ROLE_LABEL[user.role] ?? user.role}</small></span>
            <button onClick={logout}>Abmelden</button>
          </div>
        </header>
        {meta.demoKiModus && <div className="banner warn" style={{ margin: 0, borderRadius: 0 }} role="note"><strong>Demo-KI-Modus aktiv.</strong> Kriterien werden regelbasiert statt per KI abgeleitet und sind als „Demo-Ableitung“ gekennzeichnet.</div>}
        <main id="main" tabIndex={-1} style={{ outline: 'none' }}>
          <Routes>
            <Route path="/" element={staff ? <Dashboard /> : <Navigate to="/pruefungen" replace />} />
            <Route path="/kriterien" element={staff ? <Kriterien /> : <Navigate to="/pruefungen" replace />} />
            <Route path="/kriterien/:id" element={staff ? <CriterionDetail /> : <Navigate to="/pruefungen" replace />} />
            <Route path="/testfaelle" element={staff ? <Testfaelle /> : <Navigate to="/pruefungen" replace />} />
            <Route path="/testfaelle/:id" element={staff ? <TestcaseDetail /> : <Navigate to="/pruefungen" replace />} />
            <Route path="/pruefungen" element={<Pruefungen />} />
            <Route path="/pruefungen/:id" element={<CampaignDetail />} />
            <Route path="/laeufe/:id" element={<RunDetail />} />
            <Route path="/freigaben" element={staff ? <Freigaben /> : <Navigate to="/pruefungen" replace />} />
            <Route path="/berichte" element={<Berichte />} />
            <Route path="/berichte/:id" element={<ReportDetail />} />
            <Route path="/einstellungen/*" element={staff ? <Einstellungen /> : <Navigate to="/pruefungen" replace />} />
            <Route path="*" element={<><h1>Seite nicht gefunden</h1><p>Diese Adresse gibt es nicht. Nutzen Sie die Navigation oben.</p></>} />
          </Routes>
        </main>
        {help && (
          <Modal title="Abkürzungen und Fachbegriffe" onClose={() => setHelp(false)}>
            <dl className="facts" style={{ gridTemplateColumns: 'minmax(90px,max-content) 1fr' }}>{meta.glossar.map((g) => <React.Fragment key={g.term}><dt><strong>{g.term}</strong></dt><dd>{g.meaning}</dd></React.Fragment>)}</dl>
          </Modal>
        )}
        <div className="toasts" aria-live="polite" role="status">{toasts.map((t) => <div key={t.id} className={`toast ${t.err ? 'err' : ''}`}>{t.msg}</div>)}</div>
      </ToastCtx.Provider>
    </AuthCtx.Provider>
  );
}
