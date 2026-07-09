"use client";

import { useActionState } from "react";
import type { LinkStatus } from "@/lib/graph";
import { SubmitButton } from "@/components/button";
import { runImport, type ImportState } from "./actions";

const initial: ImportState = { report: null, error: null, source: null };

export function ImportForm({ link }: { link: LinkStatus }) {
  const [state, formAction] = useActionState(runImport, initial);
  const r = state.report;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Import client list</h1>
        <p className="text-sm text-slate-500">
          Sync from the linked SharePoint master list, or upload an Excel/CSV
          file. Always dry-run first; commit only after reviewing the report.
          The sheet wins for allotment fields.
        </p>
      </div>

      <form action={formAction} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <input type="hidden" name="source" value="sharepoint" />
        <h2 className="font-medium text-slate-900">Linked SharePoint file</h2>
        {!link.configured ? (
          <p className="text-slate-500">
            Not connected. Set <code>GRAPH_TENANT_ID</code>,{" "}
            <code>GRAPH_CLIENT_ID</code> and <code>GRAPH_CLIENT_SECRET</code>{" "}
            (see .env.example) to link the master client list.
          </p>
        ) : link.error !== null ? (
          <p className="text-red-700">
            Linked, but the file could not be reached: {link.error}
          </p>
        ) : (
          <>
            <p className="text-slate-600">
              <a
                href={link.file.webUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-blue-700 underline hover:text-blue-900"
              >
                {link.file.name}
              </a>{" "}
              — last modified{" "}
              {new Date(link.file.lastModified).toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
            <label className="flex items-center gap-2 text-slate-600">
              <input type="checkbox" name="applyRenames" />
              Apply rename candidates on commit (only after reviewing them in a dry run)
            </label>
            <div className="flex gap-2">
              <SubmitButton name="mode" value="dryrun" variant="secondary" size="sm">
                Dry run from SharePoint
              </SubmitButton>
              <SubmitButton name="mode" value="commit" variant="ink" size="sm">
                Import from SharePoint
              </SubmitButton>
            </div>
          </>
        )}
      </form>

      <form action={formAction} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <h2 className="font-medium text-slate-900">Manual upload</h2>
        <input type="file" name="file" accept=".csv,.xlsx,.xls" className="block" />
        <label className="flex items-center gap-2 text-slate-600">
          <input type="checkbox" name="applyRenames" />
          Apply rename candidates on commit (only after reviewing them in a dry run)
        </label>
        <div className="flex gap-2">
          <SubmitButton name="mode" value="dryrun" variant="secondary" size="sm">
            Dry run
          </SubmitButton>
          <SubmitButton name="mode" value="commit" variant="ink" size="sm">
            Commit import
          </SubmitButton>
        </div>
      </form>

      {state.error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      {r && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-medium text-slate-900">
              {r.dryRun ? "Dry run" : "Committed"} — batch {r.batchId.slice(0, 8)}
              {state.source && (
                <span className="font-normal text-slate-500"> · {state.source}</span>
              )}
            </h2>
            <div className="flex flex-wrap gap-4 text-sm">
              {Object.entries(r.counts).map(([k, v]) => (
                <span key={k} className="text-slate-600">
                  {k}: <strong className="text-slate-900">{v}</strong>
                </span>
              ))}
              {!r.dryRun && (
                <span className="text-amber-700">
                  flagged missing: <strong>{r.missingFlagged}</strong>
                </span>
              )}
            </div>
          </div>

          {Object.keys(r.unresolvedAliases).length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
              <h3 className="mb-1 font-medium text-amber-800">Unresolved incharge names</h3>
              <ul className="list-inside list-disc text-amber-700">
                {Object.entries(r.unresolvedAliases).map(([name, count]) => (
                  <li key={name}>
                    &quot;{name}&quot; — {count} row{count > 1 ? "s" : ""} (map it on the
                    Staff screen, then re-import)
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ReportTable
            title="Needs attention"
            rows={r.rows.filter((x) =>
              ["error", "rename_candidate", "skipped"].includes(x.action)
            )}
          />
          <ReportTable
            title="Changes"
            rows={r.rows.filter((x) => ["insert", "update"].includes(x.action))}
          />
        </div>
      )}
    </div>
  );
}

function ReportTable({
  title,
  rows,
}: {
  title: string;
  rows: NonNullable<ImportState["report"]>["rows"];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <h3 className="border-b border-slate-100 px-4 py-2 text-sm font-medium text-slate-900">
        {title} ({rows.length})
      </h3>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">Row</th>
            <th className="px-3 py-2 font-medium">Client</th>
            <th className="px-3 py-2 font-medium">Action</th>
            <th className="px-3 py-2 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 300).map((x) => (
            <tr key={x.rowNumber} className="border-t border-slate-100 align-top">
              <td className="px-3 py-2 text-slate-400">{x.rowNumber}</td>
              <td className="px-3 py-2 font-medium">{x.clientName}</td>
              <td className="px-3 py-2">{x.action}</td>
              <td className="px-3 py-2 text-slate-600">
                {x.messages.map((m, i) => (
                  <div key={i}>{m}</div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 300 && (
        <p className="px-4 py-2 text-xs text-slate-400">
          Showing first 300 of {rows.length}.
        </p>
      )}
    </div>
  );
}
