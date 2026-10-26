// Microsoft Teams + Outlook calls made with the connected account's
// delegated token (see delegated.ts).

import { getDelegatedToken } from "./delegated";

const GRAPH = "https://graph.microsoft.com/v1.0";

async function graph<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getDelegatedToken();
  const res = await fetch(path.startsWith("http") ? path : `${GRAPH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (res.status === 429 || res.status === 503) {
    // One polite retry after Graph's advertised back-off.
    const wait = Number(res.headers.get("retry-after") ?? 2) * 1000;
    await new Promise((r) => setTimeout(r, Math.min(wait, 10_000)));
    return graph<T>(path, init);
  }
  if (!res.ok) {
    throw new Error(`Graph ${init.method ?? "GET"} ${path} failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
  }
  if (res.status === 202 || res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface TeamSummary {
  id: string;
  displayName: string;
  description: string | null;
}

export interface ChannelSummary {
  id: string;
  displayName: string;
  webUrl: string | null;
  membershipType: string | null;
}

/** Every team the connected account is a member of (follows paging). */
export async function listJoinedTeams(): Promise<TeamSummary[]> {
  const out: TeamSummary[] = [];
  let url: string | null = `/me/joinedTeams?$select=id,displayName,description`;
  while (url) {
    const page: { value: TeamSummary[]; "@odata.nextLink"?: string } = await graph(url);
    out.push(...page.value.map((t) => ({ ...t, description: t.description ?? null })));
    url = page["@odata.nextLink"] ?? null;
  }
  return out;
}

export async function listChannels(teamId: string): Promise<ChannelSummary[]> {
  const page = await graph<{ value: ChannelSummary[] }>(
    `/teams/${teamId}/channels?$select=id,displayName,webUrl,membershipType`
  );
  return page.value;
}

export async function getPrimaryChannel(teamId: string): Promise<ChannelSummary | null> {
  try {
    return await graph<ChannelSummary>(`/teams/${teamId}/primaryChannel?$select=id,displayName,webUrl`);
  } catch {
    return null;
  }
}

export interface Mention {
  /** Entra object id of the user. */
  id: string;
  displayName: string;
}

/**
 * Posts an HTML message. `mentions` are rendered as @-mentions: reference
 * them in `html` as `<at id="0">Name</at>`, `<at id="1">…</at>` in order.
 */
export async function postChannelMessage(
  teamId: string,
  channelId: string,
  html: string,
  mentions: Mention[] = []
): Promise<{ id: string; webUrl: string | null }> {
  const body = {
    body: { contentType: "html", content: html },
    mentions: mentions.map((m, i) => ({
      id: i,
      mentionText: m.displayName,
      mentioned: { user: { id: m.id, displayName: m.displayName, userIdentityType: "aadUser" } },
    })),
  };
  const res = await graph<{ id: string; webUrl?: string }>(
    `/teams/${teamId}/channels/${channelId}/messages`,
    { method: "POST", body: JSON.stringify(body) }
  );
  return { id: res.id, webUrl: res.webUrl ?? null };
}

/** Looks up a tenant user by UPN/email for @-mentions. Null when not found. */
export async function findUser(email: string): Promise<Mention | null> {
  try {
    const u = await graph<{ id: string; displayName: string }>(
      `/users/${encodeURIComponent(email)}?$select=id,displayName`
    );
    return { id: u.id, displayName: u.displayName };
  } catch {
    return null;
  }
}

export async function sendMail(to: string[], subject: string, html: string): Promise<void> {
  if (!to.length) return;
  await graph("/me/sendMail", {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: false,
    }),
  });
}

export async function whoAmI(): Promise<{ displayName: string; mail: string | null }> {
  const me = await graph<{ displayName: string; mail?: string; userPrincipalName?: string }>(
    `/me?$select=displayName,mail,userPrincipalName`
  );
  return { displayName: me.displayName, mail: me.mail ?? me.userPrincipalName ?? null };
}
