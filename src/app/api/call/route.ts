import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dial, normalizeNumber } from "@/lib/yeastar";

// Click-to-call: originate a PBX call from the signed-in user's extension to a
// client's phone. The caller extension is derived from the session (never the
// request body), and the client is fetched under the user's RLS so a user can
// only dial clients they're allowed to see.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let clientId: string | undefined;
  try {
    ({ clientId } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!clientId) {
    return NextResponse.json({ error: "Missing clientId" }, { status: 400 });
  }

  const { data: me } = await supabase
    .from("staff")
    .select("id, extension, full_name")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!me?.extension) {
    return NextResponse.json(
      { error: "No PBX extension is set for your account. Ask an admin to add one." },
      { status: 400 }
    );
  }

  const { data: client } = await supabase
    .from("clients")
    .select("name, phone")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
  if (!client.phone) {
    return NextResponse.json({ error: "This client has no phone number" }, { status: 400 });
  }

  const callee = normalizeNumber(client.phone);
  if (callee.replace(/\D/g, "").length < 6) {
    return NextResponse.json({ error: `Invalid phone number: ${client.phone}` }, { status: 400 });
  }

  try {
    const callId = await dial(me.extension, callee);
    // Log the attempt so the follow-up cron can track its outcome via CDR.
    await supabase.from("call_logs").insert({
      client_id: clientId,
      staff_id: me.id,
      pbx_call_id: callId,
      caller_ext: me.extension,
      callee,
    });
    return NextResponse.json({ ok: true, callId, extension: me.extension, callee });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Call could not be placed" },
      { status: 502 }
    );
  }
}
