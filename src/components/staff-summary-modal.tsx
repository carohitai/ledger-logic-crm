"use client";

import { useEffect, useState } from "react";
import { AppLink } from "./nav-progress";
import { Spinner } from "./spinner";

// Staff drill-down modal (design: Admin interface redesign handoff) — shows a
// staff member's calling & messaging summary with department-wise rows that
// link through to their client-level call & message log.

interface SummaryRow {
  key: string;
  dept: string;
  clients: number;
  calls: number;
  msgs: number;
}

interface StaffSummary {
  id: string;
  name: string;
  totalClients: number;
  totalCalls: number;
  totalMsgs: number;
  rows: SummaryRow[];
}

const DEPT_COLORS: Record<string, string> = {
  gst: "#94C047",
  it: "#1E429F",
  acc: "#C99A4E",
  bill: "#6F7A8C",
};

export function StaffSummaryModal({
  staffId,
  staffName,
  onClose,
}: {
  staffId: string;
  staffName: string;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState<StaffSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/staff/${staffId}/summary`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load summary");
        if (!cancelled) setSummary(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load summary");
      });
    return () => {
      cancelled = true;
    };
  }, [staffId]);

  const clientsHref = (dept?: string) =>
    `/staff/${staffId}/clients${dept ? `?dept=${dept}` : ""}`;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-6"
      style={{ background: "rgba(26,34,51,0.45)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Staff summary — ${staffName}`}
    >
      <div
        className="max-h-[90vh] w-full max-w-[560px] overflow-auto bg-white"
        style={{ borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-md)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-start gap-3 px-[22px] py-[18px]"
          style={{ borderBottom: "1px solid var(--border-default)", background: "var(--paper-2)" }}
        >
          <div className="flex-1">
            <div
              className="text-[11px] font-semibold uppercase"
              style={{ letterSpacing: "0.14em", color: "var(--brand-blue)" }}
            >
              Staff summary
            </div>
            <div
              className="text-2xl font-semibold leading-tight"
              style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}
            >
              {staffName}
            </div>
            <div className="mt-1 text-[12.5px]" style={{ color: "var(--ink-500)" }}>
              Calling &amp; messaging
              {summary ? <> · {summary.totalClients} clients across departments</> : null}
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close"
            className="ll-press inline-flex h-[30px] w-[30px] items-center justify-center text-lg hover:bg-[var(--paper-3)] hover:text-[var(--ink-900)]"
            style={{ color: "var(--ink-400)", borderRadius: "var(--radius-md)" }}
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-[18px] px-[22px] py-5">
          {error ? (
            <p className="m-0 py-6 text-center text-sm" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          ) : !summary ? (
            <div className="flex items-center justify-center gap-3 py-10 text-sm" style={{ color: "var(--ink-400)" }}>
              <Spinner size={18} color="var(--brand-blue)" /> Loading summary…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <AppLink
                  href={clientsHref()}
                  title="Open clients page"
                  className="flex flex-col p-4 no-underline transition-all duration-150 hover:-translate-y-px hover:shadow-md"
                  style={{ background: "var(--brand-green-pale)", borderRadius: "var(--radius-md)" }}
                >
                  <span className="text-3xl font-bold tabular-nums" style={{ color: "var(--brand-green-deep)" }}>
                    {summary.totalCalls}
                  </span>
                  <span className="mt-0.5 text-xs font-semibold" style={{ color: "var(--earth-moss)" }}>
                    Calls done
                  </span>
                  <span className="mt-1.5 text-[11px] font-semibold" style={{ color: "var(--brand-green-deep)" }}>
                    View clients →
                  </span>
                </AppLink>
                <AppLink
                  href={clientsHref()}
                  title="Open clients page"
                  className="flex flex-col p-4 no-underline transition-all duration-150 hover:-translate-y-px hover:shadow-md"
                  style={{ background: "var(--brand-blue-pale)", borderRadius: "var(--radius-md)" }}
                >
                  <span className="text-3xl font-bold tabular-nums" style={{ color: "var(--brand-blue-deep)" }}>
                    {summary.totalMsgs}
                  </span>
                  <span className="mt-0.5 text-xs font-semibold" style={{ color: "var(--brand-blue)" }}>
                    WhatsApp sent
                  </span>
                  <span className="mt-1.5 text-[11px] font-semibold" style={{ color: "var(--brand-blue)" }}>
                    View clients →
                  </span>
                </AppLink>
              </div>

              <div>
                <div
                  className="mb-2 text-[11px] font-bold uppercase"
                  style={{ letterSpacing: "0.12em", color: "var(--ink-400)" }}
                >
                  Section-wise summary
                </div>
                <div style={{ overflow: "hidden", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)" }}>
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr style={{ background: "var(--paper-2)", color: "var(--ink-500)" }} className="text-left">
                        <th className="px-3.5 py-[9px] text-[10.5px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>Department</th>
                        <th className="px-3.5 py-[9px] text-right text-[10.5px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>Clients</th>
                        <th className="px-3.5 py-[9px] text-right text-[10.5px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>Calls done</th>
                        <th className="px-3.5 py-[9px] text-right text-[10.5px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>WhatsApp sent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.rows.map((r) => (
                        <tr key={r.key} style={{ borderTop: "1px solid var(--ink-100)" }} className="hover:bg-[var(--paper)]">
                          <td className="px-3.5 py-2.5">
                            <AppLink
                              href={clientsHref(r.key)}
                              title="Open clients page"
                              inlineSpinner
                              className="inline-flex items-center gap-[9px] no-underline"
                            >
                              <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: DEPT_COLORS[r.key] }} />
                              <span
                                className="font-semibold"
                                style={{ color: "var(--brand-blue-deep)", borderBottom: "1px dashed var(--brand-blue-soft)" }}
                              >
                                {r.dept}
                              </span>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9 18l6-6-6-6" />
                              </svg>
                            </AppLink>
                          </td>
                          <td className="px-3.5 py-2.5 text-right tabular-nums" style={{ color: "var(--ink-700)" }}>{r.clients}</td>
                          <td className="px-3.5 py-2.5 text-right font-semibold tabular-nums" style={{ color: "var(--brand-green-deep)" }}>{r.calls}</td>
                          <td className="px-3.5 py-2.5 text-right font-semibold tabular-nums" style={{ color: "var(--brand-blue-deep)" }}>{r.msgs}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
