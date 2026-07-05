export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700",
    missing_from_sheet: "bg-amber-50 text-amber-700",
    archived: "bg-slate-100 text-slate-500",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${styles[status] ?? "bg-slate-100 text-slate-600"}`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}
