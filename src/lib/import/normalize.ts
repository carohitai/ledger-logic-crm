export type AllotmentRole =
  | "partner"
  | "income_tax"
  | "billing"
  | "accounts"
  | "data_entry"
  | "gst";

export const ROLE_COLUMNS: Record<AllotmentRole, string> = {
  partner: "Partner Incharge",
  income_tax: "Income Tax Incharge",
  billing: "Biling Incharge", // sic — header is misspelt in the sheet
  accounts: "Accounts Incharge",
  data_entry: "Data Entry Assistance",
  gst: "GST INCHARGE",
};

export const ROLE_LABELS: Record<AllotmentRole, string> = {
  partner: "Partner",
  income_tax: "Income Tax",
  billing: "Billing",
  accounts: "Accounts",
  data_entry: "Data Entry",
  gst: "GST",
};

/** Values that mean "no incharge", never a person. Compared uppercase. */
const NON_STAFF = new Set([
  "",
  "NA",
  "N A",
  "N.A.",
  "NOT APPLICABLE",
  "NOTREG.",
  "NOTREG",
  "NOT REG.",
  "CANCELLED",
  "LEFT",
]);

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export interface ClientFields {
  name: string;
  constitution: string | null;
  trade_name: string | null;
  pan: string | null;
  gstin: string | null;
  gst_status: string | null;
  category: string | null;
  books: string | null;
  it_category: string | null;
  gst_frequency: string | null;
  phone: string | null;
  email: string | null;
}

export interface NormalizedRow {
  rowNumber: number; // 1-based data row number (excluding header)
  raw: Record<string, string>;
  importKey: string;
  fields: ClientFields;
  /** role -> incharge name as written (post-trim), only for real people */
  allotmentNames: Partial<Record<AllotmentRole, string>>;
  messages: string[];
}

export function norm(s: string | undefined | null): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function upper(s: string | undefined | null): string {
  return norm(s).toUpperCase();
}

function orNull(s: string | undefined | null): string | null {
  const v = norm(s);
  return v === "" ? null : v;
}

/** Header cells come with BOM/whitespace quirks; match by trimmed name. */
export function cleanHeaders(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = norm(k.replace(/^﻿/, ""));
    if (key !== "") out[key] = typeof v === "string" ? v : String(v ?? "");
  }
  return out;
}

export function buildImportKey(pan: string | null, name: string, tradeName: string | null): string {
  const trade = upper(tradeName);
  return pan ? `PAN:${pan}|${trade}` : `NAME:${upper(name)}|${trade}`;
}

/** Returns null for blank filler rows. */
export function normalizeRow(
  rawIn: Record<string, string>,
  rowNumber: number
): NormalizedRow | null {
  const raw = cleanHeaders(rawIn);
  const messages: string[] = [];

  const name = norm(raw["Name of Client"]);
  if (name === "") return null;

  let pan: string | null = upper(raw["PAN"]) || null;
  if (pan && !PAN_RE.test(pan)) {
    messages.push(`Invalid PAN "${pan}" — stored blank, keyed by name`);
    pan = null;
  }

  const gstinRaw = upper(raw["GSTIN"]);
  const gstin =
    gstinRaw === "" || gstinRaw === "NOT REGISTERED" || gstinRaw === "NA"
      ? null
      : norm(raw["GSTIN"]).toUpperCase();

  // gst_status harvested from junk values before they are discarded
  const gstInchargeUpper = upper(raw["GST INCHARGE"]);
  let gst_status: string | null = null;
  if (gstinRaw === "NOT REGISTERED" || gstInchargeUpper.startsWith("NOTREG")) {
    gst_status = "not_registered";
  } else if (gstInchargeUpper === "CANCELLED") {
    gst_status = "cancelled";
  } else if (gstin) {
    gst_status = "registered";
  }

  const fields: ClientFields = {
    name,
    constitution: orNull(raw["CONSTITUTION"]),
    trade_name: orNull(raw["TRADE NAME"]),
    pan,
    gstin,
    gst_status,
    category: orNull(raw["CATEGORY"]),
    books: orNull(raw["BOOKS"]),
    it_category: orNull(raw["IT CATEGORY"]),
    gst_frequency: orNull(raw["GST FREQUENCY"]),
    phone: orNull(raw["ALTERNATE NO 1"]),
    email: orNull(raw["Clients Email ID"]),
  };

  const allotmentNames: Partial<Record<AllotmentRole, string>> = {};
  for (const role of Object.keys(ROLE_COLUMNS) as AllotmentRole[]) {
    const v = norm(raw[ROLE_COLUMNS[role]]);
    if (!NON_STAFF.has(v.toUpperCase())) allotmentNames[role] = v;
  }

  return {
    rowNumber,
    raw,
    importKey: buildImportKey(pan, name, fields.trade_name),
    fields,
    allotmentNames,
    messages,
  };
}
