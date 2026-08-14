"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/button";
import { OPEN_STATUSES, type TaskStatus } from "@/lib/tasks";
import { assignTask, setTaskStatus } from "./actions";

/** Start / Done / Dismiss (or Reopen), acting on one task row. */
export function StatusActions({ taskId, status }: { taskId: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const open = OPEN_STATUSES.includes(status as TaskStatus);

  function move(next: TaskStatus, note?: string) {
    setBusy(next);
    startTransition(async () => {
      await setTaskStatus(taskId, next, note);
      setBusy(null);
    });
  }

  if (!open) {
    return (
      <Button
        size="xs"
        variant="secondary"
        loading={pending}
        onClick={() => move("open")}
        title="Move this task back to open"
      >
        Reopen
      </Button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {status === "open" && (
        <Button size="xs" variant="secondary" loading={pending && busy === "in_progress"} onClick={() => move("in_progress")}>
          Start
        </Button>
      )}
      <Button size="xs" variant="success" loading={pending && busy === "done"} onClick={() => move("done")}>
        Done
      </Button>
      <Button
        size="xs"
        variant="ghost"
        loading={pending && busy === "dismissed"}
        title="Not applicable for this client — close without doing the work"
        onClick={() => {
          const reason = window.prompt("Why is this task not applicable? (optional)") ?? undefined;
          move("dismissed", reason);
        }}
      >
        Dismiss
      </Button>
    </span>
  );
}

export function AssigneeSelect({
  taskId,
  value,
  staff,
}: {
  taskId: string;
  value: string | null;
  staff: { id: string; full_name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState(value ?? "");

  return (
    <select
      value={current}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        setCurrent(next);
        startTransition(() => assignTask(taskId, next));
      }}
      className="w-full cursor-pointer px-2 py-1 text-[12px]"
      style={{
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-md)",
        background: "var(--white)",
        color: "var(--ink-900)",
        opacity: pending ? 0.6 : 1,
      }}
    >
      <option value="">— unassigned —</option>
      {staff.map((s) => (
        <option key={s.id} value={s.id}>
          {s.full_name}
        </option>
      ))}
    </select>
  );
}
