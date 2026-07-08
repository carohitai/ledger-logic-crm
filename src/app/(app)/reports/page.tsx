import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ReportsView, type DeptKey, type ReportStaff, type ReportsData } from "./reports-view";

export const dynamic = "force-dynamic";

const ROLE_BY_DEPT: Record<DeptKey, string> = {
  gst: "gst",
  it: "income_tax",
  acc: "accounts",
  bill: "billing",
};

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
    .select("app_role")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  // Reports are firm-wide; restrict to admins and partners.
  if (me?.app_role !== "admin" && me?.app_role !== "partner") redirect("/dashboard");

  const [{ data: deptRows }, { data: gradeRows }] = await Promise.all([
    supabase.from("report_staff_dept").select("*"),
    supabase.from("report_staff_grade").select("*"),
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

  const params = await searchParams;
  const initialDept: DeptKey = (["gst", "it", "acc", "bill"] as DeptKey[]).includes(
    params.dept as DeptKey
  )
    ? (params.dept as DeptKey)
    : "gst";

  return <ReportsView data={empty} initialDept={initialDept} />;
}
