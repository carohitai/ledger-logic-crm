"use client";

import { useState } from "react";
import { StaffSummaryModal } from "@/components/staff-summary-modal";

// Staff name that opens the calling & messaging summary drill-down.
export function StaffDrillName({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="View calling & messaging summary"
        className="cursor-pointer text-left font-semibold transition-colors hover:!text-[var(--brand-blue)] hover:underline"
        style={{ color: "var(--ink-900)" }}
      >
        {name}
      </button>
      {open && <StaffSummaryModal staffId={id} staffName={name} onClose={() => setOpen(false)} />}
    </>
  );
}
