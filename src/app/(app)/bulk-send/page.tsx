import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NavSubmitButton } from "@/components/button";
import { AppLink } from "@/components/nav-progress";
import { StatusBadge } from "@/components/status-badge";
import {
  BulkActionBar,
  BulkSelectProvider,
  RowCheckbox,
  SelectAllCheckbox,
} from "@/components/bulk-select";
import { WA_TEMPLATES } from "@/lib/whatsapp-templates";

// Campaign-style bulk send: pick a client segment with filters, review who
// qualifies, then send an approved WhatsApp template to the whole selection.
// Everything matching the filter starts selected; untick anyone to exclude.

const PREVIEW_LIMIT = 300;

const TH = "px-4 py-2.5 text-[11px] font-semibold uppercase";
const THS = { letterSpacing: "0.1em" } as const;

const inputStyle = {
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  background: "var(--white)",
  color: "var(--ink-900)",
} as const;

const cardStyle = {
  background: "var(--white)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-sm)",
} as const;

const IT_CATEGORIES = [
  "NON AUDIT",
  "SALARY",
  "AUDIT",
  "COMP AUDIT",
  "COMP DIRECTOR",
  "AUDIT PARTNER",
  "TRUST AUDIT",
  "NA",
];

export default async function BulkSendPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("staff")
    .select("app_role")
    .eq("auth_user_id", user!.id)
    .maybeSingle();
  // Firm-wide campaigns are a partner/admin action.
  if (me?.app_role !== "admin" && me?.app_role !== "partner") redirect("/my-clients");

  // Default to the segment we most often message: active clients only.
  const status = params.status ?? "active";

  let query = supabase
    .from("clients_wide")
    .select("id, name, trade_name, phone, category, it_category, gst_status, status, partner_incharge");
  if (status) query = query.eq("status", status);
  if (params.it_category) query = query.eq("it_category", params.it_category);
  if (params.category) query = query.eq("category", params.category);
  if (params.gst_status) query = query.eq("gst_status", params.gst_status);
  if (params.partner) query = query.eq("partner_incharge", params.partner);
  if (params.q) {
    const term = params.q.replaceAll(",", " ");
    query = query.or(`name.ilike.%${term}%,trade_name.ilike.%${term}%,pan.ilike.%${term}%`);
  }

  const { data: matched, error } = await query.order("name").limit(5000);
  if (error) throw error;

  const all = matched ?? [];
  const withPhone = all.filter((c) => (c.phone ?? "").replace(/\D/g, "").length >= 10);
  const noPhone = all.length - withPhone.length;
  const preview = withPhone.slice(0, PREVIEW_LIMIT);
  const selectableIds = withPhone.map((c) => c.id);

  const { data: partners } = await supabase
    .from("staff")
    .select("full_name")
    .eq("app_role", "partner")
    .order("full_name");

  const sendable = WA_TEMPLATES.filter((t) => t.nextel);

  return (
    <BulkSelectProvider
      pageIds={preview.map((c) => c.id)}
      allFilteredIds={selectableIds}
      initialSelected={selectableIds}
    >
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
            Bulk WhatsApp Send
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--ink-500)" }}>
            Choose a segment, review who qualifies, then send an approved template.
            Everyone matching starts selected — untick anyone you want to leave out.
          </p>
        </div>

        <form className="flex flex-wrap items-center gap-2.5 text-[13px]" method="get">
          <input
            name="q"
            defaultValue={params.q}
            placeholder="Search name / trade name / PAN"
            className="w-[260px] px-3 py-2"
            style={inputStyle}
          />
          <select name="it_category" defaultValue={params.it_category ?? ""} className="cursor-pointer px-3 py-2" style={inputStyle}>
            <option value="">All IT categories</option>
            {IT_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select name="category" defaultValue={params.category ?? ""} className="cursor-pointer px-3 py-2" style={inputStyle}>
            <option value="">All categories</option>
            {["A++", "A+", "A", "B", "C", "D", "E"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select name="gst_status" defaultValue={params.gst_status ?? ""} className="cursor-pointer px-3 py-2" style={inputStyle}>
            <option value="">Any GST status</option>
            {["registered", "unregistered", "cancelled"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select name="partner" defaultValue={params.partner ?? ""} className="cursor-pointer px-3 py-2" style={inputStyle}>
            <option value="">All partners</option>
            {(partners ?? []).map((p) => (
              <option key={p.full_name}>{p.full_name}</option>
            ))}
          </select>
          <select name="status" defaultValue={status} className="cursor-pointer px-3 py-2" style={inputStyle}>
            <option value="active">active</option>
            <option value="missing_from_sheet">missing from sheet</option>
            <option value="archived">archived</option>
          </select>
          <NavSubmitButton variant="ink" size="md">
            Apply segment
          </NavSubmitButton>
          <AppLink
            href="/bulk-send"
            inlineSpinner
            className="text-[12.5px] font-semibold no-underline"
            style={{ color: "var(--brand-blue)" }}
          >
            Reset
          </AppLink>
        </form>

        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["Match the segment", all.length, "var(--brand-blue-deep)"],
            ["Have a mobile number", withPhone.length, "var(--earth-moss)"],
            ["Skipped — no mobile", noPhone, "var(--ink-400)"],
          ].map(([label, value, color]) => (
            <div key={label as string} className="px-5 py-4" style={cardStyle}>
              <div
                className="mb-1 text-[10.5px] font-bold uppercase"
                style={{ letterSpacing: "0.1em", color: "var(--ink-400)" }}
              >
                {label as string}
              </div>
              <div className="text-[28px] font-semibold tabular-nums" style={{ color: color as string }}>
                {value as number}
              </div>
            </div>
          ))}
        </div>

        {!sendable.length && (
          <p className="m-0 px-5 py-4 text-[13px]" style={{ ...cardStyle, color: "var(--ink-700)" }}>
            No templates are approved on Nextel yet, so nothing can be bulk sent.
          </p>
        )}

        <div className="overflow-x-auto bg-white" style={cardStyle}>
          <table className="w-full min-w-[820px] border-collapse text-[13px]">
            <thead>
              <tr style={{ background: "var(--paper-2)", color: "var(--ink-500)" }} className="text-left">
                <th className="w-9 px-4 py-2.5">
                  <SelectAllCheckbox />
                </th>
                <th className={TH} style={THS}>Client</th>
                <th className={TH} style={THS}>Mobile</th>
                <th className={TH} style={THS}>Cat.</th>
                <th className={TH} style={THS}>IT Category</th>
                <th className={TH} style={THS}>GST</th>
                <th className={TH} style={THS}>Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid var(--ink-100)" }} className="hover:bg-[var(--paper)]">
                  <td className="px-4 py-[11px]">
                    <RowCheckbox id={c.id} />
                  </td>
                  <td className="px-4 py-[11px]">
                    <AppLink
                      href={`/clients/${c.id}`}
                      inlineSpinner
                      className="font-semibold no-underline hover:!text-[var(--brand-blue)] hover:underline"
                      style={{ color: "var(--ink-900)" }}
                    >
                      {c.name}
                    </AppLink>
                  </td>
                  <td className="px-4 py-[11px] tabular-nums" style={{ color: "var(--ink-700)" }}>{c.phone}</td>
                  <td className="px-4 py-[11px]">{c.category}</td>
                  <td className="px-4 py-[11px]" style={{ color: "var(--ink-700)" }}>{c.it_category}</td>
                  <td className="px-4 py-[11px]" style={{ color: "var(--ink-500)" }}>{c.gst_status}</td>
                  <td className="px-4 py-[11px]">
                    <StatusBadge status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {withPhone.length > preview.length && (
          <p className="m-0 text-[12.5px]" style={{ color: "var(--ink-400)" }}>
            Showing the first {preview.length} of {withPhone.length} matching clients — all
            {" "}{withPhone.length} are selected and will be sent to.
          </p>
        )}

        <BulkActionBar />
      </div>
    </BulkSelectProvider>
  );
}
