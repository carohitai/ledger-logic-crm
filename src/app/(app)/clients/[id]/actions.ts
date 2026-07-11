"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { graphConfigured, updateClientListRow } from "@/lib/graph";
import { PAN_RE, buildImportKey, norm } from "@/lib/import/normalize";

export interface SaveDetailsState {
  ok: boolean;
  error: string | null;
  /** Outcome of the master-Excel write-back, shown under the form. */
  excel: string | null;
  /** Bumped on success so the form knows to leave edit mode. */
  savedAt: number;
}

// App column → sheet header, as consumed by the import (normalize.ts).
const SHEET_HEADERS = {
  name: "Name of Client",
  constitution: "CONSTITUTION",
  trade_name: "TRADE NAME",
  pan: "PAN",
  gstin: "GSTIN",
  category: "CATEGORY",
  books: "BOOKS",
  it_category: "IT CATEGORY",
  gst_frequency: "GST FREQUENCY",
  phone: "ALTERNATE NO 1",
  email: "Clients Email ID",
} as const;

type EditableField = keyof typeof SHEET_HEADERS;
const GST_STATUSES = new Set(["registered", "not_registered", "cancelled"]);

/** The GSTIN cell doubles as the not-registered marker (import convention). */
function gstinCell(gstin: string | null, gstStatus: string | null): string {
  return gstin ?? (gstStatus === "not_registered" ? "NOT REGISTERED" : "");
}

export async function saveClientDetails(
  _prev: SaveDetailsState,
  formData: FormData
): Promise<SaveDetailsState> {
  const fail = (error: string): SaveDetailsState => ({ ok: false, error, excel: null, savedAt: 0 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not signed in");
  const { data: me } = await supabase
    .from("staff")
    .select("app_role")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (me?.app_role !== "admin") return fail("Only admins can edit client details");

  const clientId = String(formData.get("clientId") ?? "");
  const { data: old } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();
  if (!old) return fail("Client not found");

  const text = (key: string): string | null => {
    const v = norm(String(formData.get(key) ?? ""));
    return v === "" ? null : v;
  };

  const name = text("name");
  if (!name) return fail("Client name is required");
  const pan = text("pan")?.toUpperCase() ?? null;
  if (pan && !PAN_RE.test(pan)) return fail(`"${pan}" is not a valid PAN (format: AAAAA9999A)`);
  const gstin = text("gstin")?.toUpperCase() ?? null;
  const gstStatusRaw = String(formData.get("gst_status") ?? "");
  const gst_status = GST_STATUSES.has(gstStatusRaw)
    ? gstStatusRaw
    : gstin
      ? "registered"
      : null;

  const fields: Record<EditableField, string | null> & { gst_status: string | null } = {
    name,
    constitution: text("constitution"),
    trade_name: text("trade_name"),
    pan,
    gstin,
    gst_status,
    category: text("category"),
    books: text("books"),
    it_category: text("it_category"),
    gst_frequency: text("gst_frequency"),
    phone: text("phone"),
    email: text("email"),
  };

  const changed = (Object.keys(SHEET_HEADERS) as EditableField[]).filter(
    (k) => (fields[k] ?? null) !== (old[k] ?? null)
  );
  const gstinCellChanged =
    gstinCell(fields.gstin, fields.gst_status) !== gstinCell(old.gstin, old.gst_status);
  if (changed.length === 0 && fields.gst_status === (old.gst_status ?? null)) {
    return { ok: true, error: null, excel: "No changes to save.", savedAt: Date.now() };
  }

  // Keep the import matching this client after identity edits: recompute the
  // key the sheet sync matches rows by.
  const import_key = buildImportKey(pan, name, fields.trade_name);
  const { error: dbError } = await supabase
    .from("clients")
    .update({ ...fields, import_key, updated_at: new Date().toISOString() })
    .eq("id", clientId);
  if (dbError) return fail(`Save failed: ${dbError.message}`);

  // Best-effort write-back to the linked master Excel; the CRM save stands
  // even if the sheet can't be reached.
  let excel: string;
  if (!graphConfigured()) {
    excel = "Master Excel is not linked (GRAPH_* env vars unset) — update the sheet manually.";
  } else {
    try {
      const updates: Record<string, string> = {};
      for (const k of changed) {
        if (k === "gstin") continue; // handled below with the status marker
        updates[SHEET_HEADERS[k]] = fields[k] ?? "";
      }
      if (gstinCellChanged) {
        updates[SHEET_HEADERS.gstin] = gstinCell(fields.gstin, fields.gst_status);
      }
      const { updatedCells } = await updateClientListRow(
        { pan: old.pan, name: old.name, tradeName: old.trade_name },
        updates
      );
      excel =
        updatedCells > 0
          ? `Master Excel updated (${updatedCells} cell${updatedCells === 1 ? "" : "s"}).`
          : "Master Excel already matched — no cells changed.";
    } catch (e) {
      excel = `Saved in the CRM, but the master Excel could not be updated: ${
        e instanceof Error ? e.message : String(e)
      }`;
    }
  }

  revalidatePath(`/clients/${clientId}`);
  return { ok: true, error: null, excel, savedAt: Date.now() };
}
