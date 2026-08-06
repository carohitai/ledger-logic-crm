import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Feed behind the notification bell: recent client edits / additions / bulk
// sends, plus how many of them the caller has not seen yet.
// GET  -> { items, unread, lastSeenAt }
// POST -> marks everything up to now as seen.

const LIMIT = 25;

async function staffId(supabase: Awaited<ReturnType<typeof createClient>>, authId: string) {
  const { data } = await supabase.from("staff").select("id").eq("auth_user_id", authId).maybeSingle();
  return data?.id ?? null;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const me = await staffId(supabase, user.id);

  const [{ data: rows }, { data: seen }] = await Promise.all([
    supabase
      .from("client_activity")
      .select("id, client_id, action, summary, created_at, staff:actor_staff_id (full_name), client:client_id (name)")
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    me
      ? supabase.from("notification_reads").select("seen_at").eq("staff_id", me).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const lastSeenAt = seen?.seen_at ?? null;
  const items = (rows ?? []).map((r) => {
    const staff = r.staff as { full_name?: string } | { full_name?: string }[] | null;
    const client = r.client as { name?: string } | { name?: string }[] | null;
    return {
      id: r.id,
      clientId: r.client_id,
      action: r.action,
      summary: r.summary,
      createdAt: r.created_at,
      actor: (Array.isArray(staff) ? staff[0]?.full_name : staff?.full_name) ?? "Someone",
      client: (Array.isArray(client) ? client[0]?.name : client?.name) ?? null,
    };
  });

  const unread = lastSeenAt
    ? items.filter((i) => new Date(i.createdAt) > new Date(lastSeenAt)).length
    : items.length;

  return NextResponse.json({ items, unread, lastSeenAt });
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const me = await staffId(supabase, user.id);
  if (!me) return NextResponse.json({ ok: true, skipped: "no staff record" });

  const { error } = await supabase
    .from("notification_reads")
    .upsert({ staff_id: me, seen_at: new Date().toISOString() }, { onConflict: "staff_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
