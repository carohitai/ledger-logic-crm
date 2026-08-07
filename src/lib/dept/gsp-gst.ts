// GST through a licensed GST Suvidha Provider.
//
// The full GSTN API surface — GSTR-1/3B/2B, ledgers, and actual filing — is
// only reachable through a GSP under contract, and each client additionally has
// to enable API access for that GSP on the GST portal. Declared here so the
// switch is a one-file change once the firm signs with one, rather than a
// refactor of the reconcile path.

import {
  ProviderNotOnboardedError,
  type ComplianceProvider,
} from "./types";

export const gspGstProvider: ComplianceProvider = {
  key: "gsp-gst",
  label: "GST via GSP (not yet onboarded)",
  capabilities: {
    departments: ["gst"],
    forms: ["GSTR1", "GSTR3B", "GSTR2B", "GSTR9"],
    canFetchStatus: true,
    canFile: true,
    requiresContract: true,
  },
  isConfigured: () =>
    Boolean(process.env.GSP_GST_BASE_URL && process.env.GSP_GST_CLIENT_ID && process.env.GSP_GST_CLIENT_SECRET),
  async fetchFilingStatus() {
    throw new ProviderNotOnboardedError(
      "gsp-gst",
      "No GSP contract configured. Set GSP_GST_BASE_URL / GSP_GST_CLIENT_ID / GSP_GST_CLIENT_SECRET once the firm is onboarded with a GST Suvidha Provider."
    );
  },
};
