// Periskope (WhatsApp for teams) sender. Used to mirror CRM change notices
// into an internal staff group; the per-client group id is stored on the
// client record for future client-facing use but is never written to by the
// change notifier.
//
// Docs: https://docs.periskope.app/api-reference/message/send-message
// Auth: `Authorization: Bearer <api key>` plus `x-phone: <connected org phone>`.

const API_URL = (process.env.PERISKOPE_API_URL ?? "https://api.periskope.app/v1").replace(/\/$/, "");
const API_KEY = process.env.PERISKOPE_API_KEY;
const PHONE = process.env.PERISKOPE_PHONE;

export function periskopeConfigured(): boolean {
  return Boolean(API_KEY && PHONE);
}

export async function sendPeriskopeMessage(chatId: string, message: string): Promise<void> {
  if (!API_KEY || !PHONE) {
    throw new Error("Periskope is not configured (PERISKOPE_API_KEY / PERISKOPE_PHONE missing)");
  }
  const res = await fetch(`${API_URL}/message/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      "x-phone": PHONE,
    },
    body: JSON.stringify({ chat_id: chatId, message, options: { hide_url_preview: true } }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Periskope send failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
}
