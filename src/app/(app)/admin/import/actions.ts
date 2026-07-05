"use server";

import Papa from "papaparse";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { runSync, type SyncReport } from "@/lib/import/sync";

export interface ImportState {
  report: SyncReport | null;
  error: string | null;
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: me } = await supabase
    .from("staff")
    .select("app_role")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (me?.app_role !== "admin") throw new Error("Admin only");
  return supabase;
}

function parseFile(name: string, buf: ArrayBuffer): Record<string, string>[] {
  if (name.toLowerCase().endsWith(".csv")) {
    const text = new TextDecoder("utf-8").decode(buf).replace(/^﻿/, "");
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: "greedy",
    });
    return parsed.data;
  }
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    defval: "",
    raw: false,
  });
}

export async function runImport(
  _prev: ImportState,
  formData: FormData
): Promise<ImportState> {
  try {
    const supabase = await requireAdmin();
    const file = formData.get("file") as File | null;
    if (!file || file.size === 0) return { report: null, error: "Choose a file first." };
    const mode = String(formData.get("mode") ?? "dryrun");
    const applyRenames = formData.get("applyRenames") === "on";

    const records = parseFile(file.name, await file.arrayBuffer());
    if (records.length === 0)
      return { report: null, error: "No data rows found in the file." };

    const report = await runSync(supabase, records, {
      filename: file.name,
      dryRun: mode !== "commit",
      applyRenames,
    });
    return { report, error: null };
  } catch (e) {
    return { report: null, error: e instanceof Error ? e.message : String(e) };
  }
}
