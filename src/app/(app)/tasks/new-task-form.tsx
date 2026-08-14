"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/button";
import { PRIORITY_LABELS } from "@/lib/tasks";
import { createTask, type NewTaskState } from "./actions";

const initial: NewTaskState = { error: null, created: null };

const inputStyle = {
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  background: "var(--white)",
  color: "var(--ink-900)",
} as const;

const LABEL = "mb-[5px] text-[10.5px] font-bold uppercase";
const LABEL_STYLE = { letterSpacing: "0.1em", color: "var(--ink-400)" } as const;

/**
 * Manual task entry. Pass `clients` for the picker on /tasks, or `clientId`
 * when the client is already fixed (client master screen).
 */
export function NewTaskForm({
  clients,
  clientId,
  staff,
}: {
  clients?: { id: string; name: string }[];
  clientId?: string;
  staff: { id: string; full_name: string }[];
}) {
  const [state, formAction] = useActionState(createTask, initial);

  return (
    <form action={formAction} className="flex flex-col gap-3.5">
      {clientId ? (
        <input type="hidden" name="client_id" value={clientId} />
      ) : (
        <label className="flex flex-col">
          <span className={LABEL} style={LABEL_STYLE}>Client</span>
          <select name="client_id" defaultValue="" className="cursor-pointer px-3 py-2 text-[13px]" style={inputStyle}>
            <option value="">— choose a client —</option>
            {(clients ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col">
        <span className={LABEL} style={LABEL_STYLE}>Task</span>
        <input
          name="title"
          placeholder="e.g. Collect purchase bills for July 2026"
          className="px-3 py-2 text-[13px]"
          style={inputStyle}
        />
      </label>

      <label className="flex flex-col">
        <span className={LABEL} style={LABEL_STYLE}>Details</span>
        <textarea name="details" rows={2} className="px-3 py-2 text-[13px]" style={inputStyle} />
      </label>

      <div className="grid gap-3.5 sm:grid-cols-3">
        <label className="flex flex-col">
          <span className={LABEL} style={LABEL_STYLE}>Due date</span>
          <input type="date" name="due_date" className="px-3 py-2 text-[13px]" style={inputStyle} />
        </label>
        <label className="flex flex-col">
          <span className={LABEL} style={LABEL_STYLE}>Priority</span>
          <select name="priority" defaultValue="normal" className="cursor-pointer px-3 py-2 text-[13px]" style={inputStyle}>
            {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className={LABEL} style={LABEL_STYLE}>Assign to</span>
          <select name="assignee_staff_id" defaultValue="" className="cursor-pointer px-3 py-2 text-[13px]" style={inputStyle}>
            <option value="">— unassigned —</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton variant="ink" size="md">
          Add task
        </SubmitButton>
        {state.error && (
          <span className="text-[12.5px]" style={{ color: "var(--danger)" }}>
            {state.error}
          </span>
        )}
        {state.created && (
          <span className="text-[12.5px]" style={{ color: "var(--earth-moss)" }}>
            {state.created}
          </span>
        )}
      </div>
    </form>
  );
}
