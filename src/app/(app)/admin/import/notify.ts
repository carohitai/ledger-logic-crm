import { after } from "next/server";
import { createServiceClient, serviceConfigured } from "@/lib/supabase/service";
import { getSettings } from "@/lib/settings";
import { notifyClientChange, postSyncDigest } from "@/lib/notify/client-change";
import type { SyncReport } from "@/lib/import/sync";

/**
 * Fans out Teams / Outlook / Periskope notices for a manual import, after the
 * response has gone back to the admin so the report renders immediately.
 */
export function notifyCommittedSync(report: SyncReport, filename: string): void {
  if (!report.activities.length || !serviceConfigured()) return;
  after(async () => {
    const db = createServiceClient();
    const settings = await getSettings(db);
    for (const a of report.activities) {
      await notifyClientChange(
        db,
        {
          clientId: a.clientId,
          activityId: a.activityId,
          kind: a.action,
          changes: a.changes,
          actorName: "Master client sheet (manual import)",
          skipFirmChannel: true,
        },
        settings
      );
    }
    const { data: mapped } = await db
      .from("clients")
      .select("id, teams_team_name")
      .in("id", report.activities.map((a) => a.clientId));
    const teamName = new Map((mapped ?? []).map((c) => [c.id as string, c.teams_team_name as string | null]));
    await postSyncDigest(
      db,
      {
        fileName: filename,
        fileUrl: null,
        counts: { insert: report.counts.insert, update: report.counts.update, missing: report.missingFlagged },
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
  });
}
