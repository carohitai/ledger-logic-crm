// Ingests the PBX's full call record into call_logs.
//
// Until now call_logs only held calls the CRM itself placed via click-to-call,
// so the timeline missed every call staff made from their handset and every
// call a client made in. This walks Yeastar's CDR and records both.
//
// It upserts on pbx_call_id, so when a call DID originate from click-to-call
// the existing row is enriched (duration, disposition) rather than duplicated.
// Rows created here carry source='cdr'; the follow-up cron filters on
// source='crm' precisely so it never mistakes an observed call for one of its
// own pending click-to-calls.

import type { SupabaseClient } from "@supabase/supabase-js";
import { recentCdr, yeastarConfigured, type CdrRecord } from "../yeastar";
import { matchClientByPhone, normalizePhone } from "../match";

const SYNC_KEY = "yeastar_cdr";
const LOOKBACK_HOURS = Number(process.env.CDR_LOOKBACK_HOURS ?? 24);
const MAX_RECORDS = Number(process.env.CDR_MAX_RECORDS_PER_RUN ?? 500);

/** Yeastar dispositions that mean the call did not connect. */
const UNANSWERED = new Set(["NO ANSWER", "BUSY", "FAILED", "VOICEMAIL"]);

export interface CdrSyncSummary {
  fetched: number;
  inserted: number;
  enriched: number;
  matched: number;
  unmatched: number;
  skippedInternal: number;
  through: string | null;
  errors: string[];
}

interface StaffExt {
  id: string;
  extension: string;
}

/**
 * Internal legs are PBX extensions: short numbers, or anything we know belongs
 * to a staff member. Everything else is the outside world.
 */
function isInternal(number: string, extensions: Set<string>): boolean {
  const digits = (number ?? "").replace(/\D/g, "");
  if (!digits) return false;
  return extensions.has(digits) || digits.length <= 5;
}

export async function runCdrSync(db: SupabaseClient): Promise<CdrSyncSummary> {
  const summary: CdrSyncSummary = {
    fetched: 0,
    inserted: 0,
    enriched: 0,
    matched: 0,
    unmatched: 0,
    skippedInternal: 0,
    through: null,
    errors: [],
  };

  if (!yeastarConfigured()) {
    summary.errors.push("Yeastar is not configured (YEASTAR_API_URL / CLIENT_ID / SECRET)");
    return summary;
  }

  const { data: state } = await db
    .from("sync_state")
    .select("cursor")
    .eq("key", SYNC_KEY)
    .maybeSingle();

  const since = state?.cursor
    ? Number(state.cursor)
    : Math.floor((Date.now() - LOOKBACK_HOURS * 3_600_000) / 1000);

  let records: CdrRecord[];
  try {
    records = await recentCdr(since);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    summary.errors.push(message);
    await db.from("sync_state").upsert({
      key: SYNC_KEY,
      cursor: String(since),
      last_run_at: new Date().toISOString(),
      last_error: message,
      updated_at: new Date().toISOString(),
    });
    return summary;
  }

  // Oldest first, so a mid-run failure leaves the cursor on a contiguous prefix
  // rather than skipping the gap.
  records.sort((a, b) => a.timestamp - b.timestamp);
  const batch = records.slice(0, MAX_RECORDS);
  summary.fetched = batch.length;

  const { data: staffRows } = await db
    .from("staff")
    .select("id, extension")
    .not("extension", "is", null)
    .eq("is_active", true)
    .returns<StaffExt[]>();

  const extensions = new Set((staffRows ?? []).map((s) => s.extension));
  // One extension is duplicated in the live staff table. Map only the
  // unambiguous ones — a tie leaves staff_id null rather than crediting the
  // call to the wrong person.
  const extCount = new Map<string, number>();
  for (const s of staffRows ?? []) {
    extCount.set(s.extension, (extCount.get(s.extension) ?? 0) + 1);
  }
  const staffByExt = new Map(
    (staffRows ?? [])
      .filter((s) => extCount.get(s.extension) === 1)
      .map((s) => [s.extension, s.id])
  );

  let cursor = since;

  for (const rec of batch) {
    if (!rec.call_id || !rec.timestamp) continue;

    const fromInternal = isInternal(rec.call_from_number, extensions);
    const toInternal = isInternal(rec.call_to_number, extensions);

    if (fromInternal && toInternal) {
      // Extension-to-extension: real, but not client correspondence.
      summary.skippedInternal++;
      cursor = Math.max(cursor, rec.timestamp);
      continue;
    }

    const direction = fromInternal ? "out" : "in";
    const externalRaw = fromInternal ? rec.call_to_number : rec.call_from_number;
    const internalRaw = fromInternal ? rec.call_from_number : rec.call_to_number;
    const counterparty = normalizePhone(externalRaw) ?? externalRaw;

    const clientId = await matchClientByPhone(db, externalRaw);
    if (clientId) summary.matched++;
    else summary.unmatched++;

    const staffId = staffByExt.get((internalRaw ?? "").replace(/\D/g, "")) ?? null;
    const answered = !UNANSWERED.has(rec.disposition);
    const placedAt = new Date(rec.timestamp * 1000).toISOString();

    // Only ever fill columns the click-to-call flow does not own. If a row for
    // this pbx_call_id already exists, its status/attempt/staff belong to the
    // follow-up state machine and must not be rewritten from here.
    const { data: existing } = await db
      .from("call_logs")
      .select("id")
      .eq("pbx_call_id", rec.call_id)
      .maybeSingle();

    if (existing) {
      const { error } = await db
        .from("call_logs")
        .update({
          disposition: rec.disposition,
          duration_seconds: rec.duration ?? null,
          direction,
        })
        .eq("id", existing.id);
      if (error) summary.errors.push(`${rec.call_id}: ${error.message}`);
      else summary.enriched++;
    } else {
      const { error } = await db.from("call_logs").insert({
        client_id: clientId,
        staff_id: staffId,
        pbx_call_id: rec.call_id,
        caller_ext: fromInternal ? internalRaw : null,
        callee: counterparty,
        direction,
        status: answered ? "answered" : "unanswered",
        disposition: rec.disposition,
        duration_seconds: rec.duration ?? null,
        placed_at: placedAt,
        resolved_at: placedAt,
        source: "cdr",
        attempt: 1,
      });
      if (error) summary.errors.push(`${rec.call_id}: ${error.message}`);
      else summary.inserted++;
    }

    cursor = Math.max(cursor, rec.timestamp);
  }

  summary.through = new Date(cursor * 1000).toISOString();

  await db.from("sync_state").upsert({
    key: SYNC_KEY,
    cursor: String(cursor),
    last_run_at: new Date().toISOString(),
    last_error: summary.errors.length ? summary.errors.slice(0, 3).join("; ") : null,
    updated_at: new Date().toISOString(),
  });

  return summary;
}
