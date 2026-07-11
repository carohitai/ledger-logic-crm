"use client";

import { useMemo, useState } from "react";
import {
  CHART_COLORS,
  Donut,
  StatCard,
  cardStyle,
  useProgress,
  useReveal,
} from "@/components/charts";
import { AppLink } from "@/components/nav-progress";
import { StaffSummaryModal } from "@/components/staff-summary-modal";

export interface ReportStaff {
  id: string;
  name: string;
  total: number;
  callsDone: number;
  msgsDone: number;
  grades: { grade: string; count: number }[];
}

export type DeptKey = "gst" | "it" | "acc" | "bill";
export type ReportTab = DeptKey | "mine";

export interface ReportsData {
  gst: ReportStaff[];
  it: ReportStaff[];
  acc: ReportStaff[];
  bill: ReportStaff[];
}

export interface MyPartnerClient {
  id: string;
  name: string;
  pan: string | null;
  category: string | null;
  called: boolean;
  messaged: boolean;
  lastActivity: string | null;
}

export interface MyPartnerReport {
  clients: MyPartnerClient[];
}

const DEPTS: Record<DeptKey, { title: string; short: string }> = {
  gst: { title: "GST Department Report", short: "GST department" },
  it: { title: "Income Tax Department Report", short: "Income Tax department" },
  acc: { title: "Accounting Department Report", short: "Accounting department" },
  bill: { title: "Billing Department Report", short: "Billing department" },
};

const GRADE_COLOR: Record<string, string> = {
  "A++": "#16306E",
  "A+": "#1E429F",
  A: "#4A6FBF",
  B: "#7CA838",
  C: "#C99A4E",
  D: "#B4623A",
  E: "#6F7A8C",
  NA: "#8A92A3",
};
const GRADE_ORDER = ["A++", "A+", "A", "B", "C", "D", "E", "NA"];

const DONE_PILL = { background: "var(--brand-green-pale)", color: "var(--earth-moss)" };
const PENDING_PILL = { background: "rgba(201,154,78,0.15)", color: "#8F6A2E" };

export function ReportsView({
  data,
  mine,
  initialDept,
}: {
  data: ReportsData;
  mine: MyPartnerReport;
  initialDept: ReportTab;
}) {
  const [dept, setDept] = useState<ReportTab>(initialDept);
  const [drill, setDrill] = useState<{ id: string; name: string } | null>(null);
  const stats = useReveal<HTMLElement>();
  const charts = useReveal<HTMLElement>();
  const statP = useProgress(stats.shown, 1100);
  const chartP = useProgress(charts.shown, 1300);

  const rows = useMemo(
    () =>
      dept === "mine"
        ? []
        : [...data[dept]]
            .sort((a, b) => b.total - a.total)
            .map((r, i) => ({ ...r, color: CHART_COLORS[i % CHART_COLORS.length] })),
    [data, dept]
  );

  const isMine = dept === "mine";
  const myClients = mine.clients;
  const myTotal = myClients.length;
  const myCalls = myClients.filter((c) => c.called).length;
  const myMsgs = myClients.filter((c) => c.messaged).length;

  const totalClients = isMine ? myTotal : rows.reduce((n, r) => n + r.total, 0);
  const totCallsDone = isMine ? myCalls : rows.reduce((n, r) => n + r.callsDone, 0);
  const totMsgsDone = isMine ? myMsgs : rows.reduce((n, r) => n + r.msgsDone, 0);

  // Contact-status split for the personal donut.
  const myBoth = myClients.filter((c) => c.called && c.messaged).length;
  const myCallOnly = myCalls - myBoth;
  const myMsgOnly = myMsgs - myBoth;
  const myNone = myTotal - myBoth - myCallOnly - myMsgOnly;
  const mySegs = [
    { label: "Called & messaged", value: myBoth, color: "var(--brand-green-deep)" },
    { label: "Called only", value: myCallOnly, color: "#94C047" },
    { label: "Messaged only", value: myMsgOnly, color: "#4A6FBF" },
    { label: "Not contacted", value: myNone, color: "#C8CFA8" },
  ];

  return (
    <div className="flex flex-col gap-10">
      {drill && (
        <StaffSummaryModal staffId={drill.id} staffName={drill.name} onClose={() => setDrill(null)} />
      )}
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
            {isMine ? "My Partner Clients Report" : DEPTS[dept].title}
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--ink-500)" }}>
            {isMine
              ? "Calls and messages done by you to clients where you are the partner incharge"
              : "Staff-wise allotment, calling and messaging status"}
          </p>
        </div>
        <label
          className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase"
          style={{ letterSpacing: "0.14em", color: "var(--ink-400)" }}
        >
          Department
          <select
            value={dept}
            onChange={(e) => setDept(e.target.value as ReportTab)}
            className="min-w-[240px] cursor-pointer px-3 py-2 text-[13px] font-medium"
            style={{
              color: "var(--ink-900)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)",
              background: "var(--white)",
            }}
          >
            <option value="gst">GST department</option>
            <option value="it">Income Tax department</option>
            <option value="acc">Accounting department</option>
            <option value="bill">Billing department</option>
            <option value="mine">My clients — Partner incharge</option>
          </select>
        </label>
      </div>

      {/* 5 stat cards */}
      <section ref={stats.ref} className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatCard value={Math.round(totalClients * statP)} label={isMine ? "My partner clients" : "Total clients"} color="var(--brand-blue-deep)" />
        <StatCard value={Math.round(totCallsDone * statP)} label="Calling done" color="var(--brand-green-deep)" />
        <StatCard value={Math.round((totalClients - totCallsDone) * statP)} label="Calling pending" color="#8F6A2E" />
        <StatCard value={Math.round(totMsgsDone * statP)} label="Messages done" color="var(--brand-green-deep)" />
        <StatCard value={Math.round((totalClients - totMsgsDone) * statP)} label="Messages pending" color="#8F6A2E" />
      </section>

      {/* Donut + progress bars */}
      <section ref={charts.ref} className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="flex min-w-0 flex-col items-center gap-4 p-6" style={cardStyle}>
          <h3 className="m-0 self-start text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>
            {isMine ? "My contact status" : "Staff-wise allotment share"}
          </h3>
          <Donut
            segments={
              isMine
                ? mySegs.map((s) => ({ value: s.value, color: s.color }))
                : rows.map((r) => ({ value: r.total, color: r.color }))
            }
            size={200}
            thickness={32}
            centerTop={String(totalClients)}
            centerBottom="CLIENTS"
            progress={chartP}
          />
          {isMine && (
            <ul className="grid w-full grid-cols-2 gap-x-3.5 gap-y-1.5">
              {mySegs.map((s) => (
                <li key={s.label} className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-700)" }}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: s.color }} />
                  <span className="flex-1">{s.label}</span>
                  <span className="font-semibold tabular-nums">{s.value}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0 p-6" style={cardStyle}>
          <h3 className="mb-[18px] text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>
            {isMine ? "My calling & messaging progress" : "Calling & messaging progress by staff"}
          </h3>
          {isMine ? (
            <div className="flex flex-col gap-[13px]">
              <div className="grid grid-cols-[130px_1fr] items-center gap-3.5">
                <span className="text-[12.5px] font-semibold" style={{ color: "var(--brand-blue-deep)" }}>Calling</span>
                <Bar pct={charts.shown && myTotal ? Math.round((myCalls / myTotal) * 100) : 0} color="var(--brand-green)" label={`${myCalls}/${myTotal} calls`} />
              </div>
              <div className="grid grid-cols-[130px_1fr] items-center gap-3.5">
                <span className="text-[12.5px] font-semibold" style={{ color: "var(--brand-blue-deep)" }}>Messaging</span>
                <Bar pct={charts.shown && myTotal ? Math.round((myMsgs / myTotal) * 100) : 0} color="var(--brand-blue-soft)" label={`${myMsgs}/${myTotal} msgs`} />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-[13px]">
              {rows.map((r) => {
                const callPct = r.total ? Math.round((r.callsDone / r.total) * 100) : 0;
                const msgPct = r.total ? Math.round((r.msgsDone / r.total) * 100) : 0;
                return (
                  <div key={r.id} className="grid grid-cols-[130px_1fr_1fr] items-center gap-3.5">
                    <button
                      onClick={() => setDrill({ id: r.id, name: r.name })}
                      title="View calling & messaging summary"
                      className="max-w-full cursor-pointer justify-self-start truncate text-left text-[12.5px] font-semibold"
                      style={{ color: "var(--brand-blue-deep)", borderBottom: "1px dashed var(--brand-blue-soft)" }}
                    >
                      {r.name}
                    </button>
                    <Bar pct={charts.shown ? callPct : 0} color="var(--brand-green)" label={`${r.callsDone}/${r.total} calls`} />
                    <Bar pct={charts.shown ? msgPct : 0} color="var(--brand-blue-soft)" label={`${r.msgsDone}/${r.total} msgs`} />
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-[18px] flex gap-5 text-[11.5px]" style={{ color: "var(--ink-500)" }}>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--brand-green)" }} />
              Calling done
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--brand-blue-soft)" }} />
              Messages done
            </span>
          </div>
        </div>
      </section>

      {/* My partner clients table */}
      {isMine ? (
        <section>
          <div className="dot-rule mb-5 w-40" />
          <h2
            className="m-0 mb-4 text-[26px] font-semibold"
            style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}
          >
            Client-wise report — my partner clients
          </h2>
          {myTotal === 0 ? (
            <p className="p-6 text-sm" style={{ ...cardStyle, color: "var(--ink-400)" }}>
              You are not marked as partner incharge for any client yet.
            </p>
          ) : (
            <div className="overflow-x-auto" style={{ ...cardStyle, overflow: "hidden" }}>
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr style={{ background: "var(--paper-2)", color: "var(--ink-500)" }} className="text-left">
                    <th className="px-4 py-[11px] text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>Client</th>
                    <th className="px-4 py-[11px] text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>PAN</th>
                    <th className="px-4 py-[11px] text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>Cat.</th>
                    <th className="px-4 py-[11px] text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>Calling</th>
                    <th className="px-4 py-[11px] text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>Message</th>
                    <th className="px-4 py-[11px] text-right text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {myClients.map((c) => (
                    <tr key={c.id} style={{ borderTop: "1px solid var(--ink-100)" }} className="hover:bg-[var(--paper)]">
                      <td className="px-4 py-3">
                        <AppLink
                          href={`/clients/${c.id}`}
                          title="Open client master summary"
                          inlineSpinner
                          className="font-semibold no-underline transition-colors hover:!text-[var(--brand-blue)] hover:underline"
                          style={{ color: "var(--ink-900)" }}
                        >
                          {c.name}
                        </AppLink>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11.5px]" style={{ color: "var(--ink-500)" }}>{c.pan ?? "—"}</td>
                      <td className="px-4 py-3">{c.category ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className="whitespace-nowrap px-[11px] py-[3px] text-[11px] font-semibold" style={{ borderRadius: "var(--radius-pill)", ...(c.called ? DONE_PILL : PENDING_PILL) }}>
                          {c.called ? "Done" : "Pending"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="whitespace-nowrap px-[11px] py-[3px] text-[11px] font-semibold" style={{ borderRadius: "var(--radius-pill)", ...(c.messaged ? DONE_PILL : PENDING_PILL) }}>
                          {c.messaged ? "Done" : "Pending"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--ink-500)" }}>{c.lastActivity ?? "—"}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "2px solid var(--border-strong)", background: "var(--paper-2)" }}>
                    <td className="px-4 py-3 text-[11px] font-bold uppercase" style={{ letterSpacing: "0.1em", color: "var(--ink-700)" }}>
                      Total — {myTotal} clients
                    </td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 font-bold tabular-nums">{myCalls} done</td>
                    <td className="px-4 py-3 font-bold tabular-nums">{myMsgs} done</td>
                    <td className="px-4 py-3" />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section>
          <div className="dot-rule mb-5 w-40" />
          <h2
            className="m-0 mb-4 text-[26px] font-semibold"
            style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}
          >
            Staff-wise report — {DEPTS[dept].short}
          </h2>
          <div className="overflow-x-auto" style={{ ...cardStyle, overflow: "hidden" }}>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr style={{ background: "var(--paper-2)", color: "var(--ink-500)" }} className="text-left">
                  <th className="px-4 py-[11px] text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>Staff</th>
                  <th className="px-4 py-[11px] text-right text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>Total clients</th>
                  <th className="px-4 py-[11px] text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>Grading</th>
                  <th className="px-4 py-[11px] text-right text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>Calling done</th>
                  <th className="px-4 py-[11px] text-right text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>Calling pending</th>
                  <th className="px-4 py-[11px] text-right text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>Messages done</th>
                  <th className="px-4 py-[11px] text-right text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>Messages pending</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--ink-100)" }} className="hover:bg-[var(--paper)]">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2.5">
                        <span className="h-[22px] w-2 rounded-[2px]" style={{ background: r.color }} />
                        <button
                          onClick={() => setDrill({ id: r.id, name: r.name })}
                          title="View calling & messaging summary"
                          className="ll-press inline-flex cursor-pointer items-center gap-1.5"
                        >
                          <span
                            className="font-semibold"
                            style={{ color: "var(--brand-blue-deep)", borderBottom: "1px dashed var(--brand-blue-soft)" }}
                          >
                            {r.name}
                          </span>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 18l6-6-6-6" />
                          </svg>
                        </button>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums" style={{ color: "var(--brand-blue-deep)" }}>{r.total}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex flex-wrap gap-[5px]">
                        {[...r.grades]
                          .sort((a, b) => GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade))
                          .map((g) => (
                            <span
                              key={g.grade}
                              className="whitespace-nowrap px-[7px] py-0.5 text-[10.5px] font-semibold"
                              style={{ border: "1px solid var(--border-default)", background: "var(--paper)", borderRadius: "var(--radius-sm)", color: "var(--ink-700)" }}
                            >
                              <span style={{ color: GRADE_COLOR[g.grade] ?? "var(--ink-500)" }}>{g.grade}</span>
                              &nbsp;{g.count}
                            </span>
                          ))}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums" style={{ color: "var(--brand-green-deep)" }}>{r.callsDone}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: "#8F6A2E" }}>{r.total - r.callsDone}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums" style={{ color: "var(--brand-green-deep)" }}>{r.msgsDone}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: "#8F6A2E" }}>{r.total - r.msgsDone}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "2px solid var(--border-strong)", background: "var(--paper-2)" }}>
                  <td className="px-4 py-3 text-[11px] font-bold uppercase" style={{ letterSpacing: "0.1em", color: "var(--ink-700)" }}>Total</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums">{totalClients}</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right font-bold tabular-nums">{totCallsDone}</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums">{totalClients - totCallsDone}</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums">{totMsgsDone}</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums">{totalClients - totMsgsDone}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Bar({ pct, color, label }: { pct: number; color: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="block h-[7px] flex-1 overflow-hidden" style={{ background: "var(--paper-3)", borderRadius: "var(--radius-pill)" }}>
        <span
          className="block h-full"
          style={{ background: color, borderRadius: "var(--radius-pill)", width: `${pct}%`, transition: "width 900ms var(--ease-emphasized)" }}
        />
      </span>
      <span className="w-[62px] text-[11px] tabular-nums" style={{ color: "var(--ink-400)" }}>
        {label}
      </span>
    </span>
  );
}
