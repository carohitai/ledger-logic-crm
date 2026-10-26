// Delegated Microsoft Graph access for posting into Teams and sending mail.
//
// Graph only lets *users* (delegated tokens) post channel messages — the
// app-only client-credentials flow in graph.ts can read the SharePoint sheet
// but cannot talk in Teams. So an admin connects their Microsoft 365 account
// once (Integrations screen); the refresh token is stored server-side and the
// cron / change notifier act on their behalf. Messages appear as posted by
// that account.
//
// Reuses the same Entra app registration as graph.ts (GRAPH_TENANT_ID /
// GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET). The app registration needs
// `${APP_URL}/api/microsoft/callback` as a Web redirect URI and the delegated
// scopes listed below.

import { createServiceClient } from "@/lib/supabase/service";

const PROVIDER = "microsoft";
const GRAPH = "https://graph.microsoft.com/v1.0";

export const DELEGATED_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "User.ReadBasic.All",
  "Team.ReadBasic.All",
  "Channel.ReadBasic.All",
  "ChannelMessage.Send",
  "Mail.Send",
];

export function delegatedConfigured(): boolean {
  return Boolean(
    process.env.GRAPH_TENANT_ID && process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET
  );
}

function tokenEndpoint(): string {
  return `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`;
}

/** Absolute callback URL. APP_URL wins (stable prod domain); else the request origin. */
export function redirectUri(origin: string): string {
  const base = (process.env.APP_URL ?? origin).replace(/\/$/, "");
  return `${base}/api/microsoft/callback`;
}

export function authorizeUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GRAPH_CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectUri(origin),
    response_mode: "query",
    scope: DELEGATED_SCOPES.join(" "),
    state,
    prompt: "select_account",
  });
  return `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/authorize?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(tokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GRAPH_CLIENT_ID!,
      client_secret: process.env.GRAPH_CLIENT_SECRET!,
      ...body,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Microsoft token request failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
  }
  return (await res.json()) as TokenResponse;
}

export interface Connection {
  account_upn: string | null;
  account_name: string | null;
  scopes: string | null;
  updated_at: string;
}

/** Completes the OAuth code flow and stores the resulting tokens. */
export async function connectWithCode(code: string, origin: string): Promise<Connection> {
  const tok = await requestToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(origin),
    scope: DELEGATED_SCOPES.join(" "),
  });
  if (!tok.refresh_token) {
    throw new Error("Microsoft did not return a refresh token — was offline_access consented?");
  }
  const meRes = await fetch(`${GRAPH}/me?$select=displayName,userPrincipalName,mail`, {
    headers: { Authorization: `Bearer ${tok.access_token}` },
    cache: "no-store",
  });
  const me = meRes.ok
    ? ((await meRes.json()) as { displayName?: string; userPrincipalName?: string; mail?: string })
    : {};

  const row = {
    provider: PROVIDER,
    account_upn: me.mail ?? me.userPrincipalName ?? null,
    account_name: me.displayName ?? null,
    scopes: tok.scope ?? DELEGATED_SCOPES.join(" "),
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const db = createServiceClient();
  const { error } = await db.from("integration_tokens").upsert(row, { onConflict: "provider" });
  if (error) throw error;
  return row;
}

export async function getConnection(): Promise<Connection | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("integration_tokens")
    .select("account_upn, account_name, scopes, updated_at")
    .eq("provider", PROVIDER)
    .maybeSingle();
  return (data as Connection | null) ?? null;
}

export async function disconnect(): Promise<void> {
  const db = createServiceClient();
  await db.from("integration_tokens").delete().eq("provider", PROVIDER);
}

export class NotConnectedError extends Error {
  constructor() {
    super("Microsoft 365 is not connected. An admin must connect an account on the Integrations screen.");
    this.name = "NotConnectedError";
  }
}

/**
 * Returns a valid delegated access token, refreshing (and persisting the
 * rotated refresh token) when the stored one is within two minutes of expiry.
 */
export async function getDelegatedToken(): Promise<string> {
  if (!delegatedConfigured()) {
    throw new Error("Microsoft Graph is not configured (GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET)");
  }
  const db = createServiceClient();
  const { data, error } = await db
    .from("integration_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotConnectedError();

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  if (data.access_token && Date.now() < expiresAt - 120_000) {
    return data.access_token as string;
  }

  const tok = await requestToken({
    grant_type: "refresh_token",
    refresh_token: data.refresh_token as string,
    scope: DELEGATED_SCOPES.join(" "),
  });
  await db
    .from("integration_tokens")
    .update({
      access_token: tok.access_token,
      // Entra rotates refresh tokens; keep the newest one.
      refresh_token: tok.refresh_token ?? data.refresh_token,
      expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("provider", PROVIDER);
  return tok.access_token;
}
