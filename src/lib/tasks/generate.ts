// Materialises compliance tasks: one row per client, per template, per period.
//
// Idempotent by construction — the (client_id, template_code, period_key)
// unique key plus ignoreDuplicates means re-running never duplicates a period
// and, critically, never resets a status somebody has already moved on. That
// last point is why this uses ignoreDuplicates rather than a plain upsert: an
// upsert would quietly wipe every "filed" back to "pending" on the next run.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TASK_TEMPLATES,
  type AppliesWhen,
  type TaskTemplate,
} from "./templates";
import { ayLabel, periodsInHorizon, dueDateFor, type Period } from "./periods";

const HORIZON_DAYS = Number(process.env.TASK_GEN_HORIZON_DAYS ?? 45);

type ClientRow = Record<string, unknown> & { id: string; name: string };

export interface GenerateSummary {
  templates: number;
  clients: number;
  considered: number;
  created: number;
  skippedExisting: number;
  unassigned: number;
  errors: string[];
}

const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();

/**
 * Exact set membership only. Substring matching would be actively wrong here:
 * "NON AUDIT" contains "AUDIT", so a LIKE would hand every non-audit client a
 * tax-audit obligation.
 */
export function appliesTo(client: ClientRow, rule: AppliesWhen): boolean {
  for (const [column, allowed] of Object.entries(rule.equals ?? {})) {
    const value = norm(client[column]);
    if (!allowed.some((a) => norm(a) === value)) return false;
  }
  for (const [column, prefixes] of Object.entries(rule.startsWith ?? {})) {
    const value = norm(client[column]);
    if (!prefixes.some((p) => value.startsWith(norm(p)))) return false;
  }
  for (const column of rule.notEmpty ?? []) {
    const value = String(client[column] ?? "").trim();
    if (!value || value === "-") return false;
  }
  for (const column of rule.isTrue ?? []) {
    if (client[column] !== true) return false;
  }
  return true;
}

function periodLabel(template: TaskTemplate, period: Period): string {
  return template.labelStyle === "ay" ? ayLabel(period.fy) : period.label;
}

export async function runTaskGeneration(
  db: SupabaseClient,
  opts: { dryRun?: boolean } = {}
): Promise<GenerateSummary> {
  const summary: GenerateSummary = {
    templates: 0,
    clients: 0,
    considered: 0,
    created: 0,
    skippedExisting: 0,
    unassigned: 0,
    errors: [],
  };

  const { data: clients, error: clientErr } = await db
    .from("clients")
    .select(
      "id, name, status, gst_status, gst_frequency, it_category, books, tds_applicable, pt_applicable"
    )
    .eq("status", "active")
    .returns<ClientRow[]>();

  if (clientErr) {
    summary.errors.push(clientErr.message);
    return summary;
  }
  summary.clients = clients?.length ?? 0;
  if (!clients?.length) return summary;

  // Who owns each kind of work, from the allotments the firm already maintains.
  const { data: allotments } = await db
    .from("client_allotments")
    .select("client_id, role, staff_id");

  const byClientRole = new Map<string, string>();
  for (const a of allotments ?? []) {
    byClientRole.set(`${a.client_id}:${a.role}`, a.staff_id as string);
  }
  const assignee = (clientId: string, role: string) =>
    byClientRole.get(`${clientId}:${role}`) ??
    byClientRole.get(`${clientId}:partner`) ??
    null;

  // Templates are read from the DB so an admin can deactivate one without a
  // deploy; the TS catalogue supplies the rules.
  const { data: dbTemplates } = await db
    .from("task_templates")
    .select("code, is_active");
  const activeCodes = new Set(
    (dbTemplates ?? []).filter((t) => t.is_active).map((t) => t.code as string)
  );

  const rows: Record<string, unknown>[] = [];

  for (const template of TASK_TEMPLATES) {
    if (!activeCodes.has(template.code)) continue;
    summary.templates++;

    const periods = periodsInHorizon(
      template.recurrence,
      template.dueRule,
      HORIZON_DAYS
    );
    if (!periods.length) continue;

    for (const client of clients) {
      if (!appliesTo(client, template.appliesWhen)) continue;
      const staffId = assignee(client.id, template.assignRole);
      if (!staffId) summary.unassigned++;

      for (const period of periods) {
        summary.considered++;
        rows.push({
          client_id: client.id,
          template_code: template.code,
          department: template.department,
          period_key: period.key,
          period_label: periodLabel(template, period),
          title: template.title,
          due_date: dueDateFor(template.dueRule, period),
          assigned_staff_id: staffId,
          source: "auto",
        });
      }
    }
  }

  if (opts.dryRun || !rows.length) return summary;

  // Chunked so a large first run stays inside the statement and payload limits.
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { data, error } = await db
      .from("tasks")
      .upsert(chunk, {
        onConflict: "client_id,template_code,period_key",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) {
      summary.errors.push(error.message);
      continue;
    }
    const created = data?.length ?? 0;
    summary.created += created;
    summary.skippedExisting += chunk.length - created;
  }

  return summary;
}
