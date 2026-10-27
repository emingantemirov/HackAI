import React, { useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { Async, Empty, Field, PageHead, Tone, api, fmtDate, fmtTime, useAction, useAsync, useAuth } from '../ui';

export function Einstellungen() {
  const { can } = useAuth();
  const items: [string, string][] = [['ki', 'KI-Verbindung'], ['software', 'Softwareprofile'], ['regelwerke', 'Regelwerke'], ...(can('users:manage') ? [['benutzer', 'Benutzer'] as [string, string]] : []), ['protokoll', 'Protokoll']];
  return (
    <>
      <h1>Einstellungen</h1>
      <div className="tabs" role="navigation" aria-label="Einstellungen">{items.map(([k, l]) => <NavLink key={k} to={`/einstellungen/${k}`} className={({ isActive }) => (isActive ? 'active' : '')} aria-current={undefined}>{l}</NavLink>)}</div>
      <Routes>
        <Route index element={<Ai />} />
        <Route path="software" element={<Software />} />
        <Route path="regelwerke" element={<Rulesets />} />
        <Route path="ki" element={<Ai />} />
        <Route path="benutzer" element={<Users />} />
        <Route path="glossar" element={<Glossary />} />
        <Route path="protokoll" element={<AuditLog />} />
      </Routes>
    </>
  );
}

function Software() {
  const s = useAsync(() => api.get('/api/software'), []); const { meta, can } = useAuth(); const { busy, run } = useAction();
  const [f, setF] = useState({ vendor: '', product: '', version: '', adapterKey: 'manual' });
  return (
    <>
      <div className="card"><h2>Softwareprofile und Adapter</h2>
                <Async s={s}>{(d: any) => <div className="tablewrap"><table><thead><tr><th>Hersteller</th><th>Produkt</th><th>Version</th><th>Adapter</th><th>Status</th></tr></thead>
          <tbody>{d.eintraege.map((r: any) => <tr key={r.id}><td>{r.vendor}</td><td>{r.product}</td><td>{r.version}</td><td>{r.adapter?.label}</td><td><Tone tone={r.adapter?.status === 'implementiert' ? 'ok' : r.adapter?.status === 'simulator' ? 'info' : 'warn'}>{r.adapter?.statusLabel}</Tone></td></tr>)}</tbody></table></div>}</Async></div>
      <div className="grid two">
        {meta.adapter.map((a: any) => <section key={a.key} className="card"><h3 style={{ marginTop: 0 }}>{a.label} <Tone tone={a.status === 'implementiert' ? 'ok' : a.status === 'simulator' ? 'info' : 'warn'}>{a.statusLabel}</Tone></h3><p>{a.description}</p>
          <ul>{Object.entries(a.capabilities).map(([k, v]) => <li key={k}>{CAP[k] ?? k}: {v ? 'ja' : 'nein'}</li>)}</ul>{a.limitations.length > 0 && <><strong>Grenzen</strong><ul>{a.limitations.map((l: string) => <li key={l}>{l}</li>)}</ul></>}</section>)}
      </div>
      {can('campaign:manage') && <div className="card"><h3>Softwareprofil anlegen</h3>
        <div className="form-grid"><Field id="sw-v" label="Hersteller"><input value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} /></Field><Field id="sw-p" label="Produkt"><input value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} /></Field>
          <Field id="sw-ver" label="Version"><input value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} /></Field>
          <Field id="sw-a" label="Adapter"><select value={f.adapterKey} onChange={(e) => setF({ ...f, adapterKey: e.target.value })}>{meta.adapter.map((a: any) => <option key={a.key} value={a.key}>{a.label} – {a.statusLabel}</option>)}</select></Field></div>
        <button className="primary" disabled={busy || !f.vendor || !f.product || !f.version} onClick={async () => { if (await run(() => api.post('/api/software', f), 'Softwareprofil angelegt.')) { setF({ vendor: '', product: '', version: '', adapterKey: 'manual' }); s.reload(); } }}>Anlegen</button></div>}
    </>
  );
}
const CAP: Record<string, string> = { eingangsdatenExport: 'Eingangsdaten bereitstellen', ausgabeImport: 'Ausgabedateien importieren', folgeantworten: 'Folgeantworten der Krankenkasse', formatpruefung: 'Formatprüfung', automatischerLauf: 'Automatischer Lauf' };

function Rulesets() {
  const s = useAsync(() => api.get('/api/rulesets'), []); const { busy, run } = useAction(); const { can } = useAuth();
  const [f, setF] = useState({ label: '', documentVersion: '', recordVersion: '', validFrom: '', validTo: '', transitionNote: '' });
  const up = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <div className="card"><h2>Regelwerksstände</h2><p className="hint">Dokumentversion (z. B. 13.1) und Datensatzversion (z. B. 13) sind verschiedene Dinge und werden getrennt geführt.</p>
        <Async s={s}>{(d: any) => d.eintraege.length === 0 ? <Empty>Noch kein Regelwerk.</Empty> : <div className="tablewrap"><table><thead><tr><th>Bezeichnung</th><th>Dokumentversion</th><th>Datensatzversion</th><th>Gültig</th><th>Übergang</th></tr></thead>
          <tbody>{d.eintraege.map((r: any) => <tr key={r.id}><td>{r.label}</td><td>{r.document_version}</td><td>{r.record_version}</td><td>{fmtDate(r.valid_from)} – {r.valid_to ? fmtDate(r.valid_to) : 'offen'}</td><td>{r.transition_note}</td></tr>)}</tbody></table></div>}</Async></div>
      {can('settings:write') && <div className="card"><h3>Regelwerksstand anlegen</h3><div className="form-grid">
        <Field id="rs-l" label="Bezeichnung"><input value={f.label} onChange={up('label')} /></Field><Field id="rs-d" label="Dokumentversion"><input value={f.documentVersion} onChange={up('documentVersion')} /></Field><Field id="rs-r" label="Datensatzversion"><input value={f.recordVersion} onChange={up('recordVersion')} /></Field>
        <Field id="rs-f" label="Gültig ab"><input type="date" value={f.validFrom} onChange={up('validFrom')} /></Field><Field id="rs-t" label="Gültig bis" hint="optional"><input type="date" value={f.validTo} onChange={up('validTo')} /></Field></div>
        <Field id="rs-n" label="Übergangshinweis" hint="optional"><textarea value={f.transitionNote} onChange={up('transitionNote')} /></Field>
        <button className="primary" disabled={busy || !f.label || !f.documentVersion || !f.recordVersion || !f.validFrom} onClick={async () => { if (await run(() => api.post('/api/rulesets', { ...f, validTo: f.validTo || null }), 'Regelwerk angelegt.')) s.reload(); }}>Anlegen</button></div>}
    </>
  );
}

function Ai() {
  const s = useAsync(() => api.get('/api/ai/status'), []); const { can } = useAuth(); const { busy, run } = useAction();
  const [t, setT] = useState<any>(null); const [key, setKey] = useState(''); const [model, setModel] = useState('');
  const writable = can('settings:write');
  const show = (r: any) => { setT(r); s.reload(); };
  return (
    <div className="card"><h2>KI-Verbindung</h2>
      <Async s={s}>{(d: any) => {
        const ok = d.konfiguriert && d.state === 'verbunden';
        return (
          <>
            <p>{!d.konfiguriert ? <Tone tone="warn">Kein Schlüssel hinterlegt</Tone> : ok ? <Tone tone="ok">Verbunden</Tone> : <Tone tone="info">Schlüssel hinterlegt – noch nicht getestet</Tone>} {d.demoModus && <Tone tone="info">Demo-KI aktiv</Tone>}
              {d.konfiguriert && <span className="hint"> Quelle: {d.schluesselQuelle === 'env' ? 'Umgebung / .env' : 'Einstellungen'}{d.anbieter ? ` · ${({ claude: 'Claude (Anthropic)', gemini: 'Google Gemini', groq: 'Groq' } as Record<string, string>)[d.anbieter] ?? 'Hessian AI'}` : ''}{d.model ? ` · Modell ${d.model}` : ''}</span>}</p>
            {d.message && !ok && <p className="hint">{d.message}</p>}
            {writable && <>
              <Field id="ai-key" label="API-Schlüssel" hint="wird nur auf dem Server gespeichert und nie wieder angezeigt"><input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="AIza… / AQ.… (Google Gemini, kostenlos) · gsk_… (Groq) · sk-ant-… (Claude)" /></Field>
              <div className="row">
                <button className="primary" disabled={busy || key.trim().length < 8} onClick={async () => { const r = await run(() => api.post('/api/ai/key', { key, ...(model.trim() ? { model: model.trim() } : {}) })); if (r) { setKey(''); show(r); } }}>Speichern und testen</button>
                <button disabled={busy || !d.konfiguriert} onClick={async () => { const r = await run(() => api.post('/api/ai/test')); if (r) show(r); }}>Verbindung testen</button>
                {d.schluesselQuelle === 'einstellungen' && <button className="ghost" disabled={busy} onClick={async () => { const r = await run(() => api.post('/api/ai/key', { key: '' }), 'Schlüssel entfernt.'); if (r) show(r); }}>Schlüssel entfernen</button>}
              </div></>}
            {!writable && <p className="hint">Für diese Einstellung fehlt Ihrer Rolle die Berechtigung. Bitte mit einem Prüfer- oder Administratorkonto anmelden.</p>}
            {t && <div className={`banner ${t.state === 'verbunden' ? 'ok' : 'bad'}`} style={{ marginTop: 12 }} role="status"><strong>{t.state === 'verbunden' ? 'Verbindung erfolgreich.' : 'Verbindung nicht erfolgreich.'}</strong> {t.message ?? ''}</div>}
            <details style={{ marginTop: 12 }}><summary>Kostenlosen Schlüssel bekommen</summary><ol className="hint">
              <li><strong>Google Gemini (empfohlen):</strong> auf aistudio.google.com/apikey mit dem Google-Konto anmelden, „Create API key“ wählen und den Schlüssel (beginnt mit <span className="mono">AIza</span> oder <span className="mono">AQ.</span>) hier eintragen. Keine Kreditkarte nötig.</li>
              <li><strong>Groq:</strong> auf console.groq.com registrieren, unter „API Keys“ einen Schlüssel (<span className="mono">gsk_…</span>) erzeugen.</li></ol>
              <Field id="ai-model" label="Modell" hint="optional, nur falls der Standard abgelehnt wird"><input value={model} onChange={(e) => setModel(e.target.value)} placeholder="z. B. gemini-2.5-flash" /></Field></details>
            <details style={{ marginTop: 12 }}><summary>Alternativ per .env-Datei</summary><p className="hint">Im Projektordner eine Datei <span className="mono">.env</span> mit der Zeile <span className="mono">HAI_API_KEY=…</span> anlegen und den Server neu starten. Die Datei wird nicht in Git aufgenommen.</p></details>
          </>
        );
      }}</Async>
    </div>
  );
}

const ROLES: Record<string, string> = { admin: 'Administrator', fachbearbeitung: 'Fachbearbeitung', pruefer: 'Prüfer/Freigeber', kunde: 'Kunde/Hersteller' };
function Users() {
  const s = useAsync(() => api.get('/api/users'), []); const orgs = useAsync(() => api.get('/api/organizations'), []); const { busy, run } = useAction();
  const [f, setF] = useState({ orgId: '', name: '', email: '', role: 'fachbearbeitung', password: '' });
  return (
    <>
      <div className="card"><h2>Benutzer</h2><Async s={s}>{(d: any) => <div className="tablewrap"><table><thead><tr><th>Name</th><th>E-Mail</th><th>Rolle</th><th>Organisation</th><th>Aktiv</th></tr></thead><tbody>{d.eintraege.map((u: any) => <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{ROLES[u.role]}</td><td>{u.org}</td><td>{u.active ? 'Ja' : 'Nein'}</td></tr>)}</tbody></table></div>}</Async></div>
      <div className="card"><h3>Benutzer anlegen</h3><div className="form-grid">
        <Field id="u-n" label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field id="u-e" label="E-Mail"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field id="u-o" label="Organisation"><select value={f.orgId} onChange={(e) => setF({ ...f, orgId: e.target.value })}><option value="">Bitte wählen</option>{orgs.data?.eintraege.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
        <Field id="u-r" label="Rolle"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field id="u-p" label="Start-Passwort" hint="mindestens 10 Zeichen"><input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field></div>
        <button className="primary" disabled={busy || !f.orgId || !f.name || !f.email || f.password.length < 10} onClick={async () => { if (await run(() => api.post('/api/users', f), 'Benutzer angelegt.')) { setF({ ...f, name: '', email: '', password: '' }); s.reload(); } }}>Anlegen</button></div>
    </>
  );
}

function Glossary() {
  const { meta } = useAuth();
  return <div className="card"><h2>Abkürzungen und Fachbegriffe</h2><dl className="facts" style={{ gridTemplateColumns: 'minmax(120px,max-content) 1fr' }}>{meta.glossar.map((g) => <React.Fragment key={g.term}><dt><strong>{g.term}</strong></dt><dd>{g.meaning}</dd></React.Fragment>)}</dl></div>;
}

function AuditLog() {
  const s = useAsync(() => api.get('/api/audit?limit=200'), []);
  return <div className="card"><h2>Änderungsprotokoll</h2><p className="hint">Unveränderlich: Einträge können nicht geändert oder gelöscht werden. KI-Aktionen nennen Modell und Promptversion.</p>
    <Async s={s}>{(d: any) => <div className="tablewrap"><table><thead><tr><th>Zeit</th><th>Wer</th><th>Aktion</th><th>Objekt</th><th>Grund / KI</th></tr></thead>
      <tbody>{d.eintraege.map((e: any, i: number) => <tr key={i}><td>{fmtTime(e.at)}</td><td>{e.actor_label}{e.actor_kind === 'ki' ? ' (KI)' : ''}</td><td>{e.action}</td><td>{e.object_type}{e.object_version ? ` v${e.object_version}` : ''}</td><td>{e.reason ?? ''}{e.ai_model ? ` Modell ${e.ai_model}, Prompt ${e.prompt_version}` : ''}</td></tr>)}</tbody></table></div>}</Async></div>;
}
