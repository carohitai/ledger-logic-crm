import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardView, type AlertItem, type StaffStat } from "./dashboard-view";
import { UserDashboardView, type FollowUp, type UserAlert } from "./user-dashboard-view";

export const dynamic = "force-dynamic";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function acknowledge(alertId: string) {
  "use server";
  const supabase = await createClient();
  await supabase
    .from("alerts")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", alertId);
  revalidatePath("/dashboard");
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("staff")
    .select("id, full_name, app_role")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const isAdmin = me?.app_role === "admin";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayLabel = new Date().toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // ---------------- Admin / partner: firm-wide team dashboard ----------------
  if (isAdmin) {
    const [{ data: statsRaw }, statCalls, statCallback, statWa, { data: alertsRaw }] =
      await Promise.all([
        supabase.from("dashboard_staff_stats").select("*"),
        supabase.from("call_logs").select("id", { count: "exact", head: true }).gte("placed_at", today.toISOString()).then((r) => r.count ?? 0),
        supabase.from("call_logs").select("id", { count: "exact", head: true }).eq("status", "scheduled").then((r) => r.count ?? 0),
        supabase.from("call_logs").select("id", { count: "exact", head: true }).eq("whatsapp_sent", true).then((r) => r.count ?? 0),
        supabase.from("alerts").select("id, client_id, type, message, created_at, acknowledged_at").eq("staff_id", me?.id ?? "").order("created_at", { ascending: false }).limit(50),
      ]);

    const stats: StaffStat[] = (statsRaw ?? []).map((s) => ({
      id: s.id,
      name: s.full_name,
      ext: s.extension,
      assigned: Number(s.assigned),
      gst: Number(s.assigned_gst),
      it: Number(s.assigned_it),
      acc: Number(s.assigned_acc),
      bill: Number(s.assigned_bill),
      contacted: Number(s.contacted),
      alerts: Number(s.alerts),
      unacked: Number(s.unacked),
    }));

    const alerts: AlertItem[] = (alertsRaw ?? []).map((a) => ({
      id: a.id,
      type: a.type,
      message: a.message,
      clientId: a.client_id,
      acknowledged: Boolean(a.acknowledged_at),
      time: fmtTime(a.created_at),
    }));

    return (
      <DashboardView
        title="Team Dashboard"
        todayLabel={todayLabel}
        stats={stats}
        alerts={alerts}
        statCalls={statCalls}
        statCallback={statCallback}
        statWa={statWa}
        isAdmin
        ack={acknowledge}
      />
    );
  }

  // ---------------- Staff: personal dashboard ----------------
  const staffId = me?.id ?? "";
  const [{ data: myStat }, statCalls, statCallback, statWa, { data: myClients }, { data: myCalls }, { data: alertsRaw }] =
    await Promise.all([
      supabase.from("dashboard_staff_stats").select("*").eq("id", staffId).maybeSingle(),
      supabase.from("call_logs").select("id", { count: "exact", head: true }).eq("staff_id", staffId).gte("placed_at", today.toISOString()).then((r) => r.count ?? 0),
      supabase.from("call_logs").select("id", { count: "exact", head: true }).eq("staff_id", staffId).eq("status", "scheduled").then((r) => r.count ?? 0),
      supabase.from("call_logs").select("id", { count: "exact", head: true }).eq("staff_id", staffId).eq("whatsapp_sent", true).then((r) => r.count ?? 0),
      supabase.from("my_clients").select("id, name, pan, category").limit(500),
      supabase.from("call_logs").select("client_id, status, whatsapp_sent, placed_at").eq("staff_id", staffId).order("placed_at", { ascending: false }).limit(500),
      supabase.from("alerts").select("id, client_id, type, message, created_at, acknowledged_at").eq("staff_id", staffId).order("created_at", { ascending: false }).limit(50),
    ]);

  const assigned = Number(myStat?.assigned ?? 0);
  const contacted = Number(myStat?.contacted ?? 0);
  const coverage = assigned ? Math.round((contacted / assigned) * 100) : 0;

  // Derive a follow-up status per client from their most recent call log.
  const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
    scheduled: { label: "Callback scheduled", bg: "var(--brand-blue-pale)", fg: "var(--brand-blue-deep)" },
    unanswered: { label: "No answer", bg: "rgba(201,154,78,0.15)", fg: "#8F6A2E" },
    answered: { label: "Answered", bg: "var(--brand-green-pale)", fg: "var(--earth-moss)" },
    placed: { label: "Call placed", bg: "var(--brand-green-pale)", fg: "var(--earth-moss)" },
  };
  const latestByClient = new Map<string, { status: string; whatsapp_sent: boolean }>();
  for (const c of myCalls ?? []) {
    if (!latestByClient.has(c.client_id)) {
      latestByClient.set(c.client_id, { status: c.status, whatsapp_sent: c.whatsapp_sent });
    }
  }
  const clientById = new Map((myClients ?? []).map((c) => [c.id, c]));
  // Order: clients with activity first (most recent), then fill from remaining allotment.
  const withActivity = [...latestByClient.keys()].filter((id) => clientById.has(id));
  const withoutActivity = (myClients ?? []).map((c) => c.id).filter((id) => !latestByClient.has(id));
  const ordered = [...withActivity, ...withoutActivity].slice(0, 8);

  const followUps: FollowUp[] = ordered.map((id) => {
    const c = clientById.get(id)!;
    const act = latestByClient.get(id);
    const s = act ? STATUS[act.status] : null;
    const status = act
      ? act.whatsapp_sent && act.status === "unanswered"
        ? { label: "WhatsApp sent", bg: "var(--brand-green-pale)", fg: "var(--earth-moss)" }
        : s ?? { label: act.status, bg: "var(--paper-3)", fg: "var(--ink-500)" }
      : { label: "Pending", bg: "rgba(201,154,78,0.15)", fg: "#8F6A2E" };
    return {
      id,
      client: c.name,
      pan: c.pan,
      cat: c.category,
      status: status.label,
      pillBg: status.bg,
      pillFg: status.fg,
    };
  });

  const alerts: UserAlert[] = (alertsRaw ?? [])
    .filter((a) => !a.acknowledged_at)
    .map((a) => ({
      id: a.id,
      kind: a.type,
      message: a.message,
      clientId: a.client_id,
      time: fmtTime(a.created_at),
      escalation: a.type === "escalation",
    }));

  return (
    <UserDashboardView
      firstName={(me?.full_name ?? "").replace(/^(CA|CS|Adv)\s+/i, "").split(/\s+/)[0] || "there"}
      todayLabel={todayLabel}
      statCalls={statCalls}
      statCallback={statCallback}
      statWa={statWa}
      coverage={coverage}
      deptCounts={{
        gst: Number(myStat?.assigned_gst ?? 0),
        it: Number(myStat?.assigned_it ?? 0),
        acc: Number(myStat?.assigned_acc ?? 0),
        bill: Number(myStat?.assigned_bill ?? 0),
      }}
      followUps={followUps}
      alerts={alerts}
      ack={acknowledge}
    />
  );
}
