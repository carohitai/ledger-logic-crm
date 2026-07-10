// Brand status pill (design: Admin interface redesign handoff).
const STYLES: Record<string, { bg: string; fg: string }> = {
  active: { bg: "var(--brand-green-pale)", fg: "var(--earth-moss)" },
  missing_from_sheet: { bg: "rgba(201,154,78,0.15)", fg: "#8F6A2E" },
  archived: { bg: "var(--paper-3)", fg: "var(--ink-500)" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STYLES[status] ?? { bg: "var(--paper-3)", fg: "var(--ink-500)" };
  return (
    <span
      className="whitespace-nowrap px-[11px] py-[3px] text-[11px] font-semibold capitalize"
      style={{ borderRadius: "var(--radius-pill)", background: s.bg, color: s.fg }}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}
