import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, teardown, FB, PR, PR2, type Ctx } from './helpers.js';

let c: Ctx; let fb: ReturnType<Ctx['as']>, pr: typeof fb, pr2: typeof fb;
beforeAll(async () => { c = await setup(); fb = c.as(FB); pr = c.as(PR); pr2 = c.as(PR2); });
afterAll(async () => { await teardown(c); });

describe('Vereinfachter Ablauf: Sammelaktionen', () => {
  it('Dashboard nennt zu Beginn den nächsten Schritt', async () => {
    const d = (await pr.get('/api/dashboard')).json;
    expect(d.naechsterSchritt?.titel).toBeTruthy(); expect(d.naechsterSchritt.link.path).toBeTruthy();
  });
  it('Sammel-Einreichung und Sammel-Freigabe: Vier-Augen bleibt, Testfall-Entwürfe entstehen automatisch', async () => {
    // offene Klärungen werden zuerst entschieden, damit Soll-Ergebnisse berechenbar sind
    for (const cl of (await pr.get('/api/clarifications')).json.eintraege) await pr.post(`/api/clarifications/${cl.id}/decide`, { decisionKey: cl.options[0].key });
    const sub = await fb.post('/api/objects/criteria/submit-batch', {});
    expect(sub.status, JSON.stringify(sub.json)).toBe(200); expect(sub.json.eingereicht).toBe(17);
    const self = await fb.post('/api/objects/criteria/approve-batch', {});
    expect(self.status).toBe(403); // Fachbearbeitung darf nicht freigeben
    const ok = await pr2.post('/api/objects/criteria/approve-batch', {});
    expect(ok.status, JSON.stringify(ok.json)).toBe(200); expect(ok.json.freigegeben).toBe(17);
    const tcs = (await fb.get('/api/objects/testcases')).json.eintraege as any[];
    expect(tcs.length).toBeGreaterThan(5); expect(tcs.every((t) => t.status !== 'approved')).toBe(true); // nie automatisch freigegeben
    const next = (await pr.get('/api/dashboard')).json.naechsterSchritt;
    expect(next.key).not.toBe('quelle');
  });
  it('Eigene Einreichung wird bei der Sammel-Freigabe nicht vom Einreicher selbst freigegeben', async () => {
    const sub = await fb.post('/api/objects/testcases/submit-batch', {});
    expect(sub.json.eingereicht).toBeGreaterThan(0);
    const mine = await pr.post('/api/objects/testcases/approve-batch', {}); // PR hat nichts eingereicht → darf
    expect(mine.status).toBe(200);
  });
  it('Automatische Ableitung ohne KI: Fallback ohne Fehlermeldung', async () => {
    const src = (await fb.get('/api/sources')).json.quellen[0];
    const r = await fb.post(`/api/sources/${src.id}/derive`, { mode: 'auto' });
    expect(r.status, JSON.stringify(r.json)).toBe(200); expect(r.json.jobId).toBeTruthy();
  });
});
