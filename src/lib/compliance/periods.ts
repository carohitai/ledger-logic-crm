// GST filing calendar helpers. Everything is computed in IST, because the
// statutory due dates ("file GSTR-3B by the 20th") are Indian calendar dates
// and the app runs on UTC servers (Vercel).

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** `now` shifted into IST, so the UTC getters read as IST wall-clock values. */
export function istNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + IST_OFFSET_MS);
}

/** Today's IST date as `YYYY-MM-DD`. */
export function istToday(now: Date = new Date()): string {
  return istNow(now).toISOString().slice(0, 10);
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

export interface Period {
  /** Canonical key stored on the task: `2026-07` (month) or `2026-Q2` (quarter). */
  key: string;
  /** Human label: `July 2026` or `Jul–Sep 2026`. */
  label: string;
  /** Calendar months the period covers (month is 1-12). */
  months: { year: number; month: number }[];
  /** Last calendar day of the period, `YYYY-MM-DD`. */
  endsOn: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Adds `delta` months to a `{year, month}` pair (month is 1-12). */
function shiftMonth(year: number, month: number, delta: number) {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

export function monthPeriod(year: number, month: number): Period {
  return {
    key: `${year}-${pad(month)}`,
    label: `${MONTH_NAMES[month - 1]} ${year}`,
    months: [{ year, month }],
    endsOn: isoDate(year, month, lastDayOfMonth(year, month)),
  };
}

/**
 * The GST/QRMP quarter containing `month`. Quarters follow the financial year
 * (Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar); the key is anchored to the
 * calendar year of the quarter's first month, so `2027-Q4` is Jan–Mar 2027.
 */
export function quarterPeriod(year: number, month: number): Period {
  const q = Math.floor(((month - 4 + 12) % 12) / 3) + 1; // 1..4
  const startMonth = q === 4 ? 1 : q * 3 + 1; // Q1->4, Q2->7, Q3->10, Q4->1
  const months = [0, 1, 2].map((i) => shiftMonth(year, startMonth, i));
  const last = months[2];
  return {
    key: `${year}-Q${q}`,
    label: `${MONTH_SHORT[startMonth - 1]}–${MONTH_SHORT[last.month - 1]} ${last.year}`,
    months,
    endsOn: isoDate(last.year, last.month, lastDayOfMonth(last.year, last.month)),
  };
}

/** The `count` most recent months that have already ended, newest first. */
export function lastCompletedMonths(count: number, now: Date = new Date()): Period[] {
  const ist = istNow(now);
  const out: Period[] = [];
  for (let i = 1; i <= count; i++) {
    const { year, month } = shiftMonth(ist.getUTCFullYear(), ist.getUTCMonth() + 1, -i);
    out.push(monthPeriod(year, month));
  }
  return out;
}

/** The `count` most recent quarters that have already ended, newest first. */
export function lastCompletedQuarters(count: number, now: Date = new Date()): Period[] {
  const ist = istNow(now);
  const current = quarterPeriod(ist.getUTCFullYear(), ist.getUTCMonth() + 1);
  const out: Period[] = [];
  let cursor = current.months[0];
  for (let i = 0; i < count; i++) {
    cursor = shiftMonth(cursor.year, cursor.month, -3);
    out.push(quarterPeriod(cursor.year, cursor.month));
  }
  return out;
}

export type ReturnType = "GSTR1" | "GSTR3B";

/**
 * Statutory due date for a return period.
 *
 * Monthly filers: GSTR-1 on the 11th, GSTR-3B on the 20th of the following
 * month. QRMP (quarterly) filers: GSTR-1/IFF on the 13th and GSTR-3B on the
 * 22nd or 24th of the month following the quarter, depending on the state
 * group — the day is configurable via GST_QRMP_3B_DUE_DAY (default 22, the
 * Group A / Maharashtra date).
 */
export function dueDateFor(
  type: ReturnType,
  period: Period,
  frequency: "MONTHLY" | "QUARTERLY"
): string {
  const last = period.months[period.months.length - 1];
  const next = shiftMonth(last.year, last.month, 1);
  const quarterly3bDay = Number(process.env.GST_QRMP_3B_DUE_DAY ?? 22);
  const day =
    frequency === "QUARTERLY"
      ? type === "GSTR1"
        ? 13
        : quarterly3bDay
      : type === "GSTR1"
        ? 11
        : 20;
  return isoDate(next.year, next.month, day);
}

/** Financial year label (`2026-27`) a calendar month belongs to. */
export function financialYear(year: number, month: number): string {
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

/** Financial year label for a period, taken from its last month. */
export function periodFinancialYear(period: Period): string {
  const last = period.months[period.months.length - 1];
  return financialYear(last.year, last.month);
}

/**
 * Normalises the `ret_prd` values GST APIs return (`062026`, `06-2026`,
 * `2026-06`) to our `YYYY-MM` month key. Returns null when unrecognised.
 */
export function normalizeReturnPeriod(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").replace(/[^0-9]/g, "");
  if (s.length !== 6) return null;
  // MMYYYY (GSTN's own format) vs YYYYMM.
  const asMonthFirst = Number(s.slice(0, 2));
  if (asMonthFirst >= 1 && asMonthFirst <= 12) {
    return `${s.slice(2)}-${s.slice(0, 2)}`;
  }
  const month = Number(s.slice(4));
  if (month >= 1 && month <= 12) return `${s.slice(0, 4)}-${s.slice(4)}`;
  return null;
}

/** `2026-07` / `2026-Q2` -> display label, for tasks read back from the DB. */
export function periodLabel(key: string | null | undefined): string {
  if (!key) return "—";
  const month = /^(\d{4})-(\d{2})$/.exec(key);
  if (month) return monthPeriod(Number(month[1]), Number(month[2])).label;
  const quarter = /^(\d{4})-Q([1-4])$/.exec(key);
  if (quarter) {
    const q = Number(quarter[2]);
    const startMonth = q === 4 ? 1 : q * 3 + 1;
    return quarterPeriod(Number(quarter[1]), startMonth).label;
  }
  return key;
}
