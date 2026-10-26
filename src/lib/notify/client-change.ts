// Fan-out for "a client record changed": Teams (the client's own team + the
// firm-wide channel), Outlook (the client's incharges) and Periskope (an
// internal staff WhatsApp group). Every attempt is written to
// notification_log so the Integrations screen can show what went where.
//
// Nothing here is client-facing: the client's WhatsApp group id is stored but
// deliberately not used, so an allotment reshuffle never reaches the client.

import type { SupabaseClient } from "@supabase/supabase-js";
import { labelFor, type ChangeSet } from "@/lib/client-profile";
import { ROLE_LABELS, type AllotmentRole } from "@/lib/import/normalize";
import { getSettings, type AppSettings } from "@/lib/settings";
import { NotConnectedError } from "@/lib/microsoft/delegated";
import { findUser, postChannelMessage, sendMail, type Mention } from "@/lib/microsoft/teams";
import { periskopeConfigured, sendPeriskopeMessage } from "@/lib/periskope";

export type ChangeKind =
  | "created"
  | "updated"
  | "allotment_change"
  | "sheet_insert"
  | "sheet_update"
  | "sheet_missing";

export interface ChangeNotice {
  clientId: string;
  activityId: string | null;
  kind: ChangeKind;
  changes: ChangeSet;
  /** Who made the change: a staff name, or "Master client sheet" for OneDrive edits. */
  actorName: string;
  /** Sheet syncs post one digest to the firm channel instead of a message per client. */
  skipFirmChannel?: boolean;
}

export interface NotifyOutcome {
  channel: "teams" | "outlook" | "periskope";
  target: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
}

const KIND_VERB: Record<ChangeKind, string> = {
  created: "was added in the CRM",
  updated: "was updated in the CRM",
  allotment_change: "has a new team allotment",
  sheet_insert: "was added to the master client sheet",
  sheet_update: "was changed in the master client sheet",
  sheet_missing: "was removed from the master client sheet",
};

interface ClientRow {
  id: string;
  name: string;
  trade_name: string | null;
  pan: string | null;
  category: string | null;
  teams_team_id: string | null;
  teams_channel_id: string | null;
  teams_team_name: string | null;
}

interface Incharge {
  role: AllotmentRole;
  name: string;
  email: string | null;
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function appUrl(path: string): string | null {
  const base = process.env.APP_URL?.replace(/\/$/, "");
  return base ? `${base}${path}` : null;
}

/** Rows of "Field: old → new" shared by every channel. */
function changeLines(changes: ChangeSet): { label: string; from: string; to: string }[] {
  return Object.entries(changes).map(([key, { from, to }]) => ({
    label: labelFor(key),
    from: show(from),
    to: show(to),
  }));
}

function buildHtml(client: ClientRow, incharges: Incharge[], notice: ChangeNotice, mentions: Mention[]): string {
  const lines = changeLines(notice.changes);
  const link = appUrl(`/clients/${client.id}`);
  const title = `<b>${esc(client.name)}</b>${client.trade_name && client.trade_name !== client.name ? ` (${esc(client.trade_name)})` : ""} ${esc(KIND_VERB[notice.kind])}.`;
  const list = lines.length
    ? `<ul>${lines
        .map((l) => `<li><b>${esc(l.label)}</b>: ${esc(l.from)} → ${esc(l.to)}</li>`)
        .join("")}</ul>`
    : "";
  const team = incharges.length
    ? `<p>Team: ${incharges
        .map((i) => `${esc(ROLE_LABELS[i.role])} – ${esc(i.name)}`)
        .join(" · ")}</p>`
    : "";
  const at = mentions.length
    ? `<p>${mentions.map((m, i) => `<at id="${i}">${esc(m.displayName)}</at>`).join(" ")} please take note.</p>`
    : "";
  const footer = `<p><i>By ${esc(notice.actorName)}${link ? ` · <a href="${link}">Open in Ledger Logic</a>` : ""}</i></p>`;
  return `<p>${title}</p>${list}${team}${at}${footer}`;
}

function buildText(client: ClientRow, incharges: Incharge[], notice: ChangeNotice): string {
  const lines = changeLines(notice.changes);
  const link = appUrl(`/clients/${client.id}`);
  const parts = [
    `*${client.name}* ${KIND_VERB[notice.kind]}.`,
    ...lines.map((l) => `• ${l.label}: ${l.from} → ${l.to}`),
  ];
  if (incharges.length) {
    parts.push(`Team: ${incharges.map((i) => `${ROLE_LABELS[i.role]} – ${i.name}`).join(" · ")}`);
  }
  parts.push(`_By ${notice.actorName}_${link ? `\n${link}` : ""}`);
  return parts.join("\n");
}

async function log(db: SupabaseClient, notice: ChangeNotice, o: NotifyOutcome) {
  await db.from("notification_log").insert({
    client_id: notice.clientId,
    activity_id: notice.activityId,
    channel: o.channel,
    target: o.target,
    status: o.status,
    error: o.error ?? null,
  });
}

const mentionCache = new Map<string, Mention | null>();
async function resolveMentions(incharges: Incharge[]): Promise<Mention[]> {
  const out: Mention[] = [];
  for (const i of incharges) {
    if (!i.email) continue;
    const key = i.email.toLowerCase();
    if (!mentionCache.has(key)) mentionCache.set(key, await findUser(i.email));
    const m = mentionCache.get(key);
    if (m && !out.some((x) => x.id === m.id)) out.push(m);
  }
  return out;
}

async function loadClient(db: SupabaseClient, clientId: string): Promise<{ client: ClientRow; incharges: Incharge[] } | null> {
  const [{ data: client }, { data: allotments }] = await Promise.all([
    db
      .from("clients")
      .select("id, name, trade_name, pan, category, teams_team_id, teams_channel_id, teams_team_name")
      .eq("id", clientId)
      .maybeSingle(),
    db
      .from("client_allotments")
      .select("role, staff:staff_id (full_name, email, is_active)")
      .eq("client_id", clientId),
  ]);
  if (!client) return null;
  const incharges: Incharge[] = [];
  for (const a of allotments ?? []) {
    const s = a.staff as unknown as { full_name: string; email: string | null; is_active: boolean } | null;
    if (!s || !s.is_active) continue;
    incharges.push({ role: a.role as AllotmentRole, name: s.full_name, email: s.email });
  }
  return { client: client as ClientRow, incharges };
}

/**
 * Sends one change notice everywhere the settings say to. Never throws:
 * each channel's failure is logged and returned.
 */
export async function notifyClientChange(
  db: SupabaseClient,
  notice: ChangeNotice,
  presetSettings?: AppSettings
): Promise<NotifyOutcome[]> {
  const outcomes: NotifyOutcome[] = [];
  const settings = presetSettings ?? (await getSettings(db));
  const loaded = await loadClient(db, notice.clientId);
  if (!loaded) return outcomes;
  const { client, incharges } = loaded;

  const attempt = async (channel: NotifyOutcome["channel"], target: string, fn: () => Promise<void>) => {
    let o: NotifyOutcome;
    try {
      await fn();
      o = { channel, target, status: "sent" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      o = { channel, target, status: e instanceof NotConnectedError ? "skipped" : "failed", error: msg };
    }
    outcomes.push(o);
    await log(db, notice, o);
  };

  // --- Teams: the client's own team ---
  const clientTeam =
    settings.notify_client_team && client.teams_team_id && client.teams_channel_id
      ? { teamId: client.teams_team_id, channelId: client.teams_channel_id }
      : null;
  let mentions: Mention[] = [];
  if (clientTeam || settings.firm_channel) {
    try {
      mentions = await resolveMentions(incharges);
    } catch {
      mentions = [];
    }
  }
  const html = buildHtml(client, incharges, notice, mentions);
  if (clientTeam) {
    await attempt("teams", client.teams_team_name ?? clientTeam.teamId, () =>
      postChannelMessage(clientTeam.teamId, clientTeam.channelId, html, mentions).then(() => undefined)
    );
  }

  // --- Teams: firm-wide channel (unless the sheet digest covers it) ---
  const firm = settings.firm_channel;
  if (firm && !notice.skipFirmChannel && firm.channelId !== clientTeam?.channelId) {
    await attempt("teams", `${firm.teamName} / ${firm.channelName}`, () =>
      postChannelMessage(firm.teamId, firm.channelId, html, mentions).then(() => undefined)
    );
  }

  // --- Outlook: incharges with an email ---
  if (settings.notify_outlook_incharges) {
    const to = [...new Set(incharges.map((i) => i.email).filter((e): e is string => Boolean(e)))];
    if (to.length) {
      await attempt("outlook", to.join(", "), () =>
        sendMail(to, `[Ledger Logic] ${client.name} ${KIND_VERB[notice.kind]}`, buildHtml(client, incharges, notice, []))
      );
    }
  }

  // --- Periskope: internal staff group ---
  if (settings.notify_periskope && settings.periskope_internal_chat_id) {
    const chat = settings.periskope_internal_chat_id;
    if (periskopeConfigured()) {
      await attempt("periskope", chat, () => sendPeriskopeMessage(chat, buildText(client, incharges, notice)));
    } else {
      const o: NotifyOutcome = { channel: "periskope", target: chat, status: "skipped", error: "Periskope not configured" };
      outcomes.push(o);
      await log(db, notice, o);
    }
  }

  return outcomes;
}

export interface DigestInput {
  fileName: string;
  fileUrl: string | null;
  counts: { insert: number; update: number; missing: number };
  changed: { clientId: string; clientName: string; kind: ChangeKind; changes: ChangeSet; teamName: string | null }[];
}

/** One firm-channel post summarising a master-sheet sync. */
export async function postSyncDigest(db: SupabaseClient, digest: DigestInput, presetSettings?: AppSettings): Promise<NotifyOutcome | null> {
  const settings = presetSettings ?? (await getSettings(db));
  const firm = settings.firm_channel;
  if (!firm) return null;

  const MAX = 40;
  const items = digest.changed.slice(0, MAX).map((c) => {
    const link = appUrl(`/clients/${c.clientId}`);
    const name = link ? `<a href="${link}">${esc(c.clientName)}</a>` : `<b>${esc(c.clientName)}</b>`;
    const what =
      c.kind === "sheet_insert"
        ? "new client"
        : c.kind === "sheet_missing"
          ? "removed from sheet"
          : changeLines(c.changes)
              .map((l) => `${esc(l.label)}: ${esc(l.from)} → ${esc(l.to)}`)
              .join("; ");
    const team = c.teamName ? "" : ' <i>(no Team mapped)</i>';
    return `<li>${name} — ${what}${team}</li>`;
  });
  const more = digest.changed.length > MAX ? `<p><i>…and ${digest.changed.length - MAX} more.</i></p>` : "";
  const file = digest.fileUrl ? `<a href="${digest.fileUrl}">${esc(digest.fileName)}</a>` : esc(digest.fileName);
  const html =
    `<p><b>Master client sheet synced</b> from ${file}: ` +
    `${digest.counts.insert} added, ${digest.counts.update} updated, ${digest.counts.missing} removed.</p>` +
    `<ul>${items.join("")}</ul>${more}`;

  let o: NotifyOutcome;
  try {
    await postChannelMessage(firm.teamId, firm.channelId, html);
    o = { channel: "teams", target: `${firm.teamName} / ${firm.channelName}`, status: "sent" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    o = {
      channel: "teams",
      target: `${firm.teamName} / ${firm.channelName}`,
      status: e instanceof NotConnectedError ? "skipped" : "failed",
      error: msg,
    };
  }
  await db.from("notification_log").insert({
    client_id: null,
    activity_id: null,
    channel: o.channel,
    target: o.target,
    status: o.status,
    error: o.error ?? null,
  });
  return o;
}
