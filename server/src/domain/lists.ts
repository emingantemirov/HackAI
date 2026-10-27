// Listen und Dashboard. Zählregeln (identisch in Dashboard und Listen, damit Zahlen und Listen nie auseinanderlaufen):
//  * Gezählt wird je logischem Objekt nur die AKTUELLE Version (höchste Versionsnummer).
//  * „Wartet auf Freigabe“ = eingereichte, noch nicht entschiedene aktuelle Versionen.
//  * „Entwurf“ und „Klärung erforderlich“ sind getrennte Zustände.
//  * „Abgelehnt“ ist ein Freigabestatus, „Nicht bestanden“ ein Testergebnis – beides wird nie vermischt.
//  * Verhältniszahlen werden immer als Zähler/Nenner ausgewiesen.

import type { Q } from '../db.js';

export const STATUS_FILTERS: Record<string, { status: string; label: string }> = {
  entwurf: { status: 'draft', label: 'Entwurf' },
  klaerung: { status: 'clarification', label: 'Klärung erforderlich' },
  'zur-freigabe': { status: 'submitted', label: 'Zur Freigabe eingereicht' },
  freigegeben: { status: 'approved', label: 'Freigegeben' },
  abgelehnt: { status: 'rejected', label: 'Abgelehnt' },
};

export const RUN_FILTERS: Record<string, { statuses: string[]; label: string }> = {
  'nicht-gestartet': { statuses: ['not_run'], label: 'Nicht gestartet' },
  'in-bearbeitung': { statuses: ['awaiting_return', 'exported'], label: 'Wartet auf Rückgabe' },
  bestanden: { statuses: ['passed'], label: 'Bestanden' },
  'nicht-bestanden': { statuses: ['failed'], label: 'Nicht bestanden' },
  blockiert: { statuses: ['blocked'], label: 'Blockiert' },
  zuordnung: { statuses: ['assignment_required', 'import_error'], label: 'Zuordnung/Import prüfen' },
};

type Kind = 'criterion' | 'testcase' | 'report';
const SQL: Record<Kind, { obj: string; ver: string; fk: string }> = {
  criterion: { obj: 'criteria', ver: 'criteria_versions', fk: 'criterion_id' },
  testcase: { obj: 'testcases', ver: 'testcase_versions', fk: 'testcase_id' },
  report: { obj: 'reports', ver: 'report_versions', fk: 'report_id' },
};

/** Aktuelle Version je logischem Objekt, optional gefiltert. Einzige Quelle für Dashboard UND Listen. */
export function currentRowsSql(kind: Kind, statusFilter?: string): { sql: string; filterStatus: string | null } {
  const t = SQL[kind];
  const f = statusFilter ? STATUS_FILTERS[statusFilter]?.status ?? null : null;
  return { filterStatus: f, sql: `select distinct on (o.id) o.id as object_id, o.*, v.id as version_id, v.version, v.status, v.title, v.created_at as version_created_at from ${t.obj} o join ${t.ver} v on v.${t.fk} = o.id where o.org_id = $1 order by o.id, v.version desc` };
}

async function countByStatus(q: Q, orgId: string, kind: Kind) {
  const { sql } = currentRowsSql(kind);
  const r = await q.query(`select status, count(*)::int as n from (${sql}) cur group by status`, [orgId]);
  const m: Record<string, number> = {};
  for (const x of r.rows) m[x.status] = x.n;
  return m;
}

export async function listCurrent(q: Q, orgId: string, kind: Kind, statusFilter?: string, search?: string) {
  const { sql, filterStatus } = currentRowsSql(kind, statusFilter);
  const params: unknown[] = [orgId];
  let where = '1=1';
  if (statusFilter) { if (!filterStatus) return []; params.push(filterStatus); where += ` and status = $${params.length}`; }
  if (search?.trim()) { params.push(`%${search.trim().toLowerCase()}%`); where += ` and (lower(title) like $${params.length} or lower(code) like $${params.length})`; }
  const r = await q.query(`select * from (${sql}) cur where ${where} order by code`, params);
  return r.rows;
}

export async function listRuns(q: Q, orgId: string, filter?: string, customerOrgId?: string) {
  const f = filter ? RUN_FILTERS[filter] : null;
  if (filter && !f) return [];
  const params: unknown[] = [customerOrgId ?? orgId];
  let where = `${customerOrgId ? 'c.customer_org_id' : 'c.org_id'} = $1 and r.superseded_by is null`;
  if (f) { params.push(f.statuses); where += ` and r.status = any($${params.length})`; }
  const r = await q.query(
    `select r.id, r.status, r.stage, r.azvu, r.basis_outdated, r.blocked_reason, r.campaign_id, c.name as campaign_name, t.code as testcase_code, tv.version as testcase_version, tv.title, tv.test_type
       from test_runs r join campaigns c on c.id = r.campaign_id join testcases t on t.id = r.testcase_id join testcase_versions tv on tv.id = r.testcase_version_id where ${where} order by c.created_at desc, t.code`, params);
  return r.rows;
}

export async function dashboard(q: Q, orgId: string) {
  const [crit, tc, rep] = await Promise.all([countByStatus(q, orgId, 'criterion'), countByStatus(q, orgId, 'testcase'), countByStatus(q, orgId, 'report')]);
  const total = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
  const obj = (m: Record<string, number>, path: string) => ({
    gesamt: total(m), link: { path },
    zaehler: Object.entries(STATUS_FILTERS).map(([key, f]) => ({ key, label: f.label, anzahl: m[f.status] ?? 0, nenner: total(m), link: { path, query: { status: key } } })),
  });
  const runs = (await q.query(
    `select r.status, count(*)::int as n from test_runs r join campaigns c on c.id = r.campaign_id where c.org_id = $1 and r.superseded_by is null group by r.status`, [orgId])).rows;
  const runTotal = runs.reduce((a, x) => a + x.n, 0);
  const rmap: Record<string, number> = Object.fromEntries(runs.map((x) => [x.status, x.n]));
  const pruef = {
    gesamt: runTotal, link: { path: '/pruefungen' },
    zaehler: Object.entries(RUN_FILTERS).map(([key, f]) => ({ key, label: f.label, anzahl: f.statuses.reduce((a, s) => a + (rmap[s] ?? 0), 0), nenner: runTotal, link: { path: '/pruefungen', query: { status: key } } })),
  };
  const waiting = [
    { art: 'Kriterien', anzahl: crit.submitted ?? 0, link: { path: '/freigaben', query: { art: 'criterion' } } },
    { art: 'Testfälle', anzahl: tc.submitted ?? 0, link: { path: '/freigaben', query: { art: 'testcase' } } },
    { art: 'Berichte', anzahl: rep.submitted ?? 0, link: { path: '/freigaben', query: { art: 'report' } } },
  ];
  const cl = (await q.query(`select count(*)::int as n from clarifications where org_id = $1 and status = 'open'`, [orgId])).rows[0].n;
  const impacts = (await q.query(`select count(*)::int as n from change_impacts where org_id = $1 and status = 'offen'`, [orgId])).rows[0].n;
  const outdated = (await q.query(`select count(*)::int as n from test_runs r join campaigns c on c.id = r.campaign_id where c.org_id = $1 and r.superseded_by is null and r.basis_outdated`, [orgId])).rows[0].n;
  const campaigns = (await q.query(`select id, name from campaigns where org_id = $1 order by created_at desc`, [orgId])).rows;
  return {
    stand: new Date().toISOString(),
    zaehlregeln: [
      'Gezählt wird je Kriterium, Testfall und Bericht nur die aktuelle Version.',
      '„Wartet auf Freigabe“ umfasst nur eingereichte, noch nicht entschiedene Versionen.',
      '„Entwurf“ und „Klärung erforderlich“ sind getrennte Zustände.',
      '„Abgelehnt“ ist ein Freigabestatus, „Nicht bestanden“ ein Testergebnis.',
      'Verhältniszahlen zeigen Zähler und Nenner.',
    ],
    kriterien: obj(crit, '/kriterien'), testfaelle: obj(tc, '/testfaelle'), berichte: obj(rep, '/berichte'),
    wartendAufFreigabe: { gesamt: waiting.reduce((a, x) => a + x.anzahl, 0), nachArt: waiting, link: { path: '/freigaben' } },
    pruefungen: pruef,
    offeneKlaerungen: { anzahl: cl, link: { path: '/kriterien', query: { ansicht: 'klaerungen' } } },
    offeneAenderungen: { anzahl: impacts, link: { path: '/testfaelle', query: { ansicht: 'auswirkungen' } } },
    laeufeMitUeberholterGrundlage: { anzahl: outdated, nenner: runTotal, link: { path: '/pruefungen', query: { grundlage: 'ueberholt' } } },
    campaigns,
  };
}

export async function listApprovalQueue(q: Q, orgId: string, art?: string) {
  const parts: string[] = [];
  if (!art || art === 'criterion') parts.push(`select 'criterion' as art, o.id as object_id, o.code, v.id as version_id, v.version, v.title, v.submitted_at, u.name as submitted_by from criteria o join criteria_versions v on v.criterion_id = o.id left join users u on u.id = v.submitted_by where o.org_id = $1 and v.status = 'submitted'`);
  if (!art || art === 'testcase') parts.push(`select 'testcase', o.id, o.code, v.id, v.version, v.title, v.submitted_at, u.name from testcases o join testcase_versions v on v.testcase_id = o.id left join users u on u.id = v.submitted_by where o.org_id = $1 and v.status = 'submitted'`);
  if (!art || art === 'report') parts.push(`select 'report', o.id, o.code, v.id, v.version, v.title, v.submitted_at, u.name from reports o join report_versions v on v.report_id = o.id left join users u on u.id = v.submitted_by where o.org_id = $1 and v.status = 'submitted'`);
  if (!parts.length) return [];
  const r = await q.query(`select * from (${parts.join(' union all ')}) x order by submitted_at`, [orgId]);
  return r.rows;
}
