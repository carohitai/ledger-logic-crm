import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import {
  ReportsView,
  type DeptKey,
  type MyPartnerClient,
  type MyPartnerReport,
  type ReportStaff,
  type ReportsData,
  type ReportTab,
} from "./reports-view";

export const dynamic = "force-dynamic";

const ROLE_BY_DEPT: Record<DeptKey, string> = {
  gst: "gst",
  it: "income_tax",
  acc: "accounts",
  bill: "billing",
};

const IN_CHUNK = 400;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("staff")
    .select("id, app_role")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  // Reports are firm-wide; restrict to admins and partners.
  if (me?.app_role !== "admin" && me?.app_role !== "partner") redirect("/dashboard");

  const [{ data: deptRows }, { data: gradeRows }, partnerAllots, myCalls] = await Promise.all([
    supabase.from("report_staff_dept").select("*"),
    supabase.from("report_staff_grade").select("*"),
    fetchAllRows<{ client_id: string }>((from, to) =>
      supabase
        .from("client_allotments")
        .select("client_id")
        .eq("staff_id", me.id)
        .eq("role", "partner")
        .range(from, to)
    ),
    fetchAllRows<{ client_id: string; status: string; whatsapp_sent: boolean; placed_at: string }>(
      (from, to) =>
        supabase
          .from("call_logs")
          .select("client_id, status, whatsapp_sent, placed_at")
          .eq("staff_id", me.id)
          .order("placed_at", { ascending: false })
          .range(from, to),
      10000
    ),
  ]);

  const gradesByKey = new Map<string, { grade: string; count: number }[]>();
  for (const g of gradeRows ?? []) {
    const key = `${g.role}:${g.staff_id}`;
    const list = gradesByKey.get(key) ?? [];
    list.push({ grade: g.category, count: Number(g.cnt) });
    gradesByKey.set(key, list);
  }

  const empty: ReportsData = { gst: [], it: [], acc: [], bill: [] };
  const roleToDept = Object.fromEntries(
    Object.entries(ROLE_BY_DEPT).map(([d, r]) => [r, d as DeptKey])
  );

  for (const row of deptRows ?? []) {
    const deptKey = roleToDept[row.role];
    if (!deptKey) continue;
    const staff: ReportStaff = {
      id: row.staff_id,
      name: row.full_name,
      total: Number(row.total),
      callsDone: Number(row.calls_done),
      msgsDone: Number(row.msgs_done),
      grades: gradesByKey.get(`${row.role}:${row.staff_id}`) ?? [],
    };
    empty[deptKey].push(staff);
  }

  // ---- My partner clients: calls & messages done by me ----
  const partnerIds = [...new Set(partnerAllots.map((a) => a.client_id))];
  const partnerClients: { id: string; name: string; pan: string | null; category: string | null }[] = [];
  for (let i = 0; i < partnerIds.length; i += IN_CHUNK) {
    const { data } = await supabase
      .from("clients")
      .select("id, name, pan, category")
      .in("id", partnerIds.slice(i, i + IN_CHUNK));
    partnerClients.push(...(data ?? []));
  }

  // myCalls is newest-first, so the first hit per client is its latest activity.
  const calledAt = new Map<string, string>();
  const messagedAt = new Map<string, string>();
  for (const c of myCalls) {
    if (c.status !== "scheduled" && !calledAt.has(c.client_id)) calledAt.set(c.client_id, c.placed_at);
    if (c.whatsapp_sent && !messagedAt.has(c.client_id)) messagedAt.set(c.client_id, c.placed_at);
  }
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  const mineClients: MyPartnerClient[] = partnerClients
    .map((c) => {
      const call = calledAt.get(c.id) ?? null;
      const msg = messagedAt.get(c.id) ?? null;
      const last = call && msg ? (call > msg ? call : msg) : call ?? msg;
      return {
        id: c.id,
        name: c.name,
        pan: c.pan,
        category: c.category,
        called: Boolean(call),
        messaged: Boolean(msg),
        lastActivity: last ? fmtDate(last) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const mine: MyPartnerReport = { clients: mineClients };

  const params = await searchParams;
  const initialDept: ReportTab = (["gst", "it", "acc", "bill", "mine"] as ReportTab[]).includes(
    params.dept as ReportTab
  )
    ? (params.dept as ReportTab)
    : "gst";

  return <ReportsView data={empty} mine={mine} initialDept={initialDept} />;
}
