// Microsoft Graph link to the master client list on SharePoint.
//
// Uses an Entra app registration with application permissions
// (Sites.Selected granted on the admin-team site, or Sites.Read.All) via the
// client-credentials flow — no user token needed, so imports and future cron
// syncs work server-side.

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// Default link: "Client List Final 22062026.xlsx" in the admin-team site,
// Shared Documents/Client List. Override via env when the master file moves.
const DEFAULT_DRIVE_ID =
  "b!gkhfAoiKxEqNs-1-u-BlBQhLF__OhidLvOZ2e9uo-ujqpiM87EpaS4oaZK6SEHm4";
const DEFAULT_ITEM_ID = "01ZCJMRVW767CC57XANVEIYYATN47FDELC";

function itemUrl(): string {
  const driveId = process.env.GRAPH_CLIENT_LIST_DRIVE_ID || DEFAULT_DRIVE_ID;
  const itemId = process.env.GRAPH_CLIENT_LIST_ITEM_ID || DEFAULT_ITEM_ID;
  return `${GRAPH_BASE}/drives/${driveId}/items/${itemId}`;
}

export function graphConfigured(): boolean {
  return Boolean(
    process.env.GRAPH_TENANT_ID &&
      process.env.GRAPH_CLIENT_ID &&
      process.env.GRAPH_CLIENT_SECRET
  );
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }
  const tenant = process.env.GRAPH_TENANT_ID!;
  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.GRAPH_CLIENT_ID!,
        client_secret: process.env.GRAPH_CLIENT_SECRET!,
        scope: "https://graph.microsoft.com/.default",
      }),
      cache: "no-store",
    }
  );
  if (!res.ok) {
    throw new Error(`Graph auth failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return json.access_token;
}

async function graphGet(url: string, token: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Graph request failed (${res.status}): ${await res.text()}`);
  }
  return res;
}

export interface LinkedFile {
  name: string;
  webUrl: string;
  lastModified: string;
  size: number;
}

export async function getClientListMetadata(): Promise<LinkedFile> {
  const token = await getToken();
  const res = await graphGet(
    `${itemUrl()}?$select=name,webUrl,lastModifiedDateTime,size`,
    token
  );
  const json = (await res.json()) as {
    name: string;
    webUrl: string;
    lastModifiedDateTime: string;
    size: number;
  };
  return {
    name: json.name,
    webUrl: json.webUrl,
    lastModified: json.lastModifiedDateTime,
    size: json.size,
  };
}

/** Downloads the linked workbook. Graph 302-redirects to a pre-authenticated URL. */
export async function downloadClientList(): Promise<{
  name: string;
  buf: ArrayBuffer;
}> {
  const token = await getToken();
  const meta = await getClientListMetadata();
  const res = await graphGet(`${itemUrl()}/content`, token);
  return { name: meta.name, buf: await res.arrayBuffer() };
}

export type LinkStatus =
  | { configured: false }
  | { configured: true; error: string }
  | { configured: true; error: null; file: LinkedFile };

/** Non-throwing status for the import page banner. */
export async function getLinkStatus(): Promise<LinkStatus> {
  if (!graphConfigured()) return { configured: false };
  try {
    return { configured: true, error: null, file: await getClientListMetadata() };
  } catch (e) {
    return {
      configured: true,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
