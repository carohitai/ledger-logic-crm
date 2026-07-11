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

async function graphPatch(url: string, token: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Graph request failed (${res.status}): ${await res.text()}`);
  }
}

const cell = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const upperCell = (v: unknown) => cell(v).toUpperCase();

/** 0-based column index → A1 letters (0 → A, 26 → AA). */
function colLetter(idx: number): string {
  let n = idx + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function letterToIdx(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Writes edited client fields back into the linked master workbook so the
 * sheet stays in step with in-app edits. The row is located by the client's
 * PRE-EDIT identity (PAN, else name + trade name — the same keys the import
 * uses), and `updates` maps sheet headers to new cell values.
 *
 * Requires the Entra app to have write access to the file (Sites.ReadWrite.All,
 * or a "write" role grant on Sites.Selected); a 403 here means it only has read.
 */
export async function updateClientListRow(
  match: { pan: string | null; name: string; tradeName: string | null },
  updates: Record<string, string>
): Promise<{ updatedCells: number }> {
  const token = await getToken();

  const wsRes = await graphGet(`${itemUrl()}/workbook/worksheets?$select=id,name`, token);
  const sheets = ((await wsRes.json()) as { value: { id: string; name: string }[] }).value;
  if (!sheets?.length) throw new Error("Workbook has no worksheets");
  // The import reads the first sheet; write back to the same one.
  const base = `${itemUrl()}/workbook/worksheets/${encodeURIComponent(sheets[0].id)}`;

  const urRes = await graphGet(`${base}/usedRange?$select=address,values`, token);
  const ur = (await urRes.json()) as { address: string; values: unknown[][] };
  const addr = ur.address.match(/!\$?([A-Z]+)\$?(\d+)/);
  if (!addr || !ur.values?.length) throw new Error("Could not read the sheet's used range");
  const startCol = letterToIdx(addr[1]);
  const startRow = Number(addr[2]);

  const headerIdx = new Map<string, number>();
  ur.values[0].forEach((h, i) => {
    const key = cell(h);
    if (key) headerIdx.set(key.toUpperCase(), i);
  });
  const col = (header: string) => headerIdx.get(header.toUpperCase());

  const panCol = col("PAN");
  const nameCol = col("Name of Client");
  const tradeCol = col("TRADE NAME");
  if (nameCol === undefined) throw new Error(`Sheet is missing a "Name of Client" column`);

  const hits: number[] = [];
  for (let i = 1; i < ur.values.length; i++) {
    const row = ur.values[i];
    const found = match.pan
      ? panCol !== undefined && upperCell(row[panCol]) === match.pan.toUpperCase()
      : upperCell(row[nameCol]) === match.name.toUpperCase().replace(/\s+/g, " ").trim() &&
        (tradeCol === undefined || upperCell(row[tradeCol]) === (match.tradeName ?? "").toUpperCase().replace(/\s+/g, " ").trim());
    if (found) hits.push(i);
  }
  const key = match.pan ? `PAN ${match.pan}` : `name "${match.name}"`;
  if (hits.length === 0) throw new Error(`No sheet row matches ${key}`);
  if (hits.length > 1) throw new Error(`${hits.length} sheet rows match ${key} — fix the sheet, then re-import`);

  const rowIdx = hits[0];
  const row = ur.values[rowIdx];
  let updatedCells = 0;
  for (const [header, value] of Object.entries(updates)) {
    const c = col(header);
    if (c === undefined) continue; // column absent from the sheet — nothing to write
    if (cell(row[c]) === cell(value)) continue;
    const address = `${colLetter(startCol + c)}${startRow + rowIdx}`;
    await graphPatch(`${base}/range(address='${address}')`, token, { values: [[value]] });
    updatedCells++;
  }
  return { updatedCells };
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
