"use client";

// Triage control for one unattributed item. Client island around a server-
// rendered row, matching how BulkActionBar and the contact actions work: the
// table stays an RSC, only the control is interactive.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ClientOption {
  id: string;
  name: string;
}

export function AssignRow({
  channel,
  id,
  counterparty,
  clients,
}: {
  channel: string;
  id: string;
  counterparty: string | null;
  clients: ClientOption[];
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [learn, setLearn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    if (!clientId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inbox/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, id, clientId, counterparty, learn }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Assign failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        disabled={busy}
        className="max-w-[240px] cursor-pointer px-2.5 py-1.5 text-[12.5px]"
        style={{
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-md)",
          background: "var(--white)",
          color: "var(--ink-900)",
        }}
      >
        <option value="">— assign to client —</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {counterparty && (
        <label
          className="flex cursor-pointer items-center gap-1.5 text-[11.5px]"
          style={{ color: "var(--ink-500)" }}
          title={`Save ${counterparty} against the client so future messages match on their own`}
        >
          <input
            type="checkbox"
            checked={learn}
            onChange={(e) => setLearn(e.target.checked)}
            disabled={busy}
          />
          remember this contact
        </label>
      )}

      <button
        type="button"
        onClick={assign}
        disabled={busy || !clientId}
        className="px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
        style={{
          borderRadius: "var(--radius-md)",
          background: "var(--brand-blue-deep)",
          color: "var(--white)",
          cursor: busy || !clientId ? "not-allowed" : "pointer",
        }}
      >
        {busy ? "Assigning…" : "Assign"}
      </button>

      {error && (
        <span className="text-[11.5px]" style={{ color: "#B4443A" }}>
          {error}
        </span>
      )}
    </div>
  );
}
