import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Annot, Async, Badge, Empty, Field, FilterChips, PageHead, Tabs, Tone, api, fmtDate, fmtTime, useAction, useAsync, useAuth, useDirty } from '../ui';
import { ApprovalPanel, SollView, TYPE_LABEL } from './Shared';

export function Testfaelle() {
  const [sp, setSp] = useSearchParams(); const view = sp.get('ansicht') ?? 'testfaelle'; const status = sp.get('status') ?? '';
  const { meta, can } = useAuth(); const { busy, run } = useAction();
  const s = useAsync(() => api.get(`/api/objects/testcases${status ? `?status=${status}` : ''}`), [status]);
  const imp = useAsync(() => api.get('/api/impacts'), []);
  const [res, setRes] = useState<any>(null);
  return (
    <>
      <h1>Testfälle</h1>
      <Tabs label="Bereiche der Testfälle" current={view} onChange={(k) => setSp(k === 'testfaelle' ? {} : { ansicht: k })} items={[['testfaelle', 'Testfälle'], ['auswirkungen', `Änderungen${imp.data && imp.data.eintraege.some((x: any) => x.status === 'offen') ? ` (${imp.data.eintraege.filter((x: any) => x.status === 'offen').length})` : ''}`]]} />
      {view === 'testfaelle' && (
        <>
          {(() => { const drafts = (s.data?.eintraege ?? []).filter((t: any) => t.status === 'draft').length; return drafts > 0 && can('content:submit') ? <div className="bulkbar"><span><strong>{drafts}</strong> Entwürfe bereit zur Freigabe</span><button className="accent" disabled={busy} onClick={async () => { const r: any = await run(() => api.post('/api/objects/testcases/submit-batch', {}), (x: any) => `${x.eingereicht} eingereicht${x.uebersprungen.length ? `, ${x.uebersprungen.length} übersprungen (z. B. offene Klärung)` : ''}.`); if (r) s.reload(); }}>Alle einreichen</button></div> : null; })()}
          <div className="row spread" style={{ margin: '4px 0 12px' }}>
            <FilterChips options={meta.statusFilter} value={status} onChange={(v) => setSp(v ? { status: v } : {})} />
            {can('content:write') && <div className="row">
              <button disabled={busy} onClick={async () => { const r = await run(() => api.post('/api/testcases/generate', {}), 'Testfälle aktualisiert.'); if (r) { setRes(r); s.reload(); } }}>Neu berechnen</button>
              {can('ai:run') && <button disabled={busy} onClick={async () => { const r = await run(() => api.post('/api/testcases/ai-propose'), 'KI-Vorschläge als Entwürfe angelegt.'); if (r) s.reload(); }}>KI-Vorschläge</button>}
            </div>}
          </div>
          <div className="card"><Async s={s}>{(d: any) => d.eintraege.length === 0 ? <div className="empty"><strong>Noch keine Testfälle.</strong><span className="hint">Sie entstehen automatisch, sobald Kriterien freigegeben sind.</span><Link className="btn primary" to="/freigaben">Zu den Freigaben</Link></div> : (
            <div className="tablewrap"><table><caption className="sr">{d.eintraege.length} Testfälle</caption>
              <thead><tr><th>Kennung</th><th>Titel</th><th>Art</th><th>Version</th><th>Status</th></tr></thead>
              <tbody>{d.eintraege.map((t: any) => <tr key={t.object_id}><td className="mono">{t.code}</td><td><Link to={`/testfaelle/${t.object_id}`}>{t.title}</Link></td><td>{TYPE_LABEL[t.test_type] ?? t.test_type}</td><td>v{t.version}</td><td><Badge kind="obj" value={t.status} /></td></tr>)}</tbody></table></div>
          )}</Async></div>
        </>
      )}
      {view === 'auswirkungen' && <Impacts s={imp} />}
    </>
  );
}

function summarize(r: any): string {
  if (!r || typeof r !== 'object') return String(r);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(r)) parts.push(`${k}: ${Array.isArray(v) ? v.length + ' Einträge' : typeof v === 'object' ? JSON.stringify(v) : v}`);
  return parts.join('\n');
}

function Impacts({ s }: { s: any }) {
  const { busy, run } = useAction(); const [expl, setExpl] = useState<Record<string, any>>({}); const { can } = useAuth();
  return (
    <div className="card">
      <p className="hint">Wenn sich ein freigegebenes Kriterium ändert, werden betroffene Testfälle hier angezeigt. Freigegebene Testfälle und fertige Ergebnisse werden nie überschrieben: Es entstehen neue Entwürfe, die erneut freigegeben werden müssen; laufende Prüfungen werden als „Grundlage überholt“ markiert.</p>
      <Async s={s}>{(d: any) => d.eintraege.length === 0 ? <Empty>Keine Auswirkungen vorhanden.</Empty> : (
        <div className="tablewrap"><table><thead><tr><th>Kriterium</th><th>Änderung</th><th>Betroffener Testfall</th><th>Neuer Entwurf</th><th>Stand</th><th></th></tr></thead>
          <tbody>{d.eintraege.map((i: any) => (
            <React.Fragment key={i.id}>
              <tr><td className="mono">{i.criterion_code}</td><td>v{i.from_version ?? '–'} → v{i.to_version}</td><td>{i.testcase_code} v{i.affected_testcase_version}</td><td>{i.draft_testcase_version ? `v${i.draft_testcase_version}` : '–'}</td>
                <td>{i.status === 'offen' ? <Tone tone="warn">Offen</Tone> : <Tone tone="ok">Erledigt</Tone>}</td>
                <td>{can('ai:run') && <button disabled={busy} onClick={async () => { const r = await run(() => api.post(`/api/impacts/${i.id}/explain`)); if (r) setExpl({ ...expl, [i.id]: r }); }}>KI-Erklärung</button>}</td></tr>
              {expl[i.id] && <tr><td colSpan={6}><div className="banner info"><strong>Erklärung (KI, ohne Entscheidung):</strong> {expl[i.id].summary}<ul>{(expl[i.id].points ?? []).map((p: string, k: number) => <li key={k}>{p}</li>)}</ul></div></td></tr>}
            </React.Fragment>))}</tbody></table></div>
      )}</Async>
    </div>
  );
}

export function TestcaseDetail() {
  const { id } = useParams(); const { can } = useAuth(); const { busy, run } = useAction();
  const s = useAsync(() => api.get(`/api/objects/testcases/${id}`), [id]);
  const [edit, setEdit] = useState<Record<string, any>>({}); useEffect(() => setEdit({}), [s.data]); useDirty(Object.keys(edit).length > 0);
  return (
    <Async s={s}>{(d: any) => {
      const v = d.versionen[0];
      const editable = ['draft', 'clarification', 'rejected', 'approved'].includes(v.status) && can('content:write');
      const stale = (d.kriterien ?? []).filter((k: any) => k.effective_version && k.effective_version !== k.linked_version);
      const dirty = Object.keys(edit).length > 0;
      return (
        <>
          <p><Link to="/testfaelle">← Alle Testfälle</Link></p>
          <PageHead title={`${d.objekt.code} · ${v.title}`} lead={<><Badge kind="obj" value={v.status} /> &nbsp;Version {v.version} · {TYPE_LABEL[v.test_type]} · erzeugt durch {v.generated_by === 'engine' ? 'die Regel-Engine (deterministisch)' : v.generated_by === 'ki' ? 'KI-Vorschlag' : 'manuelle Eingabe'}</>} />
          {v.status === 'clarification' && <div className="banner warn"><strong>Klärung erforderlich.</strong> Das Soll-Ergebnis ist nicht berechnet, weil offene Fragen es blockieren: {(d.klaerungen ?? []).map((k: any) => <span key={k.id}>{k.code} ({k.title}) </span>)}<Link to="/kriterien?ansicht=klaerungen">Zu den Klärungsvorgängen</Link></div>}
          {stale.length > 0 && <div className="banner bad" role="alert"><strong>Grundlage überholt.</strong> Dieser Testfall beruht auf älteren Kriterienversionen ({stale.map((k: any) => `${k.code} v${k.linked_version} → v${k.effective_version}`).join(', ')}). Freigabe ist erst nach Aktualisierung möglich.</div>}
          <div className="grid two">
            <section className="card"><h2>Zweck und Ausgangslage</h2>
              <Field id="tc-title" label="Titel">{editable ? <input value={edit.title ?? v.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /> : <div>{v.title}</div>}</Field>
              <Field id="tc-purpose" label="Zweck">{editable ? <textarea value={edit.purpose ?? v.purpose} onChange={(e) => setEdit({ ...edit, purpose: e.target.value })} /> : <div><Annot text={v.purpose} /></div>}</Field>
              <dl className="facts"><dt>Tagesdatum</dt><dd>{fmtDate(v.test_date)} (fest im Testkontext)</dd><dt>Ausgangslage</dt><dd><Annot text={d.szenario ?? '–'} /></dd></dl>
              {dirty && <div className="sticky-actions row"><button className="primary" disabled={busy} onClick={async () => { if (await run(() => api.patch(`/api/objects/testcases/versions/${v.id}`, { patch: edit }), (x: any) => x.created ? `Neue Version v${x.version.version} angelegt.` : 'Gespeichert.')) { setEdit({}); s.reload(); } }}>Änderungen speichern</button><button onClick={() => setEdit({})}>Verwerfen</button><span className="hint">Ungespeicherte Änderungen</span></div>}
            </section>
            <section className="card"><h2>Zugrunde liegende Kriterien</h2>
              {(d.kriterien ?? []).length ? <ul>{d.kriterien.map((k: any) => <li key={k.id}><Link to={`/kriterien/${k.id}`}>{k.code}</Link> v{k.linked_version} – {k.title}</li>)}</ul> : <Empty>Keine Zuordnung.</Empty>}
              <h3>Herleitung des Soll-Ergebnisses</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}><Annot text={v.derivation || 'Keine Herleitung vorhanden (Soll nicht berechnet).'} /></p>
              <p className="hint">Das Soll wird von der Anwendung berechnet, nicht von der KI. Es kann nicht von Hand überschrieben werden – eine fachliche Änderung erfolgt über das Kriterium oder eine Klärungsentscheidung.</p>
            </section>
          </div>
          <section className="card"><h2>Ablauf und Soll-Ergebnis</h2>
            {v.status === 'clarification' ? <Empty>Noch kein Soll-Ergebnis, solange die Klärung offen ist.</Empty> : <SollView expected={v.expected} events={v.events} />}
            {v.observation_note && <p><strong>Testabschluss:</strong> {v.observation_note}</p>}
          </section>
          <ApprovalPanel type="testcases" v={v} d={d} isCur reload={s.reload} extraGuard={stale.length ? 'Die Grundlage ist überholt; die Einreichung wird vom Server abgewiesen.' : undefined} />
          {void fmtTime}
        </>
      );
    }}</Async>
  );
}
