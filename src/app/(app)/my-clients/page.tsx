import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type AllotmentRole } from "@/lib/import/normalize";
import { StatusBadge } from "@/components/status-badge";

export default async function MyClientsPage() {
  const supabase = await createClient();
  const { data: clients, error } = await supabase
    .from("my_clients")
    .select("id, name, trade_name, pan, category, status, my_role")
    .order("name");
  if (error) throw error;

  const byRole = new Map<string, typeof clients>();
  for (const c of clients ?? []) {
    const list = byRole.get(c.my_role) ?? [];
    list.push(c);
    byRole.set(c.my_role, list);
  }

  if (!clients?.length) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">
        No clients are allotted to you yet. If this seems wrong, ask the admin
        to map your email on the Staff screen.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-lg font-semibold text-slate-900">
        My Clients ({clients.length})
      </h1>
      {[...byRole.entries()].map(([role, list]) => (
        <section key={role}>
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-500">
            {ROLE_LABELS[role as AllotmentRole] ?? role} — {list!.length}
          </h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Client</th>
                  <th className="px-3 py-2 font-medium">Trade Name</th>
                  <th className="px-3 py-2 font-medium">PAN</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {list!.map((c) => (
                  <tr key={`${role}-${c.id}`} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <Link
                        href={`/clients/${c.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{c.trade_name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{c.pan}</td>
                    <td className="px-3 py-2">{c.category}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
