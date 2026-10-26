// Automated pull of the master client list from SharePoint/OneDrive.
//
// Shared by the cron route and the admin "Sync now" button. Change detection
// is the file's cTag/eTag (Graph bumps it on every content change), remembered
// in sync_state under `client_sheet`, so an unchanged workbook costs one
// metadata call and nothing else.

import type { SupabaseClient } from "@supabase/supabase-js";
import { downloadClientList, getClientListMetadata, graphConfigured } from "@/lib/graph";
import { parseClientListFile } from "./parse";
import { runSync, type SyncReport } from "./sync";
import { getSettings } from "@/lib/settings";
import { notifyClientChange, postSyncDigest, type NotifyOutcome } from "@/lib/notify/client-change";

export const SHEET_SYNC_KEY = "client_sheet";
const SHEET_ACTOR = "Master client sheet (OneDrive)";
const MAX_PER_CLIENT_NOTICES = Number(process.env.SHEET_SYNC_MAX_CLIENT_NOTICES ?? 60);

export interface SheetSyncResult {
  skipped: boolean;
  reason?: string;
  file?: { name: string; webUrl: string; lastModified: string; eTag: string | null };
  report?: Pick<SyncReport, "batchId" | "counts" | "missingFlagged" | "unresolvedAliases">;
  changedClients?: number;
  notifications?: { sent: number; failed: number; skipped: number };
  digest?: NotifyOutcome | null;
}

export interface SheetSyncState {
  cursor: string | null;
  last_run_at: string | null;
  last_error: string | null;
}

export async function getSheetSyncState(db: SupabaseClient): Promise<SheetSyncState | null> {
  const { data } = await db
    .from("sync_state")
    .select("cursor, last_run_at, last_error")
    .eq("key", SHEET_SYNC_KEY)
    .maybeSingle();
  return (data as SheetSyncState | null) ?? null;
}

async function saveState(db: SupabaseClient, patch: Partial<SheetSyncState>) {
  await db
    .from("sync_state")
    .upsert({ key: SHEET_SYNC_KEY, ...patch, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

/**
 * `db` must be a service-role client: the cron has no user session, and the
 * notifier reads the Microsoft token table.
 */
export async function runSheetSync(
  db: SupabaseClient,
  opts: { force?: boolean; actorStaffId?: string | null; notify?: boolean } = {}
): Promise<SheetSyncResult> {
  if (!graphConfigured()) {
    throw new Error("Microsoft Graph is not configured (GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET)");
  }

  let meta;
  try {
    meta = await getClientListMetadata();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await saveState(db, { last_run_at: new Date().toISOString(), last_error: msg });
    throw e;
  }

  const state = await getSheetSyncState(db);
  if (!opts.force && meta.eTag && state?.cursor === meta.eTag) {
    await saveState(db, { last_run_at: new Date().toISOString(), last_error: null });
    return { skipped: true, reason: "Workbook unchanged since the last sync", file: meta };
  }

  try {
    const { name, buf } = await downloadClientList();
    const records = parseClientListFile(name, buf);
    if (records.length === 0) throw new Error("No data rows found in the workbook's first sheet");

    const report = await runSync(db, records, {
      filename: name,
      dryRun: false,
      applyRenames: false,
      actorStaffId: opts.actorStaffId ?? null,
    });

    const result: SheetSyncResult = {
      skipped: false,
      file: meta,
      report: {
        batchId: report.batchId,
        counts: report.counts,
        missingFlagged: report.missingFlagged,
        unresolvedAliases: report.unresolvedAliases,
      },
      changedClients: report.activities.length,
    };

    if (opts.notify !== false && report.activities.length) {
      const settings = await getSettings(db);
      const tally = { sent: 0, failed: 0, skipped: 0 };
      // Per-client notices go to each client's own Team; the firm channel
      // gets a single digest below instead of N posts. A mass edit (say a
      // column re-done for 300 clients) would otherwise ping 300 Teams at
      // once, so above the cap only the digest goes out.
      const perClient = report.activities.length <= MAX_PER_CLIENT_NOTICES ? report.activities : [];
      if (!perClient.length) result.reason = `${report.activities.length} clients changed — above the per-client notice cap (${MAX_PER_CLIENT_NOTICES}); digest only`;
      for (const a of perClient) {
        const outcomes = await notifyClientChange(
          db,
          {
            clientId: a.clientId,
            activityId: a.activityId,
            kind: a.action,
            changes: a.changes,
            actorName: SHEET_ACTOR,
            skipFirmChannel: true,
          },
          settings
        );
        for (const o of outcomes) tally[o.status]++;
      }
      const { data: mapped } = await db
        .from("clients")
        .select("id, teams_team_name")
        .in("id", report.activities.map((a) => a.clientId));
      const teamName = new Map((mapped ?? []).map((c) => [c.id as string, c.teams_team_name as string | null]));
      result.digest = await postSyncDigest(
        db,
        {
          fileName: name,
          fileUrl: meta.webUrl,
          counts: {
            insert: report.counts.insert,
            update: report.counts.update,
            missing: report.missingFlagged,
          },
          changed: report.activities.map((a) => ({
            clientId: a.clientId,
            clientName: a.clientName,
            kind: a.action,
            changes: a.changes,
            teamName: teamName.get(a.clientId) ?? null,
          })),
        },
        settings
      );
      result.notifications = tally;
    }

    await saveState(db, { cursor: meta.eTag, last_run_at: new Date().toISOString(), last_error: null });
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await saveState(db, { last_run_at: new Date().toISOString(), last_error: msg });
    throw e;
  }
}
