// Firm-wide omnichannel inbox: everything said to and from clients, across
// Outlook, WhatsApp and the phone system, in one feed.
//
// Reads the `communications` view, which is security_invoker — so each channel
// is filtered by its own table's RLS and a staff member only ever sees clients
// they are allotted to. The Unmatched tab is admin/partner only for the same
// reason: an unattributed item has no client to scope it by.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TimelineItem } from "@/components/client-timeline";
import { COMMUNICATION_COLUMNS, type CommunicationItem } from "@/lib/inbox/types";
import { AssignRow, type ClientOption } from "./assign-row";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 60;

const cardStyle = {
  background: "var(--white)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-sm)",
} as const;

const CHANNELS = ["all", "email", "whatsapp", "call"] as const;

function Tab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 text-[12.5px] font-semibold no-underline"
      style={{
        borderRadius: "var(--radius-pill)",
        background: active ? "var(--brand-blue-deep)" : "var(--paper-2)",
        color: active ? "var(--white)" : "var(--ink-500)",
      }}
    >
      {children}
    </Link>
  );
}

export default async function InboxPage({
  searchParams,
}: {
  // Next 16: searchParams is a Promise and must be awaited.
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const channel = CHANNELS.includes(params.channel as never) ? params.channel! : "all";
  const view = params.view === "unmatched" ? "unmatched" : "all";
  const page = Math.max(0, Number(params.page ?? 0) || 0);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("staff")
    .select("id, app_role")
    .eq("auth_user_id", user!.id)
    .maybeSingle();
  const canTriage = me?.app_role === "admin" || me?.app_role === "partner";

  let query = supabase
    .from(view === "unmatched" ? "unmatched_comms" : "communications")
    .select(COMMUNICATION_COLUMNS)
    .order("occurred_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (channel !== "all") query = query.eq("channel", channel);

  const { data: rows, error } = await query.returns<CommunicationItem[]>();
  const items = rows ?? [];

  // Names for the client and staff ids the feed references — two extra queries
  // rather than joining through the view, which PostgREST cannot embed.
  const clientIds = [...new Set(items.map((i) => i.client_id).filter(Boolean))] as string[];
  const staffIds = [...new Set(items.map((i) => i.staff_id).filter(Boolean))] as string[];

  const [{ data: clientRows }, { data: staffRows }, { data: assignable }] = await Promise.all([
    clientIds.length
      ? supabase.from("clients").select("id, name").in("id", clientIds)
      : Promise.resolve({ data: null }),
    staffIds.length
      ? supabase.from("staff").select("id, full_name").in("id", staffIds)
      : Promise.resolve({ data: null }),
    view === "unmatched" && canTriage
      ? supabase
          .from("clients")
          .select("id, name")
          .eq("status", "active")
          .order("name")
          .limit(1000)
      : Promise.resolve({ data: null }),
  ]);

  const clientNames = new Map(
    (clientRows ?? []).map((c) => [c.id as string, c.name as string])
  );
  const staffNames = new Map(
    (staffRows ?? []).map((s) => [s.id as string, s.full_name as string])
  );
  const clientOptions: ClientOption[] = (assignable ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
  }));

  const qs = (next: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { channel, view, page, ...next };
    for (const [k, v] of Object.entries(merged)) {
      if (v === undefined || v === "" || v === "all" || v === 0) continue;
      sp.set(k, String(v));
    }
    const s = sp.toString();
    return s ? `/inbox?${s}` : "/inbox";
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div
          className="mb-2 text-[11px] font-semibold uppercase"
          style={{ letterSpacing: "0.18em", color: "var(--brand-blue)" }}
        >
          Omnichannel
        </div>
        <h1
          className="m-0 text-[34px] font-semibold leading-[1.1]"
          style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}
        >
          Inbox
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-500)" }}>
          Outlook mail, WhatsApp messages and call logs for every client you handle.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Tab href={qs({ view: "all", page: 0 })} active={view === "all"}>
          All activity
        </Tab>
        {canTriage && (
          <Tab href={qs({ view: "unmatched", page: 0 })} active={view === "unmatched"}>
            Needs attribution
          </Tab>
        )}
        <span className="mx-2 h-5 w-px" style={{ background: "var(--border-default)" }} />
        {CHANNELS.map((c) => (
          <Tab key={c} href={qs({ channel: c, page: 0 })} active={channel === c}>
            {c === "all" ? "All channels" : c === "call" ? "Calls" : c === "email" ? "Email" : "WhatsApp"}
          </Tab>
        ))}
      </div>

      {view === "unmatched" && (
        <p
          className="m-0 px-4 py-3 text-[12.5px]"
          style={{
            background: "var(--brand-blue-pale)",
            borderRadius: "var(--radius-md)",
            color: "var(--brand-blue-deep)",
          }}
        >
          These arrived from an address or number that matches no client, or that
          matches more than one. Assigning one also saves the contact, so the
          rest of that correspondent&apos;s history and everything they send
          later attaches on its own.
        </p>
      )}

      <div className="overflow-hidden" style={cardStyle}>
        {error ? (
          <p className="px-[22px] py-5 text-sm" style={{ color: "#B4443A" }}>
            Could not load the inbox: {error.message}
          </p>
        ) : !items.length ? (
          <p className="px-[22px] py-5 text-sm" style={{ color: "var(--ink-400)" }}>
            {view === "unmatched"
              ? "Nothing waiting for attribution."
              : "No activity yet. Mail sync and call logging populate this feed."}
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {items.map((item) => (
              <div key={`${item.channel}-${item.id}`}>
                <TimelineItem
                  item={item}
                  clientName={item.client_id ? clientNames.get(item.client_id) : null}
                  staffName={item.staff_id ? staffNames.get(item.staff_id) : null}
                />
                {view === "unmatched" && canTriage && (
                  <div className="px-[22px] pb-4">
                    <AssignRow
                      channel={item.channel}
                      id={item.id}
                      counterparty={item.counterparty}
                      clients={clientOptions}
                    />
                  </div>
                )}
              </div>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-3 text-[12.5px]">
        {page > 0 && (
          <Link href={qs({ page: page - 1 })} style={{ color: "var(--brand-blue)" }}>
            ← Newer
          </Link>
        )}
        {items.length === PAGE_SIZE && (
          <Link href={qs({ page: page + 1 })} style={{ color: "var(--brand-blue)" }}>
            Older →
          </Link>
        )}
      </div>
    </div>
  );
}
