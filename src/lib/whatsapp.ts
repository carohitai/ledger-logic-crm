// Server-only WhatsApp sender via Nextel's template API.
// Activates when NEXTEL_API_KEY is configured; otherwise callers get a clear error.

const SEND_URL = process.env.NEXTEL_SEND_URL;
const API_KEY = process.env.NEXTEL_API_KEY;
const TEMPLATE_ID = process.env.WHATSAPP_TEMPLATE_ID ?? "call_back_work";
const TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG ?? "en";

export function whatsappConfigured(): boolean {
  return Boolean(SEND_URL && API_KEY);
}

/** Digits only, prefixed with 91 for 10-digit Indian numbers. */
export function toWhatsAppNumber(raw: string): string {
  let n = (raw ?? "").replace(/\D/g, "");
  if (n.length === 10) n = "91" + n;
  return n;
}

/**
 * Sends the approved "call_back_work" button template: language "en", one arg
 * (client name). `sender_phone` in Nextel's schema is the RECIPIENT's number.
 */
export async function sendCallbackTemplate(
  phone: string,
  templateArgs: string[]
): Promise<void> {
  if (!SEND_URL || !API_KEY) {
    throw new Error("WhatsApp is not configured (NEXTEL_SEND_URL / NEXTEL_API_KEY missing)");
  }
  const to = toWhatsAppNumber(phone);
  if (to.length < 12) throw new Error(`Invalid WhatsApp number: ${phone}`);

  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      type: "buttonTemplate",
      templateId: TEMPLATE_ID,
      templateLanguage: TEMPLATE_LANG,
      sender_phone: to,
      templateArgs,
    }),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WhatsApp send failed (${res.status}): ${text.slice(0, 200)}`);
  }
  // Nextel returns JSON; treat an explicit error field as failure even on 200.
  try {
    const data = JSON.parse(text);
    const status = String(data.status ?? data.success ?? "").toLowerCase();
    if (status === "false" || status === "error" || data.error) {
      throw new Error(`WhatsApp send rejected: ${text.slice(0, 200)}`);
    }
  } catch (e) {
    if (e instanceof SyntaxError) return; // non-JSON success body
    throw e;
  }
}
