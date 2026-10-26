import type { SupabaseClient } from "@supabase/supabase-js";

// Admin-editable integration settings, stored one row per key in
// `app_settings`. Defaults live here so a fresh database behaves sensibly
// before anyone visits the Integrations screen.

export interface FirmChannel {
  teamId: string;
  channelId: string;
  teamName: string;
  channelName: string;
}

export interface AppSettings {
  /** Firm-wide channel that receives every change (digest + unmapped clients). */
  firm_channel: FirmChannel | null;
  /** Post each change into the client's own Team when one is mapped. */
  notify_client_team: boolean;
  /** Email the client's incharges (staff with an email) via Outlook. */
  notify_outlook_incharges: boolean;
  /** Internal staff WhatsApp group on Periskope that mirrors the Teams notice. */
  periskope_internal_chat_id: string | null;
  notify_periskope: boolean;
  /** Minimum name-similarity (0–1) for the Teams auto-mapper to propose a match. */
  teams_match_threshold: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  firm_channel: null,
  notify_client_team: true,
  notify_outlook_incharges: false,
  periskope_internal_chat_id: null,
  notify_periskope: false,
  teams_match_threshold: 0.72,
};

export type SettingKey = keyof AppSettings;

export async function getSettings(db: SupabaseClient): Promise<AppSettings> {
  const { data, error } = await db.from("app_settings").select("key, value");
  if (error) throw error;
  const merged: AppSettings = { ...DEFAULT_SETTINGS };
  for (const row of data ?? []) {
    if (row.key in merged) {
      (merged as unknown as Record<string, unknown>)[row.key] = row.value;
    }
  }
  return merged;
}

export async function setSetting<K extends SettingKey>(
  db: SupabaseClient,
  key: K,
  value: AppSettings[K]
): Promise<void> {
  const { error } = await db
    .from("app_settings")
    .upsert({ key, value: value as unknown as object, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
}
