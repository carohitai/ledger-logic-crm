"use client";

import { useEffect, useRef, useState } from "react";

export const CHART_COLORS = [
  "#94C047", "#1E429F", "#6B7F3A", "#4A6FBF", "#C99A4E",
  "#A8B98A", "#6F7A8C", "#B4623A", "#7CA838", "#3D4A4A",
  "#5C6679", "#B8D578", "#16306E", "#C8CFA8", "#8A92A3",
  "#2F3A52", "#EACB6C", "#7B9E6B", "#9AA7C4", "#6B4F3A",
  "#4E7A5A", "#A06AB4", "#3A7A8C", "#BC8F8F",
];

/**
 * Eased 0->1 progress once `active` flips true (drives count-ups and arcs).
 * A timeout guarantees it settles at exactly 1 even if requestAnimationFrame
 * is throttled (e.g. a backgrounded tab), so displayed totals stay correct.
 */
export function useProgress(active: boolean, ms = 1100) {
  const [p, setP] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const x = Math.min(1, (t - t0) / ms);
      setP(1 - Math.pow(1 - x, 3));
      if (x < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const settle = setTimeout(() => setP(1), ms + 400);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
  }, [active, ms]);
  return p;
}

/**
 * Reveals `true` when the element scrolls into view (once). Falls back to
 * revealing after a short delay so content/counters never stay stuck at 0 on
 * a hidden or backgrounded tab, where IntersectionObserver reports nothing.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.2 }
    );
    io.observe(el);
    const fallback = setTimeout(() => setShown(true), 1200);
    return () => {
      io.disconnect();
      clearTimeout(fallback);
    };
  }, []);
  return { ref, shown };
}

export function Donut({
  segments,
  size,
  thickness,
  centerTop,
  centerBottom,
  progress,
}: {
  segments: { value: number; color: string }[];
  size: number;
  thickness: number;
  centerTop?: string;
  centerBottom?: string;
  progress: number;
}) {
  const R = (size - thickness) / 2;
  const total = segments.reduce((n, s) => n + s.value, 0) || 1;
  let offset = 25; // start at 12 o'clock
  const arcs = segments.map((s, i) => {
    const len = (s.value / total) * 100 * progress;
    const arc = (
      <circle
        key={i}
        cx={size / 2}
        cy={size / 2}
        r={R}
        fill="none"
        stroke={s.color}
        strokeWidth={thickness}
        pathLength={100}
        strokeDasharray={`${Math.max(0, len - 0.6)} ${100 - Math.max(0, len - 0.6)}`}
        strokeDashoffset={offset}
      />
    );
    offset -= len;
    return arc;
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
      <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="#ECE7DC" strokeWidth={thickness} />
      {arcs}
      {centerTop != null && (
        <>
          <text
            x={size / 2}
            y={size / 2 - 2}
            textAnchor="middle"
            style={{ fontFamily: "var(--font-sans)", fontSize: size * 0.16, fontWeight: 700, fill: "#1A2233" }}
          >
            {centerTop}
          </text>
          <text
            x={size / 2}
            y={size / 2 + size * 0.11}
            textAnchor="middle"
            style={{ fontFamily: "var(--font-sans)", fontSize: size * 0.058, fontWeight: 600, letterSpacing: "0.08em", fill: "#8A92A3" }}
          >
            {centerBottom}
          </text>
        </>
      )}
    </svg>
  );
}

export const cardStyle: React.CSSProperties = {
  background: "var(--white)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-sm)",
};

export function StatCard({
  value,
  label,
  color = "var(--ink-900)",
}: {
  value: number | string;
  label: string;
  color?: string;
}) {
  return (
    <div
      className="px-6 py-[22px] transition-all duration-200 hover:-translate-y-px hover:shadow-md"
      style={cardStyle}
    >
      <div className="text-[32px] font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className="mt-1.5 text-xs" style={{ color: "var(--ink-500)" }}>
        {label}
      </div>
    </div>
  );
}
