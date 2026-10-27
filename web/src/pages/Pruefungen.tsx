import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Annot, Async, Badge, ConfirmReason, DemoTag, Empty, Field, FilterChips, Modal, PageHead, Tabs, Tone, api, fmtDate, fmtTime, useAction, useAsync, useAuth, useToast } from '../ui';
import { SollView, TYPE_LABEL } from './Shared';

export function Pruefungen() {
  const [sp, setSp] = useSearchParams(); const { meta, can, staff } = useAuth();
  const status = sp.get('status') ?? ''; const grundlage = sp.get('grundlage') ?? '';
  const view = sp.get('ansicht') ?? (status || grundlage ? 'laeufe' : 'pruefungen');
  const camps = useAsync(() => api.get('/api/campaigns'), []);
  const runs = useAsync(() => api.get(`/api/runs?${new URLSearchParams({ ...(status ? { status } : {}), ...(grundlage ? { grundlage } : {}) })}`), [status, grundlage]);
  const [neu, setNeu] = useState(false);
  return (
    <>
      <PageHead title="Prüfungen" lead={staff ? 'Eine Prüfung bindet freigegebene Testfälle an eine Softwareversion. Das Prüfpaket geht an die Prüfperson oder den Hersteller; die Rückgabedaten werden hier importiert und mit dem Soll verglichen.' : 'Ihre Prüfungen: Prüfpaket herunterladen, die Software testen und die erzeugten Dateien hochladen.'}
        actions={can('campaign:manage') && <button className="primary" onClick={() => setNeu(true)}>Neue Prüfung</button>} />
      <Tabs label="Ansicht" current={view} onChange={(k) => setSp(k === 'pruefungen' ? {} : { ansicht: k })} items={[['pruefungen', 'Prüfungen'], ['laeufe', 'Testläufe']]} />
      {view === 'pruefungen' && <div className="card"><Async s={camps}>{(d: any) => d.eintraege.length === 0 ? <Empty>Noch keine Prüfung angelegt.</Empty> : (
        <div className="tablewrap"><table><caption>{d.eintraege.length} Prüfungen</caption><thead><tr><th>Name</th><th>Hersteller</th><th>Software</th><th>Testdatum</th><th>Läufe</th><th>Status</th></tr></thead>
          <tbody>{d.eintraege.map((c: any) => <tr key={c.id}><td><Link to={`/pruefungen/${c.id}`}>{c.name}</Link></td><td>{c.customer}</td><td>{c.vendor} {c.product} {c.sw_version}</td><td>{fmtDate(c.test_date)}</td><td className="ratio">{c.passed} von {c.runs} bestanden</td><td><Badge kind="camp" value={c.status} /></td></tr>)}</tbody></table></div>)}</Async></div>}
      {view === 'laeufe' && (
        <div className="card">
          <FilterChips options={meta.laufFilter} value={status} onChange={(v) => setSp(v ? { ansicht: 'laeufe', status: v } : { ansicht: 'laeufe' })} />
          {grundlage && <p><Tone tone="warn">Gefiltert: Grundlage überholt</Tone> <button className="link" onClick={() => setSp({ ansicht: 'laeufe' })}>Filter aufheben</button></p>}
          <Async s={runs}>{(d: any) => d.eintraege.length === 0 ? <Empty>Keine Testläufe mit diesem Filter.</Empty> : (
            <div className="tablewrap"><table><caption>{d.eintraege.length} Testläufe</caption><thead><tr><th>Testfall</th><th>Titel</th><th>Prüfung</th><th>Status</th><th>Hinweis</th></tr></thead>
              <tbody>{d.eintraege.map((r: any) => <tr key={r.id}><td className="mono">{r.testcase_code} v{r.testcase_version}</td><td><Link to={`/laeufe/${r.id}`}>{r.title}</Link></td><td><Link to={`/pruefungen/${r.campaign_id}`}>{r.campaign_name}</Link></td><td><Badge kind="run" value={r.status} /></td><td>{r.basis_outdated && <Tone tone="warn">Grundlage überholt</Tone>}</td></tr>)}</tbody></table></div>)}</Async>
        </div>
      )}
      {neu && <NewCampaign onClose={() => setNeu(false)} />}
    </>
  );
}

function NewCampaign({ onClose }: { onClose: () => void }) {
  const nav = useNavigate(); const { busy, run } = useAction();
  const cu = useAsync(() => api.get('/api/customers'), []); const sw = useAsync(() => api.get('/api/software'), []); const rs = useAsync(() => api.get('/api/rulesets'), []);
  const [f, setF] = useState({ name: '', customerOrgId: '', softwareVersionId: '', rulesetId: '', testDate: '2026-04-15', scopeNote: '' });
  const up = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Neue Prüfung" onClose={onClose}>
      <Field id="p-name" label="Name"><input value={f.name} onChange={up('name')} /></Field>
      <Field id="p-cu" label="Hersteller / Kunde"><select value={f.customerOrgId} onChange={up('customerOrgId')}><option value="">Bitte wählen</option>{cu.data?.eintraege.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field id="p-sw" label="Softwareprofil" hint="bestimmt den Adapter"><select value={f.softwareVersionId} onChange={up('softwareVersionId')}><option value="">Bitte wählen</option>{sw.data?.eintraege.map((x: any) => <option key={x.id} value={x.id}>{x.vendor} {x.product} {x.version} – {x.adapter?.statusLabel}</option>)}</select></Field>
      <Field id="p-rs" label="Regelwerksstand"><select value={f.rulesetId} onChange={up('rulesetId')}><option value="">Bitte wählen</option>{rs.data?.eintraege.map((x: any) => <option key={x.id} value={x.id}>{x.label} (Dokument {x.document_version}, Datensatz {x.record_version})</option>)}</select></Field>
      <Field id="p-date" label="Fixes Testdatum" hint="Tagesdatum im Testkontext"><input type="date" value={f.testDate} onChange={up('testDate')} /></Field>
      <Field id="p-note" label="Anmerkung zum Prüfumfang" hint="optional"><textarea value={f.scopeNote} onChange={up('scopeNote')} /></Field>
      <button className="primary" disabled={busy || !f.name || !f.customerOrgId || !f.softwareVersionId || !f.rulesetId} onClick={async () => { const r = await run(() => api.post('/api/campaigns', f), 'Prüfung angelegt.'); if (r) { onClose(); nav(`/pruefungen/${r.id ?? r.campaignId}`); } }}>Prüfung anlegen</button>
    </Modal>
  );
}

export function CampaignDetail() {
  const { id } = useParams(); const { can, staff, meta } = useAuth(); const { busy, run } = useAction(); const toast = useToast();
  const s = useAsync(() => api.get(`/api/campaigns/${id}`), [id]);
  const [pv, setPv] = useState<any>(null); const [file, setFile] = useState<File | null>(null); const [enc, setEnc] = useState(''); const [target, setTarget] = useState('');
  const [fault, setFault] = useState('keine'); const [assign, setAssign] = useState<any>(null);
  return (
    <Async s={s}>{(d: any) => {
      const c = d.pruefung; const ad = d.adapter;
      return (
        <>
          <p><Link to="/pruefungen">← Alle Prüfungen</Link></p>
          <PageHead title={c.name} lead={<><Badge kind="camp" value={c.status} /> &nbsp;{c.customer} · {c.vendor} {c.product} {c.sw_version} · Testdatum {fmtDate(c.test_date)}</>} />
          <div className="grid two">
            <section className="card"><h2>Grundlagen</h2>
              <dl className="facts"><dt>Regelwerk</dt><dd>{c.rs_label} – Dokumentversion {c.document_version}, Datensatzversion {c.record_version}</dd><dt>Gültig</dt><dd>{fmtDate(c.rs_from)} bis {c.rs_to ? fmtDate(c.rs_to) : 'offen'}</dd>
                {c.transition_note && <><dt>Übergang</dt><dd>{c.transition_note}</dd></>}
                <dt>Adapter</dt><dd>{ad?.label} <Tone tone={ad?.status === 'implementiert' ? 'ok' : ad?.status === 'simulator' ? 'info' : 'warn'}>{ad?.statusLabel}</Tone></dd></dl>
              {ad?.status === 'nicht_konfiguriert' && <div className="banner warn">Für dieses Softwareprofil ist <strong>noch keine Schnittstelle konfiguriert</strong>. Es wird keine Kompatibilität behauptet; nutzen Sie den manuellen Ablauf mit einem Softwareprofil „Manuell“.</div>}
              {ad?.limitations?.length > 0 && <details><summary>Grenzen dieses Adapters</summary><ul>{ad.limitations.map((l: string) => <li key={l}>{l}</li>)}</ul></details>}
              {c.scope_note && <p><strong>Prüfumfang:</strong> {c.scope_note}</p>}
            </section>
            {staff && d.zertifizierung && <Certification d={d.zertifizierung} campaignId={c.id} onChange={s.reload} />}
          </div>

          <section className="card"><div className="row spread"><h2>Testläufe</h2>{can('campaign:manage') && <button disabled={busy} onClick={async () => { const r = await run(() => api.post(`/api/campaigns/${c.id}/runs`, {}), (x: any) => `${x.runs?.length ?? 0} Testläufe hinzugefügt${x.skipped?.length ? `, ${x.skipped.length} übersprungen` : ''}.`); if (r) s.reload(); }}>Freigegebene Testfälle hinzufügen</button>}</div>
            {d.laeufe.length === 0 ? <Empty>Noch keine Testläufe. Es werden nur freigegebene Testfallversionen gebunden.</Empty> : (
              <div className="tablewrap"><table><caption>{d.laeufe.length} Testläufe</caption><thead><tr><th>Testfall</th><th>Titel</th><th>Art</th><th>AZVU</th><th>Status</th><th>Hinweis</th></tr></thead>
                <tbody>{d.laeufe.map((r: any) => <tr key={r.id}><td className="mono">{r.code} v{r.version}</td><td><Link to={`/laeufe/${r.id}`}>{r.title}</Link></td><td>{TYPE_LABEL[r.test_type]}</td><td className="mono">{r.azvu}</td><td><Badge kind="run" value={r.status} /></td><td>{r.basis_outdated && <Tone tone="warn">Grundlage überholt</Tone>}{r.blocked_reason && ` ${r.blocked_reason}`}</td></tr>)}</tbody></table></div>)}
          </section>

          <section className="card"><h2>Prüfpaket</h2>
            <p className="hint">Das Paket enthält nur Eingangsdaten und Anweisungen – <strong>keine Soll-Werte</strong>.</p>
            {can('campaign:manage') && <div className="row"><button disabled={busy} onClick={async () => setPv(await run(() => api.get(`/api/campaigns/${c.id}/package/preview`)))}>Vorschau und Prüfung</button>
              <button className="primary" disabled={busy || (pv && !pv.preview?.ok)} onClick={async () => { const r = await run(() => api.post(`/api/campaigns/${c.id}/package`, {}), (x: any) => `Prüfpaket ${x.packageNo} erzeugt (${x.runs} Testläufe).`); if (r) { setPv(null); s.reload(); } }}>Paket erzeugen</button></div>}
            {pv && <div style={{ marginTop: 10 }}>
              {pv.preview?.errors?.length > 0 && <div className="banner bad" role="alert"><strong>Das Paket kann so nicht erzeugt werden:</strong><ul>{pv.preview.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul></div>}
              {pv.preview?.warnings?.length > 0 && <div className="banner warn"><ul>{pv.preview.warnings.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul></div>}
              {pv.preview?.ok && <div className="banner ok">Das Paket ist gültig und enthält {pv.runs.length} Testläufe.</div>}
              {pv.excluded?.length > 0 && <div className="banner warn"><strong>Nicht enthalten:</strong><ul>{pv.excluded.map((e: any, i: number) => <li key={i}>{e.code ?? e.runId}: {e.reason}</li>)}</ul></div>}
            </div>}
            {d.pakete.length > 0 && <div className="tablewrap"><table><caption>Erzeugte Pakete</caption><thead><tr><th>Nr.</th><th>Datei</th><th>Erzeugt</th><th>Prüfsumme</th></tr></thead><tbody>{d.pakete.map((p: any) => <tr key={p.id}><td>{p.package_no}</td><td><a href={`/api/packages/${p.id}/download`}>{p.file_name}</a></td><td>{fmtTime(p.created_at)}</td><td className="mono">{p.sha256.slice(0, 12)}…</td></tr>)}</tbody></table></div>}
          </section>

          {ad?.status === 'simulator' && can('campaign:manage') && (
            <section className="card"><div className="row spread"><h2>Simulator</h2><DemoTag>Demonstration, keine echte Software</DemoTag></div>
              <p className="hint">Der Simulator erzeugt Ausgabedateien, die dieselbe Importstrecke durchlaufen wie echte Rückgaben. Wählen Sie ein Fehlerbild, um zu sehen, dass der Vergleich Abweichungen erkennt.</p>
              <div className="row"><div><label htmlFor="sim">Fehlerbild</label><select id="sim" value={fault} onChange={(e) => setFault(e.target.value)}>{meta.simulatorFehlerbilder.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></div>
                <button className="primary" disabled={busy} style={{ alignSelf: 'flex-end' }} onClick={async () => { const r = await run(() => api.post(`/api/campaigns/${c.id}/simulator`, { fault }), (x: any) => (x.log?.length ? `Simulator ausgeführt: ${x.log.length} Rückgabe(n) importiert und verglichen.` : 'Es wartet kein Testlauf auf Rückgabe. Bitte zuerst Testläufe hinzufügen und das Prüfpaket erzeugen.')); if (r) s.reload(); }}>Simulator ausführen</button></div>
            </section>
          )}

          {can('import:upload') && (
            <section className="card"><h2>Rückgabedaten importieren</h2>
              <p className="hint">EEL-Ausgabedatei der Software. Der Zeichensatz wird nicht geraten: Ist er nicht eindeutig, wählen Sie ihn hier aus oder die Datei wird mit einer Warnung abgewiesen.</p>
              <div className="form-grid"><Field id="imp-f" label="Datei"><input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
                <Field id="imp-r" label="Testlauf" hint="optional; sonst über das AZVU"><select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Automatisch über AZVU zuordnen</option>{d.laeufe.map((r: any) => <option key={r.id} value={r.id}>{r.code} – {r.title}</option>)}</select></Field>
                <Field id="imp-e" label="Zeichenkodierung" hint="optional"><select value={enc} onChange={(e) => setEnc(e.target.value)}><option value="">Nicht festgelegt</option><option value="utf-8">UTF-8</option><option value="iso-8859-1">ISO-8859-1</option></select></Field></div>
              <button className="primary" disabled={busy || !file} onClick={async () => {
                const fd = new FormData(); fd.append('file', file!); if (enc) fd.append('encoding', enc); if (target) fd.append('runId', target);
                const r = await run(() => api.upload(`/api/campaigns/${c.id}/imports`, fd));
                if (r) { toast(r.message ?? 'Import abgeschlossen.', r.status === 'import_error'); setFile(null); s.reload(); }
              }}>Importieren</button>
            </section>
          )}

          <section className="card"><h2>Importierte Dateien</h2>
            {d.importe.length === 0 ? <Empty>Noch nichts importiert.</Empty> : (
              <div className="tablewrap"><table><thead><tr><th>Datei</th><th>Zeit</th><th>Status</th><th>Hinweise</th><th></th></tr></thead>
                <tbody>{d.importe.map((i: any) => <tr key={i.id}><td>{i.file_name}</td><td>{fmtTime(i.uploaded_at)}</td><td><Badge kind="imp" value={i.status} /></td>
                  <td>{i.error && <span>{i.error}</span>}{(i.warnings ?? []).length > 0 && <details><summary className="hint">{i.warnings.length} Hinweise zum Format</summary>{i.warnings.map((w: string, k: number) => <div key={k} className="hint">{w}</div>)}</details>}</td>
                  <td>{staff && i.status === 'assignment_required' && <button onClick={() => setAssign(i)}>Zuordnen …</button>}</td></tr>)}</tbody></table></div>)}
          </section>

          {staff && <ReportsSection campaignId={c.id} berichte={d.berichte} onChange={s.reload} />}
          {!staff && d.berichte.length > 0 && <section className="card"><h2>Bereitgestellte Berichte</h2><ul>{d.berichte.map((b: any) => <li key={b.version_id}><Link to={`/berichte/${b.id}`}>{b.code} – {b.title}</Link> (Version {b.version})</li>)}</ul></section>}
          {assign && <AssignImport imp={assign} runs={d.laeufe} onClose={() => setAssign(null)} onDone={() => { setAssign(null); s.reload(); }} />}
        </>
      );
    }}</Async>
  );
}

function AssignImport({ imp, runs, onClose, onDone }: { imp: any; runs: any[]; onClose: () => void; onDone: () => void }) {
  const [rid, setRid] = useState(''); const { busy, run } = useAction();
  return (
    <Modal title="Importdatei zuordnen" onClose={onClose}>
      <p>Die Datei <strong>{imp.file_name}</strong> enthält kein AZVU dieser Prüfung und wurde deshalb <strong>nicht</strong> als Ergebnis gewertet. Ordnen Sie sie einem Testlauf zu:</p>
      <Field id="as-r" label="Testlauf"><select value={rid} onChange={(e) => setRid(e.target.value)}><option value="">Bitte wählen</option>{runs.map((r) => <option key={r.id} value={r.id}>{r.code} – {r.title}</option>)}</select></Field>
      <button className="primary" disabled={busy || !rid} onClick={async () => { if (await run(() => api.post(`/api/imports/${imp.id}/assign`, { runId: rid }), 'Zugeordnet und verglichen.')) onDone(); }}>Zuordnen und vergleichen</button>
    </Modal>
  );
}

function Certification({ d, campaignId, onChange }: { d: any; campaignId: string; onChange: () => void }) {
  const { can } = useAuth(); const { busy, run } = useAction(); const [dlg, setDlg] = useState<'certified' | 'withheld' | null>(null);
  const tone = d.state === 'zertifiziert' ? 'ok' : d.state === 'bestanden' ? 'info' : ['nicht_bestanden', 'versagt', 'grundlage_geaendert'].includes(d.state) ? 'bad' : 'neutral';
  return (
    <section className="card accent"><h2>Zertifizierung</h2>
      <p><Tone tone={tone}>{d.label}</Tone></p>
      <ul style={{ listStyle: 'none', paddingLeft: 0 }}>{d.checks.map((c: any) => <li key={c.key} style={{ padding: '3px 0' }}><span className={`badge ${c.ok ? 'ok' : 'warn'}`}><span aria-hidden="true">{c.ok ? '✔' : '⚠'}</span>{c.ok ? 'Erfüllt' : 'Offen'}</span> <strong>{c.label}</strong><div className="hint" style={{ marginLeft: 6 }}>{c.detail}</div></li>)}</ul>
      {d.lastDecision && <p className="hint">Letzte Entscheidung: {d.lastDecision.label} – {d.lastDecision.by}, {fmtTime(d.lastDecision.decided_at)}. Begründung: {d.lastDecision.reason}</p>}
      <p className="hint">„Bestanden“ ist ein Prüfergebnis. „Zertifiziert im Demo-Prüfumfang“ ist eine <strong>eigene, dokumentierte Entscheidung</strong> einer berechtigten Person – die KI trifft sie nie.</p>
      {can('certification:decide') ? <div className="row"><button className="primary" disabled={busy || !d.ready} onClick={() => setDlg('certified')}>Zertifizieren (Demo-Prüfumfang) …</button><button className="danger" disabled={busy} onClick={() => setDlg('withheld')}>Zertifizierung versagen …</button></div> : <p className="hint">Diese Entscheidung ist berechtigten Personen vorbehalten.</p>}
      {!d.ready && can('certification:decide') && <p className="hint">Zertifizieren ist erst möglich, wenn alle Voraussetzungen erfüllt sind.</p>}
      <p className="hint">{d.disclaimer}</p>
      {dlg && <ConfirmReason title={dlg === 'certified' ? 'Zertifizierung im Demo-Prüfumfang' : 'Zertifizierung versagen'} label="Begründung der Entscheidung" confirmLabel={dlg === 'certified' ? 'Entscheidung dokumentieren: zertifiziert' : 'Entscheidung dokumentieren: versagt'} danger={dlg === 'withheld'} onCancel={() => setDlg(null)}
        intro={<p className="banner info">{d.disclaimer}</p>}
        onConfirm={async (reason) => { if (await run(() => api.post(`/api/campaigns/${campaignId}/certification`, { decision: dlg, reason }), 'Entscheidung dokumentiert.')) { setDlg(null); onChange(); } }} />}
    </section>
  );
}

function ReportsSection({ campaignId, berichte, onChange }: { campaignId: string; berichte: any[]; onChange: () => void }) {
  const { can } = useAuth(); const { busy, run } = useAction();
  const create = async (kind: string) => { if (await run(() => api.post(`/api/campaigns/${campaignId}/reports`, { kind }), 'Berichtsentwurf angelegt.')) onChange(); };
  return (
    <section className="card"><h2>Berichte</h2>
      {berichte.length === 0 ? <Empty>Noch kein Bericht. Berichte werden aus den Vergleichsergebnissen erstellt und müssen freigegeben werden, bevor sie bereitgestellt werden.</Empty> : <ul>{berichte.map((b) => <li key={b.id}><Link to={`/berichte/${b.id}`}>{b.code} – {b.title}</Link> v{b.version} <Badge kind="obj" value={b.status} /></li>)}</ul>}
      {can('content:write') && <div className="row"><button disabled={busy} onClick={() => create('fehlerbericht')}>Fehlerbericht erstellen</button><button disabled={busy} onClick={() => create('pruefbericht')}>Prüfbericht erstellen</button></div>}
    </section>
  );
}

// ---------------- Testlauf, Soll/Ist ----------------
export function RunDetail() {
  const { id } = useParams(); const { staff, can } = useAuth(); const { busy, run } = useAction();
  const s = useAsync(() => api.get(`/api/runs/${id}`), [id]);
  const [cmpId, setCmpId] = useState<string | null>(null);
  const [dlg, setDlg] = useState<'attest' | 'finalize' | null>(null);
  return (
    <Async s={s}>{(r: any) => {
      const latest = cmpId ?? r.vergleiche?.[0]?.id ?? null;
      return (
        <>
          <p><Link to={`/pruefungen/${r.campaign_id}`}>← Zur Prüfung</Link></p>
          <PageHead title={`${r.testfall.code} v${r.testfall.version} · ${r.testfall.titel}`} lead={<><Badge kind="run" value={r.status} /> &nbsp;AZVU <span className="mono">{r.azvu}</span> · Stufe {r.stage}</>} />
          {r.grundlageUeberholt && <div className="banner bad" role="alert"><strong>Grundlage überholt.</strong> {r.hinweisGrundlage} Das Ergebnis gilt nicht mehr als belastbar; ein neuer Lauf auf der aktuellen Testfallversion ist nötig.</div>}
          {r.grund && <div className="banner warn">{r.grund}</div>}
          {staff ? (
            <>
              <div className="grid two">
                <section className="card"><h2>Ausgangslage</h2><p><Annot text={r.eingangsdaten ?? '–'} /></p><h3>Herleitung des Soll</h3><p style={{ whiteSpace: 'pre-wrap' }}><Annot text={r.herleitung} /></p></section>
                <section className="card"><h2>Soll-Ergebnis</h2><SollView expected={r.soll} events={r.ereignisse} />{r.beobachtung && <p><strong>Testabschluss:</strong> {r.beobachtung}</p>}</section>
              </div>
              <section className="card"><h2>Soll/Ist-Vergleich</h2>
                {!latest ? <Empty>Noch kein Vergleich. Importieren Sie eine Rückgabedatei.</Empty> : <Comparison id={latest} list={r.vergleiche} onPick={setCmpId} />}
              </section>
              <section className="card"><h2>Folgeantworten und Abschluss</h2>
                <p className="hint">Mehrstufige Testfälle brauchen Antworten der Krankenkasse. Das Portal erzeugt sie als Datei zum Einspielen in die Software.</p>
                {r.folgeantworten.length > 0 && <ul>{r.folgeantworten.map((f: any) => <li key={f.id}>Stufe {f.stage}: <a href={`/api/followups/${f.id}/download`}>{f.file_name}</a> – {f.note}</li>)}</ul>}
                <div className="row">
                  {can('campaign:manage') && ['awaiting_return', 'exported'].includes(r.status) && <button disabled={busy} onClick={async () => { const x = await run(() => api.post(`/api/runs/${r.id}/followup`), (z: any) => z.reused ? 'Die Folgeantwort lag schon vor.' : 'Folgeantwort erzeugt.'); if (x) s.reload(); }}>Nächste Folgeantwort erzeugen</button>}
                  {can('campaign:manage') && r.erwartetKeineMeldung && !r.abschluss && <button onClick={() => setDlg('attest')}>Testabschluss dokumentieren …</button>}
                  {can('campaign:manage') && !['passed', 'failed'].includes(r.status) && <button onClick={() => setDlg('finalize')}>Lauf ohne Rückgabe abschließen …</button>}
                </div>
                {r.abschluss && <p className="hint">Abschluss dokumentiert am {fmtTime(r.abschluss.at)}: {r.abschluss.note}</p>}
              </section>
            </>
          ) : (
            <section className="card"><h2>Ablauf</h2><div className="tablewrap"><table><thead><tr><th>Stufe</th><th>Beteiligte</th><th>Art</th><th>Beschreibung</th></tr></thead><tbody>{r.ereignisse.map((e: any, i: number) => <tr key={i}><td>{e.stage}</td><td>{e.actor}</td><td>{e.kind}</td><td>{e.text}</td></tr>)}</tbody></table></div>
              {r.folgeantworten.length > 0 && <ul>{r.folgeantworten.map((f: any) => <li key={f.id}>Stufe {f.stage}: <a href={`/api/followups/${f.id}/download`}>{f.file_name}</a></li>)}</ul>}
              <p className="hint">Soll-Werte und Vergleichsdetails sehen Sie nur in freigegebenen, bereitgestellten Berichten.</p></section>
          )}
          {dlg && <ConfirmReason title={dlg === 'attest' ? 'Testabschluss dokumentieren' : 'Lauf ohne Rückgabe abschließen'} label={dlg === 'attest' ? 'Beobachtung und Beobachtungszeitraum' : 'Begründung'} confirmLabel="Dokumentieren" onCancel={() => setDlg(null)}
            intro={<p className="hint">{dlg === 'attest' ? 'Für „es darf keine Meldung entstehen“ muss die Beobachtung dokumentiert werden; ohne diese Bestätigung gilt der Lauf nie als bestanden.' : 'Der Lauf wird ohne Rückgabedaten geschlossen. Er gilt dann nicht als bestanden.'}</p>}
            onConfirm={async (note) => { if (await run(() => api.post(`/api/runs/${r.id}/${dlg === 'attest' ? 'attest' : 'finalize'}`, { note }), 'Dokumentiert.')) { setDlg(null); s.reload(); } }} />}
        </>
      );
    }}</Async>
  );
}

function Comparison({ id, list, onPick }: { id: string; list: any[]; onPick: (id: string) => void }) {
  const s = useAsync(() => api.get(`/api/comparisons/${id}`), [id]);
  const crit = useAsync(() => api.get('/api/objects/criteria').catch(() => ({ eintraege: [] })), []);
  const [raw, setRaw] = useState<any>(null);
  const critFor = (k: string | null) => k ? (crit.data?.eintraege ?? []).find((c: any) => c.slug === k || c.object_id.startsWith(k)) : null;
  return (
    <Async s={s}>{(c: any) => (
      <>
        <div className="row spread"><p><Badge kind="out" value={c.outcome} /> &nbsp;{c.summary.reason}</p>
          {list.length > 1 && <div><label htmlFor="cmpv" className="hint">Vergleichsstand</label><select id="cmpv" value={id} onChange={(e) => onPick(e.target.value)}>{list.map((x: any) => <option key={x.id} value={x.id}>{fmtTime(x.created_at)} – {x.outcome}</option>)}</select></div>}</div>
        <p className="ratio hint">{c.summary.ok} von {c.summary.total} Prüfzeilen stimmen überein · {c.summary.abweichung} Abweichungen · {c.summary.fehlt} fehlen · {c.summary.unerwartet} unerwartet · {c.summary.nichtBewertet} nicht bewertet</p>
        <div className="tablewrap"><table><caption>Feld für Feld: Soll gegen Ist</caption>
          <thead><tr><th>Stufe</th><th>Feld</th><th>Soll</th><th>Ist</th><th>Ergebnis</th><th>Fachlicher Bezug</th><th>Rohdaten</th></tr></thead>
          <tbody>{c.rows.map((x: any, i: number) => {
            const k = critFor(x.criterion);
            return (
              <tr key={i}><td>{x.stage}</td><td>{x.label}<div className="hint mono">{x.field}</div></td><td>{x.expected}</td><td>{x.actual}</td>
                <td><Badge kind="cmp" value={x.result} />{x.result !== 'ok' && x.explanation && <div className="hint">{x.explanation}</div>}</td>
                <td>{k ? <Link to={`/kriterien/${k.object_id}`}>{k.code}</Link> : x.criterion ?? '–'}</td>
                <td>{x.source ? <button className="link" onClick={() => setRaw(x.source)}>Zeile {x.source.line}</button> : '–'}</td></tr>);
          })}</tbody></table></div>
        <details><summary>Angewandte Normalisierung und Toleranzen</summary><ul>{c.normalization.map((n: string) => <li key={n}>{n}</li>)}</ul></details>
        <p className="hint">Der Vergleich ist deterministisch (Geldbeträge in ganzen Cent). Die KI darf Abweichungen erklären, aber nicht über Gleichheit entscheiden.</p>
        {raw && <RawView src={raw} onClose={() => setRaw(null)} />}
      </>
    )}</Async>
  );
}

function RawView({ src, onClose }: { src: any; onClose: () => void }) {
  const s = useAsync(() => api.get(`/api/imports/${src.fileId}/bytes`), [src.fileId]);
  return (
    <Modal title={`Rohdaten: ${src.fileName}`} onClose={onClose} wide>
      <Async s={s}>{(d: any) => (
        <>
          <p className="hint">Kodierung: {d.kodierung}. Die markierte Stelle gehört zur gewählten Prüfzeile.</p>
          <pre className="raw" tabIndex={0} aria-label="Inhalt der Importdatei">{d.zeilen.map((l: any) => (
            <div key={l.nr} style={l.nr === src.line ? { background: '#26345c' } : undefined}><span style={{ opacity: .5 }}>{String(l.nr).padStart(3, ' ')} </span>
              {l.nr === src.line ? <>{l.text.slice(0, src.start)}<mark className="hit">{l.text.slice(src.start, src.start + src.length)}</mark>{l.text.slice(src.start + src.length)}</> : l.text}</div>))}</pre>
        </>
      )}</Async>
    </Modal>
  );
}
