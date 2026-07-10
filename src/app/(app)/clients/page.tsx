import { AppLink } from "@/components/nav-progress";
import { NavSubmitButton } from "@/components/button";
import { CallIconButton, WhatsAppIconButton } from "@/components/contact-actions";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/status-badge";

const PAGE_SIZE = 50;

const TH = "px-4 py-2.5 text-[11px] font-semibold uppercase";
const THS = { letterSpacing: "0.1em" } as const;

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

  // Phone numbers for the Mobile column (click-to-call / WhatsApp actions).
  const ids = (clients ?? []).map((c) => c.id);
  const { data: phones } = ids.length
    ? await supabase.from("clients").select("id, phone").in("id", ids)
    : { data: [] as { id: string; phone: string | null }[] };
  const phoneById = new Map((phones ?? []).map((p) => [p.id, p.phone]));

  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const inputStyle = {
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-md)",
    background: "var(--white)",
    color: "var(--ink-900)",
  } as const;

  return (
    <div className="flex flex-col gap-6">
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
          All Clients <span className="text-2xl" style={{ color: "var(--ink-400)" }}>({total})</span>
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-500)" }}>
          Firm-wide client master — search and filter by category, partner or status
        </p>
      </div>

      <form className="flex flex-wrap items-center gap-2.5 text-[13px]" method="get">
        <input
          name="q"
          defaultValue={params.q}
          placeholder="Search name / trade name / PAN"
          className="w-[280px] px-3 py-2"
          style={inputStyle}
        />
        <select name="category" defaultValue={params.category ?? ""} className="cursor-pointer px-3 py-2" style={inputStyle}>
          <option value="">All categories</option>
          {["A++", "A+", "A", "B", "C", "D", "E"].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select name="partner" defaultValue={params.partner ?? ""} className="cursor-pointer px-3 py-2" style={inputStyle}>
          <option value="">All partners</option>
          {(partners ?? []).map((p) => (
            <option key={p.full_name}>{p.full_name}</option>
          ))}
        </select>
        <select name="status" defaultValue={params.status ?? ""} className="cursor-pointer px-3 py-2" style={inputStyle}>
          <option value="">All statuses</option>
          <option value="active">active</option>
          <option value="missing_from_sheet">missing from sheet</option>
          <option value="archived">archived</option>
        </select>
        <NavSubmitButton variant="ink" size="md">
          Filter
        </NavSubmitButton>
      </form>

      <div
        className="overflow-x-auto bg-white"
        style={{
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <table className="w-full min-w-[900px] border-collapse text-[13px]">
          <thead>
            <tr style={{ background: "var(--paper-2)", color: "var(--ink-500)" }} className="text-left">
              <th className={TH} style={THS}>Client</th>
              <th className={TH} style={THS}>Trade Name</th>
              <th className={TH} style={THS}>PAN</th>
              <th className={TH} style={THS}>Cat.</th>
              <th className={TH} style={THS}>Partner</th>
              <th className={TH} style={THS}>Income Tax</th>
              <th className={TH} style={THS}>GST</th>
              <th className={TH} style={THS}>Mobile</th>
              <th className={TH} style={THS}>Status</th>
            </tr>
          </thead>
          <tbody>
            {(clients ?? []).map((c) => {
              const phone = phoneById.get(c.id) ?? null;
              return (
                <tr key={c.id} style={{ borderTop: "1px solid var(--ink-100)" }} className="hover:bg-[var(--paper)]">
                  <td className="whitespace-nowrap px-4 py-[11px]">
                    <AppLink
                      href={`/clients/${c.id}`}
                      title="Open client master summary"
                      inlineSpinner
                      className="font-semibold no-underline transition-colors hover:!text-[var(--brand-blue)] hover:underline"
                      style={{ color: "var(--ink-900)" }}
                    >
                      {c.name}
                    </AppLink>
                  </td>
                  <td className="px-4 py-[11px]" style={{ color: "var(--ink-500)" }}>{c.trade_name}</td>
                  <td className="px-4 py-[11px] font-mono text-[11.5px]" style={{ color: "var(--ink-500)" }}>{c.pan}</td>
                  <td className="px-4 py-[11px]">{c.category}</td>
                  <td className="px-4 py-[11px]" style={{ color: "var(--ink-700)" }}>{c.partner_incharge}</td>
                  <td className="px-4 py-[11px]" style={{ color: "var(--ink-700)" }}>{c.income_tax_incharge}</td>
                  <td className="px-4 py-[11px]" style={{ color: "var(--ink-700)" }}>{c.gst_incharge}</td>
                  <td className="px-4 py-[11px]">
                    <div className="flex items-center gap-1.5">
                      <span className="whitespace-nowrap text-[12.5px] tabular-nums" style={{ color: "var(--ink-700)" }}>
                        {phone ?? "—"}
                      </span>
                      <CallIconButton client={{ id: c.id, name: c.name, phone }} />
                      <WhatsAppIconButton client={{ id: c.id, name: c.name, phone }} />
                    </div>
                  </td>
                  <td className="px-4 py-[11px]">
                    <StatusBadge status={c.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center gap-2 text-sm">
          {page > 1 && (
            <AppLink
              inlineSpinner
              className="ll-press inline-flex items-center px-3 py-1 hover:bg-[var(--paper-2)]"
              style={{ border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)", color: "var(--ink-700)" }}
              href={{ query: { ...params, page: page - 1 } }}
            >
              ← Prev
            </AppLink>
          )}
          <span className="px-2 py-1" style={{ color: "var(--ink-500)" }}>
            Page {page} of {pages}
          </span>
          {page < pages && (
            <AppLink
              inlineSpinner
              className="ll-press inline-flex items-center px-3 py-1 hover:bg-[var(--paper-2)]"
              style={{ border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)", color: "var(--ink-700)" }}
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
