// Which firm mailboxes the CRM reads, and whether each is syncing.
//
// The mailbox list lives in the database rather than an env var so adding one
// does not need a redeploy. GRAPH_MAILBOXES only seeds this table on first run.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/button";
import { BackLink } from "@/components/back-link";

export const dynamic = "force-dynamic";

const cardStyle = {
  background: "var(--white)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-sm)",
} as const;

function fmt(iso: string | null) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function MailboxesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("staff")
    .select("app_role")
    .eq("auth_user_id", user!.id)
    .maybeSingle();
  if (me?.app_role !== "admin") redirect("/dashboard");

  const [{ data: mailboxes }, messageCount] = await Promise.all([
    supabase.from("mailboxes").select("*").order("upn"),
    supabase
      .from("email_messages")
      .select("id", { count: "exact", head: true })
      .then((r) => r.count ?? 0),
  ]);

  async function addMailbox(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const upn = String(formData.get("upn") ?? "").trim().toLowerCase();
    if (upn) await supabase.from("mailboxes").upsert({ upn }, { onConflict: "upn" });
    revalidatePath("/admin/mailboxes");
  }

  async function toggleMailbox(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = String(formData.get("id") ?? "");
    const active = String(formData.get("active") ?? "") === "true";
    if (id) await supabase.from("mailboxes").update({ is_active: !active }).eq("id", id);
    revalidatePath("/admin/mailboxes");
  }

  async function resetDelta(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = String(formData.get("id") ?? "");
    if (id) {
      await supabase
        .from("mailboxes")
        .update({ delta_link: null, backfilled_at: null, last_error: null })
        .eq("id", id);
    }
    revalidatePath("/admin/mailboxes");
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <BackLink fallback="/dashboard" />
        <div
          className="mb-2 text-[11px] font-semibold uppercase"
          style={{ letterSpacing: "0.18em", color: "var(--brand-blue)" }}
        >
          Admin
        </div>
        <h1
          className="m-0 text-[34px] font-semibold leading-[1.1]"
          style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}
        >
          Outlook mailboxes
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-500)" }}>
          {messageCount} messages ingested.
        </p>
      </div>

      <div
        className="px-4 py-3 text-[12.5px]"
        style={{
          background: "var(--brand-blue-pale)",
          borderRadius: "var(--radius-md)",
          color: "var(--brand-blue-deep)",
        }}
      >
        <strong>Before enabling a mailbox.</strong> The Entra app needs the{" "}
        <code>Mail.Read</code> <em>application</em> permission with admin consent,
        and — this part is not optional — an Application Access Policy limiting
        it to these mailboxes. Without the policy the app can read every mailbox
        in the tenant. Policy changes take up to ~30 minutes to take effect.
      </div>

      <section className="px-6 py-[22px]" style={cardStyle}>
        <h3 className="mb-4 text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>
          Add a mailbox
        </h3>
        <form action={addMailbox} className="flex flex-wrap items-center gap-2.5">
          <input
            name="upn"
            type="email"
            required
            placeholder="accounts@kolteassociates.in"
            className="w-[320px] px-2.5 py-1.5 text-[13px]"
            style={{
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-md)",
              background: "var(--white)",
              color: "var(--ink-900)",
            }}
          />
          <SubmitButton variant="ink" size="sm">
            Add
          </SubmitButton>
        </form>
      </section>

      <div className="overflow-hidden" style={cardStyle}>
        {!mailboxes?.length ? (
          <p className="px-[22px] py-5 text-sm" style={{ color: "var(--ink-400)" }}>
            No mailboxes configured yet.
          </p>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr style={{ background: "var(--paper-2)" }}>
                {["Mailbox", "Status", "Last sync", "Backfilled", ""].map((h) => (
                  <th
                    key={h}
                    className="px-[22px] py-2.5 text-left text-[10.5px] font-bold uppercase"
                    style={{ letterSpacing: "0.1em", color: "var(--ink-400)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mailboxes.map((m) => (
                <tr key={m.id} style={{ borderTop: "1px solid var(--ink-100)" }}>
                  <td className="px-[22px] py-3">
                    <div className="font-semibold" style={{ color: "var(--ink-900)" }}>
                      {m.upn}
                    </div>
                    {m.last_error && (
                      <div className="mt-1 text-[11.5px]" style={{ color: "#B4443A" }}>
                        {m.last_error}
                      </div>
                    )}
                  </td>
                  <td className="px-[22px] py-3">
                    <span
                      className="px-2.5 py-[2px] text-[11px] font-semibold"
                      style={{
                        borderRadius: "var(--radius-pill)",
                        background: m.is_active ? "var(--brand-green-pale)" : "var(--paper-3)",
                        color: m.is_active ? "var(--earth-moss)" : "var(--ink-500)",
                      }}
                    >
                      {m.is_active ? "Active" : "Paused"}
                    </span>
                  </td>
                  <td className="px-[22px] py-3 tabular-nums" style={{ color: "var(--ink-500)" }}>
                    {fmt(m.last_synced_at)}
                  </td>
                  <td className="px-[22px] py-3 tabular-nums" style={{ color: "var(--ink-500)" }}>
                    {fmt(m.backfilled_at)}
                  </td>
                  <td className="px-[22px] py-3">
                    <div className="flex items-center gap-2">
                      <form action={toggleMailbox}>
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="active" value={String(m.is_active)} />
                        <SubmitButton variant="ghost" size="sm">
                          {m.is_active ? "Pause" : "Resume"}
                        </SubmitButton>
                      </form>
                      <form action={resetDelta}>
                        <input type="hidden" name="id" value={m.id} />
                        <SubmitButton variant="ghost" size="sm">
                          Re-seed
                        </SubmitButton>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
