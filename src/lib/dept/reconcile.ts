// Closes compliance tasks from department data, where such data exists.
//
// Two invariants make this safe to run unattended:
//
//   1. A provider can only move a task FORWARD. Nothing here reopens a task,
//      and nothing overrides a status a human has already set.
//   2. `unknown` never mutates anything. A department being unreachable is not
//      evidence that a client failed to file — treating it as such would flood
//      staff with false overdue alerts the first time an endpoint had an outage.

import type { SupabaseClient } from "@supabase/supabase-js";
import { activeProviderFor, type Department, type FilingStatus } from "./index";

/** Which form a template's filings are reported under. */
const FORM_FOR_TEMPLATE: Record<string, string> = {
  gstr1_monthly: "GSTR1",
  gstr3b_monthly: "GSTR3B",
  gstr1_quarterly: "GSTR1",
  gstr3b_quarterly: "GSTR3B",
  gstr9_annual: "GSTR9",
};

const OPEN = ["pending", "in_progress", "blocked"];
const MAX_PER_RUN = Number(process.env.DEPT_SYNC_MAX_PER_RUN ?? 100);
const DELAY_MS = Number(process.env.DEPT_SYNC_DELAY_MS ?? 400);
const CACHE_HOURS = Number(process.env.DEPT_SYNC_CACHE_HOURS ?? 24);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ReconcileSummary {
  checked: number;
  filed: number;
  notFiled: number;
  unknown: number;
  skippedCached: number;
  provider: string | null;
  errors: string[];
}

interface TaskRow {
  id: string;
  client_id: string;
  template_code: string | null;
  department: Department;
  period_key: string;
  status: string;
  due_date: string;
}

export async function runDeptReconcile(
  db: SupabaseClient,
  department: Department = "gst"
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    checked: 0,
    filed: 0,
    notFiled: 0,
    unknown: 0,
    skippedCached: 0,
    provider: null,
    errors: [],
  };

  const provider = activeProviderFor(department);
  if (!provider) {
    // Not an error — TDS and professional tax have no API at all, and GST/IT
    // are simply not onboarded yet.
    return summary;
  }
  summary.provider = provider.key;

  const { data: tasks } = await db
    .from("tasks")
    .select("id, client_id, template_code, department, period_key, status, due_date")
    .eq("department", department)
    .in("status", OPEN)
    .order("due_date", { ascending: false })
    .limit(MAX_PER_RUN)
    .returns<TaskRow[]>();

  if (!tasks?.length) return summary;

  const clientIds = [...new Set(tasks.map((t) => t.client_id))];
  const { data: clients } = await db
    .from("clients")
    .select("id, name, pan, gstin")
    .in("id", clientIds);
  const clientById = new Map((clients ?? []).map((c) => [c.id as string, c]));

  const freshAfter = new Date(Date.now() - CACHE_HOURS * 3_600_000).toISOString();

  for (const task of tasks) {
    const formCode = FORM_FOR_TEMPLATE[task.template_code ?? ""];
    const client = clientById.get(task.client_id);
    if (!formCode || !client) continue;

    // Respect the cache so a run does not re-hammer the endpoint for tasks it
    // already asked about today.
    const { data: cached } = await db
      .from("filing_status_cache")
      .select("state, fetched_at")
      .eq("client_id", task.client_id)
      .eq("form_code", formCode)
      .eq("period_key", task.period_key)
      .gte("fetched_at", freshAfter)
      .maybeSingle();
    if (cached) {
      summary.skippedCached++;
      continue;
    }

    summary.checked++;
    let results: FilingStatus[];
    try {
      results = await provider.fetchFilingStatus(
        {
          id: client.id as string,
          name: client.name as string,
          pan: (client.pan as string) ?? null,
          gstin: (client.gstin as string) ?? null,
        },
        { formCode, periodKey: task.period_key }
      );
    } catch (e) {
      summary.errors.push(e instanceof Error ? e.message : String(e));
      continue;
    }

    for (const result of results) {
      await db.from("filing_status_cache").upsert(
        {
          client_id: task.client_id,
          provider: provider.key,
          department,
          form_code: result.formCode,
          period_key: result.periodKey,
          state: result.state,
          filed_on: result.filedOn,
          reference: result.reference,
          confidence: result.confidence,
          payload: (result.raw ?? null) as never,
          fetched_at: result.fetchedAt,
        },
        { onConflict: "client_id,form_code,period_key" }
      );

      if (result.state === "filed") {
        summary.filed++;
        await db
          .from("tasks")
          .update({
            status: "filed",
            completed_at: result.filedOn ?? result.fetchedAt,
            evidence: {
              reference: result.reference,
              source: provider.key,
              confidence: result.confidence,
              filedOn: result.filedOn,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", task.id)
          // Belt and braces: only ever advance a task that is still open, so a
          // concurrent human edit is never overwritten.
          .in("status", OPEN);

        await db.from("task_events").insert({
          task_id: task.id,
          actor_staff_id: null, // system
          action: "auto_closed",
          from_status: task.status,
          to_status: "filed",
          note: `Confirmed filed via ${provider.key}${result.reference ? ` (${result.reference})` : ""}`,
        });
      } else if (result.state === "not_filed") {
        summary.notFiled++;
      } else {
        summary.unknown++;
      }
    }

    await sleep(DELAY_MS);
  }

  return summary;
}
