"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/button";
import { runSyncNow, type SyncState } from "./actions";

const initial: SyncState = { report: null, error: null, mockData: false };

const inputStyle = {
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  background: "var(--white)",
  color: "var(--ink-900)",
} as const;

/**
 * On-demand PAN/GST lookup. `clientId` limits the run to one client (the
 * "Refresh compliance" button on a client master); without it the run takes
 * the next `limit` clients that have not been looked up recently.
 */
export function SyncPanel({
  clientId,
  configured,
  provider,
  compact = false,
}: {
  clientId?: string;
  configured: boolean;
  provider: string;
  compact?: boolean;
}) {
  const [state, formAction] = useActionState(runSyncNow, initial);
  const r = state.report;

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-wrap items-end gap-2.5">
        {clientId && <input type="hidden" name="client_id" value={clientId} />}
        {!clientId && (
          <label className="flex flex-col">
            <span
              className="mb-[5px] text-[10.5px] font-bold uppercase"
              style={{ letterSpacing: "0.1em", color: "var(--ink-400)" }}
            >
              Clients per run
            </span>
            <input
              name="limit"
              type="number"
              min={1}
              max={500}
              defaultValue={25}
              className="w-[110px] px-3 py-2 text-[13px]"
              style={inputStyle}
            />
          </label>
        )}
        <SubmitButton name="mode" value="dryrun" variant="secondary" size="md">
          Preview
        </SubmitButton>
        <SubmitButton name="mode" value="commit" variant="ink" size="md">
          {clientId ? "Refresh from PAN / GST" : "Generate tasks"}
        </SubmitButton>
      </form>

      {!configured && (
        <p className="m-0 text-[12px]" style={{ color: "#8F6A2E" }}>
          No PAN/GST vendor is configured — running on the <strong>{provider}</strong>{" "}
          provider, which returns sample data. Set{" "}
          <code>COMPLIANCE_API_BASE_URL</code> and <code>COMPLIANCE_API_KEY</code> to
          use live data.
        </p>
      )}

      {state.error && (
        <p className="m-0 text-[12.5px]" style={{ color: "var(--danger)" }}>
          {state.error}
        </p>
      )}

      {r && (
        <div
          className="px-4 py-3 text-[12.5px]"
          style={{
            background: "var(--paper-2)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-md)",
            color: "var(--ink-700)",
          }}
        >
          <strong style={{ color: "var(--ink-900)" }}>
            {r.dryRun ? "Preview" : "Run complete"}
          </strong>{" "}
          · {r.scanned} client{r.scanned === 1 ? "" : "s"} looked up
          {!clientId && ` of ${r.candidates} due`} · {r.created} task
          {r.created === 1 ? "" : "s"} {r.dryRun ? "would be created" : "created"} ·{" "}
          {r.updated} updated · {r.resolved} auto-closed
          {r.failed > 0 && (
            <span style={{ color: "var(--danger)" }}> · {r.failed} lookup failed</span>
          )}
          {r.errors.length > 0 && (
            <ul className="mb-0 mt-2 list-inside list-disc" style={{ color: "var(--danger)" }}>
              {r.errors.slice(0, 5).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          {!compact && r.clients.some((c) => c.proposals > 0) && (
            <ul className="mb-0 mt-2 list-inside list-disc">
              {r.clients
                .filter((c) => c.proposals > 0)
                .slice(0, 15)
                .map((c) => (
                  <li key={c.clientId}>
                    {c.name}: {c.created} new, {c.updated} updated, {c.resolved} closed
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
