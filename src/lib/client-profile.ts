// Shared definition of which client columns are editable in the CRM, who may
// edit them, and how an edit is recorded. Used by the client edit form and by
// the activity feed behind the notification bell.

export interface EditableField {
  key: string;
  label: string;
  /** Free text unless `options` is set, which renders a <select>. */
  options?: readonly string[];
  placeholder?: string;
  /** Only admins may change this column (master-data / lifecycle fields). */
  adminOnly?: boolean;
  mono?: boolean;
}

export const EDITABLE_FIELDS: EditableField[] = [
  { key: "name", label: "Client name", adminOnly: true },
  { key: "trade_name", label: "Trade name" },
  { key: "phone", label: "Mobile", placeholder: "10-digit mobile" },
  { key: "email", label: "Email" },
  { key: "constitution", label: "Constitution" },
  { key: "pan", label: "PAN", adminOnly: true, mono: true },
  { key: "gstin", label: "GSTIN", mono: true },
  {
    key: "gst_status",
    label: "GST status",
    options: ["", "registered", "unregistered", "cancelled"],
  },
  {
    key: "gst_frequency",
    label: "GST frequency",
    options: ["", "MONTHLY", "QUARTERLY", "CANCELLED"],
  },
  {
    key: "category",
    label: "Category",
    options: ["", "A++", "A+", "A", "B", "C", "D", "E"],
    adminOnly: true,
  },
  {
    key: "it_category",
    label: "IT category",
    options: [
      "",
      "NON AUDIT",
      "SALARY",
      "AUDIT",
      "COMP AUDIT",
      "COMP DIRECTOR",
      "AUDIT PARTNER",
      "TRUST AUDIT",
      "NA",
    ],
  },
  { key: "books", label: "Books" },
  {
    key: "status",
    label: "Status",
    options: ["active", "missing_from_sheet", "archived"],
    adminOnly: true,
  },
];

export function fieldsFor(isAdmin: boolean): EditableField[] {
  return isAdmin ? EDITABLE_FIELDS : EDITABLE_FIELDS.filter((f) => !f.adminOnly);
}

/** Change keys used for team-allotment edits, alongside the column keys above. */
export const ALLOTMENT_CHANGE_KEYS: Record<string, string> = {
  "incharge.partner": "Partner incharge",
  "incharge.income_tax": "Income Tax incharge",
  "incharge.billing": "Billing incharge",
  "incharge.accounts": "Accounts incharge",
  "incharge.data_entry": "Data Entry assistance",
  "incharge.gst": "GST incharge",
};

export const FIELD_LABELS: Record<string, string> = {
  ...Object.fromEntries(EDITABLE_FIELDS.map((f) => [f.key, f.label])),
  ...ALLOTMENT_CHANGE_KEYS,
};

export type ChangeSet = Record<string, { from: unknown; to: unknown }>;

/** Human-readable one-liner for the notification feed. */
export function changeSummary(changes: ChangeSet): string {
  const keys = Object.keys(changes);
  if (!keys.length) return "No changes";
  return keys.map((k) => FIELD_LABELS[k] ?? k).join(", ");
}

export function labelFor(key: string): string {
  return FIELD_LABELS[key] ?? key.replaceAll("_", " ");
}
