import React, { useEffect, useState } from 'react';

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <ellipse cx="20" cy="20" rx="17" ry="7" fill="none" stroke="#4f6d94" strokeWidth="2" transform="rotate(-30 20 20)" />
      <ellipse cx="20" cy="20" rx="17" ry="7" fill="none" stroke="#4f6d94" strokeWidth="2" transform="rotate(30 20 20)" />
      <circle cx="20" cy="20" r="6.5" fill="#d0102f" />
      <circle cx="33" cy="12" r="2.4" fill="#1b2a44" />
    </svg>
  );
}

const PATHS: Record<string, React.ReactNode> = {
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  doc: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></>,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  flask: <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" />,
  play: <path d="M7 4l13 8-13 8z" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />,
  inbox: <path d="M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  spark: <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></>,
  out: <path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" />,
};
export function Icon({ n, size = 18 }: { n: keyof typeof PATHS | string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[n]}</svg>;
}

export function useCountUp(target: number, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setV(target); return; }
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / ms); setV(Math.round(target * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export interface Seg { value: number; color: string; label: string }
/** Segmentierter Ring. Die Segmente „zeichnen“ sich beim Laden ein (bei reduzierter Bewegung sofort). */
export function Ring({ segs, total, pct, size = 132 }: { segs: Seg[]; total: number; pct: number; size?: number }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(r); }, []);
  const R = 54, C = 2 * Math.PI * R; let acc = 0;
  const shown = useCountUp(pct);
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`${pct} Prozent freigegeben`}>
      <svg width={size} height={size} viewBox="0 0 132 132">
        <circle className="track" cx="66" cy="66" r={R} />
        {total > 0 && segs.filter((s) => s.value > 0).map((s) => {
          const len = (s.value / total) * C; const off = -acc; acc += len;
          return <circle key={s.label} className="seg" cx="66" cy="66" r={R} stroke={s.color} strokeDasharray={on ? `${Math.max(len - 1.5, 0)} ${C - Math.max(len - 1.5, 0)}` : `0 ${C}`} strokeDashoffset={off} />;
        })}
      </svg>
      <div className="center"><span>{shown}<small>%</small></span></div>
    </div>
  );
}

export function Stacked({ parts }: { parts: { v: number; c: string; l: string }[] }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(r); }, []);
  const total = parts.reduce((a, p) => a + p.v, 0) || 1;
  return <div className="bar" role="img" aria-label={parts.filter((p) => p.v).map((p) => `${p.v} ${p.l}`).join(', ')}>{parts.map((p) => <i key={p.l} title={`${p.v} ${p.l}`} style={{ background: p.c, width: on ? `${(p.v / total) * 100}%` : 0 }} />)}</div>;
}

export function Steps({ steps }: { steps: { label: string; state: 'done' | 'now' | 'todo' }[] }) {
  return (
    <ol className="steps" style={{ listStyle: 'none', padding: 0 }} aria-label="Ablauf">
      {steps.map((s, i) => <li key={s.label} className={`step ${s.state}`} aria-current={s.state === 'now' ? 'step' : undefined}><div className="dot">{s.state === 'done' ? <Icon n="check" size={14} /> : i + 1}</div>{s.label}{s.state === 'done' && <span className="sr"> (erledigt)</span>}</li>)}
    </ol>
  );
}
