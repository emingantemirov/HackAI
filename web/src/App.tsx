import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from './api';
import { AuthCtx, Meta, Modal, ROLE_LABEL, ToastCtx, User, Loading, Field } from './ui';
import { Icon, Logo } from './viz';
import { Dashboard } from './pages/Dashboard';
import { Kriterien, CriterionDetail } from './pages/Kriterien';
import { Testfaelle, TestcaseDetail } from './pages/Testfaelle';
import { Pruefungen, CampaignDetail, RunDetail } from './pages/Pruefungen';
import { Freigaben } from './pages/Freigaben';
import { Berichte, ReportDetail } from './pages/Berichte';
import { Einstellungen } from './pages/Einstellungen';

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e: string, p: string) => { setBusy(true); setErr(''); try { await api.post('/api/auth/login', { email: e, password: p }); onDone(); } catch (x: any) { setErr(x instanceof ApiError ? x.message : 'Anmeldung nicht möglich.'); } finally { setBusy(false); } };
  return (
    <main style={{ maxWidth: 440, paddingTop: 70 }}>
      <div style={{ textAlign: 'center', marginBottom: 22 }}><Logo size={56} /><h1 style={{ marginTop: 10 }}>EEL Prüfportal</h1><p className="lead" style={{ margin: '0 auto' }}>KI unterstützt. Menschen entscheiden.</p></div>
      <form className="card" onSubmit={(e) => { e.preventDefault(); go(email, pw); }}>
        {err && <div className="banner bad" role="alert">{err}</div>}
        <Field id="email" label="E-Mail"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field id="pw" label="Passwort"><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
        <button className="primary" disabled={busy} style={{ width: '100%' }}>Anmelden</button>
      </form>
      <details style={{ marginTop: 12 }}><summary>Demo-Zugänge</summary>
        <p className="hint">Synthetische Konten. Das Passwort steht in der README.</p>
        <div className="row">{[['pruefer@demo.example', 'Prüfer'], ['fachbearbeitung@demo.example', 'Fachbearbeitung'], ['kunde@demo.example', 'Kunde'], ['admin@demo.example', 'Admin']].map(([m, l]) => <button key={m} type="button" onClick={() => { setEmail(m); document.getElementById('pw')?.focus(); }}>{l}</button>)}</div>
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
  const [pending, setPending] = useState(0);
  const nav = useNavigate(); const loc = useLocation();

  const load = useCallback(async () => {
    try { const [me, m] = await Promise.all([api.get('/api/auth/me'), api.get('/api/meta')]); setUser(me.user); setMeta(m); } catch { setUser(null); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const h = () => setUser(null); window.addEventListener('eel-unauthenticated', h); return () => window.removeEventListener('eel-unauthenticated', h); }, []);
  useEffect(() => { setOpen(false); document.getElementById('main')?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, [loc.pathname]);

  useEffect(() => { if (user && user.role !== 'kunde') api.get('/api/dashboard').then((d: any) => setPending(d.wartendAufFreigabe?.gesamt ?? 0)).catch(() => {}); }, [user, loc.pathname]);

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
    ? [['/', 'Übersicht'], ['/kriterien', 'Kriterien'], ['/testfaelle', 'Testfälle'], ['/pruefungen', 'Prüfungen'], ['/freigaben', 'Freigaben']]
    : [['/pruefungen', 'Prüfungen'], ['/berichte', 'Berichte']];

  return (
    <AuthCtx.Provider value={{ user, meta, can, staff, logout }}>
      <ToastCtx.Provider value={toast}>
        <a href="#main" className="skip">Zum Inhalt springen</a>
        <header className="top">
          <NavLink to={staff ? '/' : '/pruefungen'} className="brand"><Logo size={30} />EEL Prüfportal</NavLink>
          <button className="menu-btn iconbtn" aria-expanded={open} aria-controls="mainnav" aria-label="Menü" onClick={() => setOpen(!open)}><Icon n="menu" /></button>
          <nav id="mainnav" className={`main ${open ? 'open' : ''}`} aria-label="Hauptnavigation">
            {items.map(([to, t]) => <NavLink key={to} to={to} end={to === '/'}>{t}{to === '/freigaben' && pending > 0 && <span className="pill-n" aria-label={`${pending} offen`}>{pending}</span>}</NavLink>)}
          </nav>
          <div className="userbox">
            {meta.demoKiModus && <span className="demo-chip" title="Kriterien werden regelbasiert statt per KI abgeleitet und als Demo-Ableitung gekennzeichnet.">Demo-KI</span>}
            <button className="iconbtn" onClick={() => setHelp(true)} aria-label="Abkürzungen erklären" title="Abkürzungen"><Icon n="help" /></button>
            {staff && <NavLink className="iconbtn" to="/einstellungen" aria-label="Einstellungen" title="Einstellungen"><Icon n="gear" /></NavLink>}
            <span className="who" title={user.org}>{user.name}<small>{ROLE_LABEL[user.role] ?? user.role}</small></span>
            <button className="iconbtn" onClick={logout} aria-label="Abmelden" title="Abmelden"><Icon n="out" /></button>
          </div>
        </header>
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
