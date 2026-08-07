// Pulls firm Outlook mailboxes into email_messages.
//
// Runs under the service role from the cron dispatcher, so RLS does not apply
// here — every read/write is deliberate and scoped by mailbox.
//
// Resumability is the design constraint: the delta cursor is persisted after
// EVERY page, not at the end of a round. A function timeout, a 429 or a deploy
// mid-run therefore costs at most one page of re-fetching instead of restarting
// a 90-day backfill.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GraphMailError,
  attachmentNames,
  graphMailConfigured,
  initialDeltaUrl,
  isFirmAddress,
  readDeltaPage,
  recipientAddresses,
  senderAddress,
  type GraphMessage,
} from "../graph-mail";
import { matchClientByAddresses } from "../match";

const BACKFILL_DAYS = Number(process.env.MAIL_SYNC_BACKFILL_DAYS ?? 90);
const MAX_PAGES = Number(process.env.MAIL_SYNC_MAX_PAGES ?? 10);

/** Graph caps a delta query carrying a $filter at 5,000 messages. */
const FILTERED_DELTA_CEILING = 5000;

interface MailboxRow {
  id: string;
  upn: string;
  delta_link: string | null;
  backfilled_at: string | null;
}

export interface MailSyncSummary {
  mailboxes: number;
  fetched: number;
  inserted: number;
  matched: number;
  unmatched: number;
  deduped: number;
  errors: string[];
  warnings: string[];
}

/**
 * Seeds `mailboxes` from GRAPH_MAILBOXES the first time only. After that the
 * table is the source of truth and mailboxes are managed in /admin/mailboxes,
 * so adding one does not need a redeploy.
 */
export async function seedMailboxes(db: SupabaseClient): Promise<void> {
  const upns = (process.env.GRAPH_MAILBOXES ?? "")
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
  if (!upns.length) return;
  await db
    .from("mailboxes")
    .upsert(
      upns.map((upn) => ({ upn })),
      { onConflict: "upn", ignoreDuplicates: true }
    );
}

function toRow(
  m: GraphMessage,
  mailboxId: string,
  upn: string,
  allUpns: string[]
) {
  const from = senderAddress(m);
  const to = recipientAddresses(m.toRecipients);
  const cc = recipientAddresses(m.ccRecipients);
  const receivedAt = m.receivedDateTime ?? m.sentDateTime ?? new Date().toISOString();

  return {
    mailbox_id: mailboxId,
    graph_id: m.id,
    internet_message_id: m.internetMessageId ?? null,
    conversation_id: m.conversationId ?? null,
    // Sent by us if the sender is one of our mailboxes or on a firm domain.
    direction: isFirmAddress(from, allUpns) ? "out" : "in",
    subject: m.subject ?? null,
    body_preview: m.bodyPreview ?? null,
    from_address: from,
    from_name: m.from?.emailAddress?.name ?? null,
    to_addresses: to,
    cc_addresses: cc,
    has_attachments: Boolean(m.hasAttachments),
    web_link: m.webLink ?? null,
    sent_at: m.sentDateTime ?? null,
    received_at: receivedAt,
    seen_in_mailboxes: [upn],
    client_id: null as string | null,
  };
}

/** External participants only — matching on a colleague's address is useless. */
function externalParticipants(
  row: ReturnType<typeof toRow>,
  allUpns: string[]
): string[] {
  return [row.from_address, ...row.to_addresses, ...row.cc_addresses]
    .filter((a): a is string => !!a)
    .filter((a) => !isFirmAddress(a, allUpns));
}

/**
 * Falls back to the thread when no address resolves. This is what makes triage
 * compound: once a human attributes one message in a conversation, every later
 * reply attaches itself automatically.
 */
async function inheritFromConversation(
  db: SupabaseClient,
  conversationId: string | null
): Promise<string | null> {
  if (!conversationId) return null;
  const { data } = await db
    .from("email_messages")
    .select("client_id")
    .eq("conversation_id", conversationId)
    .not("client_id", "is", null)
    .limit(1);
  return data?.[0]?.client_id ?? null;
}

async function syncOneMailbox(
  db: SupabaseClient,
  mailbox: MailboxRow,
  allUpns: string[],
  summary: MailSyncSummary
): Promise<void> {
  let url = mailbox.delta_link;
  let firstRound = false;

  if (!url) {
    firstRound = true;
    const since = new Date(Date.now() - BACKFILL_DAYS * 86_400_000).toISOString();
    url = initialDeltaUrl(mailbox.upn, since);
  }

  let ingestedThisRound = 0;

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const result = await readDeltaPage(url);
    summary.fetched += result.messages.length;
    ingestedThisRound += result.messages.length;

    await persistMessages(db, result.messages, mailbox, allUpns, summary);

    // Persist the cursor before doing anything else, so an interruption after
    // this point never re-reads the page we just stored.
    url = result.nextCursor ?? result.deltaLink;
    await db
      .from("mailboxes")
      .update({
        delta_link: url,
        last_synced_at: new Date().toISOString(),
        last_error: null,
        ...(result.deltaLink && firstRound
          ? { backfilled_at: new Date().toISOString() }
          : {}),
      })
      .eq("id", mailbox.id);

    if (result.deltaLink) break; // round complete
  }

  if (firstRound && ingestedThisRound >= FILTERED_DELTA_CEILING) {
    summary.warnings.push(
      `${mailbox.upn}: hit Graph's 5,000-message ceiling for a filtered delta ` +
        `query. Lower MAIL_SYNC_BACKFILL_DAYS (currently ${BACKFILL_DAYS}) and ` +
        `clear this mailbox's delta_link to re-seed, or mail older than the ` +
        `cutoff may be missing.`
    );
  }
}

async function persistMessages(
  db: SupabaseClient,
  messages: GraphMessage[],
  mailbox: MailboxRow,
  allUpns: string[],
  summary: MailSyncSummary
): Promise<void> {
  // Delta re-emits a message when it changes and sends @removed on delete.
  // Drafts are noise — they are not correspondence with anyone yet.
  const live = messages.filter((m) => !m["@removed"] && !m.isDraft && m.id);
  if (!live.length) return;

  const rows = live.map((m) => toRow(m, mailbox.id, mailbox.upn, allUpns));

  // Dedupe against what we already hold. The same physical mail legitimately
  // appears in two firm mailboxes; we keep one row and record both mailboxes.
  const graphIds = rows.map((r) => r.graph_id);
  const imids = rows.map((r) => r.internet_message_id).filter((v): v is string => !!v);

  const [{ data: byGraph }, { data: byImid }] = await Promise.all([
    db.from("email_messages").select("graph_id").in("graph_id", graphIds),
    imids.length
      ? db
          .from("email_messages")
          .select("id, internet_message_id, seen_in_mailboxes")
          .in("internet_message_id", imids)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const knownGraphIds = new Set((byGraph ?? []).map((r) => r.graph_id as string));
  const knownByImid = new Map(
    (byImid ?? []).map((r) => [
      r.internet_message_id as string,
      r as { id: string; seen_in_mailboxes: string[] },
    ])
  );

  const fresh: typeof rows = [];

  for (const row of rows) {
    const twin = row.internet_message_id
      ? knownByImid.get(row.internet_message_id)
      : undefined;

    if (twin) {
      // Same mail, different mailbox: record the sighting, don't duplicate it.
      summary.deduped++;
      if (!twin.seen_in_mailboxes?.includes(mailbox.upn)) {
        await db
          .from("email_messages")
          .update({
            seen_in_mailboxes: [...(twin.seen_in_mailboxes ?? []), mailbox.upn],
          })
          .eq("id", twin.id);
      }
      continue;
    }
    if (knownGraphIds.has(row.graph_id)) {
      summary.deduped++;
      continue;
    }
    fresh.push(row);
  }

  if (!fresh.length) return;

  for (const row of fresh) {
    const participants = externalParticipants(row, allUpns);
    row.client_id =
      (await matchClientByAddresses(db, participants)) ??
      (await inheritFromConversation(db, row.conversation_id));
    if (row.client_id) summary.matched++;
    else summary.unmatched++;

    // Names only, and only when there is something to name. Attachment bodies
    // are never fetched — the CRM links out to Outlook instead.
    if (row.has_attachments) {
      try {
        const names = await attachmentNames(mailbox.upn, row.graph_id);
        if (names.length) {
          (row as Record<string, unknown>).raw = { attachments: names };
        }
      } catch {
        // Attachment metadata is a nicety; never fail ingest over it.
      }
    }
  }

  const { error } = await db
    .from("email_messages")
    .upsert(fresh, { onConflict: "graph_id", ignoreDuplicates: true });
  if (error) summary.errors.push(`${mailbox.upn}: ${error.message}`);
  else summary.inserted += fresh.length;
}

export async function runMailSync(db: SupabaseClient): Promise<MailSyncSummary> {
  const summary: MailSyncSummary = {
    mailboxes: 0,
    fetched: 0,
    inserted: 0,
    matched: 0,
    unmatched: 0,
    deduped: 0,
    errors: [],
    warnings: [],
  };

  if (!graphMailConfigured()) {
    summary.errors.push("Graph is not configured (GRAPH_TENANT_ID / CLIENT_ID / CLIENT_SECRET)");
    return summary;
  }

  await seedMailboxes(db);

  const { data: mailboxes } = await db
    .from("mailboxes")
    .select("id, upn, delta_link, backfilled_at")
    .eq("is_active", true)
    .order("upn")
    .returns<MailboxRow[]>();

  if (!mailboxes?.length) {
    summary.warnings.push(
      "No active mailboxes. Add one in /admin/mailboxes or set GRAPH_MAILBOXES."
    );
    return summary;
  }

  const allUpns = mailboxes.map((m) => m.upn.toLowerCase());

  // Sequential, never parallel: Graph throttles per app per mailbox and a
  // fan-out here is the fastest way to earn a 429 across every mailbox at once.
  for (const mailbox of mailboxes) {
    summary.mailboxes++;
    try {
      await syncOneMailbox(db, mailbox, allUpns, summary);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      summary.errors.push(`${mailbox.upn}: ${message}`);
      await db
        .from("mailboxes")
        .update({ last_error: message, last_synced_at: new Date().toISOString() })
        .eq("id", mailbox.id);

      // A 429 applies to the whole app, so stop the round rather than marching
      // through the remaining mailboxes collecting more of them.
      if (e instanceof GraphMailError && e.status === 429) {
        summary.warnings.push(
          `Throttled by Graph; retry after ${e.retryAfterSeconds ?? "?"}s. ` +
            `Remaining mailboxes deferred to the next run.`
        );
        break;
      }
    }
  }

  return summary;
}
