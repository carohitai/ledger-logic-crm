"use client";

import { useState } from "react";
import { Button } from "@/components/button";

type Status = { kind: "idle" | "calling" | "ok" | "error"; message?: string };

const PhoneIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .8-.2 1l-2.3 2.2z" />
  </svg>
);

export function CallButton({
  clientId,
  phone,
  hasExtension,
}: {
  clientId: string;
  phone: string | null;
  hasExtension: boolean;
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  if (!phone) return null;

  const disabled = status.kind === "calling" || !hasExtension;

  async function call() {
    setStatus({ kind: "calling" });
    try {
      const res = await fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Call failed");
      setStatus({
        kind: "ok",
        message: "Ringing your extension — pick up to connect.",
      });
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : "Call failed" });
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="success"
        size="sm"
        onClick={call}
        disabled={disabled}
        loading={status.kind === "calling"}
        icon={PhoneIcon}
        title={hasExtension ? `Call ${phone}` : "No PBX extension set for your account"}
      >
        {status.kind === "calling" ? "Calling…" : "Call"}
      </Button>
      {status.message && (
        <span
          className={`text-xs ${status.kind === "error" ? "text-red-600" : "text-emerald-700"}`}
        >
          {status.message}
        </span>
      )}
    </div>
  );
}
