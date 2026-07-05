import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type AllotmentRole,
  type NormalizedRow,
  normalizeRow,
} from "./normalize";

export type RowAction =
  | "insert"
  | "update"
  | "unchanged"
  | "rename_candidate"
  | "skipped"
  | "error";

export interface RowResult {
  rowNumber: number;
  action: RowAction;
  clientName: string;
  importKey: string;
  clientId: string | null;
  messages: string[];
  diff: Record<string, { from: unknown; to: unknown }> | null;
}

export interface SyncReport {
  batchId: string;
  dryRun: boolean;
  counts: Record<RowAction, number>;
  missingFlagged: number;
  unresolvedAliases: Record<string, number>;
  rows: RowResult[];
}

interface ExistingClient {
  id: string;
  import_key: string;
  pan: string | null;
  row_hash: string | null;
  status: string;
}

function rowHash(row: NormalizedRow, allotments: Record<string, string>): string {
  return createHash("sha256")
    .update(JSON.stringify([row.fields, allotments]))
    .digest("hex");
}

const CHUNK = 400;

async function chunked<T>(items: T[], fn: (slice: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += CHUNK) {
    await fn(items.slice(i, i + CHUNK));
  }
}

/**
 * Runs the full import pipeline. Dry-run and commit share every step up to
 * the write phase; dry-run persists only the batch + row report.
 * `applyRenames`: rename_candidates are only applied when explicitly confirmed.
 */
export async function runSync(
  supabase: SupabaseClient,
  records: Record<string, string>[],
  opts: { filename: string; dryRun: boolean; applyRenames: boolean }
): Promise<SyncReport> {
  // --- load reference data ---
  const [{ data: aliases, error: aliasErr }, { data: existing, error: cliErr }] =
    await Promise.all([
      supabase.from("staff_aliases").select("alias, staff_id"),
      supabase
        .from("clients")
        .select("id, import_key, pan, row_hash, status")
        .limit(100000),
    ]);
  if (aliasErr) throw aliasErr;
  if (cliErr) throw cliErr;

  const aliasMap = new Map<string, string>(
    (aliases ?? []).map((a) => [a.alias.toUpperCase(), a.staff_id])
  );
  const byKey = new Map<string, ExistingClient>(
    (existing ?? []).map((c) => [c.import_key, c])
  );
  const byPan = new Map<string, ExistingClient[]>();
  for (const c of existing ?? []) {
    if (c.pan) {
      const list = byPan.get(c.pan) ?? [];
      list.push(c);
      byPan.set(c.pan, list);
    }
  }

  // --- normalize ---
  const rows: NormalizedRow[] = [];
  records.forEach((rec, i) => {
    const n = normalizeRow(rec, i + 1);
    if (n) rows.push(n);
  });

  const incomingKeys = new Set(rows.map((r) => r.importKey));
  const seenKeys = new Set<string>();
  const claimedClientIds = new Set<string>();
  const unresolvedAliases: Record<string, number> = {};

  interface PlannedRow {
    row: NormalizedRow;
    action: RowAction;
    client: ExistingClient | null;
    allotments: Record<string, string>; // role -> staff_id
    hash: string;
    messages: string[];
  }
  const planned: PlannedRow[] = [];

  for (const row of rows) {
    const messages = [...row.messages];

    // resolve aliases
    const allotments: Record<string, string> = {};
    for (const [role, name] of Object.entries(row.allotmentNames)) {
      const staffId = aliasMap.get(name.toUpperCase());
      if (staffId) {
        allotments[role as AllotmentRole] = staffId;
      } else {
        messages.push(`Unknown incharge "${name}" for ${role} — allotment skipped`);
        unresolvedAliases[name] = (unresolvedAliases[name] ?? 0) + 1;
      }
    }
    const hash = rowHash(row, allotments);

    // intra-sheet duplicate key: first wins, rest are errors
    if (seenKeys.has(row.importKey)) {
      planned.push({
        row,
        action: "error",
        client: null,
        allotments,
        hash,
        messages: [...messages, `Duplicate key in sheet: ${row.importKey}`],
      });
      continue;
    }
    seenKeys.add(row.importKey);

    // (1) exact key match
    const exact = byKey.get(row.importKey);
    if (exact && !claimedClientIds.has(exact.id)) {
      claimedClientIds.add(exact.id);
      planned.push({
        row,
        action: exact.row_hash === hash && exact.status === "active" ? "unchanged" : "update",
        client: exact,
        allotments,
        hash,
        messages,
      });
      continue;
    }

    // (2) rename detection: unique PAN match on a client whose key nothing claims
    const panMatches = (row.fields.pan ? byPan.get(row.fields.pan) ?? [] : []).filter(
      (c) => !claimedClientIds.has(c.id) && !incomingKeys.has(c.import_key)
    );
    if (panMatches.length === 1) {
      const c = panMatches[0];
      claimedClientIds.add(c.id);
      planned.push({
        row,
        action: "rename_candidate",
        client: c,
        allotments,
        hash,
        messages: [
          ...messages,
          `Existing client ${c.import_key} appears renamed to ${row.importKey}`,
        ],
      });
      continue;
    }

    // (3) new client
    planned.push({ row, action: "insert", client: null, allotments, hash, messages });
  }

  // --- create batch ---
  const { data: batch, error: batchErr } = await supabase
    .from("import_batches")
    .insert({ filename: opts.filename, dry_run: opts.dryRun })
    .select("id")
    .single();
  if (batchErr) throw batchErr;
  const batchId = batch.id as string;

  const results: RowResult[] = [];
  let missingFlagged = 0;

  if (!opts.dryRun) {
    // inserts
    const inserts = planned.filter((p) => p.action === "insert");
    await chunked(inserts, async (slice) => {
      const { data, error } = await supabase
        .from("clients")
        .insert(
          slice.map((p) => ({
            ...p.row.fields,
            import_key: p.row.importKey,
            row_hash: p.hash,
            status: "active",
            last_seen_batch_id: batchId,
          }))
        )
        .select("id, import_key");
      if (error) throw error;
      const idByKey = new Map(data!.map((d) => [d.import_key, d.id]));
      for (const p of slice) {
        p.client = {
          id: idByKey.get(p.row.importKey)!,
          import_key: p.row.importKey,
          pan: p.row.fields.pan,
          row_hash: p.hash,
          status: "active",
        };
      }
    });

    // updates + confirmed renames (field updates); unchanged rows just get stamped
    for (const p of planned) {
      if (p.action === "update" || (p.action === "rename_candidate" && opts.applyRenames)) {
        const { error } = await supabase
          .from("clients")
          .update({
            ...p.row.fields,
            import_key: p.row.importKey,
            row_hash: p.hash,
            status: "active",
            last_seen_batch_id: batchId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", p.client!.id);
        if (error) throw error;
      }
    }
    const unchangedIds = planned
      .filter((p) => p.action === "unchanged")
      .map((p) => p.client!.id);
    await chunked(unchangedIds, async (slice) => {
      const { error } = await supabase
        .from("clients")
        .update({ last_seen_batch_id: batchId, status: "active" })
        .in("id", slice);
      if (error) throw error;
    });

    // replace import-sourced allotments for every non-unchanged, seen client
    const touched = planned.filter(
      (p) =>
        p.client &&
        (p.action === "insert" ||
          p.action === "update" ||
          (p.action === "rename_candidate" && opts.applyRenames))
    );
    await chunked(
      touched.map((p) => p.client!.id),
      async (slice) => {
        const { error } = await supabase
          .from("client_allotments")
          .delete()
          .in("client_id", slice)
          .eq("source", "import");
        if (error) throw error;
      }
    );
    const allotmentRows = touched.flatMap((p) =>
      Object.entries(p.allotments).map(([role, staff_id]) => ({
        client_id: p.client!.id,
        role,
        staff_id,
        source: "import",
        batch_id: batchId,
      }))
    );
    await chunked(allotmentRows, async (slice) => {
      const { error } = await supabase.from("client_allotments").insert(slice);
      if (error) throw error;
    });

    // flag clients missing from this sheet
    const { data: flagged, error: missErr } = await supabase
      .from("clients")
      .update({ status: "missing_from_sheet" })
      .eq("status", "active")
      .neq("last_seen_batch_id", batchId)
      .select("id");
    if (missErr) throw missErr;
    missingFlagged = flagged?.length ?? 0;
  }

  // --- persist row report ---
  const rowRecords = planned.map((p) => ({
    batch_id: batchId,
    row_number: p.row.rowNumber,
    client_id: p.client?.id ?? null,
    action:
      p.action === "rename_candidate" && !opts.dryRun && !opts.applyRenames
        ? "skipped"
        : p.action,
    raw: p.row.raw,
    diff: null,
    messages: p.messages,
  }));
  await chunked(rowRecords, async (slice) => {
    const { error } = await supabase.from("import_rows").insert(slice);
    if (error) throw error;
  });

  const counts: Record<RowAction, number> = {
    insert: 0,
    update: 0,
    unchanged: 0,
    rename_candidate: 0,
    skipped: 0,
    error: 0,
  };
  for (const r of rowRecords) counts[r.action as RowAction]++;

  for (const p of planned) {
    results.push({
      rowNumber: p.row.rowNumber,
      action: p.action,
      clientName: p.row.fields.name,
      importKey: p.row.importKey,
      clientId: p.client?.id ?? null,
      messages: p.messages,
      diff: null,
    });
  }

  const summary = { counts, missingFlagged, unresolvedAliases };
  await supabase
    .from("import_batches")
    .update({ finished_at: new Date().toISOString(), summary })
    .eq("id", batchId);

  return { batchId, dryRun: opts.dryRun, counts, missingFlagged, unresolvedAliases, rows: results };
}
