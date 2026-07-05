// Server-only Yeastar P-Series Cloud PBX client for click-to-call.
// Credentials come from env and never reach the browser.

const DOMAIN = process.env.YEASTAR_PBX_DOMAIN;
const PORT = process.env.YEASTAR_PORT ?? "8088";
const CLIENT_ID = process.env.YEASTAR_CLIENT_ID;
const CLIENT_SECRET = process.env.YEASTAR_CLIENT_SECRET;
// Optional prefix the PBX outbound route needs (e.g. "0" for mobiles). Default none.
const DIAL_PREFIX = process.env.YEASTAR_DIAL_PREFIX ?? "";

const base = () => `https://${DOMAIN}:${PORT}/openapi/v1.0`;

// Module-level token cache. Persists across requests on a warm serverless
// instance; a cold start simply re-authenticates.
let cached: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
  if (!DOMAIN || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Yeastar credentials are not configured");
  }

  const res = await fetch(`${base()}/get_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: CLIENT_ID, password: CLIENT_SECRET }),
    cache: "no-store",
  });
  const data = await res.json();
  if (data.errcode !== 0 || !data.access_token) {
    throw new Error(`Yeastar auth failed: ${data.errmsg ?? res.status}`);
  }
  cached = {
    token: data.access_token,
    expiresAt: Date.now() + (data.access_token_expire_time ?? 1800) * 1000,
  };
  return cached.token;
}

/** Keep digits only; apply the configured outbound prefix. */
export function normalizeNumber(raw: string): string {
  let n = (raw ?? "").replace(/\D/g, "");
  // Drop a leading country code 91 for 12-digit Indian numbers so the
  // outbound route sees the expected local form.
  if (n.length === 12 && n.startsWith("91")) n = n.slice(2);
  return DIAL_PREFIX + n;
}

/**
 * Click-to-call: rings `caller` (an internal extension) first, then dials
 * `callee`. Returns the PBX call id on success.
 */
export async function dial(caller: string, callee: string): Promise<string> {
  const token = await getToken();
  const res = await fetch(`${base()}/call/dial?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caller, callee }),
    cache: "no-store",
  });
  const data = await res.json();
  if (data.errcode !== 0) {
    // A stale cached token surfaces as an auth error — clear and retry once.
    if (cached && (data.errcode === 10003 || data.errcode === 10005)) {
      cached = null;
      return dial(caller, callee);
    }
    throw new Error(`Dial failed: ${data.errmsg ?? "unknown error"}`);
  }
  return data.call_id ?? "";
}
