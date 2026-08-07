// Provider registry: which source, if any, can answer for a department.

import { eriIncomeTaxProvider } from "./eri-income-tax";
import { gspGstProvider } from "./gsp-gst";
import { manualProvider } from "./manual";
import { publicGstProvider } from "./public-gst";
import type { ComplianceProvider, Department, ProviderKey } from "./types";

export * from "./types";

const ALL: ComplianceProvider[] = [
  gspGstProvider, // preferred for GST when a contract exists
  publicGstProvider, // free fallback, no contract
  eriIncomeTaxProvider,
  manualProvider,
];

export function providerByKey(key: ProviderKey): ComplianceProvider | undefined {
  return ALL.find((p) => p.key === key);
}

/**
 * The provider that should actually be used for a department right now, or
 * null when nothing is onboarded. Order in ALL is the preference order, so a
 * GSP automatically takes over from the public endpoint once configured.
 */
export function activeProviderFor(department: Department): ComplianceProvider | null {
  return (
    ALL.find(
      (p) =>
        p.capabilities.departments.includes(department) &&
        p.capabilities.canFetchStatus &&
        p.isConfigured()
    ) ?? null
  );
}

/** Backs an admin panel: what each department can currently do, and why. */
export function providerMatrix(): {
  department: Department;
  provider: string;
  configured: boolean;
  note: string;
}[] {
  return [
    {
      department: "gst",
      provider: activeProviderFor("gst")?.label ?? "None",
      configured: Boolean(activeProviderFor("gst")),
      note: "Full GSTN APIs need a licensed GSP contract. The free public GSTIN lookup can report return-filing status without one.",
    },
    {
      department: "income_tax",
      provider: activeProviderFor("income_tax")?.label ?? "None",
      configured: Boolean(activeProviderFor("income_tax")),
      note: "Official ERI Type-2 API. Requires the firm to register as an e-Return Intermediary and hold a DSC.",
    },
    {
      department: "tds",
      provider: "Manual",
      configured: false,
      note: "TRACES exposes no API. Portal only.",
    },
    {
      department: "professional_tax",
      provider: "Manual",
      configured: false,
      note: "MahaGST exposes no API for PTRC/PTEC. Portal only.",
    },
    {
      department: "accounting",
      provider: "Manual",
      configured: false,
      note: "Internal work; no external source to reconcile against.",
    },
  ];
}
