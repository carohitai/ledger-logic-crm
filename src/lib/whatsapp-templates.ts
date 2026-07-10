// WhatsApp compliance follow-up templates ({client} is filled per client).
// Shared by the WhatsApp modal (preview / wa.me) and the send API.
//
// A template becomes sendable through the Nextel API once it is approved on
// Nextel and its `nextel` mapping (template ID + ordered args) is filled in
// here. Templates without a mapping can still be sent via wa.me.

/** Client fields available to build template args (subset of the clients table). */
export interface WaClientInfo {
  name: string;
  trade_name?: string | null;
  pan?: string | null;
  gstin?: string | null;
  gst_frequency?: string | null;
}

export interface WaNextelMapping {
  /** Approved template ID on Nextel (the template's name, e.g. "call_back_work"). */
  templateId: string;
  /** Nextel payload `type` for this template. */
  type: "buttonTemplate" | "textTemplate";
  /** Ordered values for {{1}}..{{n}} in the approved template. */
  args: (client: WaClientInfo) => string[];
}

export interface WaTemplate {
  key: string;
  label: string;
  text: string;
  /** Present once the template is approved on Nextel; null → wa.me only. */
  nextel: WaNextelMapping | null;
}

export const WA_TEMPLATES: WaTemplate[] = [
  {
    key: "gst_reminder",
    label: "GST filing reminder",
    text: "Dear {client}, a gentle reminder from Kolte & Associates LLP — your GST return for the current period is due shortly. Please share any pending details so we can file on time.",
    // Approved on Nextel as "gst_return" (buttonTemplate, 5 args). Mapping stays
    // off until the approved text + arg order ({{1}}..{{5}}) are confirmed, so
    // we don't send a garbled message.
    nextel: null,
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
      args: (client) => [client.name],
    },
  },
];

export function renderTemplate(t: WaTemplate, clientName: string): string {
  return t.text.replace("{client}", clientName);
}
