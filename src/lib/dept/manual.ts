// TDS/TRACES and Maharashtra Professional Tax.
//
// This is not a stub awaiting implementation — it is the correct and permanent
// answer for these two departments. TRACES exposes no public or developer API,
// and MahaGST is portal-only. Anyone who comes looking in six months should
// find this note rather than re-running the same investigation.

import {
  unknownStatus,
  type ComplianceProvider,
  type Department,
  type FilingStatus,
  type ProviderClientRef,
} from "./types";

const REASONS: Partial<Record<Department, string>> = {
  tds: "TRACES exposes no API. TDS status has to be checked on the portal, or via a GSP/ERI feed once the firm is onboarded.",
  professional_tax:
    "MahaGST exposes no API for PTRC/PTEC. Professional tax status is portal-only and must be recorded by hand.",
};

export const manualProvider: ComplianceProvider = {
  key: "manual",
  label: "Manual (no API exists)",
  capabilities: {
    departments: ["tds", "professional_tax", "accounting"],
    forms: [],
    canFetchStatus: false,
    canFile: false,
    requiresContract: false,
  },
  isConfigured: () => true,
  async fetchFilingStatus(
    _client: ProviderClientRef,
    { formCode, periodKey }: { formCode: string; periodKey: string }
  ): Promise<FilingStatus[]> {
    return [
      unknownStatus(
        "tds",
        formCode,
        periodKey,
        REASONS.tds ?? "No API available for this department."
      ),
    ];
  },
};
