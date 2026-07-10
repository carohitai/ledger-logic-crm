import { AppLink } from "@/components/nav-progress";
import { CallIconButton, WhatsAppIconButton } from "@/components/contact-actions";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type AllotmentRole } from "@/lib/import/normalize";
import { StatusBadge } from "@/components/status-badge";

const TH = "px-4 py-2.5 text-[11px] font-semibold uppercase";
const THS = { letterSpacing: "0.1em" } as const;

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

  // Phone numbers for the Mobile column (click-to-call / WhatsApp actions).
  const ids = [...new Set((clients ?? []).map((c) => c.id))];
  const { data: phones } = ids.length
    ? await supabase.from("clients").select("id, phone").in("id", ids)
    : { data: [] as { id: string; phone: string | null }[] };
  const phoneById = new Map((phones ?? []).map((p) => [p.id, p.phone]));

  if (!clients?.length) {
    return (
      <div
        className="bg-white p-8 text-center text-sm"
        style={{
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-sm)",
          color: "var(--ink-500)",
        }}
      >
        No clients are allotted to you yet. If this seems wrong, ask the admin
        to map your email on the Staff screen.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
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
          {clients.length} clients allotted to you · grouped by your role
        </p>
      </div>

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
              {list!.length} clients
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
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr style={{ background: "var(--paper-2)", color: "var(--ink-500)" }} className="text-left">
                  <th className={TH} style={THS}>Client</th>
                  <th className={TH} style={THS}>Trade Name</th>
                  <th className={TH} style={THS}>PAN</th>
                  <th className={TH} style={THS}>Cat.</th>
                  <th className={TH} style={THS}>Mobile</th>
                  <th className={TH} style={THS}>Status</th>
                </tr>
              </thead>
              <tbody>
                {list!.map((c) => {
                  const phone = phoneById.get(c.id) ?? null;
                  return (
                    <tr key={`${role}-${c.id}`} style={{ borderTop: "1px solid var(--ink-100)" }} className="hover:bg-[var(--paper)]">
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
