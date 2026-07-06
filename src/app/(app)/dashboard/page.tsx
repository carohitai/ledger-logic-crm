import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardView, type AlertItem, type StaffStat } from "./dashboard-view";

export const dynamic = "force-dynamic";

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

  const [{ data: statsRaw }, statCalls, statCallback, statWa, { data: alertsRaw }] =
    await Promise.all([
      supabase.from("dashboard_staff_stats").select("*"),
      supabase
        .from("call_logs")
        .select("id", { count: "exact", head: true })
        .gte("placed_at", today.toISOString())
        .then((r) => r.count ?? 0),
      supabase
        .from("call_logs")
        .select("id", { count: "exact", head: true })
        .eq("status", "scheduled")
        .then((r) => r.count ?? 0),
      supabase
        .from("call_logs")
        .select("id", { count: "exact", head: true })
        .eq("whatsapp_sent", true)
        .then((r) => r.count ?? 0),
      supabase
        .from("alerts")
        .select("id, client_id, type, message, created_at, acknowledged_at")
        .eq("staff_id", me?.id ?? "")
        .order("created_at", { ascending: false })
        .limit(50),
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
    time: new Date(a.created_at).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));

  const todayLabel = new Date().toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  async function acknowledge(alertId: string) {
    "use server";
    const supabase = await createClient();
    await supabase
      .from("alerts")
      .update({ acknowledged_at: new Date().toISOString() })
      .eq("id", alertId);
    revalidatePath("/dashboard");
  }

  return (
    <DashboardView
      title={isAdmin ? "Team Dashboard" : "My Dashboard"}
      todayLabel={todayLabel}
      stats={stats}
      alerts={alerts}
      statCalls={statCalls}
      statCallback={statCallback}
      statWa={statWa}
      isAdmin={isAdmin}
      ack={acknowledge}
    />
  );
}
