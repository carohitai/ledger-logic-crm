"use client";

import Link from "next/link";
import { Donut, StatCard, cardStyle, useProgress, useReveal } from "@/components/charts";

const DEPTS = [
  { key: "gst", name: "GST", color: "#94C047" },
  { key: "it", name: "Income Tax", color: "#1E429F" },
  { key: "acc", name: "Accounting", color: "#C99A4E" },
  { key: "bill", name: "Billing", color: "#6F7A8C" },
] as const;

export interface FollowUp {
  id: string;
  client: string;
  pan: string | null;
  cat: string | null;
  status: string;
  pillBg: string;
  pillFg: string;
}

export interface UserAlert {
  id: string;
  kind: string;
  message: string;
  clientId: string | null;
  time: string;
  escalation: boolean;
}

export function UserDashboardView({
  firstName,
  todayLabel,
  statCalls,
  statCallback,
  statWa,
  coverage,
  deptCounts,
  followUps,
  alerts,
  ack,
}: {
  firstName: string;
  todayLabel: string;
  statCalls: number;
  statCallback: number;
  statWa: number;
  coverage: number;
  deptCounts: Record<"gst" | "it" | "acc" | "bill", number>;
  followUps: FollowUp[];
  alerts: UserAlert[];
  ack: (alertId: string) => Promise<void>;
}) {
  const stats = useReveal<HTMLElement>();
  const charts = useReveal<HTMLElement>();
  const statP = useProgress(stats.shown, 1100);
  const chartP = useProgress(charts.shown, 1300);

  const split = DEPTS.map((d) => ({ name: d.name, value: deptCounts[d.key], color: d.color }));
  const total = split.reduce((n, s) => n + s.value, 0);

  return (
    <div className="flex flex-col gap-11">
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
          My Dashboard
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-500)" }}>
          Welcome, {firstName} · {todayLabel}
        </p>
      </div>

      <section ref={stats.ref} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard value={Math.round(statCalls * statP)} label="Calls placed today" />
        <StatCard value={Math.round(statCallback * statP)} label="Awaiting callback" />
        <StatCard value={Math.round(statWa * statP)} label="WhatsApp sent" />
        <StatCard value={`${Math.round(coverage * statP)}%`} label="My contact coverage" color="var(--brand-green-deep)" />
      </section>

      <section ref={charts.ref}>
        <div className="dot-rule mb-5 w-40" />
        <h2
          className="m-0 mb-5 text-[26px] font-semibold"
          style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}
        >
          My allotment
        </h2>
        <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
          <div className="flex min-w-0 flex-col items-center gap-4 p-6" style={cardStyle}>
            <h3 className="m-0 self-start text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>
              Clients by department
            </h3>
            <Donut segments={split} size={170} thickness={28} centerTop={String(total)} centerBottom="MY CLIENTS" progress={chartP} />
            <ul className="grid w-full grid-cols-2 gap-x-3.5 gap-y-1.5">
              {split.map((s) => (
                <li key={s.name} className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-700)" }}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: s.color }} />
                  <span className="flex-1">{s.name}</span>
                  <span className="font-semibold tabular-nums">{s.value}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex min-w-0 flex-col overflow-hidden" style={cardStyle}>
            <div className="flex items-baseline justify-between px-6 pb-3 pt-5">
              <h3 className="m-0 text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>
                My clients — follow-up status
              </h3>
              <Link href="/my-clients" className="text-xs font-semibold no-underline" style={{ color: "var(--brand-blue)" }}>
                View all my clients
              </Link>
            </div>
            {followUps.length === 0 ? (
              <p className="px-6 pb-6 text-sm" style={{ color: "var(--ink-400)" }}>
                No recent call or message activity on your clients yet.
              </p>
            ) : (
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr style={{ background: "var(--paper-2)", color: "var(--ink-500)" }} className="text-left">
                    <th className="px-4 py-[9px] text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>Client</th>
                    <th className="px-4 py-[9px] text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>PAN</th>
                    <th className="px-4 py-[9px] text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>Cat.</th>
                    <th className="px-4 py-[9px] text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {followUps.map((f) => (
                    <tr key={f.id} style={{ borderTop: "1px solid var(--ink-100)" }} className="hover:bg-[var(--paper)]">
                      <td className="px-4 py-[11px] font-semibold" style={{ color: "var(--ink-900)" }}>
                        <Link href={`/clients/${f.id}`} className="no-underline" style={{ color: "inherit" }}>
                          {f.client}
                        </Link>
                      </td>
                      <td className="px-4 py-[11px] font-mono text-[11.5px]" style={{ color: "var(--ink-500)" }}>{f.pan ?? "—"}</td>
                      <td className="px-4 py-[11px]">{f.cat ?? "—"}</td>
                      <td className="px-4 py-[11px]">
                        <span className="px-[11px] py-[3px] text-[11px] font-semibold" style={{ borderRadius: "var(--radius-pill)", background: f.pillBg, color: f.pillFg }}>
                          {f.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      <section>
        <h2 className="m-0 mb-3 text-xs font-semibold uppercase" style={{ letterSpacing: "0.14em", color: "var(--ink-500)" }}>
          Alerts
        </h2>
        {alerts.length === 0 ? (
          <p className="p-4 text-sm" style={{ ...cardStyle, color: "var(--ink-400)" }}>
            No alerts.
          </p>
        ) : (
          <ul style={{ ...cardStyle, overflow: "hidden" }}>
            {alerts.map((a) => (
              <li key={a.id} className="flex items-center gap-3.5 px-[18px] py-[13px] text-[13px]" style={{ borderTop: "1px solid var(--ink-100)" }}>
                <span
                  className="shrink-0 px-[11px] py-[3px] text-[11px] font-semibold"
                  style={{
                    borderRadius: "var(--radius-pill)",
                    background: a.escalation ? "rgba(178,58,58,0.09)" : "rgba(201,154,78,0.15)",
                    color: a.escalation ? "#B23A3A" : "#8F6A2E",
                  }}
                >
                  {a.escalation ? "Escalation" : "Missed call"}
                </span>
                <span style={{ color: "var(--ink-900)" }}>
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
                <form action={() => ack(a.id)}>
                  <button
                    className="cursor-pointer px-3 py-[5px] text-[11.5px] font-semibold transition-colors hover:bg-[var(--paper-2)] active:scale-[0.98]"
                    style={{ border: "1px solid var(--border-strong)", background: "var(--white)", borderRadius: "var(--radius-md)", color: "var(--ink-700)" }}
                  >
                    Acknowledge
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
