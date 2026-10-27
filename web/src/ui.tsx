import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ApiError, api } from './api';

// ---------- Kontexte ----------
export interface User { id: string; name: string; role: string; org: string; orgKind: string; permissions: string[] }
export interface Meta { glossar: { term: string; meaning: string }[]; adapter: any[]; simulatorFehlerbilder: { key: string; label: string }[]; klassifikationen: { key: string; label: string }[]; statusFilter: Record<string, string>; laufFilter: Record<string, string>; demoKiModus: boolean }
export const AuthCtx = createContext<{ user: User; meta: Meta; can: (p: string) => boolean; staff: boolean; logout: () => void }>(null as any);
export const useAuth = () => useContext(AuthCtx);
export const ToastCtx = createContext<(msg: string, err?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export const ROLE_LABEL: Record<string, string> = { admin: 'Administrator', fachbearbeitung: 'Fachbearbeitung', pruefer: 'Prüfer/Freigeber', kunde: 'Kunde/Hersteller' };

// ---------- Hilfen ----------
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, set] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    set((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => live && set({ data, error: null, loading: false }), (e) => live && set({ data: null, error: e instanceof ApiError ? e.message : String(e.message ?? e), loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload };
}

export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string | ((r: T) => string)): Promise<T | undefined> => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok); return r; }
    catch (e: any) { toast(e instanceof ApiError ? e.message : String(e.message ?? e), true); return undefined; }
    finally { setBusy(false); }
  }, [toast]);
  return { busy, run };
}

export const fmtDate = (s?: string | null) => { if (!s) return '–'; const d = String(s).slice(0, 10).split('-'); return d.length === 3 ? `${d[2]}.${d[1]}.${d[0]}` : String(s); };
export const fmtTime = (s?: string | null) => { if (!s) return '–'; const d = new Date(s); return isNaN(+d) ? String(s) : d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }); };
export const link = (l: { path: string; query?: Record<string, string> }) => l.path + (l.query ? '?' + new URLSearchParams(l.query).toString() : '');

// Ungespeicherte Änderungen: Warnung beim Verlassen (Browser) und bei Klick auf interne Links (siehe App).
export function useDirty(dirty: boolean) {
  useEffect(() => {
    (window as any).__eelDirty = dirty;
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => { window.removeEventListener('beforeunload', h); (window as any).__eelDirty = false; };
  }, [dirty]);
}

// ---------- Status ----------
type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
const OBJ_STATUS: Record<string, [string, Tone, string]> = {
  draft: ['Entwurf', 'neutral', '✎'], clarification: ['Klärung erforderlich', 'warn', '?'], submitted: ['Zur Freigabe eingereicht', 'info', '⏳'],
  approved: ['Freigegeben', 'ok', '✔'], rejected: ['Abgelehnt', 'bad', '✖'], superseded: ['Ersetzt', 'neutral', '↺'],
};
const RUN_STATUS: Record<string, [string, Tone, string]> = {
  not_run: ['Nicht gestartet', 'neutral', '○'], exported: ['Prüfpaket bereitgestellt', 'info', '⏳'], awaiting_return: ['Wartet auf Rückgabe', 'info', '⏳'],
  passed: ['Bestanden', 'ok', '✔'], failed: ['Nicht bestanden', 'bad', '✖'], blocked: ['Blockiert', 'warn', '⛔'],
  assignment_required: ['Zuordnung erforderlich', 'warn', '⚠'], import_error: ['Importfehler', 'bad', '✖'],
};
const IMPORT_STATUS: Record<string, [string, Tone, string]> = {
  imported: ['Importiert', 'ok', '✔'], assignment_required: ['Zuordnung erforderlich', 'warn', '⚠'], import_error: ['Importfehler', 'bad', '✖'], duplicate: ['Duplikat', 'neutral', '≡'],
};
const CMP_RESULT: Record<string, [string, Tone, string]> = {
  ok: ['Übereinstimmung', 'ok', '✔'], abweichung: ['Abweichung', 'bad', '✖'], fehlt: ['Fehlt', 'bad', '✖'], unerwartet: ['Unerwartet', 'bad', '✖'], nicht_bewertet: ['Nicht bewertet', 'neutral', '–'],
};
const OUTCOME: Record<string, [string, Tone, string]> = { pass: ['Bestanden', 'ok', '✔'], fail: ['Nicht bestanden', 'bad', '✖'], incomplete: ['Unvollständig', 'warn', '⚠'] };
const CAMPAIGN: Record<string, [string, Tone, string]> = {
  planned: ['Geplant', 'neutral', '○'], running: ['In Prüfung', 'info', '⏳'], passed: ['Bestanden', 'ok', '✔'], failed: ['Nicht bestanden', 'bad', '✖'], certified: ['Zertifiziert (Demo-Prüfumfang)', 'ok', '✔'], closed: ['Abgeschlossen', 'neutral', '■'],
};
const MAPS = { obj: OBJ_STATUS, run: RUN_STATUS, imp: IMPORT_STATUS, cmp: CMP_RESULT, out: OUTCOME, camp: CAMPAIGN };
export function Badge({ kind, value, label }: { kind: keyof typeof MAPS; value: string; label?: string }) {
  const m = MAPS[kind][value] ?? [value, 'neutral', '•'];
  return <span className={`badge ${m[1]}`}><span aria-hidden="true">{m[2]}</span>{label ?? m[0]}</span>;
}
export const Tone = ({ tone, children, icon }: { tone: Tone; children: React.ReactNode; icon?: string }) => <span className={`badge ${tone}`}><span aria-hidden="true">{icon ?? ({ ok: '✔', warn: '⚠', bad: '✖', info: 'ℹ', neutral: '•' }[tone])}</span>{children}</span>;
export const DemoTag = ({ children = 'Demonstration' }: { children?: React.ReactNode }) => <span className="tag-demo">{children}</span>;

// ---------- Abkürzungen ----------
const ABBR = ['eAU', 'AU', 'EFZ', 'DBVO', 'DBAL', 'DBEE', 'DBSD', 'DBID', 'DSLW', 'DSID', 'AZVU', 'GKV', 'PKV', 'EEL', 'DTA', 'ITSG', 'KK', 'AG'];
export function Annot({ text }: { text?: string | null }) {
  const { meta } = useAuth();
  const dict = useMemo(() => new Map(meta.glossar.flatMap((g) => g.term.split('/').map((t) => [t.trim(), g.meaning] as const))), [meta]);
  if (!text) return null;
  const re = new RegExp(`\\b(${ABBR.join('|')})\\b`, 'g');
  const out: React.ReactNode[] = []; let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const mean = dict.get(m[1]);
    out.push(mean ? <abbr key={i++} title={mean} tabIndex={0}>{m[1]}</abbr> : m[1]);
    last = m.index + m[1].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

// ---------- Layout-Bausteine ----------
export function Loading({ what = 'Daten' }: { what?: string }) { return <p role="status" aria-live="polite" className="hint">{what} werden geladen …</p>; }
export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return <div className="banner bad" role="alert"><strong>Das hat nicht geklappt.</strong> {error} {onRetry && <button className="link" onClick={onRetry}>Erneut versuchen</button>}</div>;
}
export function Async<T>({ s, children, what }: { s: { data: T | null; error: string | null; loading: boolean; reload: () => void }; children: (d: T) => React.ReactNode; what?: string }) {
  if (s.error) return <ErrorBox error={s.error} onRetry={s.reload} />;
  if (!s.data) return <Loading what={what} />;
  return <>{children(s.data)}</>;
}
export const Empty = ({ children }: { children: React.ReactNode }) => <p className="hint" style={{ padding: '10px 0' }}>{children}</p>;

export function Field({ label, hint, children, id }: { label: string; hint?: string; children: React.ReactElement; id: string }) {
  return <div className="field"><label htmlFor={id}>{label}{hint && <span className="hint"> – {hint}</span>}</label>{React.cloneElement(children, { id })}</div>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select,textarea,[tabindex]:not([tabindex="-1"])'));
    (focusables()[0] ?? el).focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') { const f = focusables(); if (!f.length) return; const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
    };
    el.addEventListener('keydown', key);
    return () => { el.removeEventListener('keydown', key); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1} style={wide ? { width: 'min(1100px,100%)' } : undefined}>
        <div className="row spread"><h2 style={{ margin: 0 }}>{title}</h2><button onClick={onClose} aria-label="Schließen">Schließen</button></div>
        <div style={{ marginTop: 12 }}>{children}</div>
      </div>
    </div>
  );
}

export function Tabs({ items, current, onChange, label }: { items: [string, string][]; current: string; onChange: (k: string) => void; label: string }) {
  return <div className="tabs" role="tablist" aria-label={label}>{items.map(([k, t]) => <button key={k} role="tab" aria-selected={current === k} aria-current={current === k ? 'true' : undefined} onClick={() => onChange(k)}>{t}</button>)}</div>;
}

export function FilterChips({ options, value, onChange, all = 'Alle' }: { options: Record<string, string>; value: string; onChange: (v: string) => void; all?: string }) {
  return (
    <div className="row" role="group" aria-label="Filter">
      <button className={!value ? 'primary' : ''} aria-pressed={!value} onClick={() => onChange('')}>{all}</button>
      {Object.entries(options).map(([k, l]) => <button key={k} className={value === k ? 'primary' : ''} aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}

export function Quote({ q, source }: { q: string; source?: string }) { return <blockquote className="quote" style={{ margin: '8px 0' }}>„{q}“{source && <cite>{source}</cite>}</blockquote>; }

export function PageHead({ title, lead, actions }: { title: string; lead?: React.ReactNode; actions?: React.ReactNode }) {
  return <div className="row spread" style={{ alignItems: 'flex-start' }}><div><h1>{title}</h1>{lead && <p className="lead">{lead}</p>}</div>{actions && <div className="row">{actions}</div>}</div>;
}

export function ConfirmReason({ title, label, confirmLabel, danger, minLength = 10, onCancel, onConfirm, hintField, intro }: { title: string; label: string; confirmLabel: string; danger?: boolean; minLength?: number; onCancel: () => void; onConfirm: (reason: string, hints?: string) => Promise<void> | void; hintField?: boolean; intro?: React.ReactNode }) {
  const [reason, setReason] = useState(''); const [hints, setHints] = useState(''); const [busy, setBusy] = useState(false);
  const ok = reason.trim().length >= minLength;
  return (
    <Modal title={title} onClose={onCancel}>
      {intro}
      <Field id="reason" label={label} hint={`mindestens ${minLength} Zeichen`}><textarea value={reason} onChange={(e) => setReason(e.target.value)} aria-required="true" /></Field>
      {hintField && <Field id="hints" label="Hinweise zur Verbesserung" hint="optional"><textarea value={hints} onChange={(e) => setHints(e.target.value)} /></Field>}
      <div className="row"><button className={danger ? 'danger' : 'primary'} disabled={!ok || busy} onClick={async () => { setBusy(true); try { await onConfirm(reason.trim(), hints.trim() || undefined); } finally { setBusy(false); } }}>{confirmLabel}</button><button onClick={onCancel}>Abbrechen</button></div>
      {!ok && reason.length > 0 && <p className="hint">Bitte etwas ausführlicher begründen.</p>}
    </Modal>
  );
}

export function RefLink({ to, children }: { to: string; children: React.ReactNode }) { return <Link to={to}>{children}</Link>; }
export function useQuery() { const l = useLocation(); return useMemo(() => new URLSearchParams(l.search), [l.search]); }
export { api, ApiError };
