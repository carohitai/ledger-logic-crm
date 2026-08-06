import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendWhatsAppTemplate, toWhatsAppNumber, whatsappConfigured } from "@/lib/whatsapp";
import {
  WA_TEMPLATES,
  currentMonthLabel,
  currentQuarterLabel,
  renderTemplate,
  type WaTemplateValues,
} from "@/lib/whatsapp-templates";

// Bulk WhatsApp send driven from the UI (client list selection or the Bulk
// Send screen). Clients are read under the caller's RLS, so a user can only
// message clients they are allowed to see. Pass `dryRun` to preview.
export const maxDuration = 300;

const SEND_DELAY_MS = Number(process.env.BULK_SEND_DELAY_MS ?? 300);
const MAX_RECIPIENTS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let clientIds: string[] = [];
  let templateKey = "";
  let dryRun = false;
  try {
    const body = await request.json();
    clientIds = Array.isArray(body.clientIds) ? body.clientIds.map(String) : [];
    templateKey = String(body.templateKey ?? "");
    dryRun = Boolean(body.dryRun);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const template = WA_TEMPLATES.find((t) => t.key === templateKey);
  if (!template) {
    return NextResponse.json({ error: "Unknown template" }, { status: 400 });
  }
  if (!template.nextel) {
    return NextResponse.json(
      { error: `"${template.label}" is not approved on Nextel yet — it cannot be bulk sent.` },
      { status: 400 }
    );
  }
  if (!clientIds.length) {
    return NextResponse.json({ error: "No clients selected" }, { status: 400 });
  }
  if (clientIds.length > MAX_RECIPIENTS) {
    return NextResponse.json(
      { error: `Too many recipients (${clientIds.length}); the limit is ${MAX_RECIPIENTS}.` },
      { status: 400 }
    );
  }
  if (!whatsappConfigured()) {
    return NextResponse.json(
      { error: "WhatsApp (Nextel) is not configured. Set NEXTEL_SEND_URL and NEXTEL_API_KEY." },
      { status: 503 }
    );
  }
  const media = process.env.ITR_TEMPLATE_MEDIA;
  if (template.key === "it_reminder" && !media) {
    return NextResponse.json(
      { error: "ITR_TEMPLATE_MEDIA is not configured (header image for the itr_template)" },
      { status: 503 }
    );
  }

  // RLS scopes this to clients the caller may see.
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, name, phone, gst_frequency")
    .in("id", clientIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const withPhone = (clients ?? []).filter(
    (c) => c.phone && toWhatsAppNumber(c.phone).length >= 12
  );
  const skippedNoPhone = (clients ?? []).length - withPhone.length;

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      requested: clientIds.length,
      visible: (clients ?? []).length,
      skippedNoPhone,
      due: withPhone.length,
      recipients: withPhone.map((c) => ({ name: c.name, phone: toWhatsAppNumber(c.phone!) })),
    });
  }

  // Incharge names feed templates that reference them (gst_reminder).
  const { data: allotments } = await supabase
    .from("client_allotments")
    .select("client_id, role, staff(full_name)")
    .in("client_id", withPhone.map((c) => c.id));
  const inchargeMap = new Map<string, Record<string, string>>();
  for (const a of allotments ?? []) {
    const staff = a.staff as { full_name?: string } | { full_name?: string }[] | null;
    const name = Array.isArray(staff) ? staff[0]?.full_name : staff?.full_name;
    if (!name) continue;
    const entry = inchargeMap.get(a.client_id) ?? {};
    entry[a.role] = name;
    inchargeMap.set(a.client_id, entry);
  }

  const summary = {
    requested: clientIds.length,
    due: withPhone.length,
    sent: 0,
    failed: 0,
    skippedNoPhone,
    errors: [] as string[],
  };

  for (const client of withPhone) {
    const quarterly = (client.gst_frequency ?? "").toUpperCase().includes("QUARTERLY");
    const incharges = inchargeMap.get(client.id) ?? {};
    const values: WaTemplateValues = {
      client: client.name,
      period: quarterly ? currentQuarterLabel() : currentMonthLabel(),
      partner_incharge: incharges.partner ?? "-",
      accounts_incharge: incharges.accounts ?? "-",
      gst_incharge: incharges.gst ?? "-",
      media,
    };
    const body = renderTemplate(template, values);
    try {
      await sendWhatsAppTemplate(client.phone!, template.nextel, template.nextel.args(values));
      summary.sent++;
      await supabase.from("whatsapp_messages").insert({
        client_id: client.id,
        phone: toWhatsAppNumber(client.phone!),
        direction: "out",
        body,
        template_id: template.key,
        status: "sent",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      summary.failed++;
      if (summary.errors.length < 20) summary.errors.push(`${client.name}: ${message}`);
      await supabase.from("whatsapp_messages").insert({
        client_id: client.id,
        phone: toWhatsAppNumber(client.phone!),
        direction: "out",
        body,
        template_id: template.key,
        status: "failed",
      });
    }
    await sleep(SEND_DELAY_MS);
  }

  // One activity entry for the run, so the bell shows campaign sends too.
  const { data: actor } = await supabase
    .from("staff")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  await supabase.from("client_activity").insert({
    client_id: null,
    actor_staff_id: actor?.id ?? null,
    action: "bulk_message",
    summary: `${template.label} sent to ${summary.sent} client${summary.sent === 1 ? "" : "s"}`,
    changes: { sent: summary.sent, failed: summary.failed },
  });

  return NextResponse.json({ ok: true, ...summary });
}
