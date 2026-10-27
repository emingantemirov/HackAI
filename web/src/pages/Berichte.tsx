import React, { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Annot, Async, Badge, DemoTag, Empty, Field, FilterChips, Modal, PageHead, Quote, Tone, api, fmtDate, fmtTime, useAction, useAsync, useAuth } from '../ui';
import { ApprovalPanel } from './Shared';

export function Berichte() {
  const { staff, meta } = useAuth(); const [sp, setSp] = useSearchParams(); const status = sp.get('status') ?? '';
  const s = useAsync(async () => {
    if (staff) return (await api.get(`/api/objects/reports${status ? `?status=${status}` : ''}`)).eintraege;
    const camps = (await api.get('/api/campaigns')).eintraege;
    const all = await Promise.all(camps.map((c: any) => api.get(`/api/campaigns/${c.id}`)));
    const seen = new Map<string, any>();
    all.flatMap((c: any) => c.berichte).forEach((b: any) => seen.set(b.id, { object_id: b.id, code: b.code, title: b.title, version: b.version, status: 'approved', kind: b.kind }));
    return [...seen.values()];
  }, [status, staff]);
  return (
    <>
      <PageHead title="Berichte" lead={staff ? 'Fehler- und Prüfberichte. Nur ein freigegebener Bericht darf bereitgestellt werden – Freigabe und Bereitstellung sind getrennte Schritte.' : 'Berichte, die Ihnen die Prüfstelle bereitgestellt hat.'} />
      {staff && <div className="card"><FilterChips options={meta.statusFilter} value={status} onChange={(v) => setSp(v ? { status: v } : {})} /></div>}
      <div className="card"><Async s={s}>{(rows: any[]) => rows.length === 0 ? <Empty>{staff ? 'Keine Berichte. Berichte werden in einer Prüfung aus den Vergleichsergebnissen erstellt.' : 'Es wurden noch keine Berichte bereitgestellt.'}</Empty> : (
        <div className="tablewrap"><table><caption>{rows.length} Berichte</caption><thead><tr><th>Kennung</th><th>Titel</th><th>Art</th><th>Version</th><th>Status</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.object_id}><td className="mono">{r.code}</td><td><Link to={`/berichte/${r.object_id}`}>{r.title}</Link></td><td>{r.kind === 'fehlerbericht' ? 'Fehlerbericht' : 'Prüfbericht'}</td><td>v{r.version}</td><td>{staff ? <Badge kind="obj" value={r.status} /> : <Tone tone="ok">Bereitgestellt</Tone>}</td></tr>)}</tbody></table></div>)}</Async></div>
    </>
  );
}

export function ReportDetail() {
  const { id } = useParams(); const { staff, can, meta } = useAuth(); const { busy, run } = useAction();
  const s = useAsync(() => api.get(`/api/objects/reports/${id}`), [id]);
  const [send, setSend] = useState(false);
  return (
    <Async s={s}>{(d: any) => {
      const v = d.versionen[0]; const c = v.content;
      const provided = (d.bereitstellungen ?? []).filter((x: any) => x.kind === 'bereitstellung');
      return (
        <>
          <p><Link to="/berichte">← Alle Berichte</Link></p>
          <PageHead title={`${d.objekt.code} · ${v.title}`} lead={<>{staff && <Badge kind="obj" value={v.status} />} &nbsp;Version {v.version} · Stand {fmtTime(c.stand)}</>} />
          {staff && v.status === 'approved' && provided.length === 0 && <div className="banner info">Dieser Bericht ist freigegeben, aber noch <strong>nicht bereitgestellt</strong>. Freigabe ist nicht Versand.</div>}
          <div className="grid two">
            <section className="card"><h2>Prüfgegenstand</h2>
              <dl className="facts"><dt>Software</dt><dd>{c.produkt.hersteller} {c.produkt.produkt} {c.produkt.version}</dd><dt>Kunde</dt><dd>{c.produkt.kunde}</dd><dt>Prüfung</dt><dd>{c.umfang.pruefung} ({c.umfang.bereich}), Testdatum {fmtDate(c.umfang.testdatum)}</dd>
                <dt>Regelwerk</dt><dd>{c.regelwerk.bezeichnung}, Dokumentversion {c.regelwerk.dokumentversion}, Datensatzversion {c.regelwerk.datensatzversion}</dd>
                <dt>Ergebnis</dt><dd className="ratio">{c.umfang.zaehlung.bestanden} von {c.umfang.zaehlung.gesamt} Testläufen bestanden, {c.umfang.zaehlung.nichtBestanden} nicht bestanden, {c.umfang.zaehlung.offen} offen</dd></dl>
            </section>
            <section className="card"><h2>Gesicherte Befunde</h2><p className="hint">Folgen unmittelbar aus den Vergleichszeilen.</p><ul>{c.gesicherteBefunde.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>
              <h3>Ursachenhypothesen <Tone tone="warn" icon="?">Vermutung, keine Feststellung</Tone></h3>
              {c.hypothesen.length ? <ul>{c.hypothesen.map((h: any, i: number) => <li key={i}><strong>{h.klasse}:</strong> {h.text} <span className="hint">({h.herkunft})</span></li>)}</ul> : <Empty>Keine Hypothesen.</Empty>}
            </section>
          </div>
          <section className="card"><h2>Abweichungen</h2>
            {c.abweichungen.length === 0 ? <Empty>Keine Abweichungen.</Empty> : <div className="tablewrap"><table><thead><tr><th>Testfall</th><th>Feld</th><th>Soll</th><th>Ist</th><th>Ergebnis</th><th>Fachlicher Bezug</th></tr></thead>
              <tbody>{c.abweichungen.map((a: any, i: number) => <tr key={i}><td>{a.testfall} v{a.testfallVersion}</td><td>{a.bezeichnung}</td><td>{a.soll}</td><td>{a.ist}</td><td><Tone tone="bad">{a.ergebnis === 'abweichung' ? 'Abweichung' : a.ergebnis === 'fehlt' ? 'Fehlt' : 'Unerwartet'}</Tone></td><td>{a.fachlicherBezug ?? '–'}</td></tr>)}</tbody></table></div>}
            {c.reproduktion.length > 0 && <><h3>Reproduktion</h3><ul>{c.reproduktion.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul></>}
          </section>
          {c.kriterien.length > 0 && <section className="card"><h2>Fachliche Grundlage</h2>{c.kriterien.map((k: any) => <div key={k.code}><h3>{k.code} v{k.version}: {k.titel}</h3><p><Annot text={k.regel} /></p>{k.belege.map((b: any, i: number) => <Quote key={i} q={b.zitat} source={`${b.quelle}${b.fundstelle ? ' · ' + b.fundstelle : ''}`} />)}</div>)}</section>}
          <section className="card"><h2>Einordnung und nächste Schritte</h2>
            <p><strong>Einordnung:</strong> {meta.klassifikationen.find((k) => k.key === c.klassifikation)?.label ?? c.klassifikation}</p>
            {staff && can('content:write') && v.status !== 'submitted' && <Classify id={d.objekt.id} current={c.klassifikation} onDone={s.reload} />}
            <ul>{c.naechsteSchritte.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul>
            <p className="hint">{c.hinweis}</p>
          </section>
          {staff && v.status !== 'submitted' && can('content:write') && (
            <div className="row" style={{ marginBottom: 16 }}>
              <button disabled={busy} onClick={async () => { if (await run(() => api.post(`/api/reports/${d.objekt.id}/refresh`), (x: any) => x.created ? `Neue Version v${x.version.version} aus den aktuellen Vergleichsdaten angelegt.` : 'Berichtsdaten aktualisiert.')) s.reload(); }}>Mit aktuellen Vergleichsdaten aktualisieren</button>
              {can('ai:run') && <button disabled={busy} onClick={async () => { if (await run(() => api.post(`/api/reports/${d.objekt.id}/ai-draft`), 'KI-Formulierungsvorschlag als Entwurf eingefügt. Bitte prüfen.')) s.reload(); }}>KI-Entwurf für Texte</button>}
            </div>
          )}
          {v.ai_meta && <p className="hint">KI-Unterstützung: Modell {v.ai_meta.model}, Prompt {v.ai_meta.promptVersion}. Gesicherte Befunde und Hypothesen sind getrennt; entschieden hat ein Mensch.</p>}
          {staff && <ApprovalPanel type="reports" v={v} d={d} isCur reload={s.reload} />}
          {staff && (
            <section className="card"><h2>Bereitstellung</h2>
              <p className="hint">Bereitstellen heißt: Der Bericht wird im Portal für den Kunden sichtbar. Ein E-Mail-Versand ist in diesem Prototyp <strong>nicht konfiguriert</strong> und wird nicht vorgetäuscht.</p>
              <div className="row"><button className="primary" disabled={busy || v.status !== 'approved' || !can('report:release')} onClick={async () => { if (await run(() => api.post(`/api/reports/versions/${v.id}/provide`, { kind: 'bereitstellung' }), 'Bericht im Kundenportal bereitgestellt.')) s.reload(); }}>Im Portal bereitstellen</button>
                <button disabled={busy || v.status !== 'approved' || !can('report:release')} onClick={() => setSend(true)}>Per E-Mail versenden …</button></div>
              {v.status !== 'approved' && <p className="hint">Nur die aktuelle, freigegebene Version kann bereitgestellt werden (Status jetzt: {v.status === 'draft' ? 'Entwurf' : v.status === 'submitted' ? 'wartet auf Freigabe' : v.status === 'rejected' ? 'abgelehnt' : v.status}).</p>}
              {(d.bereitstellungen ?? []).length > 0 && <div className="tablewrap"><table><caption>Protokoll</caption><thead><tr><th>Zeit</th><th>Art</th><th>Status</th><th>Hinweis</th></tr></thead><tbody>{d.bereitstellungen.map((b: any) => <tr key={b.id}><td>{fmtTime(b.created_at)}</td><td>{b.kind === 'bereitstellung' ? 'Bereitstellung im Portal' : 'E-Mail-Versand'}</td><td>{b.status === 'bereitgestellt' ? <Tone tone="ok">Bereitgestellt</Tone> : b.status === 'nicht_konfiguriert' ? <Tone tone="warn">Nicht konfiguriert – nicht versendet</Tone> : b.status}</td><td>{b.note}</td></tr>)}</tbody></table></div>}
            </section>
          )}
          {send && <SendModal vid={v.id} onClose={() => setSend(false)} onDone={() => { setSend(false); s.reload(); }} />}
          {void DemoTag}
        </>
      );
    }}</Async>
  );
}

function Classify({ id, current, onDone }: { id: string; current: string; onDone: () => void }) {
  const { meta } = useAuth(); const { busy, run } = useAction(); const [v, setV] = useState(current);
  return <div className="row" style={{ marginBottom: 10 }}><div><label htmlFor="cls">Fachliche Einordnung ändern</label><select id="cls" value={v} onChange={(e) => setV(e.target.value)}>{meta.klassifikationen.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></div>
    <button style={{ alignSelf: 'flex-end' }} disabled={busy || v === current} onClick={async () => { if (await run(() => api.post(`/api/reports/${id}/classification`, { classification: v }), 'Einordnung gespeichert.')) onDone(); }}>Speichern</button></div>;
}

function SendModal({ vid, onClose, onDone }: { vid: string; onClose: () => void; onDone: () => void }) {
  const [rcpt, setRcpt] = useState(''); const { busy, run } = useAction();
  return (
    <Modal title="Bericht per E-Mail versenden" onClose={onClose}>
      <div className="banner warn">Der E-Mail-Versand ist in dieser Installation nicht konfiguriert. Der Versuch wird protokolliert, aber es wird <strong>nichts versendet</strong>.</div>
      <Field id="rcpt" label="Empfänger"><input type="email" value={rcpt} onChange={(e) => setRcpt(e.target.value)} /></Field>
      <button className="primary" disabled={busy || !rcpt} onClick={async () => { if (await run(() => api.post(`/api/reports/versions/${vid}/provide`, { kind: 'versand', recipient: rcpt }), 'Protokolliert: nicht versendet (Versand nicht konfiguriert).')) onDone(); }}>Versuch protokollieren</button>
    </Modal>
  );
}
