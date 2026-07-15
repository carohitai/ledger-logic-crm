import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { sendWhatsAppTemplate, toWhatsAppNumber, whatsappConfigured } from "@/lib/whatsapp";
import {
  WA_TEMPLATES,
  currentMonthLabel,
  currentQuarterLabel,
  isQuarterEndMonth,
  renderTemplate,
  type WaTemplateValues,
} from "@/lib/whatsapp-templates";

// Periodic GST return-filing reminder, sent automatically via Nextel's
// approved "gst_return" template. Scheduled by the Vercel Cron entry in
// vercel.json (daily), but only actually sends on GST_REMINDER_DAY — the
// daily trigger + internal date gate is more robust across Vercel plans than
// relying on a day-of-month cron expression, and makes ad-hoc reruns via
// ?force=true safe to reason about.
//
// maxDuration needs a Vercel plan that allows functions to run beyond 60s
// (Pro/Enterprise) once the active client count grows; drop SEND_DELAY_MS or
// shard the client query if a single run risks exceeding the plan's limit.
export const maxDuration = 300;

const GST_REMINDER = WA_TEMPLATES.find((t) => t.key === "gst_reminder")!;
const GST_REMINDER_NEXTEL = GST_REMINDER.nextel!;

// Day of month (IST) this fires on. Chosen to land a few days before the
// template's "submit before the 5th" ask, matching how staff currently send
// this manually near month-end.
const REMINDER_DAY = Number(process.env.GST_REMINDER_DAY ?? 27);
// Spacing between sends so a ~200+ client run doesn't hit Nextel rate limits.
const SEND_DELAY_MS = Number(process.env.GST_REMINDER_SEND_DELAY_MS ?? 300);

function istDayOfMonth(): number {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCDate();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ClientRow {
  id: string;
  name: string;
  phone: string | null;
  gst_frequency: string | null;
}

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "true";
  const today = istDayOfMonth();
  if (!force && today !== REMINDER_DAY) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `today (IST day ${today}) is not the reminder day (${REMINDER_DAY}); pass ?force=true to send anyway`,
    });
  }

  if (!whatsappConfigured()) {
    return NextResponse.json(
      { error: "WhatsApp (Nextel) is not configured. Set NEXTEL_SEND_URL and NEXTEL_API_KEY." },
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

  const quarterEnd = isQuarterEndMonth();
  const monthPeriod = currentMonthLabel();
  const quarterPeriod = currentQuarterLabel();

  // Candidates: active clients actually registered for GST. Frequency decides
  // whether this cycle is their turn — monthly filers every run, QRMP
  // (quarterly) filers only in the quarter's last month.
  const { data: clients, error: clientsError } = await db
    .from("clients")
    .select("id, name, phone, gst_frequency")
    .eq("gst_status", "registered")
    .eq("status", "active")
    .not("gst_frequency", "is", null)
    .returns<ClientRow[]>();

  if (clientsError) {
    return NextResponse.json({ error: clientsError.message }, { status: 500 });
  }

  const due = (clients ?? []).filter((c) => {
    const freq = (c.gst_frequency ?? "").toUpperCase();
    if (freq.includes("QUARTERLY")) return quarterEnd;
    if (freq.includes("MONTHLY")) return true;
    return false; // unrecognised value (e.g. "CANCELLED") — skip rather than guess
  });

  const summary = {
    totalCandidates: (clients ?? []).length,
    due: due.length,
    sent: 0,
    failed: 0,
    skippedNoPhone: 0,
    errors: [] as string[],
  };

  if (due.length === 0) {
    return NextResponse.json({ ok: true, quarterEnd, ...summary });
  }

  // Bulk-fetch incharges for all due clients in one query rather than N+1.
  const { data: allotments } = await db
    .from("client_allotments")
    .select("client_id, role, staff(full_name)")
    .in(
      "client_id",
      due.map((c) => c.id)
    );
  const inchargeMap = new Map<string, Record<string, string>>();
  for (const a of allotments ?? []) {
    const staff = a.staff as { full_name?: string } | { full_name?: string }[] | null;
    const name = Array.isArray(staff) ? staff[0]?.full_name : staff?.full_name;
    if (!name) continue;
    const entry = inchargeMap.get(a.client_id) ?? {};
    entry[a.role] = name;
    inchargeMap.set(a.client_id, entry);
  }

  for (const client of due) {
    if (!client.phone) {
      summary.skippedNoPhone++;
      continue;
    }
    const freq = (client.gst_frequency ?? "").toUpperCase();
    const period = freq.includes("QUARTERLY") ? quarterPeriod : monthPeriod;
    const incharges = inchargeMap.get(client.id) ?? {};
    const values: WaTemplateValues = {
      client: client.name,
      period,
      partner_incharge: incharges.partner ?? "-",
      accounts_incharge: incharges.accounts ?? "-",
      gst_incharge: incharges.gst ?? "-",
    };
    const body = renderTemplate(GST_REMINDER, values);
    try {
      await sendWhatsAppTemplate(client.phone, GST_REMINDER_NEXTEL, GST_REMINDER_NEXTEL.args(values));
      summary.sent++;
      await db.from("whatsapp_messages").insert({
        client_id: client.id,
        phone: toWhatsAppNumber(client.phone),
        direction: "out",
        body,
        template_id: GST_REMINDER.key,
        status: "sent",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      summary.failed++;
      summary.errors.push(`${client.name}: ${message}`);
      await db.from("whatsapp_messages").insert({
        client_id: client.id,
        phone: toWhatsAppNumber(client.phone),
        direction: "out",
        body,
        template_id: GST_REMINDER.key,
        status: "failed",
      });
    }
    await sleep(SEND_DELAY_MS);
  }

  return NextResponse.json({ ok: true, quarterEnd, ...summary });
}
