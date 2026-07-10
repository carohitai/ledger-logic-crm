import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type AllotmentRole } from "@/lib/import/normalize";
import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/button";
import { BackLink } from "@/components/back-link";
import { CallIconButton, WhatsAppIconButton } from "@/components/contact-actions";
import { WA_TEMPLATES } from "@/lib/whatsapp-templates";

const ROLES = Object.keys(ROLE_LABELS) as AllotmentRole[];

const cardStyle = {
  background: "var(--white)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-sm)",
} as const;

const CALL_PILL: Record<string, { label: string; bg: string; fg: string }> = {
  answered: { label: "Answered", bg: "var(--brand-green-pale)", fg: "var(--earth-moss)" },
  placed: { label: "Call placed", bg: "var(--brand-green-pale)", fg: "var(--earth-moss)" },
  unanswered: { label: "No answer", bg: "rgba(201,154,78,0.15)", fg: "#8F6A2E" },
  scheduled: { label: "Callback scheduled", bg: "var(--brand-blue-pale)", fg: "var(--brand-blue-deep)" },
  abandoned: { label: "No CDR match", bg: "var(--paper-3)", fg: "var(--ink-500)" },
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: client }, { data: allotments }, { data: messages }, { data: calls }, { data: me }] =
    await Promise.all([
      supabase.from("clients").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("client_allotments")
        .select("role, source, staff:staff_id (id, full_name, is_active)")
        .eq("client_id", id),
      supabase
        .from("whatsapp_messages")
        .select("id, direction, body, template_id, status, created_at")
        .eq("client_id", id)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("call_logs")
        .select("id, status, placed_at, staff:staff_id (full_name)")
        .eq("client_id", id)
        .order("placed_at", { ascending: false })
        .limit(50),
      supabase.auth.getUser().then(async ({ data: { user } }) =>
        supabase
          .from("staff")
          .select("app_role, extension")
          .eq("auth_user_id", user!.id)
          .maybeSingle()
      ),
    ]);

  if (!client) notFound();
  const isAdmin = me?.app_role === "admin";

  const byRole = new Map(
    (allotments ?? []).map((a) => [a.role as AllotmentRole, a])
  );
  const nameFor = (role: AllotmentRole) => {
    const staff = byRole.get(role)?.staff as unknown as
      | { full_name: string; is_active: boolean }
      | undefined;
    return staff?.full_name ?? "—";
  };

  const { data: staffList } = isAdmin
    ? await supabase
        .from("staff")
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name")
    : { data: null };

  async function saveAllotments(formData: FormData) {
    "use server";
    const supabase = await createClient();
    for (const role of ROLES) {
      const staffId = String(formData.get(role) ?? "");
      const current = byRole.get(role);
      const currentId = current
        ? (current.staff as unknown as { id: string }).id
        : "";
      if (staffId === currentId) continue;
      await supabase
        .from("client_allotments")
        .delete()
        .eq("client_id", id)
        .eq("role", role);
      if (staffId) {
        await supabase.from("client_allotments").insert({
          client_id: id,
          role,
          staff_id: staffId,
          source: "manual",
        });
      }
    }
    revalidatePath(`/clients/${id}`);
  }

  const info: [string, string | null][] = [
    ["Constitution", client.constitution],
    ["Trade Name", client.trade_name],
    ["GSTIN", client.gstin],
    ["GST Status", client.gst_status],
    ["Books", client.books],
    ["IT Category", client.it_category],
    ["GST Frequency", client.gst_frequency],
    ["Email", client.email],
  ];

  const contact = { id: client.id, name: client.name, phone: client.phone };
  const templateLabel = (tid: string | null) =>
    WA_TEMPLATES.find((t) => t.key === tid)?.label ??
    (tid === "call_back_work" ? "Callback request" : null);
  const outgoing = (messages ?? []).filter((m) => m.direction === "out");

  const FIELD_LABEL = "mb-[5px] text-[10.5px] font-bold uppercase";
  const FIELD_LABEL_STYLE = { letterSpacing: "0.1em", color: "var(--ink-400)" } as const;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <BackLink fallback="/clients" />
        <div
          className="mb-2 text-[11px] font-semibold uppercase"
          style={{ letterSpacing: "0.18em", color: "var(--brand-blue)" }}
        >
          Client master summary
        </div>
        <div className="flex flex-wrap items-center gap-3.5">
          <h1
            className="m-0 text-[38px] font-semibold leading-[1.1]"
            style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}
          >
            {client.name}
          </h1>
          <StatusBadge status={client.status} />
        </div>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-500)" }}>
          {client.trade_name ?? client.name} · PAN{" "}
          <span className="font-mono text-[12.5px]">{client.pan ?? "—"}</span> · Category{" "}
          {client.category ?? "—"}
        </p>
      </div>

      {/* Contact & allotment */}
      <div className="px-6 py-[22px]" style={cardStyle}>
        <h3 className="mb-4 text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>
          Contact &amp; allotment
        </h3>
        <div className="grid grid-cols-2 gap-[18px] sm:grid-cols-3 lg:grid-cols-5">
          <div>
            <div className={FIELD_LABEL} style={FIELD_LABEL_STYLE}>Mobile</div>
            <div className="flex items-center gap-1.5">
              <span className="whitespace-nowrap text-[13px] font-semibold tabular-nums" style={{ color: "var(--ink-900)" }}>
                {client.phone ?? "—"}
              </span>
              <CallIconButton client={contact} />
              <WhatsAppIconButton client={contact} />
            </div>
          </div>
          {([["Partner", "partner"], ["Income Tax", "income_tax"], ["GST", "gst"], ["Accounting", "accounts"]] as const).map(
            ([label, role]) => (
              <div key={role}>
                <div className={FIELD_LABEL} style={FIELD_LABEL_STYLE}>{label}</div>
                <div className="text-[13px] font-semibold" style={{ color: "var(--ink-900)" }}>
                  {nameFor(role)}
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {/* Calls + WhatsApp */}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="overflow-hidden" style={cardStyle}>
          <div className="flex items-baseline justify-between px-[22px] pb-3 pt-[18px]">
            <h3 className="m-0 text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>
              Calls done
            </h3>
            <span
              className="px-2.5 py-[2px] text-[11px] font-semibold"
              style={{ borderRadius: "var(--radius-pill)", background: "var(--brand-green-pale)", color: "var(--earth-moss)" }}
            >
              {(calls ?? []).length}
            </span>
          </div>
          {!(calls ?? []).length ? (
            <p className="px-[22px] pb-5 text-sm" style={{ color: "var(--ink-400)" }}>
              No calls logged for this client yet.
            </p>
          ) : (
            <ul className="m-0 list-none p-0">
              {(calls ?? []).map((k) => {
                const pill = CALL_PILL[k.status] ?? { label: k.status, bg: "var(--paper-3)", fg: "var(--ink-500)" };
                const staff = k.staff as unknown as { full_name: string } | null;
                return (
                  <li
                    key={k.id}
                    className="flex items-center gap-3 px-[22px] py-3 text-[13px]"
                    style={{ borderTop: "1px solid var(--ink-100)" }}
                  >
                    <span
                      className="shrink-0 px-[11px] py-[3px] text-[11px] font-semibold"
                      style={{ borderRadius: "var(--radius-pill)", background: pill.bg, color: pill.fg }}
                    >
                      {pill.label}
                    </span>
                    <span style={{ color: "var(--ink-700)" }}>by {staff?.full_name ?? "—"}</span>
                    <span className="ml-auto whitespace-nowrap text-[11.5px] tabular-nums" style={{ color: "var(--ink-400)" }}>
                      {k.placed_at ? fmtTime(k.placed_at) : "queued"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="overflow-hidden" style={cardStyle}>
          <div className="flex items-baseline justify-between px-[22px] pb-3 pt-[18px]">
            <h3 className="m-0 text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>
              WhatsApp messages sent
            </h3>
            <span
              className="px-2.5 py-[2px] text-[11px] font-semibold"
              style={{ borderRadius: "var(--radius-pill)", background: "var(--brand-blue-pale)", color: "var(--brand-blue-deep)" }}
            >
              {outgoing.length}
            </span>
          </div>
          {!(messages ?? []).length ? (
            <p className="px-[22px] pb-5 text-sm" style={{ color: "var(--ink-400)" }}>
              No WhatsApp messages with this client yet. Outgoing follow-ups and
              the client&apos;s replies will appear here.
            </p>
          ) : (
            <ul className="m-0 max-h-[420px] list-none overflow-y-auto p-0">
              {(messages ?? []).map((m) => {
                const out = m.direction === "out";
                return (
                  <li key={m.id} className="px-[22px] py-3.5" style={{ borderTop: "1px solid var(--ink-100)" }}>
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex h-4 w-4" style={{ color: out ? "#25D366" : "var(--ink-400)" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M17.6 6.32A7.85 7.85 0 0 0 12 4a7.94 7.94 0 0 0-6.9 11.9L4 20l4.2-1.1a7.9 7.9 0 0 0 3.8 1h.01a7.94 7.94 0 0 0 5.59-13.58zM12 18.5a6.5 6.5 0 0 1-3.3-.9l-.24-.14-2.45.64.65-2.39-.16-.25A6.5 6.5 0 1 1 12 18.5z" />
                        </svg>
                      </span>
                      <span className="text-[12.5px] font-bold" style={{ color: "var(--ink-900)" }}>
                        {out ? (templateLabel(m.template_id) ?? "Message sent") : "Client reply"}
                      </span>
                      <span className="ml-auto whitespace-nowrap text-[11.5px] tabular-nums" style={{ color: "var(--ink-400)" }}>
                        {fmtTime(m.created_at)}
                      </span>
                    </div>
                    <p
                      className="m-0 mt-2 whitespace-pre-wrap px-3 py-2.5 text-[12.5px] leading-relaxed"
                      style={{
                        color: "var(--ink-700)",
                        background: out ? "var(--brand-green-pale)" : "var(--paper-2)",
                        borderRadius: out
                          ? "var(--radius-md) var(--radius-md) var(--radius-md) 2px"
                          : "var(--radius-md) var(--radius-md) 2px var(--radius-md)",
                      }}
                    >
                      {m.body ?? "(no text)"}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Details + admin allotment editing */}
      <div className="grid items-start gap-4 md:grid-cols-2">
        <section className="px-6 py-[22px]" style={cardStyle}>
          <h3 className="mb-4 text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>
            Details
          </h3>
          <dl className="m-0 space-y-2.5 text-[13px]">
            {info.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt style={{ color: "var(--ink-500)" }}>{label}</dt>
                <dd className="m-0 text-right font-semibold" style={{ color: "var(--ink-900)" }}>
                  {value ?? "—"}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {isAdmin && staffList && (
          <section className="px-6 py-[22px]" style={cardStyle}>
            <h3 className="mb-4 text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>
              Edit allotment
            </h3>
            <form action={saveAllotments} className="space-y-2.5 text-[13px]">
              {ROLES.map((role) => {
                const a = byRole.get(role);
                const staff = a?.staff as unknown as
                  | { id: string; full_name: string }
                  | undefined;
                return (
                  <div key={role} className="flex items-center justify-between gap-4">
                    <label style={{ color: "var(--ink-500)" }}>{ROLE_LABELS[role]}</label>
                    <select
                      name={role}
                      defaultValue={staff?.id ?? ""}
                      className="w-48 cursor-pointer px-2.5 py-1.5"
                      style={{
                        border: "1px solid var(--border-strong)",
                        borderRadius: "var(--radius-md)",
                        background: "var(--white)",
                        color: "var(--ink-900)",
                      }}
                    >
                      <option value="">— none —</option>
                      {staffList.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
              <SubmitButton variant="ink" size="sm" className="mt-2">
                Save allotments
              </SubmitButton>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
