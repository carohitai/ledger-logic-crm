import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppLink } from "@/components/nav-progress";
import { BackLink } from "@/components/back-link";
import { CallIconButton, WhatsAppIconButton } from "@/components/contact-actions";
import { WA_TEMPLATES } from "@/lib/whatsapp-templates";

export const dynamic = "force-dynamic";

// Staff clients drill-down (design: Admin interface redesign handoff) — one
// staff member's allotted clients with their call & WhatsApp log summary.
// Reached from the staff summary modal on the Team Dashboard.

const DEPTS: Record<string, { role: string; name: string }> = {
  gst: { role: "gst", name: "GST" },
  it: { role: "income_tax", name: "Income Tax" },
  acc: { role: "accounts", name: "Accounting" },
  bill: { role: "billing", name: "Billing" },
};

const CALL_LABELS: Record<string, string> = {
  scheduled: "Callback scheduled",
  unanswered: "No answer",
  answered: "Answered",
  placed: "Call placed",
  abandoned: "No CDR match",
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

export default async function StaffClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dept?: string }>;
}) {
  const { id } = await params;
  const { dept } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("staff")
    .select("id, app_role")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const allowed = me && (me.app_role === "admin" || me.app_role === "partner" || me.id === id);
  if (!allowed) redirect("/dashboard");

  const deptDef = dept ? DEPTS[dept] : undefined;

  const [{ data: staff }, { data: allotments }] = await Promise.all([
    supabase.from("staff").select("id, full_name").eq("id", id).maybeSingle(),
    (() => {
      let q = supabase.from("client_allotments").select("client_id, role").eq("staff_id", id);
      if (deptDef) q = q.eq("role", deptDef.role);
      return q;
    })(),
  ]);
  if (!staff) redirect("/dashboard");

  const clientIds = [...new Set((allotments ?? []).map((a) => a.client_id))];

  const [{ data: clients }, { data: calls }, { data: msgs }] = clientIds.length
    ? await Promise.all([
        supabase.from("clients").select("id, name, pan, phone").in("id", clientIds).order("name"),
        supabase
          .from("call_logs")
          .select("client_id, status, placed_at")
          .eq("staff_id", id)
          .in("client_id", clientIds)
          .order("placed_at", { ascending: false })
          .limit(1000),
        supabase
          .from("whatsapp_messages")
          .select("client_id, template_id, created_at")
          .eq("direction", "out")
          .in("client_id", clientIds)
          .order("created_at", { ascending: false })
          .limit(1000),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const callsByClient = new Map<string, { count: number; last: string }>();
  for (const c of calls ?? []) {
    const cur = callsByClient.get(c.client_id);
    if (cur) cur.count++;
    else
      callsByClient.set(c.client_id, {
        count: 1,
        last: `${CALL_LABELS[c.status] ?? c.status} · ${c.placed_at ? fmtTime(c.placed_at) : "queued"}`,
      });
  }
  const templateLabel = (tid: string | null) =>
    WA_TEMPLATES.find((t) => t.key === tid)?.label ??
    (tid === "call_back_work" ? "Callback request" : (tid ?? "Message"));
  const msgsByClient = new Map<string, { count: number; last: string }>();
  for (const m of msgs ?? []) {
    const cur = msgsByClient.get(m.client_id);
    if (cur) cur.count++;
    else
      msgsByClient.set(m.client_id, {
        count: 1,
        last: `${templateLabel(m.template_id)} · ${fmtTime(m.created_at)}`,
      });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackLink />
        <div
          className="mb-2 text-[11px] font-semibold uppercase"
          style={{ letterSpacing: "0.18em", color: "var(--brand-blue)" }}
        >
          Staff clients — call &amp; message log
        </div>
        <h1
          className="m-0 text-[38px] font-semibold leading-[1.1]"
          style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}
        >
          {staff.full_name}
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-500)" }}>
          {deptDef ? `${deptDef.name} department` : "All departments"} · {(clients ?? []).length}{" "}
          clients · click a client for the master summary
        </p>
      </div>

      <div
        className="overflow-hidden bg-white"
        style={{
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr style={{ background: "var(--paper-2)", color: "var(--ink-500)" }} className="text-left">
              {["Client", "PAN", "Mobile", "Calls", "WhatsApp messages"].map((h) => (
                <th key={h} className="px-4 py-2.5 text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(clients ?? []).map((c) => {
              const call = callsByClient.get(c.id);
              const msg = msgsByClient.get(c.id);
              return (
                <tr key={c.id} style={{ borderTop: "1px solid var(--ink-100)" }} className="hover:bg-[var(--paper)]">
                  <td className="px-4 py-3">
                    <AppLink
                      href={`/clients/${c.id}`}
                      title="Open client master summary"
                      inlineSpinner
                      className="inline-flex items-center gap-1.5 no-underline"
                    >
                      <span
                        className="font-semibold"
                        style={{ color: "var(--brand-blue-deep)", borderBottom: "1px dashed var(--brand-blue-soft)" }}
                      >
                        {c.name}
                      </span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </AppLink>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11.5px]" style={{ color: "var(--ink-500)" }}>
                    {c.pan ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="whitespace-nowrap text-[12.5px] tabular-nums" style={{ color: "var(--ink-700)" }}>
                        {c.phone ?? "—"}
                      </span>
                      <CallIconButton client={c} />
                      <WhatsAppIconButton client={c} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-block px-[11px] py-[3px] text-[11px] font-semibold"
                      style={{
                        borderRadius: "var(--radius-pill)",
                        background: "var(--brand-green-pale)",
                        color: "var(--earth-moss)",
                      }}
                    >
                      {call ? `${call.count} ${call.count === 1 ? "call" : "calls"}` : "No calls"}
                    </span>
                    {call && (
                      <div className="mt-[5px] text-[11.5px]" style={{ color: "var(--ink-400)" }}>
                        {call.last}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-block px-[11px] py-[3px] text-[11px] font-semibold"
                      style={{
                        borderRadius: "var(--radius-pill)",
                        background: "var(--brand-blue-pale)",
                        color: "var(--brand-blue-deep)",
                      }}
                    >
                      {msg ? `${msg.count} sent` : "None sent"}
                    </span>
                    {msg && (
                      <div className="mt-[5px] text-[11.5px]" style={{ color: "var(--ink-400)" }}>
                        {msg.last}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!(clients ?? []).length && (
              <tr style={{ borderTop: "1px solid var(--ink-100)" }}>
                <td colSpan={5} className="px-4 py-8 text-center text-sm" style={{ color: "var(--ink-400)" }}>
                  No clients allotted{deptDef ? ` in the ${deptDef.name} department` : ""}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
