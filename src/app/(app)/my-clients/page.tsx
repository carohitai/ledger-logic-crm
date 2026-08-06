import { AppLink } from "@/components/nav-progress";
import { NavSubmitButton } from "@/components/button";
import { CallIconButton, WhatsAppIconButton } from "@/components/contact-actions";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type AllotmentRole } from "@/lib/import/normalize";
import { StatusBadge } from "@/components/status-badge";
import {
  BulkActionBar,
  BulkSelectProvider,
  RowCheckbox,
  SelectAllCheckbox,
} from "@/components/bulk-select";
import { EditIconLink } from "@/components/edit-link";

const TH = "px-4 py-2.5 text-[11px] font-semibold uppercase";
const THS = { letterSpacing: "0.1em" } as const;

const inputStyle = {
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  background: "var(--white)",
  color: "var(--ink-900)",
} as const;

export default async function MyClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("my_clients")
    .select("id, name, trade_name, pan, category, status, my_role, phone, gstin, email");

  if (params.q) {
    const term = params.q.replaceAll(",", " ");
    query = query.or(
      `name.ilike.%${term}%,trade_name.ilike.%${term}%,pan.ilike.%${term}%,gstin.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`
    );
  }
  if (params.role) query = query.eq("my_role", params.role);
  if (params.category) query = query.eq("category", params.category);
  if (params.it_category) query = query.eq("it_category", params.it_category);

  const { data: clients, error } = await query.order("name");
  if (error) throw error;

  const byRole = new Map<string, NonNullable<typeof clients>>();
  for (const c of clients ?? []) {
    const list = byRole.get(c.my_role) ?? [];
    list.push(c);
    byRole.set(c.my_role, list);
  }

  // A client can appear under more than one role — dedupe for selection.
  const allIds = [...new Set((clients ?? []).map((c) => c.id))];
  const filtering = Boolean(params.q || params.role || params.category || params.it_category);

  // Roles this user actually holds, for the role filter dropdown.
  const { data: myRoles } = await supabase.from("my_clients").select("my_role");
  const roleOptions = [...new Set((myRoles ?? []).map((r) => r.my_role))].sort();

  const header = (
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
        My Clients
      </h1>
      <p className="mt-2 text-sm" style={{ color: "var(--ink-500)" }}>
        {allIds.length} clients allotted to you · grouped by your role
      </p>
    </div>
  );

  const search = (
    <form className="flex flex-wrap items-center gap-2.5 text-[13px]" method="get">
      <input
        name="q"
        defaultValue={params.q}
        placeholder="Search name / trade name / PAN / GSTIN / mobile / email"
        className="w-[320px] px-3 py-2"
        style={inputStyle}
      />
      <select name="role" defaultValue={params.role ?? ""} className="cursor-pointer px-3 py-2" style={inputStyle}>
        <option value="">All my roles</option>
        {roleOptions.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r as AllotmentRole] ?? r}
          </option>
        ))}
      </select>
      <select name="category" defaultValue={params.category ?? ""} className="cursor-pointer px-3 py-2" style={inputStyle}>
        <option value="">All categories</option>
        {["A++", "A+", "A", "B", "C", "D", "E"].map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <select name="it_category" defaultValue={params.it_category ?? ""} className="cursor-pointer px-3 py-2" style={inputStyle}>
        <option value="">All IT categories</option>
        {["NON AUDIT", "SALARY", "AUDIT", "COMP AUDIT", "COMP DIRECTOR", "AUDIT PARTNER", "TRUST AUDIT", "NA"].map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <NavSubmitButton variant="ink" size="md">
        Search
      </NavSubmitButton>
      {filtering && (
        <AppLink
          href="/my-clients"
          inlineSpinner
          className="text-[12.5px] font-semibold no-underline"
          style={{ color: "var(--brand-blue)" }}
        >
          Clear
        </AppLink>
      )}
    </form>
  );

  if (!clients?.length) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        {search}
        <div
          className="bg-white p-8 text-center text-sm"
          style={{
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-sm)",
            color: "var(--ink-500)",
          }}
        >
          {filtering
            ? "No clients match your search. Try a different term or clear the filters."
            : "No clients are allotted to you yet. If this seems wrong, ask the admin to map your email on the Staff screen."}
        </div>
      </div>
    );
  }

  // Phone numbers for the Mobile column (click-to-call / WhatsApp actions).
  const { data: phones } = allIds.length
    ? await supabase.from("clients").select("id, phone").in("id", allIds)
    : { data: [] as { id: string; phone: string | null }[] };
  const phoneById = new Map((phones ?? []).map((p) => [p.id, p.phone]));

  return (
    <BulkSelectProvider pageIds={allIds} allFilteredIds={allIds}>
      <div className="flex flex-col gap-8">
        {header}
        {search}

        {[...byRole.entries()].map(([role, list]) => (
          <section key={role}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2
                className="m-0 text-[22px] font-semibold"
                style={{ fontFamily: "var(--font-display)", color: "var(--brand-blue-deep)" }}
              >
                {ROLE_LABELS[role as AllotmentRole] ?? role}
              </h2>
              <span className="text-xs" style={{ color: "var(--ink-400)" }}>
                {list.length} clients
              </span>
            </div>
            <div
              className="overflow-x-auto bg-white"
              style={{
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-lg)",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <table className="w-full min-w-[840px] border-collapse text-[13px]">
                <thead>
                  <tr style={{ background: "var(--paper-2)", color: "var(--ink-500)" }} className="text-left">
                    <th className="w-9 px-4 py-2.5">
                      <SelectAllCheckbox />
                    </th>
                    <th className={TH} style={THS}>Client</th>
                    <th className={TH} style={THS}>Trade Name</th>
                    <th className={TH} style={THS}>PAN</th>
                    <th className={TH} style={THS}>Cat.</th>
                    <th className={TH} style={THS}>Mobile</th>
                    <th className={TH} style={THS}>Status</th>
                    <th className={TH} style={THS}>Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => {
                    const phone = phoneById.get(c.id) ?? null;
                    return (
                      <tr key={`${role}-${c.id}`} style={{ borderTop: "1px solid var(--ink-100)" }} className="hover:bg-[var(--paper)]">
                        <td className="px-4 py-[11px]">
                          <RowCheckbox id={c.id} />
                        </td>
                        <td className="px-4 py-[11px]">
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
                        <td className="px-4 py-[11px]">
                          <EditIconLink href={`/clients/${c.id}/edit`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        <BulkActionBar />
      </div>
    </BulkSelectProvider>
  );
}
