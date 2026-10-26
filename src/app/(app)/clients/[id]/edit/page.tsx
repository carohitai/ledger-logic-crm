import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/button";
import { BackLink } from "@/components/back-link";
import { fieldsFor, changeSummary } from "@/lib/client-profile";
import { queueChangeNotice } from "@/lib/notify/queue";

const cardStyle = {
  background: "var(--white)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-sm)",
} as const;

const inputStyle = {
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  background: "var(--white)",
  color: "var(--ink-900)",
} as const;

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: client }, { data: me }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).maybeSingle(),
    supabase.auth.getUser().then(async ({ data: { user } }) =>
      supabase.from("staff").select("id, app_role").eq("auth_user_id", user!.id).maybeSingle()
    ),
  ]);
  if (!client) notFound();

  const isAdmin = me?.app_role === "admin";
  const fields = fieldsFor(isAdmin);
  const manual: string[] = client.manual_fields ?? [];

  async function save(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: actor } = await supabase
      .from("staff")
      .select("id, app_role, full_name")
      .eq("auth_user_id", user!.id)
      .maybeSingle();

    // Re-read current values server-side: never trust the values the form was
    // rendered with, and only the caller's own permitted fields are applied.
    const { data: current } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
    if (!current) notFound();

    const allowed = fieldsFor(actor?.app_role === "admin");
    const patch: Record<string, string | null> = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    for (const f of allowed) {
      if (!formData.has(f.key)) continue;
      const raw = String(formData.get(f.key) ?? "").trim();
      const next = raw === "" ? null : raw;
      // `status` is a NOT NULL enum — an empty submission means "leave as is".
      if (f.key === "status" && next === null) continue;
      const before = (current as Record<string, unknown>)[f.key] ?? null;
      if ((before ?? null) === next) continue;
      patch[f.key] = next;
      changes[f.key] = { from: before, to: next };
    }

    if (Object.keys(patch).length) {
      const manualNow = [
        ...new Set([...((current.manual_fields as string[]) ?? []), ...Object.keys(patch)]),
      ];
      const { error } = await supabase
        .from("clients")
        .update({ ...patch, manual_fields: manualNow, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;

      const { data: activity } = await supabase
        .from("client_activity")
        .insert({
          client_id: id,
          actor_staff_id: actor?.id ?? null,
          action: "updated",
          summary: changeSummary(changes),
          changes,
        })
        .select("id")
        .maybeSingle();

      // Tell the client's Team (and the firm channel) once the redirect is out.
      queueChangeNotice({
        clientId: id,
        activityId: activity?.id ?? null,
        kind: "updated",
        changes,
        actorName: actor?.full_name ?? user?.email ?? "A team member",
      });
    }

    revalidatePath(`/clients/${id}`);
    revalidatePath("/clients");
    revalidatePath("/my-clients");
    redirect(`/clients/${id}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackLink fallback={`/clients/${id}`} />
        <div
          className="mb-2 text-[11px] font-semibold uppercase"
          style={{ letterSpacing: "0.18em", color: "var(--brand-blue)" }}
        >
          Edit client profile
        </div>
        <h1
          className="m-0 text-[34px] font-semibold leading-[1.1]"
          style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}
        >
          {client.name}
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-500)" }}>
          Changes you save here are kept when the master sheet is re-imported, and
          everyone is notified.
          {!isAdmin && " Master fields (name, PAN, category, status) are admin-only."}
        </p>
      </div>

      <form action={save} className="flex flex-col gap-5">
        <div className="grid gap-x-6 gap-y-4 px-6 py-[22px] sm:grid-cols-2" style={cardStyle}>
          {fields.map((f) => {
            const value = (client as Record<string, unknown>)[f.key];
            const current = value == null ? "" : String(value);
            const edited = manual.includes(f.key);
            return (
              <label key={f.key} className="flex flex-col">
                <span
                  className="mb-[5px] flex items-center gap-2 text-[10.5px] font-bold uppercase"
                  style={{ letterSpacing: "0.1em", color: "var(--ink-400)" }}
                >
                  {f.label}
                  {edited && (
                    <span
                      className="px-1.5 py-[1px] text-[9px] font-bold normal-case"
                      style={{
                        borderRadius: "var(--radius-pill)",
                        background: "var(--brand-blue-pale)",
                        color: "var(--brand-blue-deep)",
                        letterSpacing: 0,
                      }}
                      title="Edited in the CRM — the sheet import will not overwrite this"
                    >
                      CRM edited
                    </span>
                  )}
                </span>
                {f.options ? (
                  <select
                    name={f.key}
                    defaultValue={current}
                    className="cursor-pointer px-3 py-2 text-[13px]"
                    style={inputStyle}
                  >
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o === "" ? "—" : o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    name={f.key}
                    defaultValue={current}
                    placeholder={f.placeholder}
                    className={`px-3 py-2 text-[13px] ${f.mono ? "font-mono" : ""}`}
                    style={inputStyle}
                  />
                )}
              </label>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <SubmitButton variant="ink" size="md">
            Save changes
          </SubmitButton>
          <BackLink fallback={`/clients/${id}`} label="Cancel" className="" />
        </div>
      </form>
    </div>
  );
}
