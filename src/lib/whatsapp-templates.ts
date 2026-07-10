// WhatsApp compliance follow-up templates, with {token} variables filled per
// client. Shared by the WhatsApp modal (preview / wa.me) and the send API.
//
// A template becomes sendable through the Nextel API once it is approved on
// Nextel and its `nextel` mapping (template ID + ordered args) is filled in
// here. Templates without a mapping can still be sent via wa.me.

/**
 * Values available to fill template {token}s. The send API builds these per
 * client (incharges come from client_allotments); the modal preview only has
 * the client name, so unfilled tokens render literally there.
 */
export interface WaTemplateValues {
  client: string;
  /** Month the return is for, e.g. "June 2026". */
  period?: string;
  partner_incharge?: string;
  accounts_incharge?: string;
  gst_incharge?: string;
}

export interface WaNextelMapping {
  /** Approved template ID on Nextel (the template's name, e.g. "call_back_work"). */
  templateId: string;
  /** Nextel payload `type` for this template. */
  type: "buttonTemplate" | "textTemplate";
  /** Ordered values for {{1}}..{{n}} in the approved template. */
  args: (values: WaTemplateValues) => string[];
}

export interface WaTemplate {
  key: string;
  label: string;
  text: string;
  /** Present once the template is approved on Nextel; null → wa.me only. */
  nextel: WaNextelMapping | null;
}

// Text mirrors the approved "gst_return" template on Nextel verbatim
// ({{1}}..{{5}} → tokens); keep the two in sync so previews and the
// whatsapp_messages log match what clients actually receive.
const GST_REMINDER_TEXT = `Dear {client}

Kindly Submit your following documents data for GST return for the month period {period}

1. Sales Bills / RA Bills
2. Purchase Bills
3. Bank Statements with proper remark of every transaction
4. Loan Statements
5. Attendant Muster / Salary Paysheet / Labour Payment Advice
6. PF / ESIC – Challan, ECR, Payment Receipt
7. GSTR 7A report Only for Contractors
8. Cutting Details for Contractors
9. Suppliers Ledger
10. Credit Card Statement

Following are:
Your Partner Incharge is {partner_incharge}
Your Accounts Incharge is {accounts_incharge}
Your GST Incharge is {gst_incharge}

In case of delay, a late fee will be payable as per rules. Rs. 20/- for NIL returns per day. Rs. 50/- for other than NIL returns per day. Note -Kindly submit all bills before the 5th. Any bills received after this date may result in delays in filing the GSTR-1 return, as we may not have enough time to properly analyze your documents. Additionally, the GST website tends to slow down near the deadline, further complicating the process.`;

export const WA_TEMPLATES: WaTemplate[] = [
  {
    key: "gst_reminder",
    label: "GST filing reminder",
    text: GST_REMINDER_TEXT,
    nextel: {
      templateId: "gst_return",
      type: "buttonTemplate",
      args: (v) => [
        v.client,
        v.period ?? previousMonthLabel(),
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
    nextel: {
      templateId: "call_back_work",
      type: "buttonTemplate",
      args: (v) => [v.client],
    },
  },
];

/** Fills known {token}s; unknown or missing ones are left literally in place. */
export function renderTemplate(t: WaTemplate, values: WaTemplateValues): string {
  const map = values as unknown as Record<string, string | undefined>;
  return t.text.replace(/\{(\w+)\}/g, (token, key) => map[key] ?? token);
}

/** Previous calendar month in IST, e.g. "June 2026" — the month a GST return filed now is for. */
export function previousMonthLabel(now = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const prev = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1));
  return prev.toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}
