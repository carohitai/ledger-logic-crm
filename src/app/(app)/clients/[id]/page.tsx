import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type AllotmentRole } from "@/lib/import/normalize";
import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/button";
import { CallButton } from "./call-button";

const ROLES = Object.keys(ROLE_LABELS) as AllotmentRole[];

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: client }, { data: allotments }, { data: messages }, { data: me }] =
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
        .order("created_at", { ascending: true })
        .limit(200),
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
    ["PAN", client.pan],
    ["GSTIN", client.gstin],
    ["GST Status", client.gst_status],
    ["Category", client.category],
    ["Books", client.books],
    ["IT Category", client.it_category],
    ["GST Frequency", client.gst_frequency],
    ["Phone", client.phone],
    ["Email", client.email],
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-900">{client.name}</h1>
        <StatusBadge status={client.status} />
        <div className="ml-auto">
          <CallButton
            clientId={client.id}
            phone={client.phone}
            hasExtension={Boolean(me?.extension)}
          />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">
            Details
          </h2>
          <dl className="space-y-2 text-sm">
            {info.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-slate-500">{label}</dt>
                <dd className="text-right font-medium text-slate-800">
                  {value ?? "—"}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">
            Allotment
          </h2>
          {isAdmin && staffList ? (
            <form action={saveAllotments} className="space-y-2 text-sm">
              {ROLES.map((role) => {
                const a = byRole.get(role);
                const staff = a?.staff as unknown as
                  | { id: string; full_name: string }
                  | undefined;
                return (
                  <div key={role} className="flex items-center justify-between gap-4">
                    <label className="text-slate-500">{ROLE_LABELS[role]}</label>
                    <select
                      name={role}
                      defaultValue={staff?.id ?? ""}
                      className="w-48 rounded-md border border-slate-300 px-2 py-1"
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
          ) : (
            <dl className="space-y-2 text-sm">
              {ROLES.map((role) => {
                const a = byRole.get(role);
                const staff = a?.staff as unknown as
                  | { full_name: string; is_active: boolean }
                  | undefined;
                return (
                  <div key={role} className="flex justify-between gap-4">
                    <dt className="text-slate-500">{ROLE_LABELS[role]}</dt>
                    <dd className="font-medium text-slate-800">
                      {staff ? (
                        <>
                          {staff.full_name}
                          {!staff.is_active && (
                            <span className="ml-1 text-xs text-red-500">(inactive)</span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">
          WhatsApp
        </h2>
        {!messages?.length ? (
          <p className="text-sm text-slate-400">
            No WhatsApp messages with this client yet. Outgoing follow-ups and
            the client&apos;s replies will appear here.
          </p>
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                    m.direction === "out"
                      ? "bg-emerald-50 text-emerald-900"
                      : "bg-slate-100 text-slate-800"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.body ?? "(no text)"}</p>
                  <p className="mt-1 text-right text-[10px] text-slate-400">
                    {m.direction === "out" ? "Sent" : "Received"} ·{" "}
                    {new Date(m.created_at).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
