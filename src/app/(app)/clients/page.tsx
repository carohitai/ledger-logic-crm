import { AppLink } from "@/components/nav-progress";
import { NavSubmitButton } from "@/components/button";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/status-badge";

const PAGE_SIZE = 50;

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const page = Math.max(1, Number(params.page ?? 1));

  let query = supabase
    .from("clients_wide")
    .select(
      "id, name, trade_name, pan, category, status, partner_incharge, income_tax_incharge, gst_incharge",
      { count: "exact" }
    );

  if (params.q) {
    const q = params.q.replaceAll(",", " ");
    query = query.or(
      `name.ilike.%${q}%,trade_name.ilike.%${q}%,pan.ilike.%${q}%`
    );
  }
  if (params.category) query = query.eq("category", params.category);
  if (params.status) query = query.eq("status", params.status);
  if (params.partner) query = query.eq("partner_incharge", params.partner);

  const { data: clients, count, error } = await query
    .order("name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw error;

  const { data: partners } = await supabase
    .from("staff")
    .select("full_name")
    .eq("app_role", "partner")
    .order("full_name");

  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">
          Clients ({total})
        </h1>
      </div>

      <form className="flex flex-wrap gap-2 text-sm" method="get">
        <input
          name="q"
          defaultValue={params.q}
          placeholder="Search name / trade name / PAN"
          className="w-64 rounded-md border border-slate-300 px-3 py-1.5"
        />
        <select name="category" defaultValue={params.category ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5">
          <option value="">All categories</option>
          {["A++", "A+", "A", "B", "C", "D", "E"].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select name="partner" defaultValue={params.partner ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5">
          <option value="">All partners</option>
          {(partners ?? []).map((p) => (
            <option key={p.full_name}>{p.full_name}</option>
          ))}
        </select>
        <select name="status" defaultValue={params.status ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5">
          <option value="">All statuses</option>
          <option value="active">active</option>
          <option value="missing_from_sheet">missing from sheet</option>
          <option value="archived">archived</option>
        </select>
        <NavSubmitButton variant="ink" size="sm">
          Filter
        </NavSubmitButton>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Client</th>
              <th className="px-3 py-2 font-medium">Trade Name</th>
              <th className="px-3 py-2 font-medium">PAN</th>
              <th className="px-3 py-2 font-medium">Cat.</th>
              <th className="px-3 py-2 font-medium">Partner</th>
              <th className="px-3 py-2 font-medium">Income Tax</th>
              <th className="px-3 py-2 font-medium">GST</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(clients ?? []).map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <AppLink
                    href={`/clients/${c.id}`}
                    inlineSpinner
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {c.name}
                  </AppLink>
                </td>
                <td className="px-3 py-2 text-slate-600">{c.trade_name}</td>
                <td className="px-3 py-2 font-mono text-xs">{c.pan}</td>
                <td className="px-3 py-2">{c.category}</td>
                <td className="px-3 py-2">{c.partner_incharge}</td>
                <td className="px-3 py-2">{c.income_tax_incharge}</td>
                <td className="px-3 py-2">{c.gst_incharge}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={c.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center gap-2 text-sm">
          {page > 1 && (
            <AppLink
              inlineSpinner
              className="ll-press inline-flex items-center rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50"
              href={{ query: { ...params, page: page - 1 } }}
            >
              ← Prev
            </AppLink>
          )}
          <span className="px-2 py-1 text-slate-500">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <AppLink
              inlineSpinner
              className="ll-press inline-flex items-center rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50"
              href={{ query: { ...params, page: page + 1 } }}
            >
              Next →
            </AppLink>
          )}
        </div>
      )}
    </div>
  );
}
