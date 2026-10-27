import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Async, ConfirmReason, Modal, api, useAction, useAsync, useAuth } from '../ui';
import { Icon } from '../viz';

const ART: Record<string, { name: string; plural: string; path: string; api: string; icon: string }> = {
  criterion: { name: 'Kriterium', plural: 'Kriterien', path: 'kriterien', api: 'criteria', icon: 'list' },
  testcase: { name: 'Testfall', plural: 'Testfälle', path: 'testfaelle', api: 'testcases', icon: 'flask' },
  report: { name: 'Bericht', plural: 'Berichte', path: 'berichte', api: 'reports', icon: 'doc' },
};

export function Freigaben() {
  const { can, user } = useAuth(); const { busy, run } = useAction();
  const s = useAsync(() => api.get('/api/approvals'), []);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [rej, setRej] = useState<any>(null);
  const [bulk, setBulk] = useState<string | null>(null);
  const decide = can('approval:decide');

  const approve = async (e: any) => {
    const r = await run(() => api.post(`/api/objects/${ART[e.art].api}/versions/${e.version_id}/decide`, { decision: 'approved' }), `${ART[e.art].name} freigegeben.`);
    if (r) { setGone((g) => new Set(g).add(e.version_id)); setTimeout(s.reload, 350); }
  };
  const approveAll = async (art: string) => {
    const r: any = await run(() => api.post(`/api/objects/${ART[art].api}/approve-batch`, {}), (x: any) => `${x.freigegeben} freigegeben${x.uebersprungen.length ? `, ${x.uebersprungen.length} übersprungen` : ''}${x.testfaelle ? `. ${x.testfaelle.angelegt} Testfall-Entwürfe wurden angelegt.` : '.'}`);
    setBulk(null); if (r) s.reload();
  };

  return (
    <>
      <h1>Freigaben</h1>
      <Async s={s}>{(d: any) => {
        const items = d.eintraege.filter((e: any) => !gone.has(e.version_id));
        if (items.length === 0) return <div className="card"><div className="empty"><Icon n="check" size={44} /><strong>Alles erledigt.</strong><div className="hint">Es wartet nichts auf Ihre Entscheidung.</div></div></div>;
        return <>{(['criterion', 'testcase', 'report'] as const).map((art) => {
          const list = items.filter((e: any) => e.art === art); if (!list.length) return null;
          const others = list.filter((e: any) => e.submitted_by !== user.name);
          return (
            <section key={art} aria-label={ART[art].plural}>
              <div className="bulkbar" style={{ position: 'static', background: 'transparent', color: 'var(--ink)', padding: '4px 0' }}>
                <h2 style={{ margin: 0 }}>{ART[art].plural} <span className="pill-n">{list.length}</span></h2>
                {decide && others.length > 1 && <button className="primary" disabled={busy} onClick={() => setBulk(art)}><Icon n="check" size={16} />Alle {others.length} freigeben</button>}
              </div>
              {list.map((e: any) => {
                const own = e.submitted_by === user.name;
                return (
                  <article key={e.version_id} className="review">
                    <Icon n={ART[art].icon} size={22} />
                    <div><h3>{e.title}</h3><div className="hint"><span className="mono">{e.code}</span> · Version {e.version} · von {e.submitted_by}</div></div>
                    <div className="actions">
                      <Link className="btn" to={`/${ART[art].path}/${e.object_id}`}>Ansehen</Link>
                      {decide && (own ? <span className="hint" style={{ alignSelf: 'center' }}>Eigene Einreichung – andere Person gibt frei</span> : <>
                        <button className="primary" disabled={busy} onClick={() => approve(e)}><Icon n="check" size={16} />Freigeben</button>
                        <button className="danger" disabled={busy} onClick={() => setRej(e)}><Icon n="x" size={16} />Ablehnen</button></>)}
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}</>;
      }}</Async>
      {!decide && <p className="hint">Sie dürfen ansehen, aber nicht entscheiden.</p>}
      {rej && <ConfirmReason title={`${ART[rej.art].name} ablehnen`} label="Warum wird abgelehnt?" confirmLabel="Ablehnen" danger minLength={10} onCancel={() => setRej(null)}
        onConfirm={async (reason) => { const r = await run(() => api.post(`/api/objects/${ART[rej.art].api}/versions/${rej.version_id}/decide`, { decision: 'rejected', reason }), 'Abgelehnt. Die Version bleibt erhalten.'); if (r) { setRej(null); s.reload(); } }} />}
      {bulk && <Modal title={`Alle ${ART[bulk].plural} freigeben?`} onClose={() => setBulk(null)}>
        <p>Sie bestätigen die Inhalte{bulk === 'testcase' ? ' einschließlich der Soll-Ergebnisse' : ''}. Eigene Einreichungen werden übersprungen.</p>
        <div className="row"><button className="primary" disabled={busy} onClick={() => approveAll(bulk)}>Ja, freigeben</button><button onClick={() => setBulk(null)}>Abbrechen</button></div>
      </Modal>}
    </>
  );
}
