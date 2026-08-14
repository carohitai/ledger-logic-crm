// Status / priority pills for task rows, following the brand StatusBadge.
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  STATUS_STYLES,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks";

export function TaskStatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status as TaskStatus] ?? { bg: "var(--paper-3)", fg: "var(--ink-500)" };
  return (
    <span
      className="whitespace-nowrap px-[11px] py-[3px] text-[11px] font-semibold"
      style={{ borderRadius: "var(--radius-pill)", background: s.bg, color: s.fg }}
    >
      {STATUS_LABELS[status as TaskStatus] ?? status.replaceAll("_", " ")}
    </span>
  );
}

const PRIORITY_STYLES: Record<TaskPriority, { bg: string; fg: string }> = {
  high: { bg: "rgba(176,58,58,0.12)", fg: "var(--danger)" },
  normal: { bg: "var(--paper-3)", fg: "var(--ink-500)" },
  low: { bg: "var(--paper-2)", fg: "var(--ink-400)" },
};

export function PriorityBadge({ priority }: { priority: string }) {
  const p = PRIORITY_STYLES[priority as TaskPriority] ?? PRIORITY_STYLES.normal;
  return (
    <span
      className="whitespace-nowrap px-[11px] py-[3px] text-[11px] font-semibold"
      style={{ borderRadius: "var(--radius-pill)", background: p.bg, color: p.fg }}
    >
      {PRIORITY_LABELS[priority as TaskPriority] ?? priority}
    </span>
  );
}
