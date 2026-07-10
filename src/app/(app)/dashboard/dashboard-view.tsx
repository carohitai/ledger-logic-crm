"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppLink } from "@/components/nav-progress";
import { SubmitButton } from "@/components/button";

export interface StaffStat {
  id: string;
  name: string;
  ext: string | null;
  assigned: number;
  gst: number;
  it: number;
  acc: number;
  bill: number;
  contacted: number;
  alerts: number;
  unacked: number;
}

export interface AlertItem {
  id: string;
  type: string;
  message: string;
  clientId: string | null;
  time: string;
  acknowledged: boolean;
}

const COLORS = [
  "#94C047", "#1E429F", "#6B7F3A", "#4A6FBF", "#C99A4E",
  "#A8B98A", "#6F7A8C", "#B4623A", "#7CA838", "#3D4A4A",
  "#5C6679", "#B8D578", "#16306E", "#C8CFA8", "#8A92A3",
  "#2F3A52", "#EACB6C", "#7B9E6B", "#9AA7C4", "#6B4F3A",
  "#4E7A5A", "#A06AB4", "#3A7A8C", "#BC8F8F",
];

type DeptKey = "all" | "gst" | "it" | "acc" | "bill";

const DEPTS: { key: Exclude<DeptKey, "all">; name: string; color: string }[] = [
  { key: "gst", name: "GST", color: "#94C047" },
  { key: "it", name: "Income Tax", color: "#1E429F" },
  { key: "acc", name: "Accounting", color: "#C99A4E" },
  { key: "bill", name: "Billing", color: "#6F7A8C" },
];

const DEPT_LABELS: Record<DeptKey, string> = {
  all: "All departments",
  gst: "GST department",
  it: "Income Tax department",
  acc: "Accounting department",
  bill: "Billing department",
};

function Donut({
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
  let offset = 25;
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
            style={{ fontFamily: "var(--font-sans)", fontSize: size * 0.062, fontWeight: 600, letterSpacing: "0.08em", fill: "#8A92A3" }}
          >
            {centerBottom}
          </text>
        </>
      )}
    </svg>
  );
}

const card: React.CSSProperties = {
  background: "var(--white)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-sm)",
};

export function DashboardView({
  title,
  todayLabel,
  stats,
  alerts,
  statCalls,
  statCallback,
  statWa,
  isAdmin,
  ack,
}: {
  title: string;
  todayLabel: string;
  stats: StaffStat[];
  alerts: AlertItem[];
  statCalls: number;
  statCallback: number;
  statWa: number;
  isAdmin: boolean;
  ack: (alertId: string) => Promise<void>;
}) {
  const [dept, setDept] = useState<DeptKey>("all");
  const [statP, setStatP] = useState(0);
  const [chartP, setChartP] = useState(0);
  const [barsOn, setBarsOn] = useState(false);
  const statsRef = useRef<HTMLElement>(null);
  const chartsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const animate = (set: (v: number) => void, ms: number) => {
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / ms);
        set(1 - Math.pow(1 - p, 3));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          if (e.target === statsRef.current) animate(setStatP, 1100);
          if (e.target === chartsRef.current) {
            animate(setChartP, 1300);
            setBarsOn(true);
          }
          io.unobserve(e.target);
        }
      },
      { threshold: 0.25 }
    );
    if (statsRef.current) io.observe(statsRef.current);
    if (chartsRef.current) io.observe(chartsRef.current);
    return () => io.disconnect();
  }, []);

  const assignedOf = (s: StaffStat) => (dept === "all" ? s.assigned : s[dept]);
  const contactedOf = (s: StaffStat) =>
    dept === "all" ? s.contacted : s.assigned ? Math.round(s.contacted * (s[dept] / s.assigned)) : 0;

  const rows = stats
    .map((s, i) => ({ s, i, assigned: assignedOf(s), contacted: contactedOf(s) }))
    .filter((r) => r.assigned > 0)
    .sort((a, b) => b.assigned - a.assigned);

  const totalAssigned = rows.reduce((n, r) => n + r.assigned, 0);
  const totalContacted = rows.reduce((n, r) => n + r.contacted, 0);
  const coverage = totalAssigned ? Math.round((totalContacted / totalAssigned) * 100) : 0;

  const staffSegs = rows.map((r) => ({ value: r.assigned, color: COLORS[r.i % COLORS.length] }));
  const deptTotals = DEPTS.map((d) => stats.reduce((n, s) => n + s[d.key], 0));
  const deptSegs = DEPTS.map((d, j) => ({ value: deptTotals[j], color: d.color }));
  const covSegs = [
    { value: totalContacted, color: "#94C047" },
    { value: Math.max(0, totalAssigned - totalContacted), color: "#ECE7DC" },
  ];

  const stat = (v: number) => Math.round(v * statP);

  return (
    <div className="flex flex-col gap-11">
      {/* Hero */}
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div
            className="mb-2 text-[11px] font-semibold uppercase"
            style={{ letterSpacing: "0.18em", color: "var(--brand-blue)" }}
          >
            Kolte &amp; Associates LLP — Internal
          </div>
          <h1
            className="m-0 text-[38px] font-semibold leading-[1.1]"
            style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}
          >
            {title}
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--ink-500)" }}>
            Client allotment and compliance follow-up · {todayLabel}
          </p>
        </div>
        <label
          className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase"
          style={{ letterSpacing: "0.14em", color: "var(--ink-400)" }}
        >
          Department
          <select
            value={dept}
            onChange={(e) => setDept(e.target.value as DeptKey)}
            className="min-w-[220px] cursor-pointer px-3 py-2 text-[13px] font-medium"
            style={{
              color: "var(--ink-900)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)",
              background: "var(--white)",
            }}
          >
            {(Object.keys(DEPT_LABELS) as DeptKey[]).map((k) => (
              <option key={k} value={k}>
                {DEPT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Stat cards */}
      <section ref={statsRef} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { v: stat(statCalls), label: "Calls placed today", color: "var(--ink-900)" },
          { v: stat(statCallback), label: "Awaiting callback", color: "var(--ink-900)" },
          { v: stat(statWa), label: "WhatsApp sent", color: "var(--ink-900)" },
          { v: `${stat(coverage)}%`, label: "Contact coverage", color: "var(--brand-green-deep)" },
        ].map((c) => (
          <div
            key={c.label}
            className="px-6 py-[22px] transition-all duration-200 hover:-translate-y-px hover:shadow-md"
            style={card}
          >
            <div className="text-[32px] font-bold tabular-nums" style={{ color: c.color }}>
              {c.v}
            </div>
            <div className="mt-1.5 text-xs" style={{ color: "var(--ink-500)" }}>
              {c.label}
            </div>
          </div>
        ))}
      </section>

      {/* Charts */}
      <section ref={chartsRef} className="ll-rise">
        <div className="dot-rule mb-5 w-40" />
        <h2
          className="mb-5 text-[26px] font-semibold"
          style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}
        >
          Allotment at a glance
        </h2>
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr_1fr]">
          <div className="min-w-0 p-6" style={card}>
            <h3 className="mb-4 text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>
              Clients allotted per staff member
            </h3>
            <div className="flex flex-wrap items-center gap-6">
              <div className="shrink-0">
                <Donut segments={staffSegs} size={190} thickness={30} centerTop={String(totalAssigned)} centerBottom="CLIENTS" progress={chartP} />
              </div>
              <ul className="grid min-w-[200px] flex-1 grid-cols-2 gap-x-4 gap-y-2">
                {rows.map((r) => (
                  <li key={r.s.id} className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-700)" }}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: COLORS[r.i % COLORS.length] }} />
                    <span className="flex-1 truncate">{r.s.name}</span>
                    <span className="font-semibold tabular-nums" style={{ color: "var(--ink-900)" }}>
                      {r.assigned}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="min-w-0 p-6" style={card}>
            <h3 className="mb-4 text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>
              Department split
            </h3>
            <div className="flex flex-col items-center gap-4">
              <Donut segments={deptSegs} size={160} thickness={44} progress={chartP} />
              <ul className="grid w-full grid-cols-2 gap-x-3.5 gap-y-1.5">
                {DEPTS.map((d, j) => (
                  <li key={d.key} className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-700)" }}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: d.color }} />
                    <span className="flex-1">{d.name}</span>
                    <span className="font-semibold tabular-nums">{deptTotals[j]}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="min-w-0 p-6" style={card}>
            <h3 className="mb-4 text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>
              Coverage — contacted vs pending
            </h3>
            <div className="flex flex-col items-center gap-4">
              <Donut segments={covSegs} size={160} thickness={26} centerTop={`${Math.round(coverage * chartP)}%`} centerBottom="CONTACTED" progress={chartP} />
              <div className="flex gap-5 text-xs" style={{ color: "var(--ink-700)" }}>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--brand-green)" }} />
                  Contacted <strong className="tabular-nums">{totalContacted}</strong>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--paper-3)" }} />
                  Pending <strong className="tabular-nums">{Math.max(0, totalAssigned - totalContacted)}</strong>
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Staff table */}
      <section className="ll-rise">
        <div className="mb-4 flex items-baseline justify-between">
          <h2
            className="m-0 text-[26px] font-semibold"
            style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}
          >
            Staff allotment — {DEPT_LABELS[dept]}
          </h2>
          <span className="text-xs" style={{ color: "var(--ink-400)" }}>
            {totalAssigned} clients · sorted by allotment
          </span>
        </div>
        <div className="overflow-x-auto" style={{ ...card, overflow: "hidden" }}>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr style={{ background: "var(--paper-2)", color: "var(--ink-500)" }} className="text-left">
                {["Staff", "Alerts", "Clients assigned", "Contacted", "Coverage"].map((h, i) => (
                  <th
                    key={h}
                    className={`px-4 py-[11px] text-[11px] font-semibold uppercase ${i === 2 || i === 3 ? "text-right" : ""}`}
                    style={{ letterSpacing: "0.1em", width: i === 4 ? 220 : undefined }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = r.assigned ? Math.round((r.contacted / r.assigned) * 100) : 0;
                return (
                  <tr key={r.s.id} style={{ borderTop: "1px solid var(--ink-100)" }} className="hover:bg-[var(--paper)]">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2.5">
                        <span className="h-[22px] w-2 rounded-[2px]" style={{ background: COLORS[r.i % COLORS.length] }} />
                        <span className="font-semibold" style={{ color: "var(--ink-900)" }}>{r.s.name}</span>
                        {r.s.ext && (
                          <span className="text-[11px]" style={{ color: "var(--ink-400)" }}>ext {r.s.ext}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="tabular-nums">{r.s.alerts}</span>
                      {r.s.unacked > 0 && (
                        <span
                          className="ml-2 px-[9px] py-0.5 text-[11px] font-semibold"
                          style={{ background: "rgba(201,154,78,0.15)", color: "#8F6A2E", borderRadius: "var(--radius-pill)" }}
                        >
                          {r.s.unacked} new
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{r.assigned}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--ink-700)" }}>{r.contacted}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2.5">
                        <span className="block h-1.5 flex-1 overflow-hidden" style={{ background: "var(--paper-3)", borderRadius: "var(--radius-pill)" }}>
                          <span
                            className="block h-full"
                            style={{
                              borderRadius: "var(--radius-pill)",
                              background: "var(--brand-green)",
                              width: barsOn ? `${pct}%` : "0%",
                              transition: "width 900ms var(--ease-emphasized)",
                            }}
                          />
                        </span>
                        <span className="w-9 text-right text-xs font-semibold tabular-nums" style={{ color: "var(--ink-500)" }}>
                          {pct}%
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Department cards */}
      {isAdmin && (
        <section className="ll-rise">
          <div className="dot-rule green mb-5 w-40" />
          <h2
            className="mb-5 text-[26px] font-semibold"
            style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}
          >
            Department reports
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {DEPTS.map((d, j) => (
              <AppLink
                key={d.key}
                href={`/reports?dept=${d.key}`}
                className="flex flex-col gap-2.5 p-[22px] no-underline transition-all duration-200 hover:-translate-y-px hover:shadow-md"
                style={card}
              >
                <span className="text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.14em", color: d.color }}>
                  Report
                </span>
                <span className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}>
                  {d.name} Department
                </span>
                <span className="text-xs leading-relaxed" style={{ color: "var(--ink-500)" }}>
                  {deptTotals[j]} clients · {stats.filter((s) => s[d.key] > 0).length} staff allotted
                </span>
                <span className="mt-auto inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--brand-blue)" }}>
                  View report
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </span>
              </AppLink>
            ))}
          </div>
        </section>
      )}

      {/* My alerts */}
      <section className="ll-rise">
        <h2
          className="mb-3 text-xs font-semibold uppercase"
          style={{ letterSpacing: "0.14em", color: "var(--ink-500)" }}
        >
          My alerts
        </h2>
        {alerts.length === 0 ? (
          <p className="p-4 text-sm" style={{ ...card, color: "var(--ink-400)" }}>
            No alerts.
          </p>
        ) : (
          <ul style={{ ...card, overflow: "hidden" }}>
            {alerts.map((a) => {
              const esc = a.type === "escalation";
              return (
                <li
                  key={a.id}
                  className="flex items-center gap-3.5 px-[18px] py-[13px] text-[13px]"
                  style={{ borderTop: "1px solid var(--ink-100)" }}
                >
                  <span
                    className="shrink-0 px-[11px] py-[3px] text-[11px] font-semibold"
                    style={{
                      borderRadius: "var(--radius-pill)",
                      background: esc ? "rgba(178,58,58,0.09)" : "rgba(201,154,78,0.15)",
                      color: esc ? "#B23A3A" : "#8F6A2E",
                    }}
                  >
                    {esc ? "Escalation" : "Missed call"}
                  </span>
                  <span style={{ color: a.acknowledged ? "var(--ink-400)" : "var(--ink-900)" }}>
                    {a.clientId ? (
                      <Link href={`/clients/${a.clientId}`} className="no-underline hover:underline" style={{ color: "inherit" }}>
                        {a.message}
                      </Link>
                    ) : (
                      a.message
                    )}
                  </span>
                  <span className="ml-auto whitespace-nowrap text-[11.5px] tabular-nums" style={{ color: "var(--ink-400)" }}>
                    {a.time}
                  </span>
                  {!a.acknowledged && (
                    <form action={() => ack(a.id)}>
                      <SubmitButton variant="secondary" size="xs">
                        Acknowledge
                      </SubmitButton>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
