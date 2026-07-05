import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { dial, recentCdr, type CdrRecord } from "@/lib/yeastar";
import { sendCallbackTemplate, whatsappConfigured } from "@/lib/whatsapp";

export const maxDuration = 60;

const RETRY_MINUTES = Number(process.env.FOLLOWUP_RETRY_MINUTES ?? 120);
const MAX_ATTEMPTS = Number(process.env.FOLLOWUP_MAX_ATTEMPTS ?? 3);
// Calls are only auto-redialed inside working hours (IST).
const WORK_START_H = Number(process.env.FOLLOWUP_WORK_START ?? 10);
const WORK_END_H = Number(process.env.FOLLOWUP_WORK_END ?? 19);

const UNANSWERED = new Set(["NO ANSWER", "BUSY", "FAILED", "VOICEMAIL"]);

function inWorkingHours(): boolean {
  const istHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Kolkata",
    }).format(new Date())
  );
  return istHour >= WORK_START_H && istHour < WORK_END_H;
}

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  }
  const db = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false },
  });

  const summary = { resolvedAnswered: 0, resolvedUnanswered: 0, whatsapp: 0, retriesScheduled: 0, escalations: 0, redialed: 0, errors: [] as string[] };

  // --- 1. Resolve outcomes of placed calls (>45s old so the CDR exists) ---
  const cutoff = new Date(Date.now() - 45_000).toISOString();
  const floor = new Date(Date.now() - 48 * 3600_000).toISOString();
  const { data: pending } = await db
    .from("call_logs")
    .select("id, client_id, staff_id, pbx_call_id, caller_ext, callee, attempt, placed_at, clients(name, phone), staff(full_name)")
    .eq("status", "placed")
    .lt("placed_at", cutoff)
    .gt("placed_at", floor)
    .limit(200);

  if (pending?.length) {
    const oldest = Math.floor(Math.min(...pending.map((p) => +new Date(p.placed_at))) / 1000) - 120;
    let cdr: CdrRecord[];
    try {
      cdr = await recentCdr(oldest);
    } catch (e) {
      summary.errors.push(`CDR: ${e instanceof Error ? e.message : e}`);
      cdr = [];
    }
    const byCallId = new Map(cdr.map((r) => [r.call_id, r]));

    for (const log of pending) {
      const rec = log.pbx_call_id ? byCallId.get(log.pbx_call_id) : undefined;
      const client = log.clients as unknown as { name: string; phone: string | null } | null;
      const staff = log.staff as unknown as { full_name: string } | null;
      if (!rec) {
        // No CDR after 48h floor handling below; skip for now if still fresh.
        if (+new Date(log.placed_at) < Date.now() - 3600_000) {
          await db.from("call_logs").update({ status: "abandoned", resolved_at: new Date().toISOString() }).eq("id", log.id);
        }
        continue;
      }

      if (!UNANSWERED.has(rec.disposition)) {
        await db.from("call_logs").update({ status: "answered", disposition: rec.disposition, resolved_at: new Date().toISOString() }).eq("id", log.id);
        summary.resolvedAnswered++;
        continue;
      }

      // Unanswered → alert + WhatsApp + retry or escalate
      await db.from("call_logs").update({ status: "unanswered", disposition: rec.disposition, resolved_at: new Date().toISOString() }).eq("id", log.id);
      summary.resolvedUnanswered++;

      await db.from("alerts").insert({
        staff_id: log.staff_id,
        client_id: log.client_id,
        call_log_id: log.id,
        type: "unanswered_call",
        message: `Call to ${client?.name ?? log.callee} was not answered (attempt ${log.attempt}).`,
      });

      let whatsappSent = false;
      let whatsappError: string | null = null;
      if (whatsappConfigured() && client?.phone && log.attempt === 1) {
        try {
          await sendCallbackTemplate(client.phone, [client.name]);
          whatsappSent = true;
          summary.whatsapp++;
        } catch (e) {
          whatsappError = e instanceof Error ? e.message : String(e);
          summary.errors.push(`WA ${client?.name}: ${whatsappError}`);
        }
        await db.from("call_logs").update({ whatsapp_sent: whatsappSent, whatsapp_error: whatsappError }).eq("id", log.id);
      }

      if (log.attempt < MAX_ATTEMPTS) {
        await db.from("call_logs").insert({
          client_id: log.client_id,
          staff_id: log.staff_id,
          caller_ext: log.caller_ext,
          callee: log.callee,
          status: "scheduled",
          attempt: log.attempt + 1,
          parent_id: log.id,
          scheduled_at: new Date(Date.now() + RETRY_MINUTES * 60_000).toISOString(),
        });
        summary.retriesScheduled++;
      } else {
        // Escalate to the client's partner incharge.
        const { data: partner } = await db
          .from("client_allotments")
          .select("staff_id")
          .eq("client_id", log.client_id)
          .eq("role", "partner")
          .maybeSingle();
        if (partner) {
          await db.from("alerts").insert({
            staff_id: partner.staff_id,
            client_id: log.client_id,
            call_log_id: log.id,
            type: "escalation",
            message: `${client?.name ?? "Client"} unreachable after ${MAX_ATTEMPTS} attempts by ${staff?.full_name ?? "staff"}.`,
          });
          summary.escalations++;
        }
      }
    }
  }

  // --- 2. Place due scheduled callbacks (working hours only) ---
  if (inWorkingHours()) {
    const { data: due } = await db
      .from("call_logs")
      .select("id, caller_ext, callee")
      .eq("status", "scheduled")
      .lt("scheduled_at", new Date().toISOString())
      .limit(20);

    for (const cb of due ?? []) {
      try {
        const callId = await dial(cb.caller_ext, cb.callee);
        await db.from("call_logs").update({ status: "placed", pbx_call_id: callId, placed_at: new Date().toISOString() }).eq("id", cb.id);
        summary.redialed++;
      } catch (e) {
        summary.errors.push(`redial ${cb.callee}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  return NextResponse.json({ ok: true, ...summary });
}
