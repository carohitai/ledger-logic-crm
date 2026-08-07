// Dashboard counters for compliance work.
//
// Reads under the caller's RLS, so a staff member's numbers cover only their
// own clients and assignments — the same scoping the rest of the dashboard uses.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ComplianceCounts } from "@/components/compliance-strip";
import { istToday, isoDate } from "./periods";

const OPEN = ["pending", "in_progress", "blocked"];

export async function complianceCounts(
  db: SupabaseClient,
  opts: { staffId?: string; includeUnmatched?: boolean } = {}
): Promise<ComplianceCounts> {
  const today = istToday();
  const todayIso = isoDate(today.y, today.m, today.d);
  const weekIso = isoDate(today.y, today.m, today.d + 7);

  const base = () => {
    let q = db.from("tasks").select("id", { count: "exact", head: true }).in("status", OPEN);
    if (opts.staffId) q = q.eq("assigned_staff_id", opts.staffId);
    return q;
  };

  const [open, overdue, dueSoon, unmatched] = await Promise.all([
    base().then((r) => r.count ?? 0),
    base()
      .lt("due_date", todayIso)
      .then((r) => r.count ?? 0),
    base()
      .gte("due_date", todayIso)
      .lte("due_date", weekIso)
      .then((r) => r.count ?? 0),
    opts.includeUnmatched
      ? db
          .from("unmatched_comms")
          .select("id", { count: "exact", head: true })
          .then((r) => r.count ?? 0)
      : Promise.resolve(0),
  ]);

  return { open, overdue, dueSoon, unmatched };
}
