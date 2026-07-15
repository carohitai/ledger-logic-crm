// WhatsApp compliance follow-up templates. Shared by the WhatsApp modal
// (preview / wa.me), the send API and the GST reminder cron. `nextel`
// describes the approved Nextel template a message maps to (template id,
// language and how to build its positional args); templates with
// `nextel: null` aren't approved yet and can only be sent through wa.me.

/** Per-client values available when rendering a template / building args. */
export interface WaTemplateValues {
  client: string;
  /** Filing period label, e.g. "June 2026" or "Apr–Jun 2026". */
  period?: string;
  partner_incharge?: string;
  accounts_incharge?: string;
  gst_incharge?: string;
}

export interface NextelTemplate {
  /** Approved template id on Nextel. */
  templateId: string;
  language: string;
  /** Nextel payload `type` for this template. */
  type: "template" | "buttonTemplate";
  /** Positional args in the order the approved template expects them. */
  args: (values: WaTemplateValues) => string[];
}

export interface WaTemplate {
  key: string;
  label: string;
  text: string;
  nextel: NextelTemplate | null;
}

export const WA_TEMPLATES: WaTemplate[] = [
  {
    key: "gst_reminder",
    label: "GST filing reminder",
    text: "Dear {client}, a gentle reminder from Kolte & Associates LLP — your GST return for {period} is due. Please submit your sales and purchase details before the 5th so we can file on time. Partner incharge: {partner_incharge} · Accounts: {accounts_incharge} · GST: {gst_incharge}.",
    // Maps to the approved gst_return button template on Nextel:
    // {{1}} client, {{2}} return period, {{3}}-{{5}} partner/accounts/GST incharge.
    nextel: {
      templateId: "gst_return",
      language: "en",
      type: "buttonTemplate",
      args: (v) => [
        v.client,
        v.period ?? "-",
        v.partner_incharge ?? "-",
        v.accounts_incharge ?? "-",
        v.gst_incharge ?? "-",
      ],
    },
  },
  {
    key: "it_reminder",
    label: "Income Tax return reminder",
    text: "Dear {client}, your Income Tax return filing is pending. Kindly share the required documents at your earliest convenience so we can proceed.",
    nextel: null,
  },
  {
    key: "document_request",
    label: "Document request",
    text: "Dear {client}, we need a few documents to continue your compliance work. Please share them whenever convenient. Thank you.",
    nextel: null,
  },
  {
    key: "fee_due",
    label: "Fee / payment due",
    text: "Dear {client}, a professional fee payment is currently due on your account. Please arrange the same at your convenience. Regards, Kolte & Associates LLP.",
    nextel: null,
  },
  {
    key: "callback",
    label: "Callback request",
    text: "Dear {client}, we tried reaching you regarding your compliance follow-up. Please let us know a convenient time for a callback.",
    // Maps to the approved call_back_work button template on Nextel.
    nextel: {
      templateId: "call_back_work",
      language: "en",
      type: "buttonTemplate",
      args: (v) => [v.client],
    },
  },
];

export function renderTemplate(t: WaTemplate, values: WaTemplateValues): string {
  return t.text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const v = (values as unknown as Record<string, string | undefined>)[key];
    return v ?? "-";
  });
}

/**
 * Current calendar month in IST, e.g. "June 2026" — for the automated cron,
 * which fires a few days *before* month-end (see GST_REMINDER_DAY), so the
 * month that's about to close is the current one, not the previous one.
 */
export function currentMonthLabel(now = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** True when `now` (IST) falls in the last month of a GST/QRMP quarter (Mar, Jun, Sep, Dec). */
export function isQuarterEndMonth(now = new Date()): boolean {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const m = ist.getUTCMonth() + 1; // 1-12
  return m === 3 || m === 6 || m === 9 || m === 12;
}

/**
 * The GST/QRMP quarter (Apr-Jun / Jul-Sep / Oct-Dec / Jan-Mar) containing the
 * current IST month, e.g. "Apr–Jun 2026". Only meaningful when called in a
 * quarter's last month (see isQuarterEndMonth).
 */
export function currentQuarterLabel(now = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth(); // 0-11, last month of the quarter
  const start = new Date(Date.UTC(y, m - 2, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const startLabel = start.toLocaleString("en-IN", { month: "short", timeZone: "UTC" });
  const endLabel = end.toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
  return `${startLabel}–${endLabel}`;
}
