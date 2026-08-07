// Single scheduled entry point.
//
// Vercel caps how many cron entries a plan may have (and on Hobby, how often
// they may fire), so rather than registering one cron per job this registers
// ONE and gates each job internally on the IST clock. That follows the pattern
// /api/cron/gst-reminder already documents — a frequent trigger with an
// internal date gate is more robust across plans than a clever cron expression
// — and means adding a job later needs no vercel.json change at all.
//
// Every job is individually try/caught: one failing integration must not stop
// the others from running.
//
//   GET /api/cron/tick                     run whatever is due
//   GET /api/cron/tick?only=mail&force=1   run one job on demand
//
// Authorised with the same `Bearer ${CRON_SECRET}` header as the other crons.

import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { runMailSync } from "@/lib/inbox/mail-sync";
import { runCdrSync } from "@/lib/inbox/cdr-sync";
import { runTaskGeneration } from "@/lib/tasks/generate";
import { runDeptReconcile } from "@/lib/dept/reconcile";

export const maxDuration = 300;

type Job = "mail" | "cdr" | "tasks" | "dept";

/** Hour of the IST day the daily jobs run at. */
const DAILY_HOUR = Number(process.env.CRON_DAILY_HOUR_IST ?? 3);

function istHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).format(new Date())
  );
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

  const hour = istHour();
  const isDailyWindow = hour === DAILY_HOUR;
  const results: Record<string, unknown> = {};
  const ran: Job[] = [];
  const skipped: string[] = [];

  const shouldRun = (job: Job, dueNow: boolean, flag: string, flagDefault = false) => {
    if (only) return only === job;
    if (!enabled(flag, flagDefault)) {
      skipped.push(`${job}: disabled (${flag})`);
      return false;
    }
    if (!dueNow) {
      skipped.push(`${job}: not due (IST hour ${hour})`);
      return false;
    }
    return true;
  };

  // Mail and CDR are cheap and want low latency, so they run every tick.
  if (shouldRun("mail", true, "MAIL_SYNC_ENABLED")) {
    ran.push("mail");
    try {
      results.mail = await runMailSync(db);
    } catch (e) {
      results.mail = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  if (shouldRun("cdr", true, "CDR_SYNC_ENABLED")) {
    ran.push("cdr");
    try {
      results.cdr = await runCdrSync(db);
    } catch (e) {
      results.cdr = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Generation and department reconciliation are daily; the statutory calendar
  // does not move minute to minute.
  if (shouldRun("tasks", force || isDailyWindow, "TASKS_ENABLED")) {
    ran.push("tasks");
    try {
      results.tasks = await runTaskGeneration(db, {
        dryRun: searchParams.get("dryRun") === "true",
      });
    } catch (e) {
      results.tasks = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  if (shouldRun("dept", force || isDailyWindow, "DEPT_SYNC_ENABLED")) {
    ran.push("dept");
    try {
      results.dept = await runDeptReconcile(db, "gst");
    } catch (e) {
      results.dept = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({ ok: true, istHour: hour, ran, skipped, results });
}
