"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient, serviceConfigured } from "@/lib/supabase/service";
import { disconnect } from "@/lib/microsoft/delegated";
import { listChannels, listJoinedTeams } from "@/lib/microsoft/teams";
import { runSheetSync } from "@/lib/import/sheet-sync";
import { setSetting, type FirmChannel } from "@/lib/settings";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: me } = await supabase
    .from("staff")
    .select("id, app_role")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (me?.app_role !== "admin") throw new Error("Admin only");
  return { supabase, staffId: me.id as string };
}

function back(msg: string, kind: "ok" | "error" = "ok"): never {
  revalidatePath("/admin/integrations");
  redirect(`/admin/integrations?${kind}=${encodeURIComponent(msg.slice(0, 300))}`);
}

export async function disconnectMicrosoft(): Promise<void> {
  await requireAdmin();
  await disconnect();
  back("Microsoft 365 disconnected");
}

/** Pulls the connected account's teams into teams_directory (one paged Graph call). */
export async function refreshTeamsDirectory(): Promise<void> {
  const { supabase } = await requireAdmin();
  let teams;
  try {
    teams = await listJoinedTeams();
  } catch (e) {
    back(e instanceof Error ? e.message : String(e), "error");
  }
  const now = new Date().toISOString();
  for (let i = 0; i < teams.length; i += 200) {
    const { error } = await supabase.from("teams_directory").upsert(
      teams.slice(i, i + 200).map((t) => ({
        team_id: t.id,
        display_name: t.displayName,
        description: t.description,
        synced_at: now,
      })),
      { onConflict: "team_id" }
    );
    if (error) back(error.message, "error");
  }
  back(`Teams directory refreshed: ${teams.length} teams`);
}

export async function saveFirmChannel(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const teamId = String(formData.get("team_id") ?? "");
  const channelId = String(formData.get("channel_id") ?? "");
  if (!teamId) {
    await setSetting(supabase, "firm_channel", null);
    back("Firm-wide channel cleared");
  }
  if (!channelId) {
    // Team chosen, channel not yet: reload with the team's channels listed.
    revalidatePath("/admin/integrations");
    redirect(`/admin/integrations?team=${encodeURIComponent(teamId)}`);
  }
  const { data: team } = await supabase
    .from("teams_directory")
    .select("display_name")
    .eq("team_id", teamId)
    .maybeSingle();
  let channelName = channelId;
  try {
    channelName = (await listChannels(teamId)).find((c) => c.id === channelId)?.displayName ?? channelId;
  } catch {
    /* keep the id as a label */
  }
  const value: FirmChannel = {
    teamId,
    channelId,
    teamName: team?.display_name ?? teamId,
    channelName,
  };
  await setSetting(supabase, "firm_channel", value);
  back(`Firm-wide channel set to ${value.teamName} / ${value.channelName}`);
}

export async function saveToggles(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  await setSetting(supabase, "notify_client_team", formData.get("notify_client_team") === "on");
  await setSetting(supabase, "notify_outlook_incharges", formData.get("notify_outlook_incharges") === "on");
  await setSetting(supabase, "notify_periskope", formData.get("notify_periskope") === "on");
  const chat = String(formData.get("periskope_internal_chat_id") ?? "").trim();
  await setSetting(supabase, "periskope_internal_chat_id", chat || null);
  const threshold = Number(formData.get("teams_match_threshold"));
  if (Number.isFinite(threshold) && threshold >= 0.3 && threshold <= 1) {
    await setSetting(supabase, "teams_match_threshold", threshold);
  }
  back("Notification settings saved");
}

export async function syncNow(formData: FormData): Promise<void> {
  const { staffId } = await requireAdmin();
  if (!serviceConfigured()) back("SUPABASE_SERVICE_ROLE_KEY is not set on the server", "error");
  const force = formData.get("force") === "on";
  // redirect() throws, so the outcome is composed first and redirected after.
  let msg: string;
  let kind: "ok" | "error" = "ok";
  try {
    const r = await runSheetSync(createServiceClient(), { force, actorStaffId: staffId });
    if (r.skipped) {
      msg = `Sheet unchanged (${r.file?.name ?? "linked file"}) — nothing to import`;
    } else {
      const c = r.report!.counts;
      const n = r.notifications;
      msg =
        `Synced ${r.file?.name}: ${c.insert} added, ${c.update} updated, ${r.report!.missingFlagged} missing` +
        (n ? ` · notices sent ${n.sent}, failed ${n.failed}, skipped ${n.skipped}` : "") +
        (r.reason ? ` · ${r.reason}` : "");
    }
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
    kind = "error";
  }
  back(msg, kind);
}
