import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Staff</h1>
        <p className="text-sm text-slate-500">
          Map each person&apos;s KolteAssociates.in email so SSO links their
          account, and add spelling aliases used in the Excel sheet.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Email (for SSO)</th>
              <th className="px-3 py-2 font-medium">Sheet aliases</th>
              <th className="px-3 py-2 font-medium">Add alias</th>
            </tr>
          </thead>
          <tbody>
            {(staff ?? []).map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">
                  {s.full_name}
                  {s.is_pseudo && (
                    <span className="ml-1 text-xs text-slate-400">(pseudo)</span>
                  )}
                  {!s.is_active && (
                    <span className="ml-1 text-xs text-red-500">(inactive)</span>
                  )}
                </td>
                <td className="px-3 py-2">{s.app_role}</td>
                <td className="px-3 py-2">
                  <form action={setEmail} className="flex gap-1">
                    <input type="hidden" name="staff_id" value={s.id} />
                    <input
                      name="email"
                      defaultValue={s.email ?? ""}
                      placeholder="name@kolteassociates.in"
                      className="w-56 rounded-md border border-slate-300 px-2 py-1"
                    />
                    <button className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
                      Save
                    </button>
                  </form>
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {(aliasesByStaff.get(s.id) ?? []).join(", ")}
                </td>
                <td className="px-3 py-2">
                  <form action={addAlias} className="flex gap-1">
                    <input type="hidden" name="staff_id" value={s.id} />
                    <input
                      name="alias"
                      placeholder="e.g. Sneha"
                      className="w-28 rounded-md border border-slate-300 px-2 py-1"
                    />
                    <button className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
                      Add
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
