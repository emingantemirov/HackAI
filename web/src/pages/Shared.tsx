import React, { useState } from 'react';
import { StatusPill } from './Kriterien';
import { Icon } from '../viz';
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
  const { can } = useAuth(); const { busy, run } = useAction();
  const [dlg, setDlg] = useState<'approve' | 'reject' | null>(null);
  const label = type === 'testcases' ? 'Testfall' : 'Bericht';
  const decide = async (decision: string, reason?: string, hints?: string) => {
    if (await run(() => api.post(`/api/objects/${type}/versions/${v.id}/review`, { decision, reason, hints }), decision === 'approved' ? `${label} freigegeben.` : `${label} abgelehnt. Die Version bleibt erhalten.`)) { setDlg(null); reload(); }
  };
  const last = [...d.verlauf].reverse().find((h: any) => h.decision === 'rejected' && h.version === v.version);
  const canDecide = isCur && ['draft', 'submitted'].includes(v.status) && (can('approval:decide') || can('content:write'));
  return (
    <section className="card accent" aria-label="Entscheidung">
      <div className="row spread"><h2 style={{ margin: 0 }}>Entscheidung</h2><StatusPill status={v.status} /></div>
      {type === 'testcases' && <p className="hint">Mit „Freigeben“ bestätigen Sie den Testfall <strong>einschließlich Soll-Ergebnis</strong>. Die KI kann nicht freigeben.</p>}
      {v.status === 'rejected' && last && <div className="banner bad"><strong>Abgelehnt von {last.by}:</strong> {last.reason}{last.hints && <><br /><strong>Hinweis:</strong> {last.hints}</>}</div>}
      {extraGuard && <div className="banner warn">{extraGuard}</div>}
      {canDecide && <div className="row" style={{ marginTop: 12 }}><button className="primary" disabled={busy} onClick={() => setDlg('approve')}><Icon n="check" size={16} />Freigeben</button><button className="danger" disabled={busy} onClick={() => setDlg('reject')}><Icon n="x" size={16} />Ablehnen</button></div>}
      <h3>Entscheidungsverlauf</h3>
      {d.verlauf.length ? <ul>{d.verlauf.filter((h: any) => ['approved', 'rejected'].includes(h.decision)).map((h: any, i: number) => <li key={i}><Tone tone={h.decision === 'approved' ? 'ok' : 'bad'}>{h.decision === 'approved' ? 'Freigegeben' : 'Abgelehnt'}</Tone> v{h.version} von {h.by}, {fmtTime(h.at)}{h.reason ? ` – ${h.reason}` : ''}</li>)}</ul> : <Empty>Noch keine Entscheidung.</Empty>}
      {dlg === 'reject' && <ConfirmReason title={`${label} ablehnen`} label="Grund der Ablehnung" confirmLabel="Ablehnen" danger hintField hintLabel="Hinweis zur Verbesserung" onCancel={() => setDlg(null)} onConfirm={(r, h) => decide('rejected', r, h)} intro={<p className="hint">Die Version bleibt erhalten.</p>} />}
      {dlg === 'approve' && <Modal title={`${label} freigeben`} onClose={() => setDlg(null)}><p>Sie geben <strong>{d.objekt?.code ?? label} v{v.version}</strong> frei. Die Freigabe gilt nur für diese Version.</p><div className="row"><button className="primary" disabled={busy} onClick={() => decide('approved')}>Freigeben</button><button onClick={() => setDlg(null)}>Abbrechen</button></div></Modal>}
    </section>
  );
}
