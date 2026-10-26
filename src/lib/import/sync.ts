import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type AllotmentRole,
  type ClientFields,
  type NormalizedRow,
  ROLE_COLUMNS,
  normalizeRow,
} from "./normalize";
import { changeSummary, type ChangeSet } from "@/lib/client-profile";

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
  /** Field + incharge changes the sheet made (updates only). Keys: column names and `incharge.<role>`. */
  diff: ChangeSet | null;
}

/** A committed change worth telling the team about. */
export interface SyncActivity {
  clientId: string;
  clientName: string;
  activityId: string | null;
  action: "sheet_insert" | "sheet_update" | "sheet_missing";
  changes: ChangeSet;
}

export interface SyncReport {
  batchId: string;
  dryRun: boolean;
  counts: Record<RowAction, number>;
  missingFlagged: number;
  unresolvedAliases: Record<string, number>;
  rows: RowResult[];
  /** Only populated on commit: one entry per client that changed. */
  activities: SyncActivity[];
}

type ExistingClient = ClientFields & {
  id: string;
  import_key: string;
  row_hash: string | null;
  status: string;
  /** Columns hand-edited in the CRM — the sheet must not overwrite these. */
  manual_fields: string[] | null;
};

const FIELD_KEYS = [
  "name",
  "constitution",
  "trade_name",
  "pan",
  "gstin",
  "gst_status",
  "category",
  "books",
  "it_category",
  "gst_frequency",
  "phone",
  "email",
] as const satisfies readonly (keyof ClientFields)[];

const ROLES = Object.keys(ROLE_COLUMNS) as AllotmentRole[];

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
 * `actorStaffId`: who triggered it (null for the automated cron).
 */
export async function runSync(
  supabase: SupabaseClient,
  records: Record<string, string>[],
  opts: { filename: string; dryRun: boolean; applyRenames: boolean; actorStaffId?: string | null }
): Promise<SyncReport> {
  // --- load reference data ---
  const [
    { data: aliases, error: aliasErr },
    { data: existing, error: cliErr },
    { data: staff, error: staffErr },
    { data: importAllotments, error: allotErr },
  ] = await Promise.all([
    supabase.from("staff_aliases").select("alias, staff_id"),
    supabase
      .from("clients")
      .select(`id, import_key, row_hash, status, manual_fields, ${FIELD_KEYS.join(", ")}`)
      .limit(100000),
    supabase.from("staff").select("id, full_name"),
    supabase
      .from("client_allotments")
      .select("client_id, role, staff_id")
      .eq("source", "import")
      .limit(100000),
  ]);
  if (aliasErr) throw aliasErr;
  if (cliErr) throw cliErr;
  if (staffErr) throw staffErr;
  if (allotErr) throw allotErr;

  const aliasMap = new Map<string, string>(
    (aliases ?? []).map((a) => [a.alias.toUpperCase(), a.staff_id])
  );
  const staffName = new Map<string, string>((staff ?? []).map((s) => [s.id, s.full_name]));
  const existingRows = (existing ?? []) as unknown as ExistingClient[];
  const byKey = new Map<string, ExistingClient>(existingRows.map((c) => [c.import_key, c]));
  const byPan = new Map<string, ExistingClient[]>();
  for (const c of existingRows) {
    if (c.pan) {
      const list = byPan.get(c.pan) ?? [];
      list.push(c);
      byPan.set(c.pan, list);
    }
  }
  /** client_id -> role -> staff_id, for import-sourced allotments only. */
  const currentAllotments = new Map<string, Record<string, string>>();
  for (const a of importAllotments ?? []) {
    const entry = currentAllotments.get(a.client_id) ?? {};
    entry[a.role] = a.staff_id;
    currentAllotments.set(a.client_id, entry);
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
    diff: ChangeSet | null;
  }
  const planned: PlannedRow[] = [];

  /** What the sheet would change on an existing client, honouring CRM-edited fields. */
  const diffAgainst = (client: ExistingClient, row: NormalizedRow, allotments: Record<string, string>): ChangeSet => {
    const manual = new Set(client.manual_fields ?? []);
    const diff: ChangeSet = {};
    for (const key of FIELD_KEYS) {
      if (manual.has(key)) continue;
      const before = client[key] ?? null;
      const after = row.fields[key] ?? null;
      if (before !== after) diff[key] = { from: before, to: after };
    }
    const before = currentAllotments.get(client.id) ?? {};
    for (const role of ROLES) {
      const b = before[role] ?? null;
      const a = allotments[role] ?? null;
      if (b !== a) {
        diff[`incharge.${role}`] = {
          from: b ? staffName.get(b) ?? b : null,
          to: a ? staffName.get(a) ?? a : null,
        };
      }
    }
    return diff;
  };

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
        diff: null,
      });
      continue;
    }
    seenKeys.add(row.importKey);

    // (1) exact key match
    const exact = byKey.get(row.importKey);
    if (exact && !claimedClientIds.has(exact.id)) {
      claimedClientIds.add(exact.id);
      const diff = diffAgainst(exact, row, allotments);
      const changed = Object.keys(diff).length > 0 || exact.status !== "active";
      // A hash change with an empty diff means only CRM-protected fields moved
      // in the sheet — nothing to apply, just re-stamp the hash below.
      planned.push({
        row,
        action: changed ? "update" : "unchanged",
        client: exact,
        allotments,
        hash,
        messages,
        diff: changed ? diff : null,
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
        diff: diffAgainst(c, row, allotments),
      });
      continue;
    }

    // (3) new client
    planned.push({ row, action: "insert", client: null, allotments, hash, messages, diff: null });
  }

  // --- create batch ---
  const { data: batch, error: batchErr } = await supabase
    .from("import_batches")
    .insert({ filename: opts.filename, dry_run: opts.dryRun, created_by: opts.actorStaffId ?? null })
    .select("id")
    .single();
  if (batchErr) throw batchErr;
  const batchId = batch.id as string;

  const results: RowResult[] = [];
  const activities: SyncActivity[] = [];
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
          ...p.row.fields,
          id: idByKey.get(p.row.importKey)!,
          import_key: p.row.importKey,
          row_hash: p.hash,
          status: "active",
          manual_fields: [],
        };
      }
    });

    // updates + confirmed renames (field updates); unchanged rows just get stamped
    for (const p of planned) {
      if (p.action === "update" || (p.action === "rename_candidate" && opts.applyRenames)) {
        // Hand-edited columns win over the sheet: staff correct phone numbers
        // and emails in the CRM, and an import must not undo that.
        const manual = new Set(p.client!.manual_fields ?? []);
        const sheetFields = Object.fromEntries(
          Object.entries(p.row.fields).filter(([key]) => !manual.has(key))
        );
        if (manual.size) {
          p.messages.push(
            `Kept CRM-edited ${[...manual].join(", ")} (not overwritten by the sheet)`
          );
        }
        const { error } = await supabase
          .from("clients")
          .update({
            ...sheetFields,
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
    const unchanged = planned.filter((p) => p.action === "unchanged");
    await chunked(
      unchanged.map((p) => p.client!.id),
      async (slice) => {
        const { error } = await supabase
          .from("clients")
          .update({ last_seen_batch_id: batchId, status: "active" })
          .in("id", slice);
        if (error) throw error;
      }
    );
    // Re-stamp the hash where only CRM-protected fields moved in the sheet, so
    // the same non-change isn't re-evaluated on every sync (rare, so per row).
    for (const p of unchanged) {
      if (p.client!.row_hash === p.hash) continue;
      const { error } = await supabase.from("clients").update({ row_hash: p.hash }).eq("id", p.client!.id);
      if (error) throw error;
    }

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
      .select("id, name");
    if (missErr) throw missErr;
    missingFlagged = flagged?.length ?? 0;

    // --- activity feed: one row per changed client ---
    const activityRows = [
      ...touched.map((p) => {
        const isInsert = p.action === "insert";
        const changes: ChangeSet = isInsert
          ? Object.fromEntries(
              [
                ...FIELD_KEYS.filter((k) => p.row.fields[k] != null).map((k) => [k, { from: null, to: p.row.fields[k] }]),
                ...Object.entries(p.allotments).map(([role, sid]) => [
                  `incharge.${role}`,
                  { from: null, to: staffName.get(sid) ?? sid },
                ]),
              ]
            )
          : p.diff ?? {};
        return {
          client_id: p.client!.id,
          clientName: p.row.fields.name,
          action: (isInsert ? "sheet_insert" : "sheet_update") as SyncActivity["action"],
          summary: isInsert ? "Added from the master sheet" : changeSummary(changes),
          changes,
        };
      }),
      ...(flagged ?? []).map((c) => ({
        client_id: c.id as string,
        clientName: c.name as string,
        action: "sheet_missing" as SyncActivity["action"],
        summary: "Row removed from the master sheet",
        changes: { status: { from: "active", to: "missing_from_sheet" } } as ChangeSet,
      })),
    ];
    await chunked(activityRows, async (slice) => {
      const { data, error } = await supabase
        .from("client_activity")
        .insert(
          slice.map((a) => ({
            client_id: a.client_id,
            actor_staff_id: opts.actorStaffId ?? null,
            action: a.action,
            summary: a.summary,
            changes: a.changes,
          }))
        )
        .select("id, client_id");
      if (error) throw error;
      const idByClient = new Map((data ?? []).map((d) => [d.client_id as string, d.id as string]));
      for (const a of slice) {
        activities.push({
          clientId: a.client_id,
          clientName: a.clientName,
          activityId: idByClient.get(a.client_id) ?? null,
          action: a.action,
          changes: a.changes,
        });
      }
    });
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
    diff: p.diff,
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
      diff: p.diff,
    });
  }

  const summary = { counts, missingFlagged, unresolvedAliases, changedClients: activities.length };
  await supabase
    .from("import_batches")
    .update({ finished_at: new Date().toISOString(), summary })
    .eq("id", batchId);

  return {
    batchId,
    dryRun: opts.dryRun,
    counts,
    missingFlagged,
    unresolvedAliases,
    rows: results,
    activities,
  };
}
