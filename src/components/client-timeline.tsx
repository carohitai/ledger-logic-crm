// One stream for everything said to and from a client: Outlook mail, WhatsApp
// and calls, newest first. Replaces the two side-by-side "Calls done" and
// "WhatsApp messages sent" cards, which could not show what actually happened
// in what order.

import {
  callSummary,
  formatWhen,
  type Channel,
  type CommunicationItem,
} from "@/lib/inbox/types";

const CHANNEL_STYLE: Record<
  Channel,
  { label: string; bg: string; fg: string; icon: React.ReactNode }
> = {
  email: {
    label: "Email",
    bg: "var(--brand-blue-pale)",
    fg: "var(--brand-blue-deep)",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4.24-8 4.76-8-4.76V6l8 4.76L20 6z" />
      </svg>
    ),
  },
  whatsapp: {
    label: "WhatsApp",
    bg: "var(--brand-green-pale)",
    fg: "var(--earth-moss)",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M17.6 6.32A7.85 7.85 0 0 0 12 4a7.94 7.94 0 0 0-6.9 11.9L4 20l4.2-1.1a7.9 7.9 0 0 0 3.8 1h.01a7.94 7.94 0 0 0 5.59-13.58zM12 18.5a6.5 6.5 0 0 1-3.3-.9l-.24-.14-2.45.64.65-2.39-.16-.25A6.5 6.5 0 1 1 12 18.5z" />
      </svg>
    ),
  },
  call: {
    label: "Call",
    bg: "rgba(201,154,78,0.15)",
    fg: "#8F6A2E",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24 11.4 11.4 0 0 0 3.6.58 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.4 11.4 0 0 0 .57 3.6 1 1 0 0 1-.25 1z" />
      </svg>
    ),
  },
};

function DirectionChip({ direction }: { direction: "in" | "out" }) {
  const incoming = direction === "in";
  return (
    <span
      className="shrink-0 px-2 py-[1px] text-[10px] font-bold uppercase"
      style={{
        letterSpacing: "0.08em",
        borderRadius: "var(--radius-pill)",
        background: incoming ? "var(--paper-3)" : "transparent",
        border: incoming ? "none" : "1px solid var(--border-strong)",
        color: incoming ? "var(--ink-700)" : "var(--ink-400)",
      }}
    >
      {incoming ? "In" : "Out"}
    </span>
  );
}

export function TimelineItem({
  item,
  clientName,
  staffName,
}: {
  item: CommunicationItem;
  clientName?: string | null;
  staffName?: string | null;
}) {
  const style = CHANNEL_STYLE[item.channel];
  const body = item.channel === "call" ? callSummary(item) : item.body;
  const attachments = (item.meta?.attachments as string[] | undefined) ?? [];

  return (
    <li className="px-[22px] py-3.5" style={{ borderTop: "1px solid var(--ink-100)" }}>
      <div className="flex flex-wrap items-center gap-2.5">
        <span
          className="inline-flex items-center gap-1.5 px-2 py-[2px] text-[10.5px] font-bold uppercase"
          style={{
            letterSpacing: "0.06em",
            borderRadius: "var(--radius-pill)",
            background: style.bg,
            color: style.fg,
          }}
        >
          {style.icon}
          {style.label}
        </span>
        <DirectionChip direction={item.direction} />

        <span
          className="min-w-0 flex-1 truncate text-[12.5px] font-bold"
          style={{ color: "var(--ink-900)" }}
        >
          {item.title ?? "—"}
        </span>

        <span
          className="whitespace-nowrap text-[11.5px] tabular-nums"
          style={{ color: "var(--ink-400)" }}
        >
          {formatWhen(item.occurred_at)}
        </span>
      </div>

      <div
        className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]"
        style={{ color: "var(--ink-400)" }}
      >
        {clientName && <span style={{ color: "var(--brand-blue-deep)" }}>{clientName}</span>}
        {item.counterparty && <span className="font-mono">{item.counterparty}</span>}
        {staffName && <span>by {staffName}</span>}
        {attachments.length > 0 && (
          <span title={attachments.join(", ")}>
            📎 {attachments.length} attachment{attachments.length > 1 ? "s" : ""}
          </span>
        )}
        {item.web_link && (
          <a
            href={item.web_link}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
            style={{ color: "var(--brand-blue)" }}
          >
            Open in Outlook
          </a>
        )}
      </div>

      {body && (
        <p
          className="m-0 mt-2 whitespace-pre-wrap px-3 py-2.5 text-[12.5px] leading-relaxed"
          style={{
            color: "var(--ink-700)",
            background: item.direction === "out" ? "var(--brand-green-pale)" : "var(--paper-2)",
            borderRadius:
              item.direction === "out"
                ? "var(--radius-md) var(--radius-md) var(--radius-md) 2px"
                : "var(--radius-md) var(--radius-md) 2px var(--radius-md)",
          }}
        >
          {body}
        </p>
      )}
    </li>
  );
}

export function ClientTimeline({
  items,
  staffNames,
  emptyMessage = "No calls, messages or mail recorded for this client yet.",
}: {
  items: CommunicationItem[];
  staffNames?: Map<string, string>;
  emptyMessage?: string;
}) {
  if (!items.length) {
    return (
      <p className="px-[22px] pb-5 text-sm" style={{ color: "var(--ink-400)" }}>
        {emptyMessage}
      </p>
    );
  }
  return (
    <ul className="m-0 max-h-[560px] list-none overflow-y-auto p-0">
      {items.map((item) => (
        <TimelineItem
          key={`${item.channel}-${item.id}`}
          item={item}
          staffName={item.staff_id ? staffNames?.get(item.staff_id) : null}
        />
      ))}
    </ul>
  );
}
