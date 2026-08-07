// Single scheduled entry point.
//
// Vercel caps how many cron entries a plan may have and, on Hobby, permits
// only ONE firing per day. So rather than registering a cron per job, this
// registers one entry and decides internally what is due — the pattern
// /api/cron/gst-reminder already documents, and the reason the Hobby limit is
// a one-line schedule change rather than a redesign. Adding a job later needs
// no vercel.json change at all.
//
// Daily jobs are gated on "has this already run today, IST?" rather than on a
// particular hour, so the same code is correct whether the schedule fires
// every 15 minutes (Pro) or once a day (Hobby).
//
// Every job is individually try/caught: one failing integration must not stop
// the others from running.
//
//   GET /api/cron/tick                     run whatever is due
//   GET /api/cron/tick?only=mail&force=1   run one job on demand
//
// Authorised with the same `Bearer ${CRON_SECRET}` header as the other crons.

import { NextResponse } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { runMailSync } from "@/lib/inbox/mail-sync";
import { runCdrSync } from "@/lib/inbox/cdr-sync";
import { runTaskGeneration } from "@/lib/tasks/generate";
import { runDeptReconcile } from "@/lib/dept/reconcile";

export const maxDuration = 300;

type Job = "mail" | "cdr" | "tasks" | "dept";

function istDate(when: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);
}

/**
 * "Has this job already run today, IST?" rather than "is it a particular hour
 * right now?".
 *
 * The hour-gate version only worked at a high tick cadence — on a plan limited
 * to ONE cron firing per day, a job gated on `hour === 3` would simply never
 * run unless the single fire happened to land in that hour. This form is
 * correct at any cadence: fire every 15 minutes and the daily jobs still run
 * once; fire once a day and they run on that fire.
 */
async function dueToday(
  db: SupabaseClient,
  job: Job
): Promise<boolean> {
  const { data } = await db
    .from("sync_state")
    .select("last_run_at")
    .eq("key", `job:${job}`)
    .maybeSingle();
  if (!data?.last_run_at) return true;
  return istDate(new Date(data.last_run_at)) !== istDate();
}

async function markRan(
  db: SupabaseClient,
  job: Job
): Promise<void> {
  await db.from("sync_state").upsert({
    key: `job:${job}`,
    last_run_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

function enabled(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1";
}

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const only = searchParams.get("only") as Job | null;
  const force = searchParams.get("force") === "true" || searchParams.get("force") === "1";

  const db = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false },
  });

  const results: Record<string, unknown> = {};
  const ran: Job[] = [];
  const skipped: string[] = [];

  /** `daily` jobs run once per IST day; the others run on every tick. */
  const shouldRun = async (job: Job, flag: string, daily: boolean) => {
    if (only) return only === job;
    if (!enabled(flag)) {
      skipped.push(`${job}: disabled (${flag})`);
      return false;
    }
    if (daily && !force && !(await dueToday(db, job))) {
      skipped.push(`${job}: already ran today (IST)`);
      return false;
    }
    return true;
  };

  const run = async (job: Job, flag: string, daily: boolean, fn: () => Promise<unknown>) => {
    if (!(await shouldRun(job, flag, daily))) return;
    ran.push(job);
    try {
      results[job] = await fn();
    } catch (e) {
      results[job] = { error: e instanceof Error ? e.message : String(e) };
    }
    // Marked even on failure, so a persistently broken integration cannot
    // monopolise every tick. The next day's run retries it.
    await markRan(db, job);
  };

  // Mail and CDR want low latency, so they run on every tick when the schedule
  // allows more than one a day.
  await run("mail", "MAIL_SYNC_ENABLED", false, () => runMailSync(db));
  await run("cdr", "CDR_SYNC_ENABLED", false, () => runCdrSync(db));

  // The statutory calendar does not move minute to minute.
  await run("tasks", "TASKS_ENABLED", true, () =>
    runTaskGeneration(db, { dryRun: searchParams.get("dryRun") === "true" })
  );
  await run("dept", "DEPT_SYNC_ENABLED", true, () => runDeptReconcile(db, "gst"));

  return NextResponse.json({ ok: true, istDate: istDate(), ran, skipped, results });
}
