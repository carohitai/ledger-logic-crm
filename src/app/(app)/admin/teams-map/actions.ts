"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { indexTeams, suggestTeam } from "@/lib/match";
import { getSettings } from "@/lib/settings";
import { linkClientTeam } from "../../clients/[id]/teams-actions";

const BATCH = 40;

/**
 * Accepts the auto-suggested Team for up to BATCH unmapped clients that clear
 * the threshold. Each acceptance may cost one Graph call (General channel
 * lookup), so the batch is bounded to stay well inside a server action's time.
 */
export async function acceptSuggestions(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: me } = await supabase.from("staff").select("app_role").eq("auth_user_id", user.id).maybeSingle();
  if (me?.app_role !== "admin") throw new Error("Admin only");

  const threshold = Number(formData.get("threshold")) || (await getSettings(supabase)).teams_match_threshold;
  const [{ data: clients }, { data: dir }] = await Promise.all([
    supabase.from("clients").select("id, name, trade_name").is("teams_team_id", null).eq("status", "active").order("name"),
    supabase.from("teams_directory").select("team_id, display_name, description"),
  ]);
  const teams = indexTeams((dir ?? []).map((t) => ({ id: t.team_id, name: t.display_name, description: t.description })));

  let done = 0;
  let failed = 0;
  const used = new Set<string>();
  for (const c of clients ?? []) {
    if (done + failed >= BATCH) break;
    const s = suggestTeam({ name: c.name, trade_name: c.trade_name }, teams, threshold);
    if (!s || used.has(s.id)) continue;
    try {
      await linkClientTeam(c.id, s.id);
      used.add(s.id);
      done++;
    } catch {
      failed++;
    }
  }
  revalidatePath("/admin/teams-map");
  redirect(
    `/admin/teams-map?ok=${encodeURIComponent(
      `Linked ${done} client${done === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}${done + failed >= BATCH ? " — press again for the next batch" : ""}`
    )}`
  );
}

export async function linkOne(formData: FormData): Promise<void> {
  const clientId = String(formData.get("client_id") ?? "");
  const teamId = String(formData.get("team_id") ?? "");
  if (clientId && teamId) await linkClientTeam(clientId, teamId);
  revalidatePath("/admin/teams-map");
}
