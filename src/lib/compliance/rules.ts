// Rule engine: turns a PAN / GST API snapshot into the tasks the firm should
// actually work on. Pure functions — no database, no network — so the rules can
// be reasoned about (and dry-run) on their own.

import {
  dueDateFor,
  istToday,
  lastCompletedMonths,
  lastCompletedQuarters,
  periodFinancialYear,
  type Period,
} from "./periods";
import { panFromGstin, type GstSnapshot, type PanSnapshot } from "./provider";
import { KIND_BY_KEY, type TaskPriority } from "@/lib/tasks";

export interface RuleClient {
  id: string;
  name: string;
  trade_name?: string | null;
  pan: string | null;
  gstin: string | null;
  gst_status: string | null;
  gst_frequency: string | null;
}

export interface ProposedTask {
  kind: string;
  /** Filing period the task belongs to, or null for one-off findings. */
  period: string | null;
  /** Discriminator used for deduping when there is no period (e.g. a GSTIN). */
  dedupeOn: string | null;
  title: string;
  details: string;
  dueDate: string | null;
  priority: TaskPriority;
  evidence: Record<string, unknown>;
}

export interface RuleOutput {
  tasks: ProposedTask[];
  /**
   * Kinds this evaluation actually covered. Only these may be auto-resolved
   * by the sync — a PAN lookup that failed must not close GST tasks.
   */
  evaluatedKinds: string[];
}

/** How many completed monthly periods back the filing check looks. */
const LOOKBACK_MONTHS = Number(process.env.GST_LOOKBACK_MONTHS ?? 6);
const LOOKBACK_QUARTERS = Number(process.env.GST_LOOKBACK_QUARTERS ?? 2);

function priorityFor(kind: string, dueDate: string | null, today: string): TaskPriority {
  if (dueDate && dueDate < today) return "high";
  return KIND_BY_KEY.get(kind)?.defaultPriority ?? "normal";
}

function isActiveStatus(status: string | null | undefined): boolean {
  return /^act/i.test((status ?? "").trim());
}

/** Financial years a set of periods spans, for the vendor's returns endpoint. */
export function financialYearsFor(periods: Period[]): string[] {
  return [...new Set(periods.map(periodFinancialYear))];
}

/**
 * Periods whose GSTR-1 / GSTR-3B filing should be checked for a taxpayer,
 * newest first. Quarterly (QRMP) filers are checked per quarter, everyone else
 * per month.
 */
export function periodsToCheck(
  frequency: "MONTHLY" | "QUARTERLY",
  now: Date = new Date()
): Period[] {
  return frequency === "QUARTERLY"
    ? lastCompletedQuarters(LOOKBACK_QUARTERS, now)
    : lastCompletedMonths(LOOKBACK_MONTHS, now);
}

/** CRM `gst_frequency` -> the two values the filing calendar understands. */
function crmFrequency(value: string | null): "MONTHLY" | "QUARTERLY" | null {
  const v = (value ?? "").toUpperCase();
  if (v.includes("QUART")) return "QUARTERLY";
  if (v.includes("MONTH")) return "MONTHLY";
  return null;
}

/** Strips punctuation and the usual entity suffixes before comparing names. */
function nameKey(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\b(M\/S|PVT|PRIVATE|LTD|LIMITED|LLP|AND|&|CO|COMPANY|ENTERPRISES?|TRADERS?)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function namesLookAlike(a: string, b: string): boolean {
  const left = nameKey(a);
  const right = nameKey(b);
  if (!left || !right) return true; // nothing to compare — don't raise a task
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const leftTokens = new Set(left.split(" ").filter((t) => t.length > 2));
  const rightTokens = right.split(" ").filter((t) => t.length > 2);
  if (!leftTokens.size || !rightTokens.length) return true;
  const shared = rightTokens.filter((t) => leftTokens.has(t)).length;
  return shared / Math.max(leftTokens.size, rightTokens.length) >= 0.6;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

/** True when a filing of `type` exists for any month the period covers. */
function isFiled(snapshot: GstSnapshot, type: string, period: Period): boolean {
  const months = new Set(
    period.months.map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`)
  );
  return snapshot.returns.some((r) => r.type === type && months.has(r.period));
}

function gstFilingTasks(
  client: RuleClient,
  gst: GstSnapshot,
  frequency: "MONTHLY" | "QUARTERLY",
  today: string,
  now: Date
): ProposedTask[] {
  const out: ProposedTask[] = [];
  // No filing history at all usually means the returns endpoint is not
  // subscribed / returned nothing — raising 12 "not filed" tasks off that would
  // be worse than staying quiet.
  if (!gst.returns.length) return out;

  for (const period of periodsToCheck(frequency, now)) {
    if (gst.registeredOn && period.endsOn < gst.registeredOn) continue;
    if (gst.cancelledOn && period.endsOn > gst.cancelledOn) continue;

    for (const [type, kind, label] of [
      ["GSTR1", "gstr1_pending", "GSTR-1"],
      ["GSTR3B", "gstr3b_pending", "GSTR-3B"],
    ] as const) {
      if (isFiled(gst, type, period)) continue;
      const due = dueDateFor(type, period, frequency);
      out.push({
        kind,
        period: period.key,
        dedupeOn: period.key,
        title: `File ${label} for ${period.label}`,
        details:
          `GSTIN ${gst.gstin} shows no ${label} filed for ${period.label}. ` +
          `Statutory due date ${fmtDate(due)}${due < today ? " (overdue)" : ""}.`,
        dueDate: due,
        priority: priorityFor(kind, due, today),
        evidence: {
          gstin: gst.gstin,
          returnType: label,
          period: period.key,
          frequency,
          filedPeriods: gst.returns
            .filter((r) => r.type === type)
            .slice(0, 12)
            .map((r) => r.period),
        },
      });
    }
  }
  return out;
}

/**
 * Every rule, for one client. `gst` / `pan` are null when the client has no
 * such identifier or the lookup failed — the rules then simply skip that side.
 */
export function evaluate(input: {
  client: RuleClient;
  gst: GstSnapshot | null;
  pan: PanSnapshot | null;
  now?: Date;
}): RuleOutput {
  const { client, gst, pan } = input;
  const now = input.now ?? new Date();
  const today = istToday(now);
  const tasks: ProposedTask[] = [];
  const evaluatedKinds = new Set<string>();

  // --- GSTIN / PAN consistency (pure data quality, needs no API) ---
  if (client.pan && client.gstin) {
    evaluatedKinds.add("gstin_pan_mismatch");
    const embedded = panFromGstin(client.gstin);
    if (embedded && embedded !== client.pan.toUpperCase()) {
      tasks.push({
        kind: "gstin_pan_mismatch",
        period: null,
        dedupeOn: client.gstin.toUpperCase(),
        title: "Reconcile GSTIN and PAN on the client master",
        details:
          `GSTIN ${client.gstin} carries PAN ${embedded}, but the client master has ` +
          `${client.pan}. One of the two is wrong — verify and correct it.`,
        dueDate: null,
        priority: priorityFor("gstin_pan_mismatch", null, today),
        evidence: { gstin: client.gstin, crmPan: client.pan, gstinPan: embedded },
      });
    }
  }

  // --- GST side ---
  if (gst) {
    for (const kind of [
      "gstr1_pending",
      "gstr3b_pending",
      "gst_registration_inactive",
      "gst_status_mismatch",
      "gst_frequency_mismatch",
    ]) {
      evaluatedKinds.add(kind);
    }

    const active = isActiveStatus(gst.status);
    const frequency = gst.frequency ?? crmFrequency(client.gst_frequency) ?? "MONTHLY";

    if (!active && gst.status) {
      tasks.push({
        kind: "gst_registration_inactive",
        period: null,
        dedupeOn: gst.gstin,
        title: `GST registration is ${gst.status.toLowerCase()} — confirm with the client`,
        details:
          `The GST portal reports GSTIN ${gst.gstin} as "${gst.status}"` +
          (gst.cancelledOn ? ` with effect from ${fmtDate(gst.cancelledOn)}` : "") +
          `. Confirm with the client, stop filing if genuine, and update the client ` +
          `master (GST status / frequency) accordingly.`,
        dueDate: null,
        priority: priorityFor("gst_registration_inactive", null, today),
        evidence: { gstin: gst.gstin, status: gst.status, cancelledOn: gst.cancelledOn },
      });
    }

    // Portal says the registration is live but the CRM does not — stale master
    // data that quietly excludes the client from the GST reminder cron.
    const crmStatus = (client.gst_status ?? "").toLowerCase();
    if (active && crmStatus !== "registered") {
      tasks.push({
        kind: "gst_status_mismatch",
        period: null,
        dedupeOn: gst.gstin,
        title: "Client master says GST is not registered, the portal says active",
        details:
          `GSTIN ${gst.gstin} is Active on the portal, but the client master has GST ` +
          `status "${client.gst_status ?? "(blank)"}". Update the master so GST ` +
          `reminders and filing tasks reach this client.`,
        dueDate: null,
        priority: priorityFor("gst_status_mismatch", null, today),
        evidence: { gstin: gst.gstin, portalStatus: gst.status, crmStatus: client.gst_status },
      });
    }

    const crmFreq = crmFrequency(client.gst_frequency);
    if (active && gst.frequency && crmFreq && gst.frequency !== crmFreq) {
      tasks.push({
        kind: "gst_frequency_mismatch",
        period: null,
        dedupeOn: gst.gstin,
        title: `Filing frequency is ${gst.frequency.toLowerCase()} on the portal, ${crmFreq.toLowerCase()} in the CRM`,
        details:
          `GSTIN ${gst.gstin} files ${gst.frequency.toLowerCase()} returns per the portal, ` +
          `but the client master says ${client.gst_frequency}. Correct the master — the ` +
          `reminder cron uses it to decide who gets a message each cycle.`,
        dueDate: null,
        priority: priorityFor("gst_frequency_mismatch", null, today),
        evidence: {
          gstin: gst.gstin,
          portalFrequency: gst.frequency,
          crmFrequency: client.gst_frequency,
        },
      });
    }

    if (active) tasks.push(...gstFilingTasks(client, gst, frequency, today, now));
  }

  // --- PAN side ---
  if (pan) {
    for (const kind of ["pan_inactive", "pan_name_mismatch", "gst_new_registration"]) {
      evaluatedKinds.add(kind);
    }

    // ITD reports "E" (existing / valid) for a good PAN; anything else — deleted,
    // deactivated, or the inoperative flag for un-linked Aadhaar — needs work.
    const panOk = /^(VALID|ACTIVE|OPERATIVE|EXISTING|E)$/i.test((pan.status ?? "").trim());
    if (pan.status && !panOk) {
      tasks.push({
        kind: "pan_inactive",
        period: null,
        dedupeOn: pan.pan,
        title: `PAN ${pan.pan} is ${pan.status.toLowerCase()} — resolve before filing`,
        details:
          `The Income Tax database reports PAN ${pan.pan} as "${pan.status}". An ` +
          `inoperative or invalid PAN blocks return filing, refunds and TDS credit ` +
          `(higher TDS applies u/s 206AA). Ask the client to link Aadhaar / regularise it.`,
        dueDate: null,
        priority: priorityFor("pan_inactive", null, today),
        evidence: { pan: pan.pan, status: pan.status },
      });
    }

    if (pan.name && !namesLookAlike(pan.name, client.name) &&
        !(client.trade_name && namesLookAlike(pan.name, client.trade_name))) {
      tasks.push({
        kind: "pan_name_mismatch",
        period: null,
        dedupeOn: pan.pan,
        title: "PAN holder name does not match the client master",
        details:
          `PAN ${pan.pan} is registered to "${pan.name}", while the client master says ` +
          `"${client.name}". Verify the PAN on record before it is used for filing.`,
        dueDate: null,
        priority: priorityFor("pan_name_mismatch", null, today),
        evidence: { pan: pan.pan, panName: pan.name, crmName: client.name },
      });
    }

    // GSTINs registered on the PAN that the CRM has never heard of.
    const known = new Set([client.gstin?.toUpperCase()].filter(Boolean) as string[]);
    for (const found of pan.gstins) {
      if (known.has(found.gstin)) continue;
      if (found.status && !isActiveStatus(found.status)) continue;
      tasks.push({
        kind: "gst_new_registration",
        period: null,
        dedupeOn: found.gstin,
        title: `New GSTIN ${found.gstin} found on PAN ${pan.pan}`,
        details:
          `The GST portal lists GSTIN ${found.gstin} against PAN ${pan.pan}, but it is ` +
          `not on the client master (which has ${client.gstin ?? "no GSTIN"}). Confirm ` +
          `with the client, add it to the master and start the filing calendar for it.`,
        dueDate: null,
        priority: priorityFor("gst_new_registration", null, today),
        evidence: { pan: pan.pan, gstin: found.gstin, status: found.status },
      });
    }
  }

  return { tasks, evaluatedKinds: [...evaluatedKinds] };
}
