"use client";

// Status control for one task row. Client island inside an RSC table, matching
// how the rest of the app handles interactivity.

import { useState } from "react";
import { useRouter } from "next/navigation";

const OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "filed", label: "Filed" },
  { value: "not_applicable", label: "Not applicable" },
] as const;

export const STATUS_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  pending: { label: "Pending", bg: "var(--paper-3)", fg: "var(--ink-500)" },
  in_progress: { label: "In progress", bg: "var(--brand-blue-pale)", fg: "var(--brand-blue-deep)" },
  blocked: { label: "Blocked", bg: "rgba(180,68,58,0.12)", fg: "#B4443A" },
  filed: { label: "Filed", bg: "var(--brand-green-pale)", fg: "var(--earth-moss)" },
  not_applicable: { label: "N/A", bg: "var(--paper-2)", fg: "var(--ink-400)" },
};

export function TaskStatusSelect({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: string) {
    const previous = value;
    setValue(next);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Update failed");
      router.refresh();
    } catch (e) {
      setValue(previous);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const style = STATUS_STYLE[value] ?? STATUS_STYLE.pending;

  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        value={value}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className="cursor-pointer px-2 py-[3px] text-[11.5px] font-semibold"
        style={{
          borderRadius: "var(--radius-pill)",
          background: style.bg,
          color: style.fg,
          border: "none",
          appearance: "none",
          textAlign: "center",
        }}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && (
        <span className="text-[11px]" style={{ color: "#B4443A" }} title={error}>
          !
        </span>
      )}
    </span>
  );
}
