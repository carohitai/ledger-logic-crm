"use server";

import Papa from "papaparse";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { downloadClientList } from "@/lib/graph";
import { runSync, type SyncReport } from "@/lib/import/sync";

export interface ImportState {
  report: SyncReport | null;
  error: string | null;
  /** Which file the report came from, e.g. "Client List Final 22062026.xlsx (SharePoint)". */
  source: string | null;
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
  let source: string | null = null;
  try {
    const supabase = await requireAdmin();
    const mode = String(formData.get("mode") ?? "dryrun");
    const applyRenames = formData.get("applyRenames") === "on";

    let filename: string;
    let buf: ArrayBuffer;
    if (formData.get("source") === "sharepoint") {
      const dl = await downloadClientList();
      filename = dl.name;
      buf = dl.buf;
      source = `${dl.name} (SharePoint)`;
    } else {
      const file = formData.get("file") as File | null;
      if (!file || file.size === 0)
        return { report: null, error: "Choose a file first.", source: null };
      filename = file.name;
      buf = await file.arrayBuffer();
      source = `${file.name} (upload)`;
    }

    const records = parseFile(filename, buf);
    if (records.length === 0)
      return { report: null, error: "No data rows found in the file.", source };

    const report = await runSync(supabase, records, {
      filename,
      dryRun: mode !== "commit",
      applyRenames,
    });
    return { report, error: null, source };
  } catch (e) {
    return {
      report: null,
      error: e instanceof Error ? e.message : String(e),
      source,
    };
  }
}
