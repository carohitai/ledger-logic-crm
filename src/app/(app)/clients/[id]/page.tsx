import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type AllotmentRole } from "@/lib/import/normalize";
import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/button";
import { BackLink } from "@/components/back-link";
import { CallIconButton, WhatsAppIconButton } from "@/components/contact-actions";
import { EditIconLink } from "@/components/edit-link";
import { ClientTimeline } from "@/components/client-timeline";
import { COMMUNICATION_COLUMNS, type CommunicationItem } from "@/lib/inbox/types";

const ROLES = Object.keys(ROLE_LABELS) as AllotmentRole[];

const cardStyle = {
  background: "var(--white)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-sm)",
} as const;

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: client }, { data: allotments }, { data: timeline }, { data: me }] =
    await Promise.all([
      supabase.from("clients").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("client_allotments")
        .select("role, source, staff:staff_id (id, full_name, is_active)")
        .eq("client_id", id),
      // One ordered stream across mail, WhatsApp and calls. The view carries no
      // join to staff — PostgREST cannot embed relations through a view — so
      // names are resolved separately below.
      supabase
        .from("communications")
        .select(COMMUNICATION_COLUMNS)
        .eq("client_id", id)
        .order("occurred_at", { ascending: false })
        .limit(200)
        .returns<CommunicationItem[]>(),
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
  const items = timeline ?? [];

  // Resolve the staff names the timeline references, in one query.
  const staffIds = [...new Set(items.map((i) => i.staff_id).filter(Boolean))] as string[];
  const { data: timelineStaff } = staffIds.length
    ? await supabase.from("staff").select("id, full_name").in("id", staffIds)
    : { data: null };
  const staffNames = new Map(
    (timelineStaff ?? []).map((s) => [s.id as string, s.full_name as string])
  );

  const countBy = (channel: string) => items.filter((i) => i.channel === channel).length;

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
          <span className="ml-auto">
            <EditIconLink href={`/clients/${id}/edit`} label="Edit profile" />
          </span>
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

      {/* Unified communication timeline */}
      <div className="overflow-hidden" style={cardStyle}>
        <div className="flex flex-wrap items-baseline gap-3 px-[22px] pb-3 pt-[18px]">
          <h3 className="m-0 text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>
            Communication
          </h3>
          <span className="text-[11.5px]" style={{ color: "var(--ink-400)" }}>
            Outlook mail, WhatsApp and calls in one stream
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            {([
              ["Email", countBy("email"), "var(--brand-blue-pale)", "var(--brand-blue-deep)"],
              ["WhatsApp", countBy("whatsapp"), "var(--brand-green-pale)", "var(--earth-moss)"],
              ["Calls", countBy("call"), "rgba(201,154,78,0.15)", "#8F6A2E"],
            ] as const).map(([label, count, bg, fg]) => (
              <span
                key={label}
                className="px-2.5 py-[2px] text-[11px] font-semibold"
                style={{ borderRadius: "var(--radius-pill)", background: bg, color: fg }}
              >
                {count} {label}
              </span>
            ))}
          </span>
        </div>
        <ClientTimeline items={items} staffNames={staffNames} />
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
