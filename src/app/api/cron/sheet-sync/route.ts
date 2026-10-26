import { NextResponse } from "next/server";
import { createServiceClient, serviceConfigured } from "@/lib/supabase/service";
import { runSheetSync } from "@/lib/import/sheet-sync";

// Pulls the master client list from SharePoint when its content changed and
// notifies the teams concerned. Scheduled daily by vercel.json (Vercel Hobby
// allows daily crons only; raise the frequency on Pro); for near-instant syncs
// a Power Automate "when a file is modified" flow can call this with the same
// bearer secret. `?force=true` re-imports even if the eTag matches.
//
// A full import of ~1,000 rows plus Teams fan-out takes well under a minute;
// maxDuration leaves headroom for a busy digest.
export const maxDuration = 300;

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!serviceConfigured()) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  }
  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "true";

  try {
    const result = await runSheetSync(createServiceClient(), { force });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}

// Power Automate's HTTP action defaults to POST; accept it too.
export const POST = GET;
