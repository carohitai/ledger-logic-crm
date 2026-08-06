export type AllotmentRole =
  | "partner"
  | "income_tax"
  | "billing"
  | "accounts"
  | "data_entry"
  | "gst";

/**
 * Header names per role. Lookups are case-insensitive; multiple entries cover
 * spelling variants seen across sheet versions (e.g. "Biling Incharge" sic).
 */
export const ROLE_COLUMNS: Record<AllotmentRole, string[]> = {
  partner: ["Partner Incharge"],
  income_tax: ["Income Tax Incharge"],
  billing: ["Billing Incharge", "Biling Incharge"],
  accounts: ["Accounts Incharge"],
  data_entry: ["Data Entry Assistance"],
  gst: ["GST Incharge"],
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

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

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
  // Full master-sheet columns
  document_status: string | null;
  dsc_status: string | null;
  turnover: string | null;
  audit_report_status: string | null;
  itr_status: string | null;
  advance_tax_applicable: string | null;
  advance_tax_q1: string | null;
  advance_tax_q2: string | null;
  advance_tax_q3: string | null;
  advance_tax_q4: string | null;
  tds_applicable: string | null;
  tds_q1: string | null;
  tds_q2: string | null;
  tds_q3: string | null;
  tds_q4: string | null;
  fees_invoice: string | null;
  fees_schedule: string | null;
  fees_schedule_date: string | null;
  pt_ec_no: string | null;
  pt_rc_no: string | null;
  e_invoice: string | null;
  gstr9_status: string | null;
  gstr9c_status: string | null;
  ledger_logic: string | null;
  erp_ca_task: string | null;
  dpt3_finalization: string | null;
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

/**
 * Case-insensitive column getter. Header casing has drifted between sheet
 * versions ("GST INCHARGE" vs "GST Incharge"), so exact-case lookups break.
 */
function makeGetter(raw: Record<string, string>) {
  const byUpper = new Map<string, string>();
  for (const [k, v] of Object.entries(raw)) byUpper.set(k.toUpperCase(), v);
  return (...names: string[]): string | undefined => {
    for (const n of names) {
      const v = byUpper.get(n.toUpperCase());
      if (v !== undefined) return v;
    }
    return undefined;
  };
}

/** First column whose header starts with the given prefix (case-insensitive). */
function byPrefix(raw: Record<string, string>, prefix: string): string | undefined {
  const p = prefix.toUpperCase();
  for (const [k, v] of Object.entries(raw)) {
    if (k.toUpperCase().startsWith(p)) return v;
  }
  return undefined;
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
  const col = makeGetter(raw);

  const name = norm(col("Name of Client"));
  if (name === "") return null;

  let pan: string | null = upper(col("PAN")) || null;
  if (pan && !PAN_RE.test(pan)) {
    messages.push(`Invalid PAN "${pan}" — stored blank, keyed by name`);
    pan = null;
  }

  const gstinRaw = upper(col("GSTIN"));
  const gstin =
    gstinRaw === "" || gstinRaw === "NOT REGISTERED" || gstinRaw === "NA"
      ? null
      : norm(col("GSTIN")).toUpperCase();

  // gst_status harvested from junk values before they are discarded
  const gstInchargeUpper = upper(col("GST Incharge"));
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
    constitution: orNull(col("CONSTITUTION")),
    trade_name: orNull(col("TRADE NAME")),
    pan,
    gstin,
    gst_status,
    category: orNull(col("CATEGORY")),
    books: orNull(col("BOOKS")),
    it_category: orNull(col("IT CATEGORY")),
    gst_frequency: orNull(col("GST FREQUENCY")),
    phone: orNull(col("ALTERNATE NO 1")),
    email: orNull(col("Clients Email ID")),
    document_status: orNull(col("Document Status [Bookkeeping]", "Document Status")),
    dsc_status: orNull(col("DSC Status")),
    // Header carries the FY, e.g. " TURNOVER FY 2025-26 " — match by prefix
    // so next year's sheet still imports.
    turnover: orNull(byPrefix(raw, "TURNOVER")),
    audit_report_status: orNull(col("Audit Report Status")),
    itr_status: orNull(col("ITR Status")),
    // "Aplicability" sic in the sheet; accept the correct spelling too.
    advance_tax_applicable: orNull(
      col("Advance Tax Aplicability (Yes/No)", "Advance Tax Applicability (Yes/No)")
    ),
    advance_tax_q1: orNull(col("Advance Tax Q1")),
    advance_tax_q2: orNull(col("Advance Tax Q2")),
    advance_tax_q3: orNull(col("Advance Tax Q3")),
    advance_tax_q4: orNull(col("Advance Tax Q4")),
    tds_applicable: orNull(
      col("TDS Applicability (Yes/No)", "TDS Aplicability (Yes/No)")
    ),
    tds_q1: orNull(col("TDS Q1")),
    tds_q2: orNull(col("TDS Q2")),
    tds_q3: orNull(col("TDS Q3")),
    tds_q4: orNull(col("TDS Q4")),
    fees_invoice: orNull(col("Fees Invoice")),
    fees_schedule: orNull(col("Fees Schedule")),
    fees_schedule_date: orNull(col("Date of Fees Schedule")),
    pt_ec_no: orNull(col("PT EC NO")),
    pt_rc_no: orNull(col("PT RC NO")),
    e_invoice: orNull(col("E-Invoice")),
    gstr9_status: orNull(col("GSTR-9 STATUS")),
    gstr9c_status: orNull(col("GSTR-9C STATUS")),
    ledger_logic: orNull(col("Ledger Logic")),
    erp_ca_task: orNull(col("ERP CA Task")),
    // Sheet header has a double space: "DPT  3 Finalization" — norm() in
    // cleanHeaders collapses it, so a single-space lookup matches.
    dpt3_finalization: orNull(col("DPT 3 Finalization")),
  };

  const allotmentNames: Partial<Record<AllotmentRole, string>> = {};
  for (const role of Object.keys(ROLE_COLUMNS) as AllotmentRole[]) {
    const v = norm(col(...ROLE_COLUMNS[role]));
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
