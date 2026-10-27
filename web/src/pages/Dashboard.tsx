import { Link } from 'react-router-dom';
import { Async, DemoTag, api, link, useAsync, useAuth } from '../ui';
import { Icon, Ring, Stacked, useCountUp } from '../viz';

const C = { ok: '#1b7f46', sub: '#4f6d94', draft: '#c3cbdb', clar: '#e0a31b', bad: '#d0102f' };

function Gate({ n, name, g, next }: { n: number; name: string; g: any; next?: boolean }) {
  const by = Object.fromEntries(g.zaehler.map((z: any) => [z.key, z]));
  const total = g.gesamt, ok = by.freigegeben?.anzahl ?? 0;
  const pct = total ? Math.round((ok / total) * 100) : 0;
  const segs = [
    { value: ok, color: C.ok, label: 'Freigegeben' }, { value: by['zur-freigabe']?.anzahl ?? 0, color: C.sub, label: 'Wartet auf Freigabe' },
    { value: by.klaerung?.anzahl ?? 0, color: C.clar, label: 'Klärung erforderlich' }, { value: by.abgelehnt?.anzahl ?? 0, color: C.bad, label: 'Abgelehnt' }, { value: by.entwurf?.anzahl ?? 0, color: C.draft, label: 'Entwurf' },
  ];
  const sub = total === 0 ? 'Noch leer' : `${ok} von ${total} freigegeben`;
  return (
    <section className="gate" aria-label={`${n}. Freigabe: ${name}. ${sub}`}>
      <div className="num">Freigabe {n}</div>
      <Link className="name" to={link(g.link)} style={{ color: 'inherit', textDecoration: 'none' }}>{name}</Link>
      <Ring segs={segs} total={total} pct={pct} />
      <div className="sub">{sub}</div>
      <div className="legend">{g.zaehler.filter((z: any) => z.anzahl > 0 && z.key !== 'freigegeben').map((z: any) => {
        const s = segs.find((x) => x.label === z.label);
        return <Link key={z.key} to={link(z.link)} style={{ color: 'inherit', textDecoration: 'none' }} title={`${z.anzahl} von ${z.nenner}`}><i style={{ background: s?.color }} />{z.anzahl} {z.label.replace('Zur Freigabe eingereicht', 'wartet').replace('Klärung erforderlich', 'Klärung')}</Link>;
      })}</div>
      {void next}
    </section>
  );
}

function Money({ d }: { d: any }) {
  const num = (s: string) => Number(s.replace(/[^\d,-]/g, '').replace(',', '.'));
  const soll = num(d.soll), ist = num(d.ist), max = Math.max(soll, ist);
  return (
    <section className="card" aria-labelledby="bm">
      <div className="row spread"><h2 id="bm">Betragsvergleich</h2><DemoTag>Demonstration</DemoTag></div>
      <div className="sollbar" aria-hidden="true">
        <div style={{ height: `${(soll / max) * 100}%`, background: '#4f6d94' }}>Soll</div>
        <div style={{ height: `${(ist / max) * 100}%`, background: d.gleich ? '#1b7f46' : '#d0102f' }}>Ist</div>
      </div>
      <p className="row spread" style={{ margin: '10px 0 0' }}>
        <span className="hint">Soll {d.soll} · Ist {d.ist}</span>
        <span className={`badge ${d.gleich ? 'ok' : 'bad'}`}><Icon n={d.gleich ? 'check' : 'x'} size={13} />{d.gleich ? 'Gleich' : `Differenz ${d.differenz}`}</span>
      </p>
      <p className="hint" style={{ margin: '6px 0 0' }}>Cent-genau, deterministisch. Beispielwerte, keine echte Prüfung.</p>
    </section>
  );
}

export function Dashboard() {
  const s = useAsync(() => api.get('/api/dashboard'), []);
  const demo = useAsync(() => api.get('/api/demo/betragsvergleich'), []);
  const { can, user } = useAuth();
  return (
    <Async s={s}>{(d: any) => {
      const ns = d.naechsterSchritt; const allowed = !ns.needs || can(ns.needs);
      const crit = d.kriterien, tc = d.testfaelle;
      const critOk = crit.gesamt > 0 && crit.zaehler.find((z: any) => z.key === 'freigegeben').anzahl === crit.gesamt;
      const tcOk = tc.gesamt > 0 && tc.zaehler.find((z: any) => z.key === 'freigegeben').anzahl === tc.gesamt;
      const tasks = [
        { n: d.wartendAufFreigabe.gesamt, t: 'warten auf Freigabe', l: d.wartendAufFreigabe.link },
        { n: d.offeneKlaerungen.anzahl, t: 'offene Fragen', l: d.offeneKlaerungen.link },
        { n: d.offeneAenderungen.anzahl, t: 'Änderungen mit Folgen', l: d.offeneAenderungen.link },
        { n: d.laeufeMitUeberholterGrundlage.anzahl, t: 'Läufe auf überholter Grundlage', l: d.laeufeMitUeberholterGrundlage.link },
      ].filter((x) => x.n > 0);
      return (
        <>
          <section className="next" aria-labelledby="next-h">
            <svg className="orb" width="260" height="260" viewBox="0 0 40 40" aria-hidden="true"><ellipse cx="20" cy="20" rx="17" ry="7" fill="none" stroke="#fff" strokeWidth="1.4" transform="rotate(-30 20 20)" /><ellipse cx="20" cy="20" rx="17" ry="7" fill="none" stroke="#fff" strokeWidth="1.4" transform="rotate(30 20 20)" /><circle cx="20" cy="20" r="6" fill="#fff" /></svg>
            <div style={{ position: 'relative' }}>
              <div className="eyebrow">Hallo {user.name.split(' ')[0]} – Ihr nächster Schritt</div>
              <h2 id="next-h">{ns.titel}</h2>
              <p>{ns.text}</p>
            </div>
            <div style={{ position: 'relative' }}>
              {allowed ? <Link className="btn accent" to={link(ns.link)} style={{ fontSize: '1.05rem', padding: '12px 24px' }}>{ns.key === 'fertig' ? 'Prüfungen ansehen' : 'Jetzt erledigen'}<Icon n="arrow" /></Link>
                : <span className="badge info" style={{ background: 'rgba(255,255,255,.14)', color: '#fff', padding: '8px 16px' }}>Wartet auf Prüfer/Freigeber</span>}
            </div>
          </section>

          <div className="pipeline" aria-label="Die drei Freigaben">
            <Gate n={1} name="Kriterien" g={crit} />
            <div className={`link-line ${critOk ? 'on' : ''}`} aria-hidden="true" />
            <Gate n={2} name="Testfälle" g={tc} />
            <div className={`link-line ${tcOk ? 'on' : ''}`} aria-hidden="true" />
            <Gate n={3} name="Berichte" g={d.berichte} />
          </div>

          {tasks.length > 0 && <div className="tasks">{tasks.map((t) => <Link key={t.t} className="task" to={link(t.l)}><b>{t.n}</b>{t.t}</Link>)}</div>}

          <div className="grid two">
            <section className="card" aria-labelledby="pr-h">
              <div className="row spread"><h2 id="pr-h">Prüfungen</h2>{can('campaign:manage') && <Link className="btn" to="/pruefungen?neu=1"><Icon n="plus" size={16} />Neu</Link>}</div>
              {d.campaigns.length === 0 ? <div className="empty"><Icon n="flask" size={36} /><div>Noch keine Prüfung.</div></div> : d.campaigns.map((c: any) => (
                <Link key={c.id} className="camp" to={`/pruefungen/${c.id}`}>
                  <div><strong>{c.name}</strong><div className="hint">{c.gesamt ? `${c.bestanden} von ${c.gesamt} bestanden${c.nicht_bestanden ? ` · ${c.nicht_bestanden} Abweichung${c.nicht_bestanden === 1 ? '' : 'en'}` : ''}` : 'Noch keine Testläufe'}</div></div>
                  <Icon n="arrow" />
                  <Stacked parts={[{ v: c.bestanden, c: C.ok, l: 'bestanden' }, { v: c.nicht_bestanden, c: C.bad, l: 'nicht bestanden' }, { v: c.wartet, c: C.sub, l: 'wartet auf Rückgabe' }, { v: c.nicht_gestartet, c: C.draft, l: 'nicht gestartet' }]} />
                </Link>
              ))}
            </section>
            <Async s={demo}>{(x: any) => <Money d={x} />}</Async>
          </div>
          <details style={{ marginTop: 6 }}><summary>So wird gezählt</summary><ul className="hint">{d.zaehlregeln.map((r: string) => <li key={r}>{r}</li>)}</ul></details>
          {void useCountUp}
        </>
      );
    }}</Async>
  );
}
