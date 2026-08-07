// Status / notes / assignment changes on a compliance task.
//
// RLS decides which ROWS a caller can touch, but it is column-blind: the
// tasks_update policy would happily let an assignee reassign their task to
// someone else. So the columns a caller may set are re-derived here from the
// session, never trusted from the request — the same rule the client edit form
// already follows.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const STATUSES = ["pending", "in_progress", "blocked", "filed", "not_applicable"] as const;
type Status = (typeof STATUSES)[number];

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await supabase
    .from("staff")
    .select("id, app_role")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!me) return NextResponse.json({ error: "No staff record" }, { status: 403 });

  const isAdminOrPartner = me.app_role === "admin" || me.app_role === "partner";

  const body = (await request.json()) as {
    id?: string;
    status?: string;
    notes?: string;
    assignedStaffId?: string | null;
  };
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Re-read rather than trusting whatever the form was rendered with.
  const { data: task } = await supabase
    .from("tasks")
    .select("id, status")
    .eq("id", body.id)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let nextStatus: Status | null = null;

  if (body.status) {
    if (!STATUSES.includes(body.status as Status)) {
      return NextResponse.json({ error: "Unknown status" }, { status: 400 });
    }
    nextStatus = body.status as Status;
    patch.status = nextStatus;
    if (nextStatus === "filed") {
      patch.completed_at = new Date().toISOString();
      patch.completed_by = me.id;
    } else {
      patch.completed_at = null;
      patch.completed_by = null;
    }
  }

  if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 2000);

  // Reassignment is a supervisory act, not something an assignee does to
  // themselves.
  if (body.assignedStaffId !== undefined) {
    if (!isAdminOrPartner) {
      return NextResponse.json(
        { error: "Only admins and partners can reassign a task" },
        { status: 403 }
      );
    }
    patch.assigned_staff_id = body.assignedStaffId || null;
  }

  const { error } = await supabase.from("tasks").update(patch).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (nextStatus && nextStatus !== task.status) {
    await supabase.from("task_events").insert({
      task_id: body.id,
      actor_staff_id: me.id,
      action: "status_changed",
      from_status: task.status,
      to_status: nextStatus,
    });
  }

  return NextResponse.json({ ok: true });
}
