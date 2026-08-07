// Compliance headline for the dashboards: what is overdue, what lands this
// week, and how much unattributed mail/calls are waiting to be filed to a
// client. Deliberately a thin strip above the existing dashboards rather than a
// rebuild of them.

import Link from "next/link";

export interface ComplianceCounts {
  overdue: number;
  dueSoon: number;
  open: number;
  unmatched: number;
}

const TILES: {
  key: keyof ComplianceCounts;
  label: string;
  href: string;
  bg: string;
  fg: string;
}[] = [
  {
    key: "overdue",
    label: "Filings overdue",
    href: "/tasks",
    bg: "rgba(180,68,58,0.12)",
    fg: "#B4443A",
  },
  {
    key: "dueSoon",
    label: "Due in 7 days",
    href: "/tasks",
    bg: "rgba(201,154,78,0.15)",
    fg: "#8F6A2E",
  },
  {
    key: "open",
    label: "Open filings",
    href: "/tasks?show=open",
    bg: "var(--brand-blue-pale)",
    fg: "var(--brand-blue-deep)",
  },
  {
    key: "unmatched",
    label: "Needs attribution",
    href: "/inbox?view=unmatched",
    bg: "var(--paper-2)",
    fg: "var(--ink-700)",
  },
];

export function ComplianceStrip({
  counts,
  showUnmatched = true,
}: {
  counts: ComplianceCounts;
  showUnmatched?: boolean;
}) {
  const tiles = showUnmatched ? TILES : TILES.filter((t) => t.key !== "unmatched");
  return (
    <div className="mb-6 flex flex-wrap gap-3">
      {tiles.map((tile) => (
        <Link
          key={tile.key}
          href={tile.href}
          className="min-w-[150px] flex-1 px-5 py-3.5 no-underline"
          style={{
            background: tile.bg,
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div
            className="text-[10.5px] font-bold uppercase"
            style={{ letterSpacing: "0.1em", color: tile.fg, opacity: 0.75 }}
          >
            {tile.label}
          </div>
          <div
            className="text-[26px] font-semibold leading-tight tabular-nums"
            style={{ color: tile.fg }}
          >
            {counts[tile.key]}
          </div>
        </Link>
      ))}
    </div>
  );
}
