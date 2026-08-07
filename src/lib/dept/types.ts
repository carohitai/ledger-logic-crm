// Contract for reading filing status from a tax department.
//
// The point of this seam is that the four departments have genuinely different
// availability, and the CRM should be honest about which:
//
//   GST               real GSTN APIs exist but need a licensed GSP contract.
//                     A free public GSTIN search also returns per-period
//                     return-filing status with no contract at all.
//   Income Tax        official ERI Type-2 API. Needs the firm registered as an
//                     e-Return Intermediary, with a DSC.
//   TDS / TRACES      no API exists. Portal only.
//   Professional Tax  no API exists (MahaGST is portal only).
//
// So `manual` is not a placeholder — for TDS and PT it is the permanent, honest
// answer, and it says so rather than looking like unfinished work.

export type Department =
  | "accounting"
  | "income_tax"
  | "tds"
  | "gst"
  | "professional_tax";

export type ProviderKey = "public-gst" | "gsp-gst" | "eri-income-tax" | "manual";

export type FilingState = "filed" | "not_filed" | "not_applicable" | "unknown";

/**
 * How much a result is allowed to change. An outage or a scraped-ish public
 * endpoint must never be able to mark work "verified", and must never be able
 * to assert "not filed" — see the `unknown` rule in reconcile.ts.
 */
export type Confidence = "authoritative" | "public" | "inferred";

export interface ProviderClientRef {
  id: string;
  name: string;
  pan: string | null;
  gstin: string | null;
}

export interface FilingStatus {
  department: Department;
  formCode: string; // 'GSTR1' | 'GSTR3B' | 'ITR' | '24Q'
  periodKey: string;
  state: FilingState;
  filedOn: string | null; // ISO date
  reference: string | null; // ARN / acknowledgement number
  confidence: Confidence;
  /** Why the state is `unknown` — surfaced in the UI instead of a silent gap. */
  reason?: string;
  raw?: unknown;
  fetchedAt: string;
}

export interface ProviderCapabilities {
  departments: Department[];
  forms: string[];
  canFetchStatus: boolean;
  canFile: boolean;
  /** Needs a commercial contract (GSP licence) or registration (ERI). */
  requiresContract: boolean;
}

export interface ComplianceProvider {
  readonly key: ProviderKey;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;
  /** False keeps the registry from ever selecting it. */
  isConfigured(): boolean;
  /**
   * MUST resolve — never reject — on upstream failure, returning
   * `state: "unknown"`. A department being unreachable is not evidence that a
   * client failed to file.
   */
  fetchFilingStatus(
    client: ProviderClientRef,
    input: { formCode: string; periodKey: string }
  ): Promise<FilingStatus[]>;
}

export class ProviderNotOnboardedError extends Error {
  constructor(readonly provider: ProviderKey, message: string) {
    super(message);
    this.name = "ProviderNotOnboardedError";
  }
}

export function unknownStatus(
  department: Department,
  formCode: string,
  periodKey: string,
  reason: string
): FilingStatus {
  return {
    department,
    formCode,
    periodKey,
    state: "unknown",
    filedOn: null,
    reference: null,
    confidence: "inferred",
    reason,
    fetchedAt: new Date().toISOString(),
  };
}
