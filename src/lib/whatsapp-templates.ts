// WhatsApp compliance follow-up templates ({client} is filled per client).
// Shared by the WhatsApp modal (preview / wa.me) and the send API. `nextel`
// marks templates that map to an approved Nextel template and can be sent via
// the API; the rest can still be sent through wa.me until they're approved.

export interface WaTemplate {
  key: string;
  label: string;
  text: string;
  nextel: boolean;
}

export const WA_TEMPLATES: WaTemplate[] = [
  {
    key: "gst_reminder",
    label: "GST filing reminder",
    text: "Dear {client}, a gentle reminder from Kolte & Associates LLP — your GST return for the current period is due shortly. Please share any pending details so we can file on time.",
    nextel: false,
  },
  {
    key: "it_reminder",
    label: "Income Tax return reminder",
    text: "Dear {client}, your Income Tax return filing is pending. Kindly share the required documents at your earliest convenience so we can proceed.",
    nextel: false,
  },
  {
    key: "document_request",
    label: "Document request",
    text: "Dear {client}, we need a few documents to continue your compliance work. Please share them whenever convenient. Thank you.",
    nextel: false,
  },
  {
    key: "fee_due",
    label: "Fee / payment due",
    text: "Dear {client}, a professional fee payment is currently due on your account. Please arrange the same at your convenience. Regards, Kolte & Associates LLP.",
    nextel: false,
  },
  {
    key: "callback",
    label: "Callback request",
    text: "Dear {client}, we tried reaching you regarding your compliance follow-up. Please let us know a convenient time for a callback.",
    // Maps to the approved call_back_work button template on Nextel.
    nextel: true,
  },
];

export function renderTemplate(t: WaTemplate, clientName: string): string {
  return t.text.replace("{client}", clientName);
}
