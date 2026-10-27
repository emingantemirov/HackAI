import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Async, Empty, FilterChips, PageHead, Tone, api, fmtTime, useAsync, useAuth } from '../ui';

const ART: Record<string, [string, (id: string) => string]> = {
  criterion: ['Kriterium', (id) => `/kriterien/${id}`],
  testcase: ['Testfall (mit Soll-Ergebnis)', (id) => `/testfaelle/${id}`],
  report: ['Bericht', (id) => `/berichte/${id}`],
};

export function Freigaben() {
  const [sp, setSp] = useSearchParams(); const art = sp.get('art') ?? ''; const { can, user } = useAuth();
  const s = useAsync(() => api.get(`/api/approvals${art ? `?art=${art}` : ''}`), [art]);
  return (
    <>
      <PageHead title="Freigaben" lead="Alles, was auf eine menschliche Entscheidung wartet. Drei Freigaben sind Pflicht: Kriterien, Testfälle mit Soll-Ergebnis und Berichte – bevor etwas extern bereitgestellt wird." />
      {!can('approval:decide') && <div className="banner info">Sie dürfen Einreichungen ansehen, aber nicht entscheiden. Freigaben sind Prüfer/Freigebern und Administratoren vorbehalten.</div>}
      <div className="card"><FilterChips options={{ criterion: 'Kriterien', testcase: 'Testfälle', report: 'Berichte' }} value={art} onChange={(v) => setSp(v ? { art: v } : {})} /></div>
      <div className="card">
        <Async s={s}>{(d: any) => d.eintraege.length === 0 ? <Empty>Nichts wartet auf Freigabe{art ? ' in dieser Kategorie' : ''}.</Empty> : (
          <div className="tablewrap"><table><caption>{d.eintraege.length} Einreichungen warten auf Entscheidung</caption>
            <thead><tr><th>Art</th><th>Kennung</th><th>Titel</th><th>Version</th><th>Eingereicht</th><th>Von</th><th></th></tr></thead>
            <tbody>{d.eintraege.map((e: any) => {
              const own = e.submitted_by === user.name;
              return <tr key={e.version_id}><td>{ART[e.art][0]}</td><td className="mono">{e.code}</td><td>{e.title}</td><td>v{e.version}</td><td>{fmtTime(e.submitted_at)}</td><td>{e.submitted_by}</td>
                <td><Link className="btn primary" to={ART[e.art][1](e.object_id)}>Prüfen und entscheiden</Link>{own && <div><Tone tone="neutral">Von Ihnen eingereicht</Tone></div>}</td></tr>;
            })}</tbody></table></div>
        )}</Async>
        <p className="hint">Die Entscheidung fällt auf der Detailseite, nachdem Sie Inhalt, Belege und – bei Testfällen – das Soll-Ergebnis gesehen haben. Eine Ablehnung braucht eine Begründung; Hinweise zur Verbesserung sind freiwillig.</p>
      </div>
    </>
  );
}
