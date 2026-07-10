// Server-only Yeastar P-Series (Linkus) Cloud PBX client for click-to-call.
// Credentials come from env and never reach the browser.
//
// Env vars (server-only):
//   YEASTAR_API_URL       full OpenAPI base, e.g. https://<pbx-domain>/openapi/v1.0
//   YEASTAR_CLIENT_ID     OpenAPI client ID (PBX → Integrations → OpenAPI)
//   YEASTAR_CLIENT_SECRET OpenAPI client secret
//   YEASTAR_DIAL_PREFIX   optional outbound prefix (e.g. "0" for mobiles)
//
// P-Series Cloud PBX serves the OpenAPI over HTTPS on port 443 at
// `https://<domain>/openapi/v1.0` — do NOT append a management port like :8088,
// which the cloud domain does not expose (that was why calls failed here).

const CLIENT_ID = process.env.YEASTAR_CLIENT_ID;
const CLIENT_SECRET = process.env.YEASTAR_CLIENT_SECRET;
// Optional prefix the PBX outbound route needs (e.g. "0" for mobiles). Default none.
const DIAL_PREFIX = process.env.YEASTAR_DIAL_PREFIX ?? "";

// Prefer a full base URL (as the working World School CRM uses). Fall back to
// building one from a bare domain, honouring an explicit port only if given —
// never defaulting to :8088.
const API_URL =
  process.env.YEASTAR_API_URL ??
  (process.env.YEASTAR_PBX_DOMAIN
    ? `https://${process.env.YEASTAR_PBX_DOMAIN}${
        process.env.YEASTAR_PORT ? `:${process.env.YEASTAR_PORT}` : ""
      }/openapi/v1.0`
    : undefined);

const base = () => {
  if (!API_URL) {
    throw new Error("Yeastar API URL is not configured (set YEASTAR_API_URL)");
  }
  return API_URL;
};

// Module-level token cache. Persists across requests on a warm serverless
// instance; a cold start simply re-authenticates.
let cached: { token: string; expiresAt: number } | null = null;

export function yeastarConfigured(): boolean {
  return Boolean(API_URL && CLIENT_ID && CLIENT_SECRET);
}

/**
 * Fetch against the PBX with a timeout, surfacing network-level failures as a
 * readable error naming the host and cause (DNS, refused, timeout, TLS…)
 * instead of undici's bare "fetch failed".
 */
async function pbxFetch(pathAndQuery: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const url = `${base()}${pathAndQuery}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    const cause =
      (e as { cause?: { code?: string; message?: string } }).cause?.code ??
      (e as { cause?: { code?: string; message?: string } }).cause?.message ??
      (e instanceof Error ? e.name === "TimeoutError" ? "timed out after 8s" : e.message : String(e));
    throw new Error(
      `Could not reach the PBX at ${new URL(url).host} (${cause}). Check YEASTAR_API_URL.`
    );
  }
  try {
    return await res.json();
  } catch {
    throw new Error(`PBX returned a non-JSON response (HTTP ${res.status}) — is YEASTAR_API_URL pointing at /openapi/v1.0?`);
  }
}

async function getToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
  if (!API_URL || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Yeastar credentials are not configured");
  }

  const data = await pbxFetch(`/get_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: CLIENT_ID, password: CLIENT_SECRET }),
  });
  if (data.errcode !== 0 || !data.access_token) {
    throw new Error(`Yeastar auth failed: ${data.errmsg ?? "no access token returned"}`);
  }
  cached = {
    token: String(data.access_token),
    expiresAt: Date.now() + (Number(data.access_token_expire_time ?? 1800)) * 1000,
  };
  return cached.token;
}

/**
 * Config + connectivity health-check for diagnostics. Reports which env vars
 * are present and whether a token can be fetched — never returns secrets.
 */
export async function probeYeastar(): Promise<{
  configured: boolean;
  apiHost: string | null;
  env: Record<string, boolean | string | null>;
  ok: boolean;
  error?: string;
}> {
  const env = {
    YEASTAR_API_URL: Boolean(process.env.YEASTAR_API_URL),
    YEASTAR_PBX_DOMAIN: Boolean(process.env.YEASTAR_PBX_DOMAIN),
    YEASTAR_PORT: process.env.YEASTAR_PORT ?? null,
    YEASTAR_CLIENT_ID: Boolean(CLIENT_ID),
    YEASTAR_CLIENT_SECRET: Boolean(CLIENT_SECRET),
  };
  let apiHost: string | null = null;
  try {
    apiHost = API_URL ? new URL(API_URL).host : null;
  } catch {
    return { configured: false, apiHost: API_URL ?? null, env, ok: false, error: "YEASTAR_API_URL is not a valid URL" };
  }
  if (!yeastarConfigured()) {
    return { configured: false, apiHost, env, ok: false, error: "Missing YEASTAR_API_URL / YEASTAR_CLIENT_ID / YEASTAR_CLIENT_SECRET" };
  }
  try {
    cached = null; // force a live round-trip
    await getToken();
    return { configured: true, apiHost, env, ok: true };
  } catch (e) {
    return { configured: true, apiHost, env, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Keep digits only; apply the configured outbound prefix. */
export function normalizeNumber(raw: string): string {
  let n = (raw ?? "").replace(/\D/g, "");
  // Drop a leading country code 91 for 12-digit Indian numbers so the
  // outbound route sees the expected local form.
  if (n.length === 12 && n.startsWith("91")) n = n.slice(2);
  return DIAL_PREFIX + n;
}

export interface CdrRecord {
  call_id: string;
  disposition: string; // ANSWERED | NO ANSWER | BUSY | FAILED | VOICEMAIL
  call_from_number: string;
  call_to_number: string;
  timestamp: number; // unix seconds
  duration?: number;
  ring_duration?: number;
}

/**
 * Normalise one raw CDR row into `CdrRecord`. Yeastar P-Series returns fields
 * like `id`, `time` ("YYYY-MM-DD HH:MM:SS", PBX local time / IST), `call_from`,
 * `call_to`, `disposition`; older firmware uses slightly different names. We
 * read every known alias so a valid record is produced regardless of version.
 */
function toCdrRecord(r: Record<string, unknown>): CdrRecord {
  const timeStr = String(r.time ?? r.start_time ?? "");
  const tsNumeric = Number(r.timestamp ?? r.time_stamp ?? 0);
  const timestamp =
    tsNumeric > 0
      ? tsNumeric
      : timeStr
        ? Math.floor(Date.parse(`${timeStr.replace(" ", "T")}+05:30`) / 1000) || 0
        : 0;
  return {
    call_id: String(r.call_id ?? r.id ?? r.uid ?? ""),
    disposition: String(r.disposition ?? r.status ?? "").toUpperCase(),
    call_from_number: String(r.call_from ?? r.call_from_number ?? r.src ?? ""),
    call_to_number: String(r.call_to ?? r.call_to_number ?? r.dst ?? ""),
    timestamp,
    duration: Number(r.duration ?? 0),
    ring_duration: Number(r.ring_duration ?? 0),
  };
}

/**
 * Fetches recent CDR records covering calls since `sinceTimestamp` (unix
 * seconds). The PBX returns records oldest-first, so we read from the last
 * page backwards until we pass the window.
 */
export async function recentCdr(sinceTimestamp: number): Promise<CdrRecord[]> {
  const token = await getToken();
  const pageSize = 100;
  const first = await pbxFetch(
    `/cdr/search?access_token=${encodeURIComponent(token)}&page=1&page_size=1`
  );
  if (first.errcode !== 0) throw new Error(`CDR query failed: ${first.errmsg}`);

  const total = Number(first.total_number ?? 0);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const out: CdrRecord[] = [];

  for (let page = lastPage; page >= 1; page--) {
    const res = await pbxFetch(
      `/cdr/search?access_token=${encodeURIComponent(token)}&page=${page}&page_size=${pageSize}`
    );
    if (res.errcode !== 0) throw new Error(`CDR query failed: ${res.errmsg}`);
    const raw = (res.data ?? res.cdr_list ?? []) as Record<string, unknown>[];
    const rows: CdrRecord[] = raw.map(toCdrRecord);
    out.push(...rows);
    const oldestOnPage = rows.length ? Math.min(...rows.map((r) => r.timestamp)) : 0;
    if (oldestOnPage < sinceTimestamp || page === 1) break;
  }
  return out.filter((r) => r.timestamp >= sinceTimestamp);
}

/**
 * Click-to-call: rings `caller` (an internal extension) first, then dials
 * `callee`. Returns the PBX call id on success.
 */
export async function dial(caller: string, callee: string): Promise<string> {
  const token = await getToken();
  const data = await pbxFetch(`/call/dial?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caller, callee }),
  });
  if (data.errcode !== 0) {
    // A stale cached token surfaces as an auth error — clear and retry once.
    if (cached && (data.errcode === 10003 || data.errcode === 10005)) {
      cached = null;
      return dial(caller, callee);
    }
    throw new Error(`Dial failed: ${data.errmsg ?? "unknown error"}`);
  }
  return String(data.call_id ?? data.id ?? "");
}
