import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/button";
import { StaffDrillName } from "./staff-drill-name";

const TH = "px-4 py-2.5 text-[11px] font-semibold uppercase";
const THS = { letterSpacing: "0.1em" } as const;

const ROLE_STYLE: Record<string, { bg: string; fg: string }> = {
  admin: { bg: "rgba(30,66,159,0.10)", fg: "var(--brand-blue-deep)" },
  partner: { bg: "var(--brand-green-pale)", fg: "var(--earth-moss)" },
  staff: { bg: "var(--paper-3)", fg: "var(--ink-500)" },
};

export default async function StaffPage() {
  const supabase = await createClient();
  const [{ data: staff }, { data: aliases }] = await Promise.all([
    supabase.from("staff").select("*").order("app_role").order("full_name"),
    supabase.from("staff_aliases").select("alias, staff_id"),
  ]);

  const aliasesByStaff = new Map<string, string[]>();
  for (const a of aliases ?? []) {
    const list = aliasesByStaff.get(a.staff_id) ?? [];
    list.push(a.alias);
    aliasesByStaff.set(a.staff_id, list);
  }

  async function setEmail(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const email = String(formData.get("email") ?? "").trim() || null;
    await supabase
      .from("staff")
      .update({ email })
      .eq("id", String(formData.get("staff_id")));
    revalidatePath("/admin/staff");
  }

  async function addAlias(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const alias = String(formData.get("alias") ?? "").trim();
    if (alias) {
      await supabase
        .from("staff_aliases")
        .insert({ alias, staff_id: String(formData.get("staff_id")) });
    }
    revalidatePath("/admin/staff");
  }

  const inputStyle = {
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-md)",
  } as const;

  return (
    <div className="flex flex-col gap-7">
      <div>
        <div
          className="mb-2 text-[11px] font-semibold uppercase"
          style={{ letterSpacing: "0.18em", color: "var(--brand-blue)" }}
        >
          Kolte &amp; Associates LLP — Internal
        </div>
        <h1
          className="m-0 text-[38px] font-semibold leading-[1.1]"
          style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}
        >
          Staff
        </h1>
        <p className="mt-2 max-w-[640px] text-sm leading-relaxed" style={{ color: "var(--ink-500)" }}>
          Map each person&apos;s KolteAssociates.in email so SSO links their
          account, and add spelling aliases used in the Excel sheet. Click a
          name for their calling &amp; messaging summary.
        </p>
      </div>
      <div
        className="overflow-x-auto bg-white"
        style={{
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <table className="w-full min-w-[860px] border-collapse text-[13px]">
          <thead>
            <tr style={{ background: "var(--paper-2)", color: "var(--ink-500)" }} className="text-left">
              <th className={TH} style={THS}>Name</th>
              <th className={TH} style={THS}>Role</th>
              <th className={TH} style={THS}>Email (for SSO)</th>
              <th className={TH} style={THS}>Sheet aliases</th>
              <th className={TH} style={THS}>Add alias</th>
            </tr>
          </thead>
          <tbody>
            {(staff ?? []).map((s) => {
              const role = ROLE_STYLE[s.app_role] ?? ROLE_STYLE.staff;
              return (
                <tr key={s.id} style={{ borderTop: "1px solid var(--ink-100)" }} className="hover:bg-[var(--paper)]">
                  <td className="px-4 py-3">
                    <StaffDrillName id={s.id} name={s.full_name} />
                    {s.is_pseudo && (
                      <span className="ml-1.5 text-[11px]" style={{ color: "var(--ink-400)" }}>(pseudo)</span>
                    )}
                    {!s.is_active && (
                      <span className="ml-1.5 text-[11px]" style={{ color: "var(--danger)" }}>(inactive)</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="px-[9px] py-[2px] text-[11px] font-semibold"
                      style={{ borderRadius: "var(--radius-pill)", background: role.bg, color: role.fg }}
                    >
                      {s.app_role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <form action={setEmail} className="flex gap-1.5">
                      <input type="hidden" name="staff_id" value={s.id} />
                      <input
                        name="email"
                        defaultValue={s.email ?? ""}
                        placeholder="name@kolteassociates.in"
                        className="w-[230px] px-2.5 py-1.5 text-[12.5px]"
                        style={inputStyle}
                      />
                      <SubmitButton variant="secondary" size="xs">
                        Save
                      </SubmitButton>
                    </form>
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--ink-500)" }}>
                    {(aliasesByStaff.get(s.id) ?? []).join(", ")}
                  </td>
                  <td className="px-4 py-3">
                    <form action={addAlias} className="flex gap-1.5">
                      <input type="hidden" name="staff_id" value={s.id} />
                      <input
                        name="alias"
                        placeholder="e.g. Sneha"
                        className="w-[120px] px-2.5 py-1.5 text-[12.5px]"
                        style={inputStyle}
                      />
                      <SubmitButton variant="secondary" size="xs">
                        Add
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
