"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryChannel } from "@/lib/microsoft/teams";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: me } = await supabase
    .from("staff")
    .select("app_role")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (me?.app_role !== "admin") throw new Error("Admin only");
  return supabase;
}

/**
 * Links a client to a Team. The channel is the team's General channel, looked
 * up once via Graph and cached in teams_directory.
 */
export async function linkClientTeam(clientId: string, teamId: string): Promise<void> {
  const supabase = await requireAdmin();
  const { data: team } = await supabase
    .from("teams_directory")
    .select("team_id, display_name, general_channel_id")
    .eq("team_id", teamId)
    .maybeSingle();
  if (!team) throw new Error("Team not in directory — refresh it on the Integrations screen");

  let channelId = team.general_channel_id as string | null;
  if (!channelId) {
    const primary = await getPrimaryChannel(teamId);
    if (!primary) throw new Error("Could not read the team's General channel from Microsoft Graph");
    channelId = primary.id;
    await supabase
      .from("teams_directory")
      .update({ general_channel_id: channelId, web_url: primary.webUrl ?? null })
      .eq("team_id", teamId);
  }

  const { error } = await supabase
    .from("clients")
    .update({
      teams_team_id: teamId,
      teams_channel_id: channelId,
      teams_team_name: team.display_name,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);
  if (error) throw error;
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/admin/teams-map");
}

export async function unlinkClientTeam(clientId: string): Promise<void> {
  const supabase = await requireAdmin();
  const { error } = await supabase
    .from("clients")
    .update({ teams_team_id: null, teams_channel_id: null, teams_team_name: null })
    .eq("id", clientId);
  if (error) throw error;
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/admin/teams-map");
}

export async function setPeriskopeChat(clientId: string, chatId: string): Promise<void> {
  const supabase = await requireAdmin();
  const value = chatId.trim() || null;
  if (value && !/^\d{8,20}(@[cg]\.us)?$/.test(value)) {
    throw new Error("Periskope chat id should look like 1203630000000000@g.us or 919876543210@c.us");
  }
  const { error } = await supabase.from("clients").update({ periskope_chat_id: value }).eq("id", clientId);
  if (error) throw error;
  revalidatePath(`/clients/${clientId}`);
}

// Form-friendly wrappers (server actions bound to a <form action>).
export async function linkClientTeamForm(formData: FormData): Promise<void> {
  const clientId = String(formData.get("client_id") ?? "");
  const teamId = String(formData.get("team_id") ?? "");
  if (!clientId || !teamId) return;
  await linkClientTeam(clientId, teamId);
}

export async function unlinkClientTeamForm(formData: FormData): Promise<void> {
  const clientId = String(formData.get("client_id") ?? "");
  if (clientId) await unlinkClientTeam(clientId);
}

export async function setPeriskopeChatForm(formData: FormData): Promise<void> {
  const clientId = String(formData.get("client_id") ?? "");
  if (clientId) await setPeriskopeChat(clientId, String(formData.get("chat_id") ?? ""));
}
