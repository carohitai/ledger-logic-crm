import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

// Receives inbound WhatsApp messages pushed by Nextel.
// The exact payload schema isn't documented to us, so this endpoint stores the
// FULL raw payload and best-effort extracts sender + text from common field
// names. Parsing can be tightened once real payloads are visible in the table.

function pick(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

function digits(s: string | null): string {
  return (s ?? "").replace(/\D/g, "");
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("token") !== process.env.WHATSAPP_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  let payload: Record<string, unknown>;
  const text = await request.text();
  try {
    payload = JSON.parse(text);
  } catch {
    // Some providers post form-encoded bodies.
    payload = Object.fromEntries(new URLSearchParams(text));
  }

  // Providers often nest the message one level down.
  const inner =
    (payload.message as Record<string, unknown>) ??
    (payload.data as Record<string, unknown>) ??
    payload;

  const from = digits(
    pick(inner, ["from", "sender", "sender_phone", "mobile", "phone", "wa_id", "waId", "source"]) ??
      pick(payload, ["from", "sender", "sender_phone", "mobile", "phone"])
  );
  const body =
    pick(inner, ["text", "body", "message", "msg", "content", "caption"]) ??
    pick(payload, ["text", "body", "msg", "content"]);
  const status = pick(inner, ["status", "event", "type"]);

  const db = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false },
  });

  // Match a client by the last 10 digits of the sender's number.
  let clientId: string | null = null;
  if (from.length >= 10) {
    const last10 = from.slice(-10);
    const { data: match } = await db
      .from("clients")
      .select("id, phone")
      .ilike("phone", `%${last10}%`)
      .limit(2);
    if (match?.length === 1) clientId = match[0].id;
  }

  await db.from("whatsapp_messages").insert({
    client_id: clientId,
    phone: from || "unknown",
    direction: "in",
    body,
    status,
    raw: payload,
  });

  return NextResponse.json({ ok: true, matched: Boolean(clientId) });
}

// Some providers verify webhooks with a GET challenge.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const challenge = searchParams.get("hub.challenge") ?? searchParams.get("challenge");
  return challenge
    ? new Response(challenge)
    : NextResponse.json({ ok: true });
}
