// Triage: attach an unattributed inbox item to a client.
//
// Beyond setting client_id on the one row, this *teaches* the matcher: the
// address or number is written to client_contacts, and every other unmatched
// item carrying the same address/number is attributed in the same pass. So the
// triage queue shrinks faster the more of it you do, instead of one row at a
// time forever.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { learnContact, normalizeEmail, normalizePhone } from "@/lib/match";

const TABLE_FOR: Record<string, string> = {
  email: "email_messages",
  whatsapp: "whatsapp_messages",
  call: "call_logs",
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await supabase
    .from("staff")
    .select("id, app_role")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  // Attribution decides who can see a message from then on, so it stays with
  // the people who already have firm-wide visibility.
  if (me?.app_role !== "admin" && me?.app_role !== "partner") {
    return NextResponse.json({ error: "Admins and partners only" }, { status: 403 });
  }

  const body = (await request.json()) as {
    channel?: string;
    id?: string;
    clientId?: string;
    counterparty?: string | null;
    learn?: boolean;
  };

  const table = TABLE_FOR[body.channel ?? ""];
  if (!table || !body.id || !body.clientId) {
    return NextResponse.json(
      { error: "channel, id and clientId are required" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from(table)
    .update({ client_id: body.clientId })
    .eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let learned: string | null = null;
  let backfilled = 0;

  if (body.learn !== false && body.counterparty) {
    const kind = body.channel === "email" ? "email" : "phone";
    learned = await learnContact(supabase, body.clientId, kind, body.counterparty);

    if (learned) {
      // Sweep the rest of the queue for the same correspondent.
      const norm = kind === "email" ? normalizeEmail(body.counterparty) : normalizePhone(body.counterparty);
      if (norm) {
        if (kind === "email") {
          const { data: siblings } = await supabase
            .from("email_messages")
            .select("id")
            .is("client_id", null)
            .eq("from_address", norm);
          const ids = (siblings ?? []).map((s) => s.id as string);
          if (ids.length) {
            await supabase.from("email_messages").update({ client_id: body.clientId }).in("id", ids);
            backfilled = ids.length;
          }
        } else {
          // Phone columns hold assorted formats, so match on the normalised
          // tail rather than an exact string compare.
          const { data: siblings } = await supabase
            .from("whatsapp_messages")
            .select("id, phone")
            .is("client_id", null)
            .ilike("phone", `%${norm}%`);
          const ids = (siblings ?? []).map((s) => s.id as string);
          if (ids.length) {
            await supabase.from("whatsapp_messages").update({ client_id: body.clientId }).in("id", ids);
            backfilled += ids.length;
          }
          const { data: calls } = await supabase
            .from("call_logs")
            .select("id")
            .is("client_id", null)
            .ilike("callee", `%${norm}%`);
          const callIds = (calls ?? []).map((c) => c.id as string);
          if (callIds.length) {
            await supabase.from("call_logs").update({ client_id: body.clientId }).in("id", callIds);
            backfilled += callIds.length;
          }
        }
      }
    }
  }

  return NextResponse.json({ ok: true, learned, backfilled });
}
