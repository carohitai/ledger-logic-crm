"use client";

import { useActionState, useState } from "react";
import { Button, SubmitButton } from "@/components/button";
import { saveClientDetails, type SaveDetailsState } from "./actions";

// Editable "Details" card on the client master page. View mode mirrors the
// original read-only list; admins get an Edit toggle whose Save runs the
// saveClientDetails server action (CRM update + master-Excel write-back).

export interface DetailsClient {
  id: string;
  name: string;
  constitution: string | null;
  trade_name: string | null;
  pan: string | null;
  gstin: string | null;
  gst_status: string | null;
  category: string | null;
  books: string | null;
  it_category: string | null;
  gst_frequency: string | null;
  phone: string | null;
  email: string | null;
}

const initial: SaveDetailsState = { ok: false, error: null, excel: null, savedAt: 0 };

const cardStyle = {
  background: "var(--white)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-sm)",
} as const;

const LABEL = "mb-[5px] block text-[10.5px] font-bold uppercase";
const LABEL_STYLE = { letterSpacing: "0.1em", color: "var(--ink-400)" } as const;
const INPUT = "w-full px-2.5 py-1.5 text-[13px]";
const INPUT_STYLE = {
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  background: "var(--white)",
  color: "var(--ink-900)",
} as const;

const TEXT_FIELDS: { key: keyof DetailsClient; label: string; placeholder?: string }[] = [
  { key: "name", label: "Client Name" },
  { key: "trade_name", label: "Trade Name" },
  { key: "constitution", label: "Constitution" },
  { key: "pan", label: "PAN", placeholder: "AAAAA9999A" },
  { key: "gstin", label: "GSTIN" },
  { key: "category", label: "Category" },
  { key: "books", label: "Books" },
  { key: "it_category", label: "IT Category" },
  { key: "gst_frequency", label: "GST Frequency" },
  { key: "phone", label: "Mobile" },
  { key: "email", label: "Email" },
];

const GST_STATUS_OPTIONS = [
  ["", "—"],
  ["registered", "Registered"],
  ["not_registered", "Not registered"],
  ["cancelled", "Cancelled"],
] as const;

export function ClientDetailsCard({ client, canEdit }: { client: DetailsClient; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useActionState(saveClientDetails, initial);

  // Leave edit mode when a save lands (render-phase derived state).
  const [seenSavedAt, setSeenSavedAt] = useState(0);
  if (state.ok && state.savedAt > seenSavedAt) {
    setSeenSavedAt(state.savedAt);
    setEditing(false);
  }

  const info: [string, string | null][] = [
    ["Constitution", client.constitution],
    ["Trade Name", client.trade_name],
    ["GSTIN", client.gstin],
    ["GST Status", client.gst_status],
    ["Books", client.books],
    ["IT Category", client.it_category],
    ["GST Frequency", client.gst_frequency],
    ["Email", client.email],
  ];

  return (
    <section className="px-6 py-[22px]" style={cardStyle}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="m-0 text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>
          Details
        </h3>
        {canEdit && !editing && (
          <Button
            variant="secondary"
            size="xs"
            onClick={() => setEditing(true)}
            icon={
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            }
          >
            Edit
          </Button>
        )}
      </div>

      {!editing ? (
        <>
          <dl className="m-0 space-y-2.5 text-[13px]">
            {info.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt style={{ color: "var(--ink-500)" }}>{label}</dt>
                <dd className="m-0 text-right font-semibold" style={{ color: "var(--ink-900)" }}>
                  {value ?? "—"}
                </dd>
              </div>
            ))}
          </dl>
          {state.ok && state.savedAt > 0 && (
            <p className="mb-0 mt-3 text-[12.5px]" style={{ color: "var(--earth-moss)" }}>
              Saved. {state.excel}
            </p>
          )}
        </>
      ) : (
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="clientId" value={client.id} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {TEXT_FIELDS.map(({ key, label, placeholder }) => (
              <div key={key}>
                <label htmlFor={`edit-${key}`} className={LABEL} style={LABEL_STYLE}>
                  {label}
                </label>
                <input
                  id={`edit-${key}`}
                  name={key}
                  defaultValue={(client[key] as string | null) ?? ""}
                  placeholder={placeholder}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </div>
            ))}
            <div>
              <label htmlFor="edit-gst_status" className={LABEL} style={LABEL_STYLE}>
                GST Status
              </label>
              <select
                id="edit-gst_status"
                name="gst_status"
                defaultValue={client.gst_status ?? ""}
                className={`${INPUT} cursor-pointer`}
                style={INPUT_STYLE}
              >
                {GST_STATUS_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {state.error && (
            <p className="m-0 text-[12.5px]" style={{ color: "var(--danger)" }}>
              {state.error}
            </p>
          )}
          <div className="flex items-center gap-2.5 pt-1">
            <SubmitButton variant="ink" size="sm">
              Save details
            </SubmitButton>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <span className="text-[11.5px]" style={{ color: "var(--ink-400)" }}>
              Also updates the linked master Excel on SharePoint.
            </span>
          </div>
        </form>
      )}
    </section>
  );
}
