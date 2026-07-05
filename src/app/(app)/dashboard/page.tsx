import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface StaffRow {
  id: string;
  full_name: string;
  extension: string | null;
  alerts: number;
  unacked: number;
  assigned: number;
  contacted: number;
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

  // Aggregates come from a SQL view (RLS-scoped via security_invoker), so
  // counts are exact regardless of row-limit caps on raw selects.
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [{ data: stats }, callsToday, awaitingCallback, waSent, { data: alerts }] =
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
        .select("id, staff_id, client_id, type, message, created_at, acknowledged_at")
        .eq("staff_id", me?.id ?? "")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  const rows: StaffRow[] = (stats ?? [])
    .map((s) => ({
      id: s.id,
      full_name: s.full_name,
      extension: s.extension,
      alerts: Number(s.alerts),
      unacked: Number(s.unacked),
      assigned: Number(s.assigned),
      contacted: Number(s.contacted),
    }))
    .filter((r) => r.assigned > 0 || r.alerts > 0 || r.contacted > 0)
    .sort((a, b) => b.assigned - a.assigned);

  const totalAssigned = rows.reduce((n, r) => n + r.assigned, 0);
  const totalContacted = rows.reduce((n, r) => n + r.contacted, 0);
  const coverage = totalAssigned ? Math.round((totalContacted / totalAssigned) * 100) : 0;

  const myAlerts = alerts ?? [];

  async function acknowledge(formData: FormData) {
    "use server";
    const supabase = await createClient();
    await supabase
      .from("alerts")
      .update({ acknowledged_at: new Date().toISOString() })
      .eq("id", String(formData.get("alert_id")));
    revalidatePath("/dashboard");
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">
        {isAdmin ? "Team Dashboard" : "My Dashboard"}
      </h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Calls placed today" value={callsToday} />
        <Card label="Awaiting callback" value={awaitingCallback} />
        <Card label="WhatsApp sent" value={waSent} />
        <Card label="Contact coverage" value={`${coverage}%`} />
      </div>

      <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Staff</th>
              <th className="px-3 py-2 font-medium">Alerts received</th>
              <th className="px-3 py-2 font-medium">Clients assigned</th>
              <th className="px-3 py-2 font-medium">Clients contacted</th>
              <th className="px-3 py-2 font-medium">Coverage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <span className="font-medium">{r.full_name}</span>
                  {r.extension && (
                    <span className="ml-1 text-xs text-slate-400">ext {r.extension}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {r.alerts}
                  {r.unacked > 0 && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                      {r.unacked} new
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">{r.assigned}</td>
                <td className="px-3 py-2">{r.contacted}</td>
                <td className="px-3 py-2 text-slate-500">
                  {r.assigned ? Math.round((r.contacted / r.assigned) * 100) : 0}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
          {isAdmin ? "My alerts" : "Alerts"}
        </h2>
        {myAlerts.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
            No alerts.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {myAlerts.slice(0, 50).map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    a.type === "escalation"
                      ? "bg-red-50 text-red-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {a.type === "escalation" ? "Escalation" : "Missed call"}
                </span>
                <span className={a.acknowledged_at ? "text-slate-400" : "text-slate-800"}>
                  {a.client_id ? (
                    <Link href={`/clients/${a.client_id}`} className="hover:underline">
                      {a.message}
                    </Link>
                  ) : (
                    a.message
                  )}
                </span>
                <span className="ml-auto whitespace-nowrap text-xs text-slate-400">
                  {new Date(a.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                </span>
                {!a.acknowledged_at && (
                  <form action={acknowledge}>
                    <input type="hidden" name="alert_id" value={a.id} />
                    <button className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
                      Acknowledge
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Card({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  );
}
