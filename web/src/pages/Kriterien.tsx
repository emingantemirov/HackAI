import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../viz';
import { Annot, Async, Badge, ConfirmReason, DemoTag, Empty, Field, FilterChips, Modal, PageHead, Quote, Tabs, Tone, api, fmtDate, fmtTime, useAction, useAsync, useAuth, useDirty, useToast } from '../ui';

const ORIGIN: Record<string, string> = { 'quelle-uebernommen': 'Aus Quelle übernommen', 'ki-ableitung': 'KI-Ableitung', 'demo-ableitung': 'Demo-Ableitung (regelbasiert, keine KI)', manuell: 'Manuell angelegt' };
const loc = (l: any) => (l ? `${l.kind === 'seite' ? 'Seite' : 'Absatz'} ${l.n}` : 'ohne Fundstelle');

export function Kriterien() {
  const [sp, setSp] = useSearchParams();
  const view = sp.get('ansicht') ?? 'kriterien';
  return (
    <>
      <h1>Kriterien</h1>
      <Tabs label="Bereiche der Kriterien" current={view} onChange={(k) => setSp(k === 'kriterien' ? {} : { ansicht: k })} items={[['kriterien', 'Kriterien'], ['quellen', 'Quellen']]} />
      {view === 'kriterien' && <CriteriaList />}
      {view === 'quellen' && <Sources />}
    </>
  );
}

const FILTER: [string, string][] = [['', 'Alle'], ['pruefen', 'Zu prüfen'], ['freigegeben', 'Freigegeben'], ['abgelehnt', 'Abgelehnt']];

function FilterSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="fsel"><span className="sr">Anzeigen</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Kriterien filtern">{FILTER.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    </label>
  );
}

function ReviewCard({ c, onDone }: { c: any; onDone: () => void }) {
  const { can } = useAuth(); const { busy, run } = useAction(); const toast = useToast();
  const [rej, setRej] = useState(false); const [leaving, setLeaving] = useState(false);
  const ev = (c.evidence as any[] | undefined)?.find((e) => e.verified);
  const decide = can('approval:decide');
  const approve = async () => {
    const r: any = await run(() => api.post(`/api/criteria/versions/${c.version_id}/review`, { decision: 'approved' }));
    if (r) { setLeaving(true); toast(`${c.code} freigegeben – ab jetzt Grundlage für Testfälle${r.testfaelle ? ` (${r.testfaelle} Testfall-Entwürfe angelegt)` : ''}.`); setTimeout(onDone, 300); }
  };
  return (
    <article className={`review ${leaving ? 'gone' : ''}`} aria-label={`${c.code} ${c.title}`}>
      <Icon n="list" size={22} />
      <div>
        <h3><Link to={`/kriterien/${c.object_id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{c.title}</Link></h3>
        <div className="hint"><span className="mono">{c.code}</span> · v{c.version} · {c.origin === 'ki-ableitung' ? 'KI-Entwurf' : c.origin === 'demo-ableitung' ? 'Demo-Entwurf' : c.origin === 'manuell' ? 'manuell' : 'aus Quelle'}{c.status === 'rejected' && ' · abgelehnt'}</div>
      </div>
      <div className="actions">
        {c.status === 'rejected' ? <ReviseButton c={c} onDone={onDone} /> : decide ? <>
          <button className="primary" disabled={busy} onClick={approve}><Icon n="check" size={16} />Freigeben</button>
          <button className="danger" disabled={busy} onClick={() => setRej(true)}><Icon n="x" size={16} />Ablehnen</button></> : <span className="hint">Wartet auf Prüfer/Freigeber</span>}
      </div>
      <div className="body">
        {c.rule && <p style={{ margin: '2px 0' }}>{c.rule}</p>}
        {ev && <p className="hint" style={{ margin: '4px 0 0' }}>„{String(ev.quote).slice(0, 180)}{String(ev.quote).length > 180 ? '…' : ''}“</p>}
      </div>
      {rej && <ConfirmReason title="Kriterium ablehnen" label="Was soll geändert werden?" confirmLabel="Ablehnen und von KI überarbeiten lassen" danger minLength={10} onCancel={() => setRej(false)}
        intro={<p className="hint">Ihre Begründung geht als Anweisung an die KI. Sie erzeugt daraus eine neue Version zur erneuten Prüfung; die abgelehnte bleibt erhalten.</p>}
        onConfirm={async (reason) => {
          const r: any = await run(() => api.post(`/api/criteria/versions/${c.version_id}/review`, { decision: 'rejected', reason }));
          if (r) { setRej(false); toast(r.ueberarbeitet ? 'Abgelehnt. Die KI hat eine überarbeitete Version erstellt – bitte prüfen.' : r.hinweis, !r.ueberarbeitet); onDone(); }
        }} />}
    </article>
  );
}

function ReviseButton({ c, onDone }: { c: any; onDone: () => void }) {
  const { can } = useAuth(); const { busy, run } = useAction();
  if (!can('ai:run')) return null;
  return <button className="primary" disabled={busy} onClick={async () => { const r = await run(() => api.post(`/api/criteria/versions/${c.version_id}/ai-revise`), 'Die KI hat eine überarbeitete Version erstellt.'); if (r) onDone(); }}><Icon n="spark" size={16} />{busy ? 'KI überarbeitet …' : 'Mit KI überarbeiten'}</button>;
}

function CriteriaList() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams(); const f = sp.get('filter') ?? '';
  const s = useAsync(() => api.get('/api/objects/criteria'), []);
  const [newOpen, setNewOpen] = useState(false);
  return (
    <>
      <div className="row spread" style={{ marginBottom: 14 }}>
        <FilterSelect value={f} onChange={(v) => setSp(v ? { filter: v } : {})} />
        {can('content:write') && <button className="ghost" onClick={() => setNewOpen(true)}><Icon n="plus" size={16} />Manuell anlegen</button>}
      </div>
      <Async s={s}>{(d: any) => {
        const all: any[] = d.eintraege;
        const stamp = (x: any) => String(x.created_at ?? '');
        const open = all.filter((x) => ['draft', 'submitted', 'clarification', 'rejected'].includes(x.status)).sort((a, b) => stamp(b).localeCompare(stamp(a)) || b.code.localeCompare(a.code));
        const toReview = open.filter((x) => x.status !== 'rejected'); const rejected = open.filter((x) => x.status === 'rejected');
        const approved = all.filter((x) => x.status === 'approved');
        const showOpen = f === '' || f === 'pruefen', showRej = f === '' || f === 'abgelehnt', showApp = f === '' || f === 'freigegeben';
        if (all.length === 0) return <div className="card"><div className="empty"><Icon n="upload" size={40} /><strong>Noch keine Kriterien.</strong><Link className="btn primary" to="/kriterien?ansicht=quellen">Quelle hinzufügen</Link></div></div>;
        return (
          <>
            {showOpen && (toReview.length ? <section aria-label="Zu prüfen"><h2>Zu prüfen <span className="pill-n">{toReview.length}</span></h2>{toReview.map((c) => <ReviewCard key={c.version_id} c={c} onDone={s.reload} />)}</section>
              : f === 'pruefen' && <div className="card"><div className="empty"><Icon n="check" size={36} /><strong>Nichts mehr zu prüfen.</strong></div></div>)}
            {showRej && rejected.length > 0 && <section aria-label="Abgelehnt"><h2>Abgelehnt <span className="pill-n" style={{ background: 'var(--muted)' }}>{rejected.length}</span></h2>{rejected.map((c) => <ReviewCard key={c.version_id} c={c} onDone={s.reload} />)}</section>}
            {showApp && approved.length > 0 && (
              <details className="card" open={f === 'freigegeben'}><summary><strong>Freigegeben</strong> <span className="badge ok">{approved.length}</span></summary>
                <div className="tablewrap"><table><caption className="sr">Freigegebene Kriterien</caption><tbody>{approved.map((c) => <tr key={c.object_id}><td className="mono">{c.code}</td><td><Link to={`/kriterien/${c.object_id}`}>{c.title}</Link></td><td className="hint">v{c.version}</td></tr>)}</tbody></table></div>
              </details>)}
            {f === 'abgelehnt' && rejected.length === 0 && <div className="card"><div className="empty"><strong>Nichts abgelehnt.</strong></div></div>}
          </>
        );
      }}</Async>
      {newOpen && <NewCriterion onClose={() => setNewOpen(false)} />}
    </>
  );
}

function NewCriterion({ onClose }: { onClose: () => void }) {
  const nav = useNavigate(); const { busy, run } = useAction();
  const [f, setF] = useState({ slug: '', title: '', description: '', preconditions: '', rule: '', exceptions: '', expected_behavior: '' });
  const up = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Kriterium anlegen" onClose={onClose}>
      <p className="hint">Ein manuell angelegtes Kriterium braucht vor der Einreichung mindestens einen wörtlichen Beleg aus einer Quelle.</p>
      <div className="form-grid">
        <Field id="n-slug" label="Schlüssel" hint="Kleinbuchstaben, Ziffern, Bindestriche"><input value={f.slug} onChange={up('slug')} /></Field>
        <Field id="n-title" label="Titel"><input value={f.title} onChange={up('title')} /></Field>
      </div>
      <Field id="n-desc" label="Beschreibung"><textarea value={f.description} onChange={up('description')} /></Field>
      <Field id="n-pre" label="Voraussetzungen"><textarea value={f.preconditions} onChange={up('preconditions')} /></Field>
      <Field id="n-rule" label="Prüfbare Regel"><textarea value={f.rule} onChange={up('rule')} /></Field>
      <Field id="n-exc" label="Ausnahmen"><textarea value={f.exceptions} onChange={up('exceptions')} /></Field>
      <Field id="n-exp" label="Erwartetes Verhalten"><textarea value={f.expected_behavior} onChange={up('expected_behavior')} /></Field>
      <button className="primary" disabled={busy} onClick={async () => { const r = await run(() => api.post('/api/criteria', f), 'Kriterium angelegt.'); if (r) { onClose(); nav(`/kriterien/${r.criterionId ?? r.id ?? r.criterion?.id}`); } }}>Kriterium anlegen</button>
    </Modal>
  );
}

// ---------------- Detail ----------------
const FIELDS: [string, string, string?][] = [
  ['title', 'Titel'], ['description', 'Beschreibung'], ['preconditions', 'Voraussetzungen'], ['rule', 'Prüfbare Regel', 'Eine einzige, prüfbare Aussage'], ['exceptions', 'Ausnahmen'], ['expected_behavior', 'Erwartetes Verhalten'],
];

export function CriterionDetail() {
  const { id } = useParams(); const { can, user } = useAuth(); const toast = useToast();
  const s = useAsync(() => api.get(`/api/objects/criteria/${id}`), [id]);
  const audit = useAsync(() => api.get(`/api/objects/criteria/${id}/audit`), [id]);
  const { busy, run } = useAction();
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, any>>({});
  const [dialog, setDialog] = useState<'reject' | 'approve' | null>(null);
  const [ev, setEv] = useState({ sourceVersionId: '', quote: '' });
  useEffect(() => { setEdit({}); }, [id, sel, s.data]);
  const dirty = Object.keys(edit).length > 0; useDirty(dirty);
  const reloadAll = () => { s.reload(); audit.reload(); };

  return (
    <Async s={s}>{(d: any) => {
      const cur = d.versionen[0]; const v = d.versionen.find((x: any) => x.id === sel) ?? cur; const isCur = v.id === cur.id;
      const editable = isCur && v.status !== 'submitted' && can('content:write');
      const val = (k: string) => (k in edit ? edit[k] : v[k] ?? '');
      const sources: Record<string, string> = Object.fromEntries((d.quellen ?? []).map((x: any) => [x.id, `${x.title} (Version ${x.version_label})`]));
      const save = async () => {
        const r = await run(() => api.patch(`/api/objects/criteria/versions/${v.id}`, { patch: edit, changeNote: 'Bearbeitung durch Fachbearbeitung' }), (x: any) => x.created ? `Neue Version v${x.version.version} als Entwurf angelegt – die bisherige Version bleibt erhalten.` : 'Gespeichert.');
        if (r) { setEdit({}); setSel(null); reloadAll(); }
      };
      const decide = async (decision: 'approved' | 'rejected', reason?: string, hints?: string) => {
        const r = await run(() => api.post(`/api/objects/criteria/versions/${v.id}/decide`, { decision, reason, hints }), decision === 'approved' ? 'Kriterium freigegeben.' : 'Kriterium abgelehnt. Die Version bleibt erhalten; eine Überarbeitung legt eine neue Version an.');
        if (r) { setDialog(null); reloadAll(); }
      };
      const lastReject = [...(d.verlauf as any[])].reverse().find((h) => h.decision === 'rejected' && h.version === v.version);
      return (
        <>
          <p><Link to="/kriterien">← Alle Kriterien</Link></p>
          <PageHead title={`${d.objekt.code} · ${v.title}`} lead={<><Badge kind="obj" value={v.status} /> &nbsp;Version {v.version}{isCur ? ' (aktuell)' : ' (ältere Version, nur lesbar)'} · {ORIGIN[v.origin] ?? v.origin}{v.origin === 'demo-ableitung' && <> <DemoTag>Demo, keine KI</DemoTag></>}</>} />
          {v.status === 'rejected' && lastReject && <div className="banner bad"><strong>Abgelehnt von {lastReject.by}:</strong> {lastReject.reason}{lastReject.hints && <><br /><strong>Hinweise:</strong> {lastReject.hints}</>}<br /><span className="hint">Beim Speichern einer Änderung entsteht eine neue Version v{v.version + 1}; die abgelehnte bleibt erhalten.</span></div>}
          {v.status === 'approved' && isCur && <div className="banner ok">Diese Version ist freigegeben. Eine Änderung legt eine neue Entwurfsversion an; Testfälle, die auf v{v.version} beruhen, werden als betroffen markiert.</div>}
          {!isCur && <div className="banner warn">Sie sehen v{v.version}. Aktuell ist v{cur.version}. <button className="link" onClick={() => setSel(null)}>Zur aktuellen Version</button></div>}
          {(v.open_questions as any[]).length > 0 && <div className="banner warn"><strong>Offene Fragen</strong><ul style={{ margin: '4px 0 0' }}>{(v.open_questions as any[]).map((o, i) => <li key={i}><Annot text={typeof o === 'string' ? o : o.text} /></li>)}</ul></div>}
          <div className="grid two">
            <section className="card" aria-label="Inhalt">
              <h2>Inhalt</h2>
              {FIELDS.map(([k, l, h]) => (
                <Field key={k} id={`f-${k}`} label={l} hint={h}>
                  {editable ? (k === 'title' ? <input value={val(k)} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /> : <textarea value={val(k)} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />)
                    : <div id={`f-${k}`} style={{ whiteSpace: 'pre-wrap', padding: '4px 0' }}>{val(k) ? <Annot text={val(k)} /> : <span className="hint">– nicht angegeben –</span>}</div>}
                </Field>
              ))}
              <dl className="facts"><dt>Gültig ab</dt><dd>{fmtDate(v.valid_from)}</dd><dt>Gültig bis</dt><dd>{v.valid_to ? fmtDate(v.valid_to) : 'unbefristet / nicht angegeben'}</dd>
                <dt>Datenfelder</dt><dd>{(v.data_fields as string[]).join(', ') || '–'}</dd><dt>Meldungstypen</dt><dd>{(v.message_types as string[]).join(', ') || '–'}</dd></dl>
              {v.ai_meta && <p className="hint">KI-Ableitung: Modell {v.ai_meta.model ?? '–'}, Prompt {v.ai_meta.promptVersion ?? '–'}, {fmtTime(v.ai_meta.derivedAt)}</p>}
              {dirty && <div className="sticky-actions row"><button className="primary" disabled={busy} onClick={save}>Änderungen speichern</button><button onClick={() => setEdit({})}>Verwerfen</button><span className="hint" role="status">Ungespeicherte Änderungen</span></div>}
            </section>
            <section className="card" aria-label="Belege">
              <h2>Belege aus den Quellen</h2>
              {(v.evidence as any[]).length === 0 && <div className="banner warn">Noch kein Beleg. Ohne geprüften Beleg kann das Kriterium nicht eingereicht werden.</div>}
              {(v.evidence as any[]).map((e, i) => (
                <div key={i}><Quote q={e.quote} source={`${sources[e.source_version_id] ?? 'Quelle'} · ${loc(e.locator)}`} />{e.verified ? <Tone tone="ok">Wörtlich in der Quelle gefunden</Tone> : <Tone tone="warn">Nicht verifiziert</Tone>}</div>
              ))}
              {editable && (
                <details style={{ marginTop: 12 }}><summary>Beleg ergänzen</summary>
                  <Field id="ev-src" label="Quelle"><select value={ev.sourceVersionId} onChange={(e) => setEv({ ...ev, sourceVersionId: e.target.value })}><option value="">Bitte wählen</option>{(d.quellen ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.title} (Version {x.version_label})</option>)}</select></Field>
                  <Field id="ev-q" label="Wörtliches Zitat" hint="muss im Originaltext vorkommen"><textarea value={ev.quote} onChange={(e) => setEv({ ...ev, quote: e.target.value })} /></Field>
                  <button disabled={busy || !ev.sourceVersionId || ev.quote.trim().length < 12} onClick={async () => { const r = await run(() => api.post(`/api/criteria/versions/${v.id}/evidence`, ev), 'Beleg geprüft und ergänzt.'); if (r) { setEv({ sourceVersionId: '', quote: '' }); reloadAll(); } }}>Beleg prüfen und ergänzen</button>
                </details>
              )}
              <h3>Zugehörige Testfälle</h3>
              {(d.testfaelle ?? []).length ? <ul>{d.testfaelle.map((t: any) => <li key={t.id}><Link to={`/testfaelle/${t.id}`}>{t.code}</Link> v{t.version} – {t.title} <Badge kind="obj" value={t.status} /></li>)}</ul> : <Empty>Noch keine Testfälle.</Empty>}
            </section>
          </div>
          <section className="card accent" aria-label="Freigabe">
            <h2>Freigabe</h2>
            <p className="hint">Drei Freigaben sind Pflicht: Kriterien, Testfälle mit Soll-Ergebnis und Berichte. Die KI kann nie freigeben. Die einreichende Person darf nicht selbst freigeben (Vier-Augen-Prinzip).</p>
            <div className="row">
              {isCur && ['draft', 'rejected', 'clarification'].includes(v.status) && can('content:submit') && <button className="primary" disabled={busy || dirty} onClick={async () => { if (await run(() => api.post(`/api/objects/criteria/versions/${v.id}/submit`), 'Zur Freigabe eingereicht.')) reloadAll(); }}>Zur Freigabe einreichen</button>}
              {isCur && v.status === 'submitted' && <button disabled={busy} onClick={async () => { if (await run(() => api.post(`/api/objects/criteria/versions/${v.id}/withdraw`), 'Einreichung zurückgezogen.')) reloadAll(); }}>Einreichung zurückziehen</button>}
              {isCur && v.status === 'submitted' && can('approval:decide') && <><button className="primary" disabled={busy || v.submitted_by === user.id} onClick={() => setDialog('approve')}>Freigeben</button><button className="danger" disabled={busy} onClick={() => setDialog('reject')}>Ablehnen …</button></>}
              {isCur && v.status === 'rejected' && can('ai:run') && <button disabled={busy} onClick={async () => { if (await run(() => api.post(`/api/criteria/versions/${v.id}/ai-revise`), 'KI-Vorschlag als neue Entwurfsversion angelegt. Bitte prüfen.')) reloadAll(); }}>KI-Überarbeitung vorschlagen</button>}
            </div>
            {dirty && <p className="hint">Bitte zuerst speichern, dann einreichen.</p>}
            {v.status === 'submitted' && v.submitted_by === user.id && <p className="hint">Sie haben diese Version eingereicht; die Freigabe muss eine andere Person übernehmen.</p>}
            <h3>Entscheidungsverlauf</h3>
            {d.verlauf.length ? <ul>{d.verlauf.map((h: any, i: number) => <li key={i}><Tone tone={h.decision === 'approved' ? 'ok' : 'bad'}>{h.decision === 'approved' ? 'Freigegeben' : 'Abgelehnt'}</Tone> v{h.version} von {h.by}, {fmtTime(h.at)}{h.reason ? ` – ${h.reason}` : ''}{h.hints ? ` (Hinweis: ${h.hints})` : ''}</li>)}</ul> : <Empty>Noch keine Entscheidung.</Empty>}
          </section>
          <section className="card"><h2>Versionen</h2>
            <ul>{d.versionen.map((x: any) => <li key={x.id}><button className="link" onClick={() => setSel(x.id)} aria-current={x.id === v.id}>v{x.version}</button> <Badge kind="obj" value={x.status} /> {fmtTime(x.created_at)}{x.created_by_name ? ` · ${x.created_by_name}` : ''}{x.change_note ? ` – ${x.change_note}` : ''}</li>)}</ul>
          </section>
          <details className="card"><summary>Änderungsprotokoll (Audit)</summary>
            <Async s={audit}>{(a: any) => <div className="tablewrap"><table><thead><tr><th>Zeit</th><th>Wer</th><th>Aktion</th><th>Version</th><th>Grund / KI</th></tr></thead><tbody>{a.eintraege.map((e: any, i: number) => <tr key={i}><td>{fmtTime(e.at)}</td><td>{e.actor_label}{e.actor_kind === 'ki' && ' (KI)'}</td><td>{e.action}</td><td>{e.object_version ?? ''}</td><td>{e.reason ?? ''}{e.ai_model ? `Modell ${e.ai_model}, Prompt ${e.prompt_version}` : ''}</td></tr>)}</tbody></table></div>}</Async>
          </details>
          {dialog === 'reject' && <ConfirmReason title="Version ablehnen" label="Begründung der Ablehnung" confirmLabel="Ablehnen" danger hintField onCancel={() => setDialog(null)} onConfirm={(r, h) => decide('rejected', r, h)} intro={<p>Die Version v{v.version} bleibt erhalten. Die Begründung ist Pflicht.</p>} />}
          {dialog === 'approve' && <Modal title="Version freigeben" onClose={() => setDialog(null)}><p>Sie geben <strong>{d.objekt.code} v{v.version}</strong> frei. Die Freigabe gilt nur für diese Version.</p><div className="row"><button className="primary" disabled={busy} onClick={() => decide('approved')}>Freigeben</button><button onClick={() => setDialog(null)}>Abbrechen</button></div></Modal>}
          {void toast}
        </>
      );
    }}</Async>
  );
}

// ---------------- Quellen ----------------
function Sources() {
  const { can, meta } = useAuth();
  const s = useAsync(() => api.get('/api/sources'), []);
  const [add, setAdd] = useState(false); const [open, setOpen] = useState<string | null>(null); const [auto, setAuto] = useState(false); const [cmp, setCmp] = useState(false);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        {can('source:write') && <button className="primary" onClick={() => setAdd(true)}><Icon n="plus" size={16} />Dokument hinzufügen</button>}
        <button className="ghost" onClick={() => setCmp(true)}>Versionen vergleichen</button>
      </div>
      <div className="card">
        <Async s={s}>{(d: any) => d.quellen.length === 0 ? <div className="empty"><Icon n="upload" size={40} /><strong>Noch kein Dokument.</strong>{can('source:write') && <button className="primary" onClick={() => setAdd(true)}>Dokument hinzufügen</button>}</div> : (
          <div className="tablewrap"><table><caption className="sr">Quellen</caption>
            <thead><tr><th>Dokument</th><th>Version</th><th>Art</th><th>Gültig ab</th><th>Text</th><th>Kriterien</th></tr></thead>
            <tbody>{d.quellen.map((r: any) => <tr key={r.id}><td><button className="link" onClick={() => setOpen(r.id)}>{r.title}</button></td><td>{r.version_label}</td><td>{r.input_kind}</td><td>{fmtDate(r.valid_from)}</td>
              <td>{r.extraction_status === 'ok' ? <Tone tone="ok">Text extrahiert</Tone> : r.extraction_status === 'ocr_pruefung_erforderlich' ? <Tone tone="warn">Textprüfung erforderlich</Tone> : <Tone tone="bad">{r.extraction_status}</Tone>}</td><td>{r.criteria_refs}</td></tr>)}</tbody></table></div>
        )}</Async>
      </div>
      {add && <AddSource onClose={() => setAdd(false)} onDone={(id) => { setAdd(false); s.reload(); if (id) { setAuto(true); setOpen(id); } }} />}
      {open && <SourceDetail id={open} auto={auto} demo={meta.demoKiModus} onClose={() => { setOpen(null); setAuto(false); s.reload(); }} />}
      {cmp && <CompareSources list={s.data?.quellen ?? []} onClose={() => setCmp(false)} />}
    </>
  );
}

function AddSource({ onClose, onDone }: { onClose: () => void; onDone: (id?: string) => void }) {
  const { busy, run } = useAction(); const toast = useToast();
  const [m, setM] = useState({ title: '', publisher: '', versionLabel: '', validFrom: '', validTo: '', area: 'DBVO', documentId: '' });
  const [mode, setMode] = useState<'datei' | 'text'>('datei'); const [file, setFile] = useState<File | null>(null); const [text, setText] = useState('');
  const up = (k: string) => (e: any) => setM({ ...m, [k]: e.target.value });
  const submit = async () => {
    const meta = { ...m, title: m.title || (file?.name.replace(/\.[^.]+$/, '') ?? 'Eingefügter Text'), versionLabel: m.versionLabel || '1.0' };
    const r = await run(async () => {
      if (mode === 'datei') { const fd = new FormData(); Object.entries(meta).forEach(([k, v]) => v && fd.append(k, v)); fd.append('file', file!); return api.upload('/api/sources', fd); }
      return api.post('/api/sources', { ...meta, text });
    });
    if (!r) return;
    if (r.duplicate) { toast('Diese Datei ist bereits als Quelle vorhanden (gleicher Hashwert). Es wurde nichts doppelt angelegt.'); onDone(r.sourceVersionId); return; }
    toast(r.extractionStatus === 'ocr_pruefung_erforderlich' ? 'Quelle gespeichert. Aus dieser Datei konnte kein Text gelesen werden – bitte Text prüfen oder ergänzen.' : 'Quelle gespeichert, Text extrahiert.');
    onDone(r.sourceVersionId);
  };
  return (
    <Modal title="Quelle hinzufügen" onClose={onClose}>
      <Tabs label="Eingabeart" current={mode} onChange={(k) => setMode(k as any)} items={[['datei', 'Datei'], ['text', 'Text einfügen']]} />
      {mode === 'datei' ? <Field id="s-file" label="PDF, DOCX oder Textdatei"><input type="file" accept=".pdf,.docx,.txt,.eel" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        : <Field id="s-text" label="Text"><textarea style={{ minHeight: 180 }} value={text} onChange={(e) => setText(e.target.value)} /></Field>}
      <details style={{ margin: '10px 0' }}><summary>Angaben zum Dokument (optional)</summary><div className="form-grid">
        <Field id="s-title" label="Titel"><input value={m.title} onChange={up('title')} placeholder="sonst Dateiname" /></Field>
        <Field id="s-ver" label="Version"><input value={m.versionLabel} onChange={up('versionLabel')} placeholder="1.0" /></Field>
        <Field id="s-pub" label="Herausgeber"><input value={m.publisher} onChange={up('publisher')} /></Field>
        <Field id="s-from" label="Gültig ab"><input type="date" value={m.validFrom} onChange={up('validFrom')} /></Field>
      </div></details>
      <button className="primary" disabled={busy || (mode === 'datei' ? !file : text.length < 20)} onClick={submit}>Hinzufügen und Kriterien ableiten</button>
    </Modal>
  );
}

function DeriveResult({ r }: { r: any }) {
  return (
    <div className="stack">
      <p><Tone tone="ok">{r.neu.length} neue Kriterien</Tone> {r.geaendert.length > 0 && <Tone tone="info">{r.geaendert.length} aktualisiert</Tone>} {r.verworfen.length > 0 && <Tone tone="warn">{r.verworfen.length} verworfen</Tone>}</p>
      {r.hinweis && <p className="hint">{r.hinweis}</p>}
      <Link className="btn accent" to="/kriterien">Kriterien prüfen und freigeben<Icon n="arrow" size={16} /></Link>
      {(r.widersprueche?.length > 0 || r.fehlendeInformationen?.length > 0 || r.verworfen.length > 0) && <details><summary>Details</summary>
        {r.widersprueche?.length > 0 && <ul>{r.widersprueche.map((w: any, i: number) => <li key={i}><strong>Widerspruch:</strong> {w.title}: {w.description}</li>)}</ul>}
        {r.fehlendeInformationen?.length > 0 && <ul>{r.fehlendeInformationen.map((w: string, i: number) => <li key={i}>Fehlt: {w}</li>)}</ul>}
        {r.verworfen.length > 0 && <ul>{r.verworfen.map((x: any, i: number) => <li key={i}>{x.slug}: {x.grund}</li>)}</ul>}</details>}
    </div>
  );
}

function SourceDetail({ id, onClose, demo, auto }: { id: string; onClose: () => void; demo: boolean; auto?: boolean }) {
  const s = useAsync(() => api.get(`/api/sources/${id}`), [id]);
  const { can } = useAuth(); const { busy, run } = useAction();
  const [job, setJob] = useState<any>(null); const [ocr, setOcr] = useState('');
  useEffect(() => {
    if (!job || ['succeeded', 'failed'].includes(job.status)) return;
    const t = setTimeout(async () => { try { setJob(await api.get(`/api/jobs/${job.id}`)); } catch { /* weiter */ } }, 900);
    return () => clearTimeout(t);
  }, [job]);
  const derive = async (mode: string) => {
    const r = await run(() => api.post(`/api/sources/${id}/derive`, { mode }));
    if (r) setJob(await api.get(`/api/jobs/${r.jobId}`));
  };
  const started = useRef(false);
  useEffect(() => { if (auto && s.data?.extraction_status === 'ok' && can('ai:run') && !started.current) { started.current = true; derive('auto'); } }, [auto, s.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="Quelle" onClose={onClose} wide>
      <Async s={s}>{(d: any) => (
        <div className="stack">
          <dl className="facts"><dt>Dokument</dt><dd>{d.title}, Version {d.version_label}</dd><dt>Herausgeber</dt><dd>{d.publisher || '–'}</dd><dt>Gültig</dt><dd>{fmtDate(d.valid_from)} bis {d.valid_to ? fmtDate(d.valid_to) : 'offen'}</dd>
            <dt>Datei</dt><dd>{d.file_name ? <a href={`/api/sources/${id}/file`}>{d.file_name}</a> : 'eingefügter Text'} ({Math.round(d.size_bytes / 1024)} KB)</dd><dt>SHA-256</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{d.sha256}</dd>
            <dt>Textextraktion</dt><dd>{d.extraction_status === 'ok' ? <Tone tone="ok">Text extrahiert</Tone> : <Tone tone="warn">{d.extraction_status}</Tone>} {d.extraction_note}</dd></dl>
          {d.extraction_status === 'ocr_pruefung_erforderlich' && can('source:write') && (
            <div className="banner warn"><strong>Aus der Datei konnte kein Text gelesen werden</strong> (vermutlich gescannt). Ohne geprüften Text können weder Kriterien abgeleitet noch Belege verifiziert werden. Fügen Sie den geprüften Text ein:
              <textarea value={ocr} onChange={(e) => setOcr(e.target.value)} style={{ marginTop: 8 }} /><button disabled={busy || ocr.length < 20} onClick={async () => { if (await run(() => api.post(`/api/sources/${id}/ocr-text`, { text: ocr }), 'Geprüfter Text übernommen.')) s.reload(); }}>Geprüften Text übernehmen</button></div>
          )}
          <h3>Kriterien aus dieser Quelle</h3>
          {d.kriterien.length ? <ul>{d.kriterien.map((k: any) => <li key={k.id}><Link to={`/kriterien/${k.id}`}>{k.code}</Link> – {k.title} <Badge kind="obj" value={k.status} /></li>)}</ul> : <Empty>Noch keine.</Empty>}
          {can('ai:run') && d.extraction_status === 'ok' && (
            <div>
              <div className="row"><button className="primary" disabled={busy || (job && ['queued', 'running'].includes(job.status))} onClick={() => derive('auto')}><Icon n="spark" size={16} />Kriterien ableiten</button></div>
              <details style={{ marginTop: 8 }}><summary>Weitere Möglichkeiten</summary><div className="row">
                <button disabled={busy} onClick={() => derive('uebernahme')}>Nur eingebettete übernehmen</button>
                <button disabled={busy} onClick={() => derive('ki')}>Nur mit KI</button>
                {demo && <button disabled={busy} onClick={() => derive('demo')}>Demo-Ableitung <DemoTag>Demo</DemoTag></button>}</div></details>
              {job && <div style={{ marginTop: 12 }} aria-live="polite">
                {['queued', 'running'].includes(job.status) && <p><progress value={job.progress} max={Math.max(job.total, 1)} /> {job.message ?? 'läuft …'}</p>}
                {job.status === 'failed' && <div className="banner bad" role="alert">{job.error}</div>}
                {job.status === 'succeeded' && <DeriveResult r={job.result} />}
              </div>}
            </div>
          )}
        </div>
      )}</Async>
    </Modal>
  );
}

function CompareSources({ list, onClose }: { list: any[]; onClose: () => void }) {
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [res, setRes] = useState<any>(null); const { busy, run } = useAction();
  const opt = list.map((x) => <option key={x.id} value={x.id}>{x.title} – Version {x.version_label}</option>);
  return (
    <Modal title="Quellenversionen vergleichen" onClose={onClose} wide>
      <div className="form-grid"><Field id="c-from" label="Ältere Version"><select value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Bitte wählen</option>{opt}</select></Field><Field id="c-to" label="Neuere Version"><select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Bitte wählen</option>{opt}</select></Field></div>
      <button className="primary" disabled={busy || !from || !to || from === to} onClick={async () => setRes(await run(() => api.get(`/api/sources/compare?from=${from}&to=${to}`)))}>Vergleichen</button>
      {res && <div className="stack" style={{ marginTop: 14 }}>
        <p><Tone tone="info">{res.counts.neu} neu</Tone> <Tone tone="warn">{res.counts.geaendert} geändert</Tone> <Tone tone="neutral">{res.counts.unveraendert} unverändert</Tone> <Tone tone="bad">{res.counts.entfallen} entfallen</Tone></p>
        {res.geaendert.map((c: any, i: number) => <div key={i} className="split"><div className="diff-before card"><strong>Vorher</strong><p>{c.before}</p></div><div className="diff-after card"><strong>Nachher</strong><p>{c.after}</p></div></div>)}
        {res.neu.length > 0 && <><h3>Neu</h3>{res.neu.map((t: string, i: number) => <p key={i} className="diff-after card">{t}</p>)}</>}
        {res.entfallen.length > 0 && <><h3>Entfallen</h3>{res.entfallen.map((t: string, i: number) => <p key={i} className="diff-before card">{t}</p>)}</>}
      </div>}
    </Modal>
  );
}
