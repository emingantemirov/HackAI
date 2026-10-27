import { Link } from 'react-router-dom';
import { Async, DemoTag, PageHead, api, link, useAsync, useAuth, fmtTime } from '../ui';

function Group({ title, g, hint }: { title: string; g: any; hint?: string }) {
  return (
    <section className="card" aria-labelledby={`g-${title}`}>
      <div className="row spread"><h2 id={`g-${title}`}><Link to={link(g.link)}>{title}</Link></h2><span className="hint">{g.gesamt} insgesamt</span></div>
      {hint && <p className="hint">{hint}</p>}
      <div className="statlist">
        {g.zaehler.map((z: any) => (
          <Link key={z.key} to={link(z.link)} className="statlink" aria-label={`${z.label}: ${z.anzahl} von ${z.nenner}. Liste öffnen`}>
            <div className="big ratio">{z.anzahl}<span className="hint" style={{ fontSize: '1rem', fontWeight: 400 }}> / {z.nenner}</span></div>
            <div>{z.label}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function Dashboard() {
  const s = useAsync(() => api.get('/api/dashboard'), []);
  const demo = useAsync(() => api.get('/api/demo/betragsvergleich'), []);
  const { can } = useAuth();
  return (
    <>
      <PageHead title="Übersicht" lead={<>Der aktuelle Stand der Prüfung – jede Zahl öffnet die zugehörige Liste. <strong className="principle">KI unterstützt. Menschen entscheiden.</strong></>} />
      <Async s={s}>{(d: any) => (
        <>
          <div className="card accent">
            <h2>Was ist jetzt zu tun?</h2>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li><Link to={link(d.wartendAufFreigabe.link)}><strong>{d.wartendAufFreigabe.gesamt}</strong> Objekte warten auf Freigabe</Link> ({d.wartendAufFreigabe.nachArt.map((x: any, i: number) => <span key={x.art}>{i ? ', ' : ''}<Link to={link(x.link)}>{x.art}: {x.anzahl}</Link></span>)})</li>
              <li><Link to={link(d.offeneKlaerungen.link)}><strong>{d.offeneKlaerungen.anzahl}</strong> offene Klärungsvorgänge</Link> – sie blockieren Soll-Ergebnisse, bis eine fachliche Entscheidung dokumentiert ist.</li>
              <li><Link to={link(d.offeneAenderungen.link)}><strong>{d.offeneAenderungen.anzahl}</strong> offene Auswirkungen geänderter Kriterien</Link> auf Testfälle.</li>
              <li><Link to={link(d.laeufeMitUeberholterGrundlage.link)}><strong>{d.laeufeMitUeberholterGrundlage.anzahl}</strong> von {d.laeufeMitUeberholterGrundlage.nenner} Testläufen</Link> beruhen auf einer überholten Grundlage.</li>
            </ul>
          </div>
          <div className="grid two">
            <Group title="Kriterien" g={d.kriterien} />
            <Group title="Testfälle" g={d.testfaelle} />
            <Group title="Prüfungen (Testläufe)" g={d.pruefungen} hint="Ergebnis eines Testlaufs. „Nicht bestanden“ ist ein Testergebnis, kein Freigabestatus." />
            <Group title="Berichte" g={d.berichte} />
          </div>
          <details className="card"><summary>Zählregeln dieser Übersicht</summary>
            <ul>{d.zaehlregeln.map((r: string) => <li key={r}>{r}</li>)}</ul>
            <p className="hint">Stand: {fmtTime(d.stand)}. Die Zahlen werden bei jedem Aufruf aus der Datenbank berechnet – mit derselben Abfrage wie die Listen.</p>
          </details>
          <section className="card" aria-labelledby="demo-h">
            <div className="row spread"><h2 id="demo-h">Betragsvergleich auf den Cent genau</h2><DemoTag /></div>
            <Async s={demo}>{(x: any) => (
              <>
                <p className="hint">{x.hinweis}</p>
                <div className="tablewrap"><table><caption className="sr-only" style={{ display: 'none' }}>Beispiel</caption>
                  <thead><tr><th>Feld</th><th className="num">Soll</th><th className="num">Ist</th><th className="num">Differenz</th><th>Ergebnis</th></tr></thead>
                  <tbody><tr><td>{x.feld}</td><td className="num">{x.soll} €</td><td className="num">{x.ist} €</td><td className="num">{x.differenz} €</td><td><span className={`badge ${x.gleich ? 'ok' : 'bad'}`}><span aria-hidden="true">{x.gleich ? '✔' : '✖'}</span>{x.gleich ? 'Gleich' : 'Abweichung'}</span></td></tr></tbody></table></div>
                <p className="hint">{x.verfahren} Die KI entscheidet nicht über Gleichheit.</p>
              </>
            )}</Async>
          </section>
          <section className="card"><h2>Ablauf einer Prüfung</h2>
            <ol>
              <li><Link to="/kriterien?ansicht=quellen">Quelle hinzufügen</Link>, Kriterien ableiten und <strong>freigeben</strong>.</li>
              <li><Link to="/testfaelle">Testfälle</Link> erzeugen, Soll-Ergebnisse prüfen und <strong>freigeben</strong>.</li>
              <li>Unter <Link to="/pruefungen">Prüfungen</Link> Prüfpaket bereitstellen, Software extern testen, Rückgabedateien importieren.</li>
              <li>Soll und Ist vergleichen, Abweichungen fachlich einordnen, Bericht erstellen und <strong>freigeben</strong>.</li>
              <li>Erst danach: Bericht bereitstellen und – getrennt davon – über die Zertifizierung entscheiden{can('certification:decide') ? '' : ' (nur berechtigte Personen)'}.</li>
            </ol>
          </section>
        </>
      )}</Async>
    </>
  );
}
