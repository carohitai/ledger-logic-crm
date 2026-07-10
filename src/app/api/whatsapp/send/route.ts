import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendCallbackTemplate, toWhatsAppNumber, whatsappConfigured } from "@/lib/whatsapp";
import { WA_TEMPLATES, renderTemplate } from "@/lib/whatsapp-templates";

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
    .select("id, name, phone")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
  if (!client.phone) {
    return NextResponse.json({ error: "This client has no phone number" }, { status: 400 });
  }

  try {
    await sendCallbackTemplate(client.phone, [client.name]);
    await supabase.from("whatsapp_messages").insert({
      client_id: client.id,
      phone: toWhatsAppNumber(client.phone),
      direction: "out",
      body: renderTemplate(template, client.name),
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
