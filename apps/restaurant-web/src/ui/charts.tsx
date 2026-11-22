// Small, dependency-free figures for the Overview and the claim details. Colors come from CSS custom
// properties (--viz-*) validated with the dataviz palette checker; text always uses
// ink tokens. Every figure has a legend, direct labels or an accessible name.
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function useSize<T extends HTMLElement>(): [(el: T | null) => void, { w: number; h: number }] {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((s) => (Math.round(width) === s.w && Math.round(height) === s.h ? s : { w: Math.round(width), h: Math.round(height) }));
    });
    ro.observe(el);
    observer.current = ro;
  }, []);
  useLayoutEffect(() => () => observer.current?.disconnect(), []);
  return [ref, size];
}

export function Legend({ items }: { items: readonly { label: string; color: string; value?: ReactNode }[] }) {
  return (
    <ul className="legend">
      {items.map((i) => (
        <li key={i.label}>
          <span className="key" style={{ background: i.color }} aria-hidden="true" />
          {i.label}
          {i.value !== undefined && <strong>{i.value}</strong>}
        </li>
      ))}
    </ul>
  );
}

/** One whole split into parts (tall segmented bar): share printed inside when it fits. */
export function SegmentedBar({ parts, label, thin = false }: { parts: readonly { label: string; value: number; color: string; ink?: "light" | "dark" }[]; label: string; thin?: boolean }) {
  const [ref, { w }] = useSize<HTMLDivElement>();
  const total = parts.reduce((t, p) => t + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div ref={ref} className={thin ? "segbar segbar-thin" : "segbar"} role="img" aria-label={`${label}: ${shown.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(", ")}`}>
      {shown.map((p) => {
        const share = p.value / total;
        const pct = `${Math.round(share * 100)}%`;
        const fits = !thin && w * share > pct.length * 8 + 14;
        return (
          <span key={p.label} style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${pct}`}>
            {fits && <span className={p.ink === "dark" ? "seg-ink-dark" : "seg-ink-light"}>{pct}</span>}
          </span>
        );
      })}
    </div>
  );
}
