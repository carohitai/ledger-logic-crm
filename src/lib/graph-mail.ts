// Reading firm Outlook mailboxes through Microsoft Graph.
//
// Uses the SAME Entra app registration and client-credentials token cache the
// SharePoint import already uses (src/lib/graph.ts) — no second app, no
// per-user OAuth. What it additionally needs from the tenant admin, once:
//
//   1. Add the APPLICATION permission `Mail.Read` and grant admin consent.
//      (`Mail.ReadBasic.All` is not enough — it excludes bodyPreview.)
//   2. SCOPE IT. By default an application-permission `Mail.Read` can read
//      EVERY mailbox in the tenant. Restrict it to the firm mailboxes:
//
//        New-ApplicationAccessPolicy -AppId <GRAPH_CLIENT_ID> `
//          -PolicyScopeGroupId ka-crm-mailboxes@<domain> `
//          -AccessRight RestrictAccess -Description "KA CRM inbox"
//
//      This policy is the security boundary and is not optional. It can take
//      ~30 minutes to propagate. Until it exists, do not grant the permission.
//
// A denied read surfaces as HTTP 403 with "Access to OData is disabled" or
// ErrorAccessDenied; we detect that string and write an actionable message to
// mailboxes.last_error rather than a generic failure.

import { GRAPH_BASE, graphFetch } from "./graph";

/** Fields we ask Graph for. Body is deliberately absent — see below. */
const SELECT = [
  "id",
  "internetMessageId",
  "conversationId",
  "subject",
  "bodyPreview",
  "from",
  "toRecipients",
  "ccRecipients",
  "hasAttachments",
  "webLink",
  "sentDateTime",
  "receivedDateTime",
  "isDraft",
].join(",");

export interface GraphAddress {
  name?: string;
  address?: string;
}

export interface GraphMessage {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  from?: { emailAddress?: GraphAddress };
  toRecipients?: { emailAddress?: GraphAddress }[];
  ccRecipients?: { emailAddress?: GraphAddress }[];
  hasAttachments?: boolean;
  webLink?: string;
  sentDateTime?: string;
  receivedDateTime?: string;
  isDraft?: boolean;
  "@removed"?: { reason?: string };
}

export interface DeltaPage {
  messages: GraphMessage[];
  /** Persist this and resume from it next call. */
  nextCursor: string | null;
  /** Present when the round is complete; persist as the delta link. */
  deltaLink: string | null;
}

export class GraphMailError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds: number | null = null,
    readonly isAccessDenied = false
  ) {
    super(message);
    this.name = "GraphMailError";
  }
}

function addressOf(r?: { emailAddress?: GraphAddress }): string | null {
  const a = r?.emailAddress?.address?.trim().toLowerCase();
  return a && a.length ? a : null;
}

export function recipientAddresses(
  list: { emailAddress?: GraphAddress }[] | undefined
): string[] {
  return [...new Set((list ?? []).map(addressOf).filter((a): a is string => !!a))];
}

export function senderAddress(m: GraphMessage): string | null {
  return addressOf(m.from);
}

async function readPage(url: string): Promise<DeltaPage> {
  const res = await graphFetch(url, {
    headers: {
      // 50 messages a page keeps each round well inside the function budget.
      Prefer: 'odata.maxpagesize=50, outlook.body-content-type="text"',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    const retryAfter = Number(res.headers.get("retry-after")) || null;
    const denied =
      res.status === 403 &&
      /access is denied|accessdenied|access to odata is disabled/i.test(text);
    throw new GraphMailError(
      denied
        ? "Graph refused the mailbox. Grant Mail.Read (Application) with admin " +
          "consent and add an Application Access Policy covering this mailbox."
        : `Graph mail request failed (${res.status}): ${text.slice(0, 300)}`,
      res.status,
      retryAfter,
      denied
    );
  }

  const json = (await res.json()) as {
    value?: GraphMessage[];
    "@odata.nextLink"?: string;
    "@odata.deltaLink"?: string;
  };

  return {
    messages: json.value ?? [],
    nextCursor: json["@odata.nextLink"] ?? null,
    deltaLink: json["@odata.deltaLink"] ?? null,
  };
}

/**
 * Builds the FIRST delta URL for a mailbox.
 *
 * The `receivedDateTime ge` filter is what stops a first run from ingesting a
 * decade of mail: Graph bakes the filter into the nextLink/deltaLink it
 * returns, so it applies for the whole round and then disappears once we are
 * on a delta cursor. Graph only supports `receivedDateTime ge|gt` here.
 *
 * Caveat from Microsoft's docs: a delta query carrying a $filter returns at
 * most 5,000 messages. Callers should treat "exactly 5000 ingested on the
 * first round" as a signal to reduce the backfill window.
 */
export function initialDeltaUrl(upn: string, sinceIso: string): string {
  const params = new URLSearchParams({
    $select: SELECT,
    $filter: `receivedDateTime ge ${sinceIso}`,
  });
  return `${GRAPH_BASE}/users/${encodeURIComponent(upn)}/messages/delta?${params}`;
}

/** Reads one page, from either a stored cursor/deltaLink or an initial URL. */
export function readDeltaPage(url: string): Promise<DeltaPage> {
  return readPage(url);
}

/**
 * Attachment names only — never contentBytes. $select keeps Graph from
 * serialising the file contents, so this stays cheap; the CRM links out to
 * Outlook via webLink rather than storing any blob.
 */
export async function attachmentNames(
  upn: string,
  messageId: string
): Promise<string[]> {
  const url =
    `${GRAPH_BASE}/users/${encodeURIComponent(upn)}/messages/` +
    `${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline`;
  const res = await graphFetch(url);
  if (!res.ok) return [];
  const json = (await res.json()) as {
    value?: { name?: string; isInline?: boolean }[];
  };
  return (json.value ?? [])
    .filter((a) => !a.isInline)
    .map((a) => a.name ?? "attachment");
}

export function graphMailConfigured(): boolean {
  return Boolean(
    process.env.GRAPH_TENANT_ID &&
      process.env.GRAPH_CLIENT_ID &&
      process.env.GRAPH_CLIENT_SECRET
  );
}

/** Domains that are the firm itself, used to tell inbound from outbound. */
export function firmDomains(): string[] {
  return (process.env.FIRM_MAIL_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function isFirmAddress(address: string | null, upns: string[]): boolean {
  if (!address) return false;
  if (upns.includes(address)) return true;
  const domain = address.split("@")[1] ?? "";
  return firmDomains().includes(domain);
}
