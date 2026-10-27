import type { Q } from './db.js';
import type { Actor } from './auth.js';

export interface AuditInput {
  orgId?: string | null;
  actor: Actor;
  action: string;
  objectType?: string;
  objectId?: string;
  objectVersion?: number;
  reason?: string | null;
  details?: Record<string, unknown>;
  aiModel?: string;
  promptVersion?: string;
}

/**
 * Audit-Eintrag: Akteur, Zeitpunkt, Objektversion, Aktion, Begründung.
 * KI-Aktionen tragen zusätzlich Modell und Promptversion. Die Tabelle ist per Trigger append-only.
 */
export async function audit(q: Q, a: AuditInput): Promise<void> {
  await q.query(
    `insert into audit_events(org_id, actor_kind, actor_id, actor_label, action, object_type, object_id, object_version, reason, details, ai_model, prompt_version)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      a.orgId ?? a.actor.orgId ?? null,
      a.actor.kind,
      a.actor.kind === 'user' ? a.actor.id : null,
      a.actor.label,
      a.action,
      a.objectType ?? null,
      a.objectId ?? null,
      a.objectVersion ?? null,
      a.reason ?? null,
      JSON.stringify(a.details ?? {}),
      a.aiModel ?? null,
      a.promptVersion ?? null,
    ],
  );
}
