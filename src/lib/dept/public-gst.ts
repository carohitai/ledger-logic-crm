// GST return-filing status from the free public GSTIN search.
//
// This is the only GST source that works without a GSP contract. It returns,
// per GSTIN, the list of returns filed with their type, period, filing date and
// ARN — enough to tell whether a GSTR-1/3B for a period has actually been
// filed, which is exactly what a compliance task needs to close itself.
//
// It is an unofficial endpoint, so:
//   * the URL lives in env and can be swapped without a deploy;
//   * ANY failure yields state "unknown", never "not_filed". Reporting an
//     outage as "not filed" would mark the whole client base delinquent and
//     bury staff in false overdue alerts;
//   * results carry confidence "public", which reconcile.ts permits to mark a
//     task filed but never to mark it verified.
//
// Off by default: set DEPT_PROVIDER_GST=public-gst and PUBLIC_GST_API_URL.

import {
  unknownStatus,
  type ComplianceProvider,
  type FilingStatus,
  type ProviderClientRef,
} from "./types";

const TIMEOUT_MS = 8000;

/** '2026-07' -> '072026'; '2026-Q1' -> '062026' (quarter's last month). */
function toReturnPeriod(periodKey: string): string | null {
  const monthly = periodKey.match(/^(\d{4})-(\d{2})$/);
  if (monthly) return `${monthly[2]}${monthly[1]}`;
  const quarterly = periodKey.match(/^(\d{4})-Q([1-4])$/);
  if (quarterly) {
    const fyStart = Number(quarterly[1]);
    const q = Number(quarterly[2]);
    const endMonth = [6, 9, 12, 3][q - 1];
    const year = q === 4 ? fyStart + 1 : fyStart;
    return `${String(endMonth).padStart(2, "0")}${year}`;
  }
  return null;
}

interface PublicReturnRow {
  rtntype?: string; // 'GSTR1' | 'GSTR3B' | ...
  ret_prd?: string; // 'MMYYYY'
  dof?: string; // date of filing, 'DD/MM/YYYY'
  arn?: string;
  status?: string;
}

/** 'DD/MM/YYYY' -> ISO. Returns null on anything unexpected. */
function toIsoDate(dof: string | undefined): string | null {
  const m = (dof ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export const publicGstProvider: ComplianceProvider = {
  key: "public-gst",
  label: "GST public return status (no contract)",
  capabilities: {
    departments: ["gst"],
    forms: ["GSTR1", "GSTR3B", "GSTR9"],
    canFetchStatus: true,
    canFile: false,
    requiresContract: false,
  },

  isConfigured: () =>
    process.env.DEPT_PROVIDER_GST === "public-gst" && Boolean(process.env.PUBLIC_GST_API_URL),

  async fetchFilingStatus(
    client: ProviderClientRef,
    { formCode, periodKey }
  ): Promise<FilingStatus[]> {
    if (!client.gstin) {
      return [unknownStatus("gst", formCode, periodKey, "Client has no GSTIN on record.")];
    }
    const wanted = toReturnPeriod(periodKey);
    if (!wanted) {
      return [unknownStatus("gst", formCode, periodKey, `Unsupported period key ${periodKey}.`)];
    }

    const base = process.env.PUBLIC_GST_API_URL!;
    const url = `${base}${base.includes("?") ? "&" : "?"}gstin=${encodeURIComponent(client.gstin)}`;

    let payload: { returns?: PublicReturnRow[]; filing?: PublicReturnRow[] };
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: process.env.PUBLIC_GST_API_KEY
          ? { Authorization: `Bearer ${process.env.PUBLIC_GST_API_KEY}` }
          : undefined,
      });
      if (!res.ok) {
        return [
          unknownStatus("gst", formCode, periodKey, `Public GST lookup returned HTTP ${res.status}.`),
        ];
      }
      payload = await res.json();
    } catch (e) {
      // Timeout, DNS, TLS, malformed JSON — all "we do not know", never
      // "they did not file".
      return [
        unknownStatus(
          "gst",
          formCode,
          periodKey,
          `Public GST lookup failed: ${e instanceof Error ? e.message : String(e)}`
        ),
      ];
    }

    const rows = payload.returns ?? payload.filing ?? [];
    const match = rows.find(
      (r) =>
        (r.rtntype ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase() === formCode.toUpperCase() &&
        r.ret_prd === wanted
    );

    const now = new Date().toISOString();
    if (match) {
      return [
        {
          department: "gst",
          formCode,
          periodKey,
          state: "filed",
          filedOn: toIsoDate(match.dof),
          reference: match.arn ?? null,
          confidence: "public",
          raw: match,
          fetchedAt: now,
        },
      ];
    }

    // The endpoint answered and this return is genuinely absent from the list.
    // Only in this case is "not filed" a real observation rather than a guess.
    return [
      {
        department: "gst",
        formCode,
        periodKey,
        state: rows.length ? "not_filed" : "unknown",
        filedOn: null,
        reference: null,
        confidence: "public",
        reason: rows.length ? undefined : "Lookup returned no filing history for this GSTIN.",
        fetchedAt: now,
      },
    ];
  },
};
