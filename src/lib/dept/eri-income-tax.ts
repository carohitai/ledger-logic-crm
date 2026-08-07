// Income tax through the ITD's e-Return Intermediary (ERI) Type-2 API.
//
// This API is real and official — session login, add client with taxpayer
// consent, prefill, validate, submit, ITR status, e-verify — but it requires
// the firm to be registered as an ERI and to hold a Digital Signature
// Certificate. Declared, unimplemented, until that registration exists.

import {
  ProviderNotOnboardedError,
  type ComplianceProvider,
} from "./types";

export const eriIncomeTaxProvider: ComplianceProvider = {
  key: "eri-income-tax",
  label: "Income Tax via ERI (not yet registered)",
  capabilities: {
    departments: ["income_tax"],
    forms: ["ITR", "3CD"],
    canFetchStatus: true,
    canFile: true,
    requiresContract: true,
  },
  isConfigured: () => Boolean(process.env.ERI_BASE_URL && process.env.ERI_USER_ID && process.env.ERI_PASSWORD),
  async fetchFilingStatus() {
    throw new ProviderNotOnboardedError(
      "eri-income-tax",
      "The firm is not registered as an e-Return Intermediary. Registration plus a DSC is required before ERI_BASE_URL / ERI_USER_ID / ERI_PASSWORD can be set."
    );
  },
};
