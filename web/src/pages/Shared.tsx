import React, { useState } from 'react';
import { Badge, ConfirmReason, Modal, Tone, api, fmtTime, useAction, useAuth, Empty } from '../ui';

export const TYPE_LABEL: Record<string, string> = { positiv: 'Positiv', negativ: 'Negativ', grenzfall: 'Grenzfall', sonderfall: 'Sonderfall', mehrstufig: 'Mehrstufig' };
export const KIND_LABEL: Record<string, string> = { eingangsdaten: 'Eingangsdaten', folgeantwort: 'Antwort der Krankenkasse', erwartet: 'Erwartet von der Software', hinweis: 'Hinweis' };

export function SollView({ expected, events }: { expected: any; events?: any[] }) {
  const msgs: any[] = expected?.messages ?? [];
  return (
    <div className="stack">
      {events && events.length > 0 && (
        <div className="tablewrap"><table><caption>Ablauf</caption><thead><tr><th>Stufe</th><th>Beteiligte</th><th>Art</th><th>Beschreibung</th></tr></thead>
          <tbody>{events.map((e, i) => <tr key={i}><td>{e.stage}</td><td>{e.actor}</td><td>{KIND_LABEL[e.kind] ?? e.kind}</td><td>{e.text}</td></tr>)}</tbody></table></div>
      )}
      {msgs.length === 0 ? <div className="banner info">Dieser Testfall erwartet ausdrücklich <strong>keine Meldung</strong> (Nicht-Erzeugung). Der Testabschluss muss dokumentiert werden.</div> : (
        <div className="tablewrap"><table><caption>Soll-Ergebnis (erwartete Meldungen)</caption>
          <thead><tr><th>Stufe</th><th>Abgabegrund</th><th>Storno</th><th>Erwartete Angaben</th></tr></thead>
          <tbody>{msgs.map((m) => (
            <tr key={m.id}><td>{m.stage}</td><td>{m.abgabegrund}</td><td>{m.storno === 'J' ? 'Ja' : 'Nein'}</td>
              <td>{m.dbvo && <div><strong>DBVO</strong> (AU ab AG {m.dbvo.auAbAg}, {m.dbvo.anzahl} Zeit{m.dbvo.anzahl === 1 ? '' : 'en'}){m.dbvo.entries.length > 0 && <ul style={{ margin: '2px 0' }}>{m.dbvo.entries.map((e: any, i: number) => <li key={i}>{e.beginn} bis {e.ende}</li>)}</ul>}</div>}
                {m.dbal && <div><strong>DBAL</strong> EFZ-Ende {m.dbal.efzEnde}{m.dbal.endeBv ? `, Ende BV ${m.dbal.endeBv}` : ''}</div>}
                {m.dbsd && <div><strong>DBSD</strong> storniert die Meldung der Stufe 1 (Verweis auf deren DATENSATZ-ID)</div>}
                <div className="hint">Kriterien: {(m.criteria ?? []).join(', ') || '–'} · AZVU {m.azvu}</div></td></tr>))}</tbody></table></div>
      )}
    </div>
  );
}

export function ApprovalPanel({ type, v, d, isCur, reload, extraGuard }: { type: 'testcases' | 'reports'; v: any; d: any; isCur: boolean; reload: () => void; extraGuard?: string }) {
  const { can, user } = useAuth(); const { busy, run } = useAction();
  const [dlg, setDlg] = useState<'approve' | 'reject' | null>(null);
  const base = `/api/objects/${type}/versions/${v.id}`;
  const label = type === 'testcases' ? 'Testfall' : 'Bericht';
  const decide = async (decision: string, reason?: string, hints?: string) => {
    if (await run(() => api.post(`${base}/decide`, { decision, reason, hints }), decision === 'approved' ? `${label} freigegeben.` : `${label} abgelehnt. Die Version bleibt erhalten.`)) { setDlg(null); reload(); }
  };
  const last = [...d.verlauf].reverse().find((h: any) => h.decision === 'rejected' && h.version === v.version);
  return (
    <section className="card accent" aria-label="Freigabe">
      <h2>Freigabe</h2>
      {type === 'testcases' && <p className="hint">Mit der Freigabe bestätigen Sie den Testfall <strong>einschließlich des Soll-Ergebnisses</strong> in dieser Version. Die KI kann nicht freigeben.</p>}
      {type === 'reports' && <p className="hint">Nur ein freigegebener Bericht darf bereitgestellt werden. Freigabe und Bereitstellung sind getrennte Schritte.</p>}
      {v.status === 'rejected' && last && <div className="banner bad"><strong>Abgelehnt von {last.by}:</strong> {last.reason}{last.hints && <><br /><strong>Hinweise:</strong> {last.hints}</>}</div>}
      {extraGuard && <div className="banner warn">{extraGuard}</div>}
      <div className="row">
        {isCur && ['draft', 'rejected', 'clarification'].includes(v.status) && can('content:submit') && <button className="primary" disabled={busy} onClick={async () => { if (await run(() => api.post(`${base}/submit`), 'Zur Freigabe eingereicht.')) reload(); }}>Zur Freigabe einreichen</button>}
        {isCur && v.status === 'submitted' && <button disabled={busy} onClick={async () => { if (await run(() => api.post(`${base}/withdraw`), 'Einreichung zurückgezogen.')) reload(); }}>Einreichung zurückziehen</button>}
        {isCur && v.status === 'submitted' && can('approval:decide') && <><button className="primary" disabled={busy || v.submitted_by === user.id} onClick={() => setDlg('approve')}>Freigeben</button><button className="danger" disabled={busy} onClick={() => setDlg('reject')}>Ablehnen …</button></>}
      </div>
      {v.status === 'submitted' && v.submitted_by === user.id && <p className="hint">Sie haben diese Version eingereicht; die Freigabe übernimmt eine andere Person.</p>}
      <h3>Entscheidungsverlauf</h3>
      {d.verlauf.length ? <ul>{d.verlauf.map((h: any, i: number) => <li key={i}><Tone tone={h.decision === 'approved' ? 'ok' : 'bad'}>{h.decision === 'approved' ? 'Freigegeben' : 'Abgelehnt'}</Tone> v{h.version} von {h.by}, {fmtTime(h.at)}{h.reason ? ` – ${h.reason}` : ''}{h.hints ? ` (Hinweis: ${h.hints})` : ''}</li>)}</ul> : <Empty>Noch keine Entscheidung.</Empty>}
      <h3>Versionen</h3>
      <ul>{d.versionen.map((x: any) => <li key={x.id}>v{x.version} <Badge kind="obj" value={x.status} /> {fmtTime(x.created_at)}{x.change_note ? ` – ${x.change_note}` : ''}</li>)}</ul>
      {dlg === 'reject' && <ConfirmReason title="Version ablehnen" label="Begründung der Ablehnung" confirmLabel="Ablehnen" danger hintField onCancel={() => setDlg(null)} onConfirm={(r, h) => decide('rejected', r, h)} intro={<p>Die Version v{v.version} bleibt erhalten. Die Begründung ist Pflicht.</p>} />}
      {dlg === 'approve' && <Modal title="Version freigeben" onClose={() => setDlg(null)}><p>Sie geben v{v.version} frei. Die Freigabe gilt nur für diese Version.</p><div className="row"><button className="primary" disabled={busy} onClick={() => decide('approved')}>Freigeben</button><button onClick={() => setDlg(null)}>Abbrechen</button></div></Modal>}
    </section>
  );
}
