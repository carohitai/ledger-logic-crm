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

// Send a WhatsApp follow-up to a client via Nextel. The client is fetched
// under the user's RLS, so a user can only message clients they can see.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let clientId: string | undefined;
  let templateKey: string | undefined;
  try {
    ({ clientId, templateKey } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const template = WA_TEMPLATES.find((t) => t.key === templateKey);
  if (!clientId || !template) {
    return NextResponse.json({ error: "Missing clientId or unknown template" }, { status: 400 });
  }
  if (!template.nextel) {
    return NextResponse.json(
      { error: `"${template.label}" is not yet approved on Nextel — use "Open in WhatsApp" instead.` },
      { status: 400 }
    );
  }
  if (!whatsappConfigured()) {
    return NextResponse.json(
      { error: "WhatsApp (Nextel) is not configured. Set NEXTEL_SEND_URL and NEXTEL_API_KEY." },
      { status: 503 }
    );
  }

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, phone, gst_frequency")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
  if (!client.phone) {
    return NextResponse.json({ error: "This client has no phone number" }, { status: 400 });
  }

  // Incharge names + filing period feed the templates that need them
  // (gst_reminder); templates with fewer placeholders just ignore them.
  const { data: allotments } = await supabase
    .from("client_allotments")
    .select("role, staff(full_name)")
    .eq("client_id", client.id);
  const incharges: Record<string, string> = {};
  for (const a of allotments ?? []) {
    const staff = a.staff as { full_name?: string } | { full_name?: string }[] | null;
    const name = Array.isArray(staff) ? staff[0]?.full_name : staff?.full_name;
    if (name) incharges[a.role] = name;
  }
  const quarterly = (client.gst_frequency ?? "").toUpperCase().includes("QUARTERLY");
  const values: WaTemplateValues = {
    client: client.name,
    period: quarterly ? currentQuarterLabel() : currentMonthLabel(),
    partner_incharge: incharges.partner ?? "-",
    accounts_incharge: incharges.accounts ?? "-",
    gst_incharge: incharges.gst ?? "-",
  };

  try {
    await sendWhatsAppTemplate(client.phone, template.nextel, template.nextel.args(values));
    await supabase.from("whatsapp_messages").insert({
      client_id: client.id,
      phone: toWhatsAppNumber(client.phone),
      direction: "out",
      body: renderTemplate(template, values),
      template_id: template.key,
      status: "sent",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "WhatsApp send failed" },
      { status: 502 }
    );
  }
}
