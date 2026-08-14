// PAN / GST lookup layer.
//
// Indian GST and PAN data is resold by many vendors (Sandbox, Surepass,
// MasterGST, KYC providers…) but they all wrap the same GSTN/ITD payloads, so
// this module talks to ONE configurable REST endpoint and normalises whatever
// shape comes back. Point it at your vendor with:
//
//   COMPLIANCE_API_BASE_URL    https://api.vendor.in/v1
//   COMPLIANCE_API_KEY         <key>
//   COMPLIANCE_API_KEY_HEADER  Authorization      (default)
//   COMPLIANCE_API_KEY_PREFIX  "Bearer "          (default; set "" for raw keys)
//   COMPLIANCE_GST_PATH          /gst/{gstin}                 (default)
//   COMPLIANCE_GST_RETURNS_PATH  /gst/{gstin}/returns?fy={fy} (default)
//   COMPLIANCE_PAN_PATH          /pan/{pan}                   (default)
//   COMPLIANCE_PAN_GSTINS_PATH   /gst/search-by-pan/{pan}     (default)
//
// With no base URL configured the provider falls back to `mock`, which returns
// deterministic synthetic data so the task rules and the UI can be exercised
// end to end before vendor credentials exist. Never leave mock on in
// production: set COMPLIANCE_API_PROVIDER=rest once the vendor is wired.

import { createHash } from "crypto";
import { normalizeReturnPeriod } from "./periods";

export type GstFrequency = "MONTHLY" | "QUARTERLY";

export interface GstReturnFiling {
  /** GSTR1 / GSTR3B / GSTR9 … as reported. */
  type: string;
  /** Filing period as `YYYY-MM` (quarterly filings carry the quarter's last month). */
  period: string;
  /** Date of filing, `YYYY-MM-DD`, when the vendor reports one. */
  filedOn: string | null;
  arn: string | null;
}

export interface GstSnapshot {
  gstin: string;
  legalName: string | null;
  tradeName: string | null;
  /** Registration status as reported: Active / Cancelled / Suspended / … */
  status: string | null;
  registeredOn: string | null;
  cancelledOn: string | null;
  frequency: GstFrequency | null;
  returns: GstReturnFiling[];
}

export interface PanSnapshot {
  pan: string;
  /** VALID / INVALID / DEACTIVATED / … as reported. */
  status: string | null;
  name: string | null;
  /** GSTINs registered against this PAN, when the vendor exposes the lookup. */
  gstins: { gstin: string; status: string | null }[];
}

export interface ProviderResult<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
  /** Raw vendor response, stored on the snapshot for audit / debugging. */
  raw: unknown;
}

export interface ComplianceProvider {
  name: string;
  fetchGst(gstin: string, financialYears: string[]): Promise<ProviderResult<GstSnapshot>>;
  fetchPan(pan: string): Promise<ProviderResult<PanSnapshot>>;
}

// ------------------------------------------------------------- helpers ----

type Json = Record<string, unknown>;

function isJson(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Vendors wrap the GSTN payload in data / result / response / taxpayerInfo. */
function unwrap(body: unknown): Json {
  let node: unknown = body;
  for (let depth = 0; depth < 4 && isJson(node); depth++) {
    const inner =
      node.data ?? node.result ?? node.response ?? node.taxpayerInfo ?? node.details;
    if (!isJson(inner) && !Array.isArray(inner)) break;
    node = inner;
  }
  return isJson(node) ? node : isJson(body) ? body : {};
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function pick(obj: Json, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = str(obj[k]);
    if (v) return v;
  }
  return null;
}

/** GSTN dates come as `dd/mm/yyyy` or `dd-mm-yyyy`; ISO passes through. */
function toIsoDate(raw: string | null): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(raw);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * Filing frequency. GSTN reports it per quarter as `{"Apr-Jun": "Q", …}`;
 * vendors also flatten it to a string. "Q" (or anything containing QUARTER)
 * means QRMP.
 */
function normalizeFrequency(node: unknown): GstFrequency | null {
  if (!node) return null;
  if (typeof node === "string") {
    const s = node.toUpperCase();
    if (s === "Q" || s.includes("QUART")) return "QUARTERLY";
    if (s === "M" || s.includes("MONTH")) return "MONTHLY";
    return null;
  }
  if (isJson(node)) {
    // Take the most recent non-empty quarter value.
    const values = Object.values(node).map(str).filter(Boolean) as string[];
    const last = values[values.length - 1];
    return last ? normalizeFrequency(last) : null;
  }
  return null;
}

function normalizeFilings(body: unknown): GstReturnFiling[] {
  const root = unwrap(body);
  const candidates: unknown[] = [];
  for (const key of ["EFiledlist", "efiledlist", "returns", "filings", "data", "list"]) {
    const v = (root as Json)[key];
    if (Array.isArray(v)) candidates.push(...v);
  }
  if (!candidates.length && Array.isArray(body)) candidates.push(...body);

  const out: GstReturnFiling[] = [];
  for (const item of candidates) {
    if (!isJson(item)) continue;
    const type = (pick(item, "rtntype", "return_type", "returnType", "type") ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    const period = normalizeReturnPeriod(
      pick(item, "ret_prd", "retPrd", "period", "tax_period", "taxPeriod")
    );
    if (!type || !period) continue;
    out.push({
      type,
      period,
      filedOn: toIsoDate(pick(item, "dof", "date_of_filing", "filedOn", "filing_date")),
      arn: pick(item, "arn", "ARN"),
    });
  }
  return out;
}

function normalizeTaxpayer(gstin: string, body: unknown): GstSnapshot {
  const root = unwrap(body);
  return {
    gstin: (pick(root, "gstin", "gstIn", "gstinId") ?? gstin).toUpperCase(),
    legalName: pick(root, "lgnm", "legal_name", "legalName", "name"),
    tradeName: pick(root, "tradeNam", "trade_name", "tradeName"),
    status: pick(root, "sts", "status", "gstinStatus", "registration_status"),
    registeredOn: toIsoDate(pick(root, "rgdt", "registration_date", "registrationDate")),
    cancelledOn: toIsoDate(pick(root, "cxdt", "cancellation_date", "cancellationDate")),
    frequency: normalizeFrequency(
      root.fillingFreq ?? root.filingFrequency ?? root.frequency ?? root.returnFrequency
    ),
    returns: [],
  };
}

function normalizePan(pan: string, body: unknown): PanSnapshot {
  const root = unwrap(body);
  const nameParts = [
    pick(root, "first_name", "firstName"),
    pick(root, "middle_name", "middleName"),
    pick(root, "last_name", "lastName"),
  ].filter(Boolean);
  return {
    pan: (pick(root, "pan", "panNumber", "pan_number") ?? pan).toUpperCase(),
    status: pick(root, "status", "pan_status", "panStatus", "sts"),
    name:
      pick(root, "name", "full_name", "fullName", "registered_name", "lgnm") ??
      (nameParts.length ? nameParts.join(" ") : null),
    gstins: [],
  };
}

function normalizePanGstins(body: unknown): { gstin: string; status: string | null }[] {
  const root = unwrap(body);
  const list: unknown[] = [];
  for (const key of ["gstinList", "gstin_list", "gstins", "data", "list"]) {
    const v = (root as Json)[key];
    if (Array.isArray(v)) list.push(...v);
  }
  if (!list.length && Array.isArray(body)) list.push(...body);

  const out: { gstin: string; status: string | null }[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      out.push({ gstin: item.toUpperCase(), status: null });
    } else if (isJson(item)) {
      const gstin = pick(item, "gstin", "gstIn", "gstinId");
      if (gstin) out.push({ gstin: gstin.toUpperCase(), status: pick(item, "status", "sts") });
    }
  }
  return out;
}

// ---------------------------------------------------------- REST vendor ----

const TIMEOUT_MS = Number(process.env.COMPLIANCE_API_TIMEOUT_MS ?? 15000);

function fillPath(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) =>
    encodeURIComponent(vars[key] ?? "")
  );
}

async function callVendor(path: string): Promise<ProviderResult<unknown>> {
  const base = (process.env.COMPLIANCE_API_BASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.COMPLIANCE_API_KEY ?? "";
  const header = process.env.COMPLIANCE_API_KEY_HEADER ?? "Authorization";
  const prefix = process.env.COMPLIANCE_API_KEY_PREFIX ?? "Bearer ";

  const headers: Record<string, string> = { Accept: "application/json" };
  if (key) headers[header] = `${prefix}${key}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // leave as text; normalisers cope with an empty object
    }
    if (!res.ok) {
      return {
        ok: false,
        data: null,
        error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        raw: body,
      };
    }
    return { ok: true, data: body, error: null, raw: body };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, data: null, error: message, raw: null };
  } finally {
    clearTimeout(timer);
  }
}

const restProvider: ComplianceProvider = {
  name: "rest",

  async fetchGst(gstin, financialYears) {
    const taxpayer = await callVendor(
      fillPath(process.env.COMPLIANCE_GST_PATH ?? "/gst/{gstin}", { gstin })
    );
    if (!taxpayer.ok) {
      return { ok: false, data: null, error: taxpayer.error, raw: taxpayer.raw };
    }
    const snapshot = normalizeTaxpayer(gstin, taxpayer.data);

    // Return history is usually a second call, once per financial year.
    const returnsPath = process.env.COMPLIANCE_GST_RETURNS_PATH ?? "/gst/{gstin}/returns?fy={fy}";
    const rawReturns: unknown[] = [];
    for (const fy of financialYears) {
      const res = await callVendor(fillPath(returnsPath, { gstin, fy }));
      if (!res.ok) {
        // A missing return history must not void the registration data we do
        // have — record it and let the rules work with what arrived.
        rawReturns.push({ fy, error: res.error });
        continue;
      }
      rawReturns.push({ fy, body: res.raw });
      snapshot.returns.push(...normalizeFilings(res.data));
    }

    return {
      ok: true,
      data: snapshot,
      error: null,
      raw: { taxpayer: taxpayer.raw, returns: rawReturns },
    };
  },

  async fetchPan(pan) {
    const res = await callVendor(fillPath(process.env.COMPLIANCE_PAN_PATH ?? "/pan/{pan}", { pan }));
    if (!res.ok) return { ok: false, data: null, error: res.error, raw: res.raw };
    const snapshot = normalizePan(pan, res.data);

    const gstinPath = process.env.COMPLIANCE_PAN_GSTINS_PATH ?? "/gst/search-by-pan/{pan}";
    let rawGstins: unknown = null;
    if (gstinPath) {
      const g = await callVendor(fillPath(gstinPath, { pan }));
      rawGstins = g.raw;
      if (g.ok) snapshot.gstins = normalizePanGstins(g.data);
    }

    return { ok: true, data: snapshot, error: null, raw: { pan: res.raw, gstins: rawGstins } };
  },
};

// ----------------------------------------------------------------- mock ----

/** Stable 0..n-1 bucket for an identifier, so mock data doesn't flap per run. */
function bucket(seed: string, n: number): number {
  const hash = createHash("sha256").update(seed).digest();
  return hash[0] % n;
}

const mockProvider: ComplianceProvider = {
  name: "mock",

  async fetchGst(gstin, financialYears) {
    const variant = bucket(gstin, 6);
    const quarterly = bucket(`${gstin}:freq`, 3) === 0;
    const status = variant === 4 ? "Cancelled" : variant === 5 ? "Suspended" : "Active";

    // Everything filed except the most recent period(s) for some taxpayers —
    // enough variety to exercise every rule in development.
    const returns: GstReturnFiling[] = [];
    const now = new Date();
    const skip = variant % 3; // 0 = all filed, 1 = last month open, 2 = last two
    for (let i = 1 + skip; i <= 12; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      for (const type of ["GSTR1", "GSTR3B"]) {
        returns.push({ type, period, filedOn: null, arn: `MOCK${type}${period}` });
      }
    }

    return {
      ok: true,
      data: {
        gstin,
        legalName: null,
        tradeName: null,
        status,
        registeredOn: "2017-07-01",
        cancelledOn: status === "Cancelled" ? "2026-03-31" : null,
        frequency: quarterly ? "QUARTERLY" : "MONTHLY",
        returns,
      },
      error: null,
      raw: { mock: true, gstin, financialYears },
    };
  },

  async fetchPan(pan) {
    const variant = bucket(pan, 8);
    return {
      ok: true,
      data: {
        pan,
        status: variant === 7 ? "INOPERATIVE" : "VALID",
        name: null,
        gstins: [],
      },
      error: null,
      raw: { mock: true, pan },
    };
  },
};

// --------------------------------------------------------------- config ----

export function providerName(): string {
  const configured = (process.env.COMPLIANCE_API_PROVIDER ?? "").toLowerCase();
  if (configured === "rest" || configured === "mock") return configured;
  return process.env.COMPLIANCE_API_BASE_URL ? "rest" : "mock";
}

/** True once a real vendor endpoint is configured (i.e. not running on mock). */
export function complianceConfigured(): boolean {
  return providerName() === "rest" && Boolean(process.env.COMPLIANCE_API_BASE_URL);
}

export function getProvider(): ComplianceProvider {
  return providerName() === "rest" ? restProvider : mockProvider;
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

export function isValidPan(pan: string | null | undefined): boolean {
  return PAN_RE.test((pan ?? "").toUpperCase().trim());
}

export function isValidGstin(gstin: string | null | undefined): boolean {
  return GSTIN_RE.test((gstin ?? "").toUpperCase().trim());
}

/** Characters 3-12 of a GSTIN are the holder's PAN. */
export function panFromGstin(gstin: string): string | null {
  const g = gstin.toUpperCase().trim();
  return isValidGstin(g) ? g.slice(2, 12) : null;
}
