import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, teardown, FB, PR, PR2, type Ctx } from './helpers.js';

let c: Ctx; let fb: ReturnType<Ctx['as']>, pr: typeof fb, pr2: typeof fb;
beforeAll(async () => { c = await setup(); fb = c.as(FB); pr = c.as(PR); pr2 = c.as(PR2); });
afterAll(async () => { await teardown(c); });

describe('Direkte Prüfung einzelner Kriterien', () => {
  it('Freigeben aus dem Entwurf aktiviert das Kriterium; Ablehnen braucht Begründung und lässt die KI-Überarbeitung aus, wenn sie nicht verbunden ist', async () => {
    const list = (await fb.get('/api/objects/criteria')).json.eintraege as any[];
    expect(list[0].created_at).toBeTruthy();
    const [a, b] = list;
    expect((await fb.post(`/api/criteria/versions/${a.version_id}/review`, { decision: 'approved' })).status).toBe(403);
    const ok = await pr.post(`/api/criteria/versions/${a.version_id}/review`, { decision: 'approved' });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect((await pr.get(`/api/objects/criteria/${a.object_id}`)).json.versionen[0].status).toBe('approved');
    expect((await pr.post(`/api/criteria/versions/${b.version_id}/review`, { decision: 'rejected', reason: 'kurz' })).status).toBe(400);
    const rj = await pr.post(`/api/criteria/versions/${b.version_id}/review`, { decision: 'rejected', reason: 'Bitte die Regel auf eine einzige Bedingung kürzen.' });
    expect(rj.status, JSON.stringify(rj.json)).toBe(200); expect(rj.json.ueberarbeitet).toBe(false); expect(rj.json.hinweis).toMatch(/KI/);
    expect((await pr.get(`/api/objects/criteria/${b.object_id}`)).json.versionen[0].status).toBe('rejected'); // bleibt erhalten
  });
});

