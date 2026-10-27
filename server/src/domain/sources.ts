import type { AppConfig } from '../config.js';
import type { Q } from '../db.js';
import { audit } from '../audit.js';
import { type Actor, HttpError, badRequest, conflict, notFound, require as requirePerm } from '../auth.js';
import { detectKind, extractDocx, extractPdf, extractPlain, paragraphFingerprints, sha256, storeFile, type Extraction } from '../extract.js';

export interface SourceMeta {
  title: string;
  publisher?: string;
  versionLabel: string;
  validFrom?: string | null;
  validTo?: string | null;
  area?: string;
  documentId?: string; // neue Version eines bestehenden Dokuments
}

export interface ImportResult {
  duplicate: boolean;
  sourceVersionId: string;
  documentId: string;
  extractionStatus: string;
  extractionNote: string | null;
  message: string;
}

function validateMeta(m: SourceMeta) {
  if (!m.title?.trim()) throw badRequest('Bitte einen Titel angeben.');
  if (!m.versionLabel?.trim()) throw badRequest('Bitte die Dokumentversion angeben (z. B. 13.1).');
  for (const [k, v] of [['Gültigkeitsbeginn', m.validFrom], ['Gültigkeitsende', m.validTo]] as const) {
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest(`${k} muss ein Datum (JJJJ-MM-TT) sein.`);
  }
  if (m.validFrom && m.validTo && m.validTo < m.validFrom) throw badRequest('Das Gültigkeitsende liegt vor dem Gültigkeitsbeginn.');
}

async function insertSource(q: Q, actor: Actor, cfg: AppConfig, meta: SourceMeta, kind: 'pdf' | 'docx' | 'text' | 'datei', fileName: string | null, mime: string | null, buf: Buffer, ex: Extraction): Promise<ImportResult> {
  const orgId = actor.orgId!;
  const sha = sha256(buf);
  const dup = await q.query('select sv.id, sv.document_id, sv.version_label, d.title, sv.extraction_status, sv.extraction_note, sv.removed_at from source_versions sv join source_documents d on d.id = sv.document_id where sv.org_id = $1 and sv.sha256 = $2', [orgId, sha]);
  if (dup.rowCount) {
    const d = dup.rows[0];
    if (d.removed_at) {
      // Entfernte Quelle erneut hochgeladen: wiederherstellen, samt der dadurch archivierten Kriterien und Testfälle.
      await q.query('update source_versions set removed_at = null, removed_by = null where id = $1', [d.id]);
      const c = await q.query('update criteria set archived_at = null, archived_by_source = null where archived_by_source = $1', [d.id]);
      const t = await q.query('update testcases set archived_at = null, archived_by_source = null where archived_by_source = $1', [d.id]);
      await audit(q, { actor, orgId, action: 'quelle.wiederhergestellt', objectType: 'source', objectId: d.id, details: { kriterien: c.rowCount, testfaelle: t.rowCount } });
      return { duplicate: false, restored: true, sourceVersionId: d.id, documentId: d.document_id, extractionStatus: d.extraction_status, extractionNote: d.extraction_note,
        message: `Die zuvor entfernte Quelle „${d.title}“ wurde wiederhergestellt (${c.rowCount} Kriterien).` } as any;
    }
    await audit(q, { actor, orgId, action: 'quelle.duplikat_erkannt', objectType: 'source', objectId: d.id, details: { sha256: sha, dateiname: fileName } });
    return {
      duplicate: true, sourceVersionId: d.id, documentId: d.document_id, extractionStatus: d.extraction_status, extractionNote: d.extraction_note,
      message: `Diese Datei ist bereits als „${d.title}“ (Version ${d.version_label}) vorhanden und wurde nicht erneut importiert.`,
    };
  }
  if (ex.status === 'fehlgeschlagen') throw new HttpError(422, 'EXTRACTION_FAILED', ex.note ?? 'Die Datei konnte nicht gelesen werden.');
  const stored = storeFile(cfg.storageDir, 'sources', buf);
  let documentId = meta.documentId;
  if (documentId) {
    const d = await q.query('select 1 from source_documents where id = $1 and org_id = $2', [documentId, orgId]);
    if (!d.rowCount) throw notFound('Quelldokument');
  } else {
    const d = await q.query('insert into source_documents(org_id, title, publisher, area) values ($1,$2,$3,$4) returning id', [orgId, meta.title.trim(), meta.publisher?.trim() || null, meta.area ?? null]);
    documentId = d.rows[0].id;
  }
  const v = await q.query(
    `insert into source_versions(org_id, document_id, version_label, valid_from, valid_to, input_kind, file_name, mime_type, sha256, size_bytes, storage_path, extracted_text, locators, extraction_status, extraction_note, uploaded_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
    [orgId, documentId, meta.versionLabel.trim(), meta.validFrom ?? null, meta.validTo ?? null, kind, fileName, mime, sha, buf.length, stored.storagePath, ex.text, JSON.stringify(ex.locators), ex.status, ex.note, actor.id],
  );
  await audit(q, { actor, orgId, action: 'quelle.importiert', objectType: 'source', objectId: v.rows[0].id, details: { titel: meta.title, version: meta.versionLabel, sha256: sha, art: kind, status: ex.status } });
  return {
    duplicate: false, sourceVersionId: v.rows[0].id, documentId: documentId!, extractionStatus: ex.status, extractionNote: ex.note,
    message: ex.status === 'ok' ? 'Quelle importiert.' : 'Quelle importiert, aber der Text konnte nicht zuverlässig gelesen werden (OCR-Prüfschritt erforderlich).',
  };
}

export async function importSourceFile(q: Q, actor: Actor, cfg: AppConfig, meta: SourceMeta, fileName: string, mime: string | null, buf: Buffer): Promise<ImportResult> {
  requirePerm(actor, 'source:write');
  validateMeta(meta);
  if (buf.length === 0) throw badRequest('Die Datei ist leer.');
  if (buf.length > cfg.maxUploadBytes) throw badRequest(`Die Datei ist zu groß (maximal ${Math.round(cfg.maxUploadBytes / 1048576)} MB).`);
  const kind = detectKind(fileName, buf);
  // EEL-Referenzdateien (Beginn „VOSZ“) dürfen als Quelle dienen (Beispieldatei); Rückgaben von Software gehören in „Prüfungen“.
  const eelReference = kind === 'datei' && buf.subarray(0, 4).toString('latin1') === 'VOSZ';
  if (kind === 'datei' && !eelReference) throw badRequest('Nur PDF, Word (.docx), eingefügter Text oder eine EEL-Referenzdatei werden als Quelle unterstützt. Rückgaben einer Software gehören in den Bereich „Prüfungen“.');
  const ex = eelReference ? extractPlain(buf.toString('utf8')) : kind === 'pdf' ? await extractPdf(buf) : kind === 'docx' ? await extractDocx(buf) : extractPlain(buf.toString('utf8'));
  return insertSource(q, actor, cfg, meta, kind, fileName, mime, buf, ex);
}

export async function importSourceText(q: Q, actor: Actor, cfg: AppConfig, meta: SourceMeta, text: string): Promise<ImportResult> {
  requirePerm(actor, 'source:write');
  validateMeta(meta);
  const buf = Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8');
  if (buf.length > cfg.maxUploadBytes) throw badRequest('Der Text ist zu groß.');
  return insertSource(q, actor, cfg, meta, 'text', null, 'text/plain', buf, extractPlain(text));
}

/** Gekennzeichneter OCR-Prüfschritt: eine Person liefert den geprüften Text nach. */
export async function supplyReviewedText(q: Q, actor: Actor, sourceVersionId: string, text: string): Promise<void> {
  requirePerm(actor, 'source:write');
  const r = await q.query('select * from source_versions where id = $1 and org_id = $2', [sourceVersionId, actor.orgId]);
  if (!r.rowCount) throw notFound('Quelle');
  if (r.rows[0].extraction_status !== 'ocr_pruefung_erforderlich') throw conflict('NOT_OCR', 'Für diese Quelle ist kein OCR-Prüfschritt offen.');
  const ex = extractPlain(text);
  if (ex.status !== 'ok') throw badRequest(ex.note ?? 'Der Text ist unbrauchbar.');
  const used = await q.query('select 1 from criteria_versions where evidence @> $1::jsonb limit 1', [JSON.stringify([{ source_version_id: sourceVersionId }])]);
  if (used.rowCount) throw conflict('SOURCE_IN_USE', 'Auf diese Quelle verweisen bereits Kriterien; der Text darf nicht nachträglich ersetzt werden.');
  await q.query(`update source_versions set extracted_text = $2, locators = $3, extraction_status = 'ok', extraction_note = $4 where id = $1`,
    [sourceVersionId, ex.text, JSON.stringify(ex.locators), `Text nach OCR-Prüfschritt durch ${actor.label} bereitgestellt.`]);
  await audit(q, { actor, orgId: actor.orgId, action: 'quelle.ocr_text_bereitgestellt', objectType: 'source', objectId: sourceVersionId });
}

/** Vergleich zweier Quellenversionen: neu / geändert / unverändert / entfallen (absatzweise). */
export async function compareSources(q: Q, orgId: string, fromId: string, toId: string) {
  const rows = await q.query('select id, extracted_text, version_label from source_versions where org_id = $1 and id = any($2::uuid[])', [orgId, [fromId, toId]]);
  const a = rows.rows.find((r) => r.id === fromId), b = rows.rows.find((r) => r.id === toId);
  if (!a || !b) throw notFound('Quelle');
  const pa = paragraphFingerprints(a.extracted_text ?? ''), pb = paragraphFingerprints(b.extracted_text ?? '');
  const byHashA = new Map(pa.map((p) => [p.hash, p])), byHashB = new Map(pb.map((p) => [p.hash, p]));
  const byKeyA = new Map(pa.map((p) => [p.key, p]));
  const unchanged: string[] = [], changed: { before: string; after: string }[] = [], added: string[] = [];
  const matchedA = new Set<string>();
  for (const p of pb) {
    if (byHashA.has(p.hash)) { unchanged.push(p.text); matchedA.add(p.hash); continue; }
    const k = byKeyA.get(p.key);
    if (k && !matchedA.has(k.hash)) { changed.push({ before: k.text, after: p.text }); matchedA.add(k.hash); } else added.push(p.text);
  }
  const removed = pa.filter((p) => !byHashB.has(p.hash) && !matchedA.has(p.hash)).map((p) => p.text);
  return {
    from: { id: a.id, version: a.version_label }, to: { id: b.id, version: b.version_label },
    counts: { neu: added.length, geaendert: changed.length, unveraendert: unchanged.length, entfallen: removed.length },
    neu: added, geaendert: changed, entfallen: removed,
  };
}

/** Entfernt eine Quelle durch Archivieren. Kriterien, die nur auf entfernten Quellen beruhen, und davon abhängige Testfälle werden mit archiviert. Nichts wird gelöscht (Protokoll, Versionen bleiben). */
export async function removeSource(q: Q, actor: Actor, sourceVersionId: string): Promise<{ kriterien: number; testfaelle: number }> {
  requirePerm(actor, 'source:write');
  const sv = (await q.query('select sv.id, sv.removed_at, d.title from source_versions sv join source_documents d on d.id = sv.document_id where sv.id = $1 and sv.org_id = $2', [sourceVersionId, actor.orgId])).rows[0];
  if (!sv) throw notFound('Quelle');
  if (sv.removed_at) return { kriterien: 0, testfaelle: 0 };
  // Kriterien, die diese Quelle belegen und keine andere aktive Quelle haben
  const linked = (await q.query(
    `select c.id, c.code, (select v.evidence from criteria_versions v where v.criterion_id = c.id order by v.version desc limit 1) as evidence
       from criteria c where c.org_id = $1 and c.archived_at is null
        and exists (select 1 from criteria_versions v where v.criterion_id = c.id and v.evidence @> $2::jsonb)`, [actor.orgId, JSON.stringify([{ source_version_id: sourceVersionId }])])).rows;
  const toArchive: { id: string; code: string }[] = [];
  for (const c of linked) {
    const ids = [...new Set(((c.evidence ?? []) as any[]).map((e) => e.source_version_id).filter((x) => x && x !== sourceVersionId))];
    let otherActive = false;
    if (ids.length) otherActive = ((await q.query('select 1 from source_versions where id = any($1::uuid[]) and removed_at is null', [ids])).rowCount ?? 0) > 0;
    if (!otherActive) toArchive.push({ id: c.id, code: c.code });
  }
  const ids = toArchive.map((c) => c.id);
  if (ids.length) {
    const used = await q.query(
      `select distinct c.code from testcase_criteria tc join criteria c on c.id = tc.criterion_id join test_runs r on r.testcase_id = (select testcase_id from testcase_versions where id = tc.testcase_version_id)
        where tc.criterion_id = any($1::uuid[])`, [ids]);
    if (used.rowCount) throw conflict('SOURCE_IN_USE', `Die Quelle kann nicht entfernt werden: ${used.rows.map((r) => r.code).join(', ')} wird bereits in einer Prüfung verwendet.`);
  }
  let testfaelle = 0;
  if (ids.length) {
    await q.query('update criteria set archived_at = now(), archived_by_source = $2 where id = any($1::uuid[])', [ids, sourceVersionId]);
    // Testfälle archivieren, deren sämtliche Kriterien archiviert sind
    const t = await q.query(
      `update testcases t set archived_at = now(), archived_by_source = $1
        where t.archived_at is null and exists (select 1 from testcase_criteria tc join testcase_versions tv on tv.id = tc.testcase_version_id where tv.testcase_id = t.id)
          and not exists (select 1 from testcase_criteria tc join testcase_versions tv on tv.id = tc.testcase_version_id join criteria c on c.id = tc.criterion_id where tv.testcase_id = t.id and c.archived_at is null)`, [sourceVersionId]);
    testfaelle = t.rowCount ?? 0;
  }
  await q.query('update source_versions set removed_at = now(), removed_by = $2 where id = $1', [sourceVersionId, actor.id]);
  await audit(q, { actor, orgId: actor.orgId!, action: 'quelle.entfernt', objectType: 'source', objectId: sourceVersionId, details: { titel: sv.title, kriterien: ids.length, testfaelle } });
  return { kriterien: ids.length, testfaelle };
}
