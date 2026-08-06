import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  ReportsView,
  type DeptKey,
  type FilingBucket,
  type FilingSummary,
  type ReportStaff,
  type ReportsData,
} from "./reports-view";

export const dynamic = "force-dynamic";

const ROLE_BY_DEPT: Record<DeptKey, string> = {
  gst: "gst",
  it: "income_tax",
  acc: "accounts",
  bill: "billing",
};

/** "FILED - EVC DONE" -> "Filed - EVC Done"; blank -> "Not updated". */
function prettyStatus(raw: string | null): string {
  const v = (raw ?? "").replace(/\s+/g, " ").trim();
  if (v === "") return "Not updated";
  return v
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bEvc\b/g, "EVC")
    .replace(/\bItr\b/g, "ITR")
    .replace(/\bNa\b/g, "NA");
}

/** Counts of each status value, most common first, blanks labelled "Not updated". */
function tally(values: (string | null)[]): FilingBucket[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const label = prettyStatus(v);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

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

  const [{ data: deptRows }, { data: gradeRows }, { data: filingRows }] = await Promise.all([
    supabase.from("report_staff_dept").select("*"),
    supabase.from("report_staff_grade").select("*"),
    supabase
      .from("clients")
      .select("itr_status, gstr9_status, gstr9c_status")
      .eq("status", "active")
      .limit(100000),
  ]);

  const filing: FilingSummary = {
    itr: tally((filingRows ?? []).map((r) => r.itr_status)),
    gstr9: tally((filingRows ?? []).map((r) => r.gstr9_status)),
    gstr9c: tally((filingRows ?? []).map((r) => r.gstr9c_status)),
  };

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

  return <ReportsView data={empty} initialDept={initialDept} filing={filing} />;
}
