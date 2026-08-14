import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { runComplianceSync } from "@/lib/compliance/sync";
import { providerName } from "@/lib/compliance/provider";

// Daily PAN/GST poll that auto-generates compliance tasks. Scheduled by the
// Vercel Cron entry in vercel.json; each run takes the next slice of clients
// that have not been looked up within COMPLIANCE_REFRESH_HOURS, so the whole
// book is covered over a few days without re-billing the same clients daily.
//
// Query params (all optional):
//   ?limit=200      clients to look up in this run
//   ?dryRun=true    evaluate the rules and report, write nothing
//
// maxDuration needs a Vercel plan allowing >60s functions once the batch grows;
// lower COMPLIANCE_SYNC_LIMIT if a run risks exceeding the plan's ceiling.
export const maxDuration = 300;

const DEFAULT_LIMIT = Number(process.env.COMPLIANCE_SYNC_LIMIT ?? 150);

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);
  const dryRun = searchParams.get("dryRun") === "true";

  const db = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    const report = await runComplianceSync(db, {
      dryRun,
      limit: Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT,
      trigger: "cron",
    });
    // The mock provider is the default until vendor credentials are set — say
    // so loudly in the response rather than passing synthetic findings off as
    // real ones.
    return NextResponse.json({
      ok: true,
      mockData: providerName() === "mock",
      ...report,
      // The per-client detail is large; the run row keeps the full summary.
      clients: report.clients.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
