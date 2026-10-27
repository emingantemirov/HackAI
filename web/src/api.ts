export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

async function call<T>(method: string, url: string, body?: unknown, form?: FormData): Promise<T> {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: { 'X-EEL-Portal': '1', ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}) },
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (res.status === 401 && !url.includes('/auth/')) { window.dispatchEvent(new Event('eel-unauthenticated')); }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* kein JSON */ }
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'ERROR', json?.error?.message ?? `Anfrage fehlgeschlagen (${res.status}).`, json?.error?.details);
  return json as T;
}
export const api = {
  get: <T = any>(u: string) => call<T>('GET', u),
  post: <T = any>(u: string, b?: unknown) => call<T>('POST', u, b ?? {}),
  patch: <T = any>(u: string, b?: unknown) => call<T>('PATCH', u, b ?? {}),
  upload: <T = any>(u: string, f: FormData) => call<T>('POST', u, undefined, f),
};
export const qs = (o: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) p.set(k, v); const s = p.toString(); return s ? `?${s}` : ''; };
