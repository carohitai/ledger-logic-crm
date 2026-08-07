// The statutory filing calendar the CRM tracks.
//
// Kept in TypeScript as well as in the database so the seed, the generator and
// the admin screen all agree, and so a reviewer can read the whole compliance
// calendar in one place.
//
// Due dates encode the actual Indian deadlines. Note that Indian statutory due
// dates do NOT shift for weekends or public holidays, so there is no such
// logic here. Where CBDT/CBIC extend a deadline in a given year, an admin
// changes the template's due_rule rather than the code being wrong all year.

import type { DueRule, Recurrence } from "./periods";

export type Department =
  | "accounting"
  | "income_tax"
  | "tds"
  | "gst"
  | "professional_tax";

/**
 * Applicability, evaluated against the client row. Every operator is exact set
 * membership — never substring. This matters: `it_category LIKE '%AUDIT%'`
 * also matches "NON AUDIT", which would wrongly hand 493 non-audit clients a
 * tax-audit obligation.
 */
export interface AppliesWhen {
  /** Column must equal one of these (case-insensitive). */
  equals?: Record<string, string[]>;
  /** Column must start with one of these (case-insensitive). */
  startsWith?: Record<string, string[]>;
  /** Column must be non-null and non-blank. */
  notEmpty?: string[];
  /** Boolean column must be true. */
  isTrue?: string[];
}

export interface TaskTemplate {
  code: string;
  department: Department;
  title: string;
  statutoryRef?: string;
  recurrence: Recurrence;
  dueRule: DueRule;
  /** Allotment role that owns it; falls back to the partner allotment. */
  assignRole: "gst" | "income_tax" | "accounts" | "partner";
  appliesWhen: AppliesWhen;
  /** Annual income-tax work is spoken about in assessment years, not FYs. */
  labelStyle?: "fy" | "ay";
  isActive: boolean;
  sortOrder: number;
}

const GST_REGISTERED: AppliesWhen["equals"] = { gst_status: ["registered"] };

const AUDIT_CATEGORIES = ["AUDIT", "COMP AUDIT", "TRUST AUDIT", "AUDIT PARTNER"];

export const TASK_TEMPLATES: TaskTemplate[] = [
  // ------------------------------------------------------------------- GST
  {
    code: "gstr1_monthly",
    department: "gst",
    title: "GSTR-1 (monthly)",
    statutoryRef: "Sec 37 CGST",
    recurrence: "monthly",
    dueRule: { kind: "after_period_end", months: 1, day: 11 },
    assignRole: "gst",
    appliesWhen: { equals: { ...GST_REGISTERED, gst_frequency: ["MONTHLY"] } },
    isActive: true,
    sortOrder: 10,
  },
  {
    code: "gstr3b_monthly",
    department: "gst",
    title: "GSTR-3B (monthly)",
    statutoryRef: "Sec 39 CGST",
    recurrence: "monthly",
    dueRule: { kind: "after_period_end", months: 1, day: 20 },
    assignRole: "gst",
    appliesWhen: { equals: { ...GST_REGISTERED, gst_frequency: ["MONTHLY"] } },
    isActive: true,
    sortOrder: 11,
  },
  {
    code: "gstr1_quarterly",
    department: "gst",
    title: "GSTR-1 (QRMP quarterly)",
    statutoryRef: "Sec 37 CGST",
    recurrence: "quarterly",
    dueRule: { kind: "after_period_end", months: 1, day: 13 },
    assignRole: "gst",
    appliesWhen: { equals: { ...GST_REGISTERED, gst_frequency: ["QUARTERLY"] } },
    isActive: true,
    sortOrder: 12,
  },
  {
    code: "gstr3b_quarterly",
    department: "gst",
    // Maharashtra sits in the 22nd-of-the-month QRMP group.
    title: "GSTR-3B (QRMP quarterly)",
    statutoryRef: "Sec 39 CGST",
    recurrence: "quarterly",
    dueRule: { kind: "after_period_end", months: 1, day: 22 },
    assignRole: "gst",
    appliesWhen: { equals: { ...GST_REGISTERED, gst_frequency: ["QUARTERLY"] } },
    isActive: true,
    sortOrder: 13,
  },
  {
    code: "gstr9_annual",
    department: "gst",
    title: "GSTR-9 annual return",
    statutoryRef: "Sec 44 CGST",
    recurrence: "annual",
    dueRule: { kind: "after_fy_end", months: 9, day: 31 },
    assignRole: "gst",
    appliesWhen: { equals: GST_REGISTERED },
    isActive: true,
    sortOrder: 14,
  },

  // ----------------------------------------------------------- Income tax
  {
    code: "itr_non_audit",
    department: "income_tax",
    title: "Income tax return (non-audit)",
    statutoryRef: "Sec 139(1)",
    recurrence: "annual",
    dueRule: { kind: "after_fy_end", months: 4, day: 31 },
    assignRole: "income_tax",
    appliesWhen: { equals: { it_category: ["NON AUDIT", "SALARY"] } },
    labelStyle: "ay",
    isActive: true,
    sortOrder: 20,
  },
  {
    code: "tax_audit_3cd",
    department: "income_tax",
    title: "Tax audit report (3CA/3CB-3CD)",
    statutoryRef: "Sec 44AB",
    recurrence: "annual",
    dueRule: { kind: "after_fy_end", months: 6, day: 30 },
    assignRole: "income_tax",
    appliesWhen: { equals: { it_category: AUDIT_CATEGORIES } },
    labelStyle: "ay",
    isActive: true,
    sortOrder: 21,
  },
  {
    code: "itr_audit",
    department: "income_tax",
    title: "Income tax return (audit case)",
    statutoryRef: "Sec 139(1)",
    recurrence: "annual",
    dueRule: { kind: "after_fy_end", months: 7, day: 31 },
    assignRole: "income_tax",
    appliesWhen: {
      equals: { it_category: [...AUDIT_CATEGORIES, "COMP DIRECTOR"] },
    },
    labelStyle: "ay",
    isActive: true,
    sortOrder: 22,
  },

  // ------------------------------------------------------------------- TDS
  // Seeded inactive: no client currently carries tds_applicable, and turning
  // these on before that master data exists would generate nothing anyway.
  {
    code: "tds_payment_monthly",
    department: "tds",
    title: "TDS payment (challan 281)",
    statutoryRef: "Rule 30",
    recurrence: "monthly",
    // March is the exception — 30 April, not 7 April.
    dueRule: {
      kind: "after_period_end",
      months: 1,
      day: 7,
      exceptions: { "03": { months: 1, day: 30 } },
    },
    assignRole: "income_tax",
    appliesWhen: { isTrue: ["tds_applicable"] },
    isActive: false,
    sortOrder: 30,
  },
  {
    code: "tds_return_quarterly",
    department: "tds",
    title: "TDS return (24Q / 26Q)",
    statutoryRef: "Rule 31A",
    recurrence: "quarterly",
    // Q1 31 Jul, Q2 31 Oct, Q3 31 Jan, Q4 31 May.
    dueRule: {
      kind: "after_period_end",
      months: 1,
      day: 31,
      exceptions: { Q4: { months: 2, day: 31 } },
    },
    assignRole: "income_tax",
    appliesWhen: { isTrue: ["tds_applicable"] },
    isActive: false,
    sortOrder: 31,
  },
  {
    code: "form16_annual",
    department: "tds",
    title: "Form 16 issuance",
    statutoryRef: "Rule 31",
    recurrence: "annual",
    dueRule: { kind: "after_fy_end", months: 3, day: 15 },
    assignRole: "income_tax",
    appliesWhen: { isTrue: ["tds_applicable"] },
    isActive: false,
    sortOrder: 32,
  },

  // ------------------------------------------------------ Professional tax
  {
    code: "ptrc_monthly",
    department: "professional_tax",
    title: "PTRC monthly return",
    statutoryRef: "MH PT Act 1975",
    recurrence: "monthly",
    dueRule: { kind: "after_period_end", months: 1, day: "last" },
    assignRole: "accounts",
    appliesWhen: { isTrue: ["pt_applicable"] },
    isActive: false,
    sortOrder: 40,
  },
  {
    code: "ptrc_annual",
    department: "professional_tax",
    title: "PTRC annual return",
    statutoryRef: "MH PT Act 1975",
    recurrence: "annual",
    dueRule: { kind: "after_fy_end", months: 0, day: 31 },
    assignRole: "accounts",
    appliesWhen: { isTrue: ["pt_applicable"] },
    isActive: false,
    sortOrder: 41,
  },

  // ------------------------------------------------------------ Accounting
  {
    code: "accounts_monthly_close",
    department: "accounting",
    title: "Monthly bookkeeping close",
    recurrence: "monthly",
    dueRule: { kind: "after_period_end", months: 1, day: 10 },
    assignRole: "accounts",
    // `books` is a category, not a yes/no: "BM …" means the firm maintains the
    // books, "NB …" means it does not, and External/NA/Pension are neither.
    // (Confirmed with the firm.) Only BM clients generate a monthly close —
    // keying off "is books set at all" would raise a monthly task for all 934
    // clients, including the 461 whose books we explicitly do not keep.
    appliesWhen: { startsWith: { books: ["BM"] } },
    isActive: true,
    sortOrder: 50,
  },
];

export function templateByCode(code: string): TaskTemplate | undefined {
  return TASK_TEMPLATES.find((t) => t.code === code);
}

export const DEPARTMENT_LABELS: Record<Department, string> = {
  accounting: "Accounting",
  income_tax: "Income Tax",
  tds: "TDS",
  gst: "GST",
  professional_tax: "Professional Tax",
};
