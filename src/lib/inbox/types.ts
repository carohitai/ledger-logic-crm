// Shape of one row from the `communications` view — the union of email,
// WhatsApp and call activity. Shared by the client timeline, the firm-wide
// inbox and the triage queue so they cannot drift apart.

export type Channel = "email" | "whatsapp" | "call";

export interface CommunicationItem {
  channel: Channel;
  id: string;
  client_id: string | null;
  direction: "in" | "out";
  title: string | null;
  body: string | null;
  occurred_at: string;
  counterparty: string | null;
  staff_id: string | null;
  web_link: string | null;
  thread_key: string | null;
  meta: Record<string, unknown> | null;
}

export const CHANNEL_LABELS: Record<Channel, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  call: "Call",
};

/** Columns to select from the view. Listed once so every caller agrees. */
export const COMMUNICATION_COLUMNS =
  "channel, id, client_id, direction, title, body, occurred_at, counterparty, staff_id, web_link, thread_key, meta";

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Call rows carry their PBX status in meta; surface it as readable text. */
export function callSummary(item: CommunicationItem): string {
  const status = String(item.meta?.status ?? "");
  const seconds = Number(item.meta?.duration_seconds ?? 0);
  const label =
    {
      answered: "Answered",
      placed: "Call placed",
      unanswered: "No answer",
      scheduled: "Callback scheduled",
      abandoned: "No CDR match",
    }[status] ?? status;
  if (!seconds) return label;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${label} · ${mins ? `${mins}m ` : ""}${secs}s`;
}
