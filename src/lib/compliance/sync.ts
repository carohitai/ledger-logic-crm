// Auto-generation pipeline: pick clients, call the PAN / GST API, store the
// snapshots, run the rules and reconcile the resulting tasks.
//
// Idempotent by construction — every auto task carries a `dedupe_key` of
// `client:kind:period`, so a second run updates the same row instead of
// creating a duplicate, and a finding that has gone away (return now filed) is
// closed with resolution `auto_resolved`.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getProvider, isValidGstin, isValidPan, providerName } from "./provider";
import { evaluate, periodsToCheck, financialYearsFor, type RuleClient } from "./rules";
import { AUTO_KINDS, KIND_BY_KEY, OPEN_STATUSES, dedupeKey, type TaskStatus } from "@/lib/tasks";
import type { AllotmentRole } from "@/lib/import/normalize";

export interface SyncOptions {
  dryRun: boolean;
  /** Clients fetched in this run. Keeps a cron pass inside the function budget. */
  limit: number;
  /** Restrict the run to specific clients (used by "Refresh" on a client page). */
  clientIds?: string[];
  trigger: "cron" | "manual";
  actorStaffId?: string | null;
  /** Clients synced within this many hours are skipped, so runs rotate. */
  refreshHours?: number;
}

export interface ClientSyncResult {
  clientId: string;
  name: string;
  gstin: string | null;
  pan: string | null;
  proposals: number;
  created: number;
  updated: number;
  resolved: number;
  errors: string[];
}

export interface SyncReport {
  runId: string | null;
  provider: string;
  dryRun: boolean;
  candidates: number;
  scanned: number;
  created: number;
  updated: number;
  resolved: number;
  failed: number;
  errors: string[];
  clients: ClientSyncResult[];
}

interface ClientRow extends RuleClient {
  status: string;
}

interface ExistingTask {
  id: string;
  dedupe_key: string | null;
  client_id: string;
  kind: string;
  status: string;
  title: string;
  details: string | null;
  due_date: string | null;
  priority: string;
}

const SEND_DELAY_MS = Number(process.env.COMPLIANCE_SYNC_DELAY_MS ?? 200);
const CANDIDATE_POOL = 5000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Financial years the returns endpoint must be queried for, per frequency. */
function financialYearsToQuery(frequency: "MONTHLY" | "QUARTERLY", now: Date): string[] {
  return financialYearsFor(periodsToCheck(frequency, now));
}

export async function runComplianceSync(
  db: SupabaseClient,
  opts: SyncOptions
): Promise<SyncReport> {
  const provider = getProvider();
  const now = new Date();
  const report: SyncReport = {
    runId: null,
    provider: providerName(),
    dryRun: opts.dryRun,
    candidates: 0,
    scanned: 0,
    created: 0,
    updated: 0,
    resolved: 0,
    failed: 0,
    errors: [],
    clients: [],
  };

  // --- run record -----------------------------------------------------------
  const { data: run } = await db
    .from("compliance_runs")
    .insert({
      trigger: opts.trigger,
      dry_run: opts.dryRun,
      actor_staff_id: opts.actorStaffId ?? null,
    })
    .select("id")
    .single();
  report.runId = (run?.id as string) ?? null;

  try {
    // --- candidates ---------------------------------------------------------
    let query = db
      .from("clients")
      .select("id, name, trade_name, pan, gstin, gst_status, gst_frequency, status")
      .eq("status", "active")
      .order("name")
      .limit(CANDIDATE_POOL);
    if (opts.clientIds?.length) query = query.in("id", opts.clientIds);

    const { data: allClients, error: clientsError } = await query.returns<ClientRow[]>();
    if (clientsError) throw clientsError;

    let candidates = (allClients ?? []).filter(
      (c) => isValidPan(c.pan) || isValidGstin(c.gstin)
    );
    report.candidates = candidates.length;

    // Skip anyone fetched recently, so a daily cron rotates through the book
    // instead of re-hitting (and re-billing) the same first N clients.
    const refreshHours = opts.refreshHours ?? Number(process.env.COMPLIANCE_REFRESH_HOURS ?? 24);
    if (refreshHours > 0 && !opts.clientIds?.length && candidates.length) {
      const cutoff = new Date(now.getTime() - refreshHours * 3600 * 1000).toISOString();
      const { data: fresh } = await db
        .from("compliance_snapshots")
        .select("client_id")
        .gte("fetched_at", cutoff)
        .eq("ok", true)
        .limit(CANDIDATE_POOL * 2);
      const recent = new Set((fresh ?? []).map((s) => s.client_id as string));
      if (recent.size) candidates = candidates.filter((c) => !recent.has(c.id));
    }

    const batch = candidates.slice(0, Math.max(0, opts.limit));
    if (!batch.length) {
      await finish(db, report.runId, report, null);
      return report;
    }

    // --- who each task lands on --------------------------------------------
    const ids = batch.map((c) => c.id);
    const [{ data: allotments }, { data: existingTasks }] = await Promise.all([
      db.from("client_allotments").select("client_id, role, staff_id").in("client_id", ids),
      db
        .from("tasks")
        .select("id, dedupe_key, client_id, kind, status, title, details, due_date, priority")
        .in("client_id", ids)
        .in("kind", AUTO_KINDS)
        .returns<ExistingTask[]>(),
    ]);

    const rolesByClient = new Map<string, Partial<Record<AllotmentRole, string>>>();
    for (const a of allotments ?? []) {
      const entry = rolesByClient.get(a.client_id) ?? {};
      entry[a.role as AllotmentRole] = a.staff_id as string;
      rolesByClient.set(a.client_id, entry);
    }
    const byKey = new Map<string, ExistingTask>();
    for (const t of existingTasks ?? []) {
      if (t.dedupe_key) byKey.set(t.dedupe_key, t);
    }

    // --- per client ---------------------------------------------------------
    for (const client of batch) {
      const result: ClientSyncResult = {
        clientId: client.id,
        name: client.name,
        gstin: client.gstin,
        pan: client.pan,
        proposals: 0,
        created: 0,
        updated: 0,
        resolved: 0,
        errors: [],
      };
      report.scanned++;

      const snapshotRows: Record<string, unknown>[] = [];
      let gstData = null;
      let panData = null;

      if (isValidGstin(client.gstin)) {
        const gstin = client.gstin!.toUpperCase();
        const freq = (client.gst_frequency ?? "").toUpperCase().includes("QUART")
          ? "QUARTERLY"
          : "MONTHLY";
        const res = await provider.fetchGst(gstin, financialYearsToQuery(freq, now));
        gstData = res.data;
        if (!res.ok) result.errors.push(`GST ${gstin}: ${res.error}`);
        snapshotRows.push({
          client_id: client.id,
          run_id: report.runId,
          kind: "gst",
          identifier: gstin,
          provider: report.provider,
          ok: res.ok,
          payload: res.raw ?? null,
          error: res.error,
        });
      }

      if (isValidPan(client.pan)) {
        const pan = client.pan!.toUpperCase();
        const res = await provider.fetchPan(pan);
        panData = res.data;
        if (!res.ok) result.errors.push(`PAN ${pan}: ${res.error}`);
        snapshotRows.push({
          client_id: client.id,
          run_id: report.runId,
          kind: "pan",
          identifier: pan,
          provider: report.provider,
          ok: res.ok,
          payload: res.raw ?? null,
          error: res.error,
        });
      }

      if (result.errors.length) report.failed++;
      if (!opts.dryRun && snapshotRows.length) {
        const { error } = await db.from("compliance_snapshots").insert(snapshotRows);
        if (error) result.errors.push(`snapshot: ${error.message}`);
      }

      const { tasks: proposals, evaluatedKinds } = evaluate({
        client,
        gst: gstData,
        pan: panData,
        now,
      });
      result.proposals = proposals.length;

      const roles = rolesByClient.get(client.id) ?? {};
      const assignFor = (kind: string): { staffId: string | null; role: string | null } => {
        const order = KIND_BY_KEY.get(kind)?.roles ?? [];
        for (const role of order) {
          const staffId = roles[role];
          if (staffId) return { staffId, role };
        }
        return { staffId: null, role: null };
      };

      const proposedKeys = new Set<string>();
      const inserts: Record<string, unknown>[] = [];

      for (const p of proposals) {
        const key = dedupeKey(client.id, p.kind, p.dedupeOn ?? p.period);
        proposedKeys.add(key);
        const existing = byKey.get(key);

        if (!existing) {
          const { staffId, role } = assignFor(p.kind);
          inserts.push({
            client_id: client.id,
            title: p.title,
            details: p.details,
            kind: p.kind,
            source: "auto",
            period: p.period,
            due_date: p.dueDate,
            priority: p.priority,
            status: "open",
            assignee_staff_id: staffId,
            assigned_role: role,
            dedupe_key: key,
            evidence: p.evidence,
          });
          result.created++;
          continue;
        }

        // Refresh a still-open task: due dates and priority drift as a period
        // goes overdue. Closed tasks are left alone — a person decided that.
        if (!OPEN_STATUSES.includes(existing.status as TaskStatus)) continue;
        const changed =
          existing.due_date !== p.dueDate ||
          existing.priority !== p.priority ||
          existing.title !== p.title ||
          existing.details !== p.details;
        if (!changed) continue;
        if (!opts.dryRun) {
          const { error } = await db
            .from("tasks")
            .update({
              title: p.title,
              details: p.details,
              due_date: p.dueDate,
              priority: p.priority,
              evidence: p.evidence,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
          if (error) result.errors.push(`task update: ${error.message}`);
        }
        result.updated++;
      }

      if (inserts.length && !opts.dryRun) {
        const { data: created, error } = await db.from("tasks").insert(inserts).select("id");
        if (error) {
          result.errors.push(`task insert: ${error.message}`);
          result.created -= inserts.length;
        } else if (created?.length) {
          await db.from("task_events").insert(
            created.map((t) => ({
              task_id: t.id as string,
              actor_staff_id: opts.actorStaffId ?? null,
              action: "created",
              note: `Auto-generated from the ${report.provider} PAN/GST lookup`,
            }))
          );
        }
      }

      // --- close findings that no longer hold ------------------------------
      const stale = (existingTasks ?? []).filter(
        (t) =>
          t.client_id === client.id &&
          t.dedupe_key &&
          OPEN_STATUSES.includes(t.status as TaskStatus) &&
          evaluatedKinds.includes(t.kind) &&
          !proposedKeys.has(t.dedupe_key)
      );
      // A failed lookup tells us nothing — never close tasks off an error.
      if (stale.length && !result.errors.length) {
        result.resolved = stale.length;
        if (!opts.dryRun) {
          const staleIds = stale.map((t) => t.id);
          const { error } = await db
            .from("tasks")
            .update({
              status: "done",
              resolution: "auto_resolved",
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .in("id", staleIds);
          if (error) result.errors.push(`auto-resolve: ${error.message}`);
          else
            await db.from("task_events").insert(
              staleIds.map((id) => ({
                task_id: id,
                actor_staff_id: opts.actorStaffId ?? null,
                action: "auto_resolved",
                note: "Closed automatically — the PAN/GST lookup no longer reports this",
              }))
            );
        }
      }

      report.created += result.created;
      report.updated += result.updated;
      report.resolved += result.resolved;
      report.errors.push(...result.errors.map((e) => `${client.name}: ${e}`));
      report.clients.push(result);

      if (SEND_DELAY_MS > 0) await sleep(SEND_DELAY_MS);
    }

    await finish(db, report.runId, report, null);
    return report;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    report.errors.push(message);
    await finish(db, report.runId, report, message);
    throw e;
  }
}

async function finish(
  db: SupabaseClient,
  runId: string | null,
  report: SyncReport,
  error: string | null
) {
  if (!runId) return;
  const { clients, ...summary } = report;
  await db
    .from("compliance_runs")
    .update({
      finished_at: new Date().toISOString(),
      summary: { ...summary, clientsScanned: clients.length },
      error,
    })
    .eq("id", runId);
}
