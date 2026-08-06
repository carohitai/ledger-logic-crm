import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { sendWhatsAppTemplate, toWhatsAppNumber, whatsappConfigured } from "@/lib/whatsapp";
import { WA_TEMPLATES, renderTemplate, type WaTemplateValues } from "@/lib/whatsapp-templates";

// One-off bulk send of the Income Tax return reminder (approved Nextel
// template "itr_template") to business, non-salary, non-audit ITR clients —
// i.e. active clients with it_category = 'NON AUDIT'.
//
// Safe by default: GET without ?send=true is a dry run that returns the
// recipient list without sending anything. Clients who already received a
// sent it_reminder are skipped, so reruns after a partial failure only cover
// the remainder.
export const maxDuration = 300;

const IT_REMINDER = WA_TEMPLATES.find((t) => t.key === "it_reminder")!;
const IT_REMINDER_NEXTEL = IT_REMINDER.nextel!;

// Spacing between sends so a ~200+ client run doesn't hit Nextel rate limits.
const SEND_DELAY_MS = Number(process.env.ITR_BLAST_SEND_DELAY_MS ?? 300);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ClientRow {
  id: string;
  name: string;
  phone: string | null;
}

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const send = searchParams.get("send") === "true";

  if (!whatsappConfigured()) {
    return NextResponse.json(
      { error: "WhatsApp (Nextel) is not configured. Set NEXTEL_SEND_URL and NEXTEL_API_KEY." },
      { status: 503 }
    );
  }
  const media = process.env.ITR_TEMPLATE_MEDIA;
  if (!media) {
    return NextResponse.json(
      { error: "ITR_TEMPLATE_MEDIA is not configured (header image for the itr_template)" },
      { status: 503 }
    );
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  }
  const db = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: clients, error: clientsError } = await db
    .from("clients")
    .select("id, name, phone")
    .eq("status", "active")
    .eq("it_category", "NON AUDIT")
    .not("phone", "is", null)
    .returns<ClientRow[]>();

  if (clientsError) {
    return NextResponse.json({ error: clientsError.message }, { status: 500 });
  }

  // Skip clients who already got this reminder (rerun-safe).
  const { data: alreadySent, error: sentError } = await db
    .from("whatsapp_messages")
    .select("client_id")
    .eq("template_id", IT_REMINDER.key)
    .eq("direction", "out")
    .eq("status", "sent");
  if (sentError) {
    return NextResponse.json({ error: sentError.message }, { status: 500 });
  }
  const sentIds = new Set((alreadySent ?? []).map((r) => r.client_id));

  const due = (clients ?? []).filter(
    (c) => !sentIds.has(c.id) && toWhatsAppNumber(c.phone!).length >= 12
  );

  const summary = {
    dryRun: !send,
    totalNonAudit: (clients ?? []).length,
    alreadySent: sentIds.size,
    due: due.length,
    sent: 0,
    failed: 0,
    errors: [] as string[],
  };

  if (!send) {
    return NextResponse.json({
      ok: true,
      ...summary,
      recipients: due.map((c) => ({ name: c.name, phone: toWhatsAppNumber(c.phone!) })),
      hint: "Dry run — pass ?send=true to actually send.",
    });
  }

  for (const client of due) {
    const values: WaTemplateValues = { client: client.name, media };
    const body = renderTemplate(IT_REMINDER, values);
    try {
      await sendWhatsAppTemplate(client.phone!, IT_REMINDER_NEXTEL, IT_REMINDER_NEXTEL.args(values));
      summary.sent++;
      await db.from("whatsapp_messages").insert({
        client_id: client.id,
        phone: toWhatsAppNumber(client.phone!),
        direction: "out",
        body,
        template_id: IT_REMINDER.key,
        status: "sent",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      summary.failed++;
      summary.errors.push(`${client.name}: ${message}`);
      await db.from("whatsapp_messages").insert({
        client_id: client.id,
        phone: toWhatsAppNumber(client.phone!),
        direction: "out",
        body,
        template_id: IT_REMINDER.key,
        status: "failed",
      });
    }
    await sleep(SEND_DELAY_MS);
  }

  return NextResponse.json({ ok: true, ...summary });
}
