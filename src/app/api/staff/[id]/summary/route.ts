import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Calling & messaging summary for one staff member, split by department —
// backs the staff drill-down modal on the Team Dashboard. Visible to admins
// and partners, and to each staff member for themselves.

const DEPTS: { key: string; role: string; name: string }[] = [
  { key: "gst", role: "gst", name: "GST" },
  { key: "it", role: "income_tax", name: "Income Tax" },
  { key: "acc", role: "accounts", name: "Accounting" },
  { key: "bill", role: "billing", name: "Billing" },
];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await supabase
    .from("staff")
    .select("id, app_role")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const allowed = me && (me.app_role === "admin" || me.app_role === "partner" || me.id === id);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [{ data: staff }, { data: allotments }, { data: calls }] = await Promise.all([
    supabase.from("staff").select("id, full_name").eq("id", id).maybeSingle(),
    supabase.from("client_allotments").select("client_id, role").eq("staff_id", id),
    supabase
      .from("call_logs")
      .select("client_id, status, whatsapp_sent")
      .eq("staff_id", id)
      .limit(2000),
  ]);
  if (!staff) return NextResponse.json({ error: "Staff not found" }, { status: 404 });

  const calledClients = new Set(
    (calls ?? []).filter((c) => c.status !== "scheduled").map((c) => c.client_id)
  );
  const messagedClients = new Set(
    (calls ?? []).filter((c) => c.whatsapp_sent).map((c) => c.client_id)
  );

  const rows = DEPTS.map((d) => {
    const clientIds = new Set(
      (allotments ?? []).filter((a) => a.role === d.role).map((a) => a.client_id)
    );
    let callsDone = 0;
    let msgs = 0;
    for (const cid of clientIds) {
      if (calledClients.has(cid)) callsDone++;
      if (messagedClients.has(cid)) msgs++;
    }
    return { key: d.key, dept: d.name, clients: clientIds.size, calls: callsDone, msgs };
  });

  return NextResponse.json({
    id: staff.id,
    name: staff.full_name,
    totalClients: rows.reduce((n, r) => n + r.clients, 0),
    totalCalls: rows.reduce((n, r) => n + r.calls, 0),
    totalMsgs: rows.reduce((n, r) => n + r.msgs, 0),
    rows,
  });
}
