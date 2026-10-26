import Papa from "papaparse";
import * as XLSX from "xlsx";

/** Turns an uploaded / downloaded client list (CSV or workbook) into header-keyed rows. */
export function parseClientListFile(name: string, buf: ArrayBuffer): Record<string, string>[] {
  if (name.toLowerCase().endsWith(".csv")) {
    const text = new TextDecoder("utf-8").decode(buf).replace(/^﻿/, "");
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: "greedy",
    });
    return parsed.data;
  }
  const wb = XLSX.read(buf, { type: "array" });
  // The master workbook's first sheet is "MAIN LIST"; other sheets are
  // status trackers that the CRM doesn't import.
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    defval: "",
    raw: false,
  });
}
