// Shared task vocabulary: the kinds a task can have, who it lands on by
// default, and how statuses / priorities are rendered. Imported by the rule
// engine, the sync, the /tasks screen and the client master card, so the label
// for a kind is defined exactly once.

import type { AllotmentRole } from "@/lib/import/normalize";

export type TaskStatus = "open" | "in_progress" | "done" | "dismissed";
export type TaskPriority = "high" | "normal" | "low";

export const TASK_STATUSES: TaskStatus[] = ["open", "in_progress", "done", "dismissed"];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  dismissed: "Dismissed",
};

export const STATUS_STYLES: Record<TaskStatus, { bg: string; fg: string }> = {
  open: { bg: "var(--brand-blue-pale)", fg: "var(--brand-blue-deep)" },
  in_progress: { bg: "rgba(201,154,78,0.15)", fg: "#8F6A2E" },
  done: { bg: "var(--brand-green-pale)", fg: "var(--earth-moss)" },
  dismissed: { bg: "var(--paper-3)", fg: "var(--ink-500)" },
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: "High",
  normal: "Normal",
  low: "Low",
};

/** Statuses that still need someone's attention. */
export const OPEN_STATUSES: TaskStatus[] = ["open", "in_progress"];

export interface TaskKind {
  key: string;
  label: string;
  /** Which side of the compliance calendar the kind belongs to. */
  group: "gst" | "pan" | "manual";
  /** Allotment roles the auto-assignment tries, in order. */
  roles: AllotmentRole[];
  defaultPriority: TaskPriority;
}

export const TASK_KINDS: TaskKind[] = [
  {
    key: "gstr1_pending",
    label: "GSTR-1 not filed",
    group: "gst",
    roles: ["gst", "accounts", "partner"],
    defaultPriority: "high",
  },
  {
    key: "gstr3b_pending",
    label: "GSTR-3B not filed",
    group: "gst",
    roles: ["gst", "accounts", "partner"],
    defaultPriority: "high",
  },
  {
    key: "gst_registration_inactive",
    label: "GST registration not active",
    group: "gst",
    roles: ["partner", "gst"],
    defaultPriority: "high",
  },
  {
    key: "gst_status_mismatch",
    label: "GST status differs from CRM",
    group: "gst",
    roles: ["gst", "partner"],
    defaultPriority: "normal",
  },
  {
    key: "gst_frequency_mismatch",
    label: "GST filing frequency differs from CRM",
    group: "gst",
    roles: ["gst", "accounts"],
    defaultPriority: "normal",
  },
  {
    key: "gst_new_registration",
    label: "New GSTIN found on PAN",
    group: "pan",
    roles: ["gst", "partner"],
    defaultPriority: "normal",
  },
  {
    key: "gstin_pan_mismatch",
    label: "GSTIN does not match the PAN on record",
    group: "gst",
    roles: ["gst", "partner"],
    defaultPriority: "high",
  },
  {
    key: "pan_inactive",
    label: "PAN inactive / inoperative",
    group: "pan",
    roles: ["income_tax", "partner"],
    defaultPriority: "high",
  },
  {
    key: "pan_name_mismatch",
    label: "PAN holder name differs from CRM",
    group: "pan",
    roles: ["income_tax", "partner"],
    defaultPriority: "low",
  },
  {
    key: "manual",
    label: "Manual task",
    group: "manual",
    roles: ["partner"],
    defaultPriority: "normal",
  },
];

export const KIND_BY_KEY = new Map(TASK_KINDS.map((k) => [k.key, k]));

/** Kinds the rule engine owns — these are the ones a sync may auto-resolve. */
export const AUTO_KINDS = TASK_KINDS.filter((k) => k.group !== "manual").map((k) => k.key);

export const GST_KINDS = TASK_KINDS.filter((k) => k.group === "gst").map((k) => k.key);
export const PAN_KINDS = TASK_KINDS.filter((k) => k.group === "pan").map((k) => k.key);

export function kindLabel(key: string | null | undefined): string {
  if (!key) return "Task";
  return KIND_BY_KEY.get(key)?.label ?? key.replaceAll("_", " ");
}

/** `client_id:kind:period` — the unique key that keeps re-runs idempotent. */
export function dedupeKey(clientId: string, kind: string, period: string | null): string {
  return `${clientId}:${kind}:${period ?? "-"}`;
}

/** Overdue = still open and past its due date (IST date string comparison). */
export function isOverdue(
  task: { status: string; due_date: string | null },
  today: string
): boolean {
  return (
    OPEN_STATUSES.includes(task.status as TaskStatus) &&
    Boolean(task.due_date) &&
    task.due_date! < today
  );
}
