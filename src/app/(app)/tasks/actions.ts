"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runComplianceSync, type SyncReport } from "@/lib/compliance/sync";
import { providerName } from "@/lib/compliance/provider";
import { OPEN_STATUSES, TASK_STATUSES, type TaskStatus } from "@/lib/tasks";

/** The caller's staff row — every action re-reads it server-side. */
async function me() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: staff } = await supabase
    .from("staff")
    .select("id, full_name, app_role")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return { supabase, staff };
}

function refresh(clientId: string | null) {
  revalidatePath("/tasks");
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

export async function setTaskStatus(taskId: string, status: string, note?: string) {
  if (!TASK_STATUSES.includes(status as TaskStatus)) throw new Error(`Unknown status: ${status}`);
  const { supabase, staff } = await me();

  const { data: task } = await supabase
    .from("tasks")
    .select("id, client_id, status")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) throw new Error("Task not found");
  if (task.status === status) return;

  const closing = !OPEN_STATUSES.includes(status as TaskStatus);
  const { error } = await supabase
    .from("tasks")
    .update({
      status,
      completed_at: closing ? new Date().toISOString() : null,
      completed_by: closing ? (staff?.id ?? null) : null,
      resolution: closing ? (note?.trim() || status) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId);
  if (error) throw error;

  await supabase.from("task_events").insert({
    task_id: taskId,
    actor_staff_id: staff?.id ?? null,
    action: "status",
    note: `${task.status} → ${status}${note?.trim() ? ` (${note.trim()})` : ""}`,
  });

  refresh(task.client_id as string);
}

export async function assignTask(taskId: string, staffId: string) {
  const { supabase, staff } = await me();
  const assignee = staffId === "" ? null : staffId;

  const { data: task } = await supabase
    .from("tasks")
    .select("id, client_id, assignee_staff_id")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) throw new Error("Task not found");
  if ((task.assignee_staff_id ?? null) === assignee) return;

  const { error } = await supabase
    .from("tasks")
    .update({ assignee_staff_id: assignee, updated_at: new Date().toISOString() })
    .eq("id", taskId);
  if (error) throw error;

  const { data: to } = assignee
    ? await supabase.from("staff").select("full_name").eq("id", assignee).maybeSingle()
    : { data: null };
  await supabase.from("task_events").insert({
    task_id: taskId,
    actor_staff_id: staff?.id ?? null,
    action: "assigned",
    note: to?.full_name ? `Assigned to ${to.full_name}` : "Unassigned",
  });

  refresh(task.client_id as string);
}

export interface NewTaskState {
  error: string | null;
  created: string | null;
}

export async function createTask(
  _prev: NewTaskState,
  formData: FormData
): Promise<NewTaskState> {
  try {
    const { supabase, staff } = await me();

    const clientId = String(formData.get("client_id") ?? "").trim();
    const title = String(formData.get("title") ?? "").trim();
    if (!clientId) return { error: "Choose a client.", created: null };
    if (!title) return { error: "Give the task a title.", created: null };

    // Never trust the posted client id — confirm it exists before writing.
    const { data: client } = await supabase
      .from("clients")
      .select("id, name")
      .eq("id", clientId)
      .maybeSingle();
    if (!client) return { error: "That client no longer exists.", created: null };

    const priority = String(formData.get("priority") ?? "normal");
    const dueDate = String(formData.get("due_date") ?? "").trim();
    const assignee = String(formData.get("assignee_staff_id") ?? "").trim();

    const { data: created, error } = await supabase
      .from("tasks")
      .insert({
        client_id: clientId,
        title,
        details: String(formData.get("details") ?? "").trim() || null,
        kind: "manual",
        source: "manual",
        priority: ["high", "normal", "low"].includes(priority) ? priority : "normal",
        due_date: dueDate || null,
        status: "open",
        assignee_staff_id: assignee || null,
        created_by: staff?.id ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;

    await supabase.from("task_events").insert({
      task_id: created.id,
      actor_staff_id: staff?.id ?? null,
      action: "created",
      note: `Created manually for ${client.name}`,
    });

    refresh(clientId);
    return { error: null, created: `Task added for ${client.name}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), created: null };
  }
}

export interface SyncState {
  report: SyncReport | null;
  error: string | null;
  mockData: boolean;
}

/**
 * Runs the PAN/GST auto-generation on demand. Restricted to admins and
 * partners: it spends vendor API credits and writes tasks across the book.
 */
export async function runSyncNow(_prev: SyncState, formData: FormData): Promise<SyncState> {
  const mockData = providerName() === "mock";
  try {
    const { supabase, staff } = await me();
    if (staff?.app_role !== "admin" && staff?.app_role !== "partner") {
      return { report: null, error: "Only admins and partners can run the sync.", mockData };
    }

    const limit = Number(formData.get("limit") ?? 25);
    const clientId = String(formData.get("client_id") ?? "").trim();
    const report = await runComplianceSync(supabase, {
      dryRun: formData.get("mode") === "dryrun",
      limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 25,
      clientIds: clientId ? [clientId] : undefined,
      trigger: "manual",
      actorStaffId: staff?.id ?? null,
      // An explicitly requested run should always hit the API.
      refreshHours: clientId ? 0 : undefined,
    });

    refresh(clientId || null);
    return { report, error: null, mockData };
  } catch (e) {
    return { report: null, error: e instanceof Error ? e.message : String(e), mockData };
  }
}
