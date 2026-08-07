// Indian financial-year period maths.
//
// Everything here is anchored to Asia/Kolkata. The server runs UTC, so a naive
// `new Date()` is the wrong day for five and a half hours out of every
// twenty-four — which would silently mis-file the last day of a period, and
// mis-report "overdue", every single evening IST.
//
// FY runs 1 Apr – 31 Mar. Quarters are FY quarters, not calendar ones:
//   Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar.

export type Recurrence = "monthly" | "quarterly" | "annual";

export interface Period {
  key: string;        // '2026-07' | '2026-Q1' | 'FY2025-26'
  label: string;      // 'July 2026' | 'Apr–Jun 2026' | 'FY 2025-26'
  /** Inclusive period start, ISO date. */
  start: string;
  /** Inclusive period end, ISO date. */
  end: string;
  /** FY the period belongs to, e.g. '2025-26'. */
  fy: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today in IST, as a plain {y, m, d} with m 1-based. */
export function istToday(now: Date = new Date()): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

export function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** FY label for a given year+month, e.g. (2026, 5) -> '2026-27'. */
export function fyFor(y: number, m: number): string {
  const startYear = m >= 4 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** Calendar year the FY starts in: '2025-26' -> 2025. */
export function fyStartYear(fy: string): number {
  return Number(fy.split("-")[0]);
}

export function monthPeriod(y: number, m: number): Period {
  return {
    key: `${y}-${String(m).padStart(2, "0")}`,
    label: `${MONTHS[m - 1]} ${y}`,
    start: isoDate(y, m, 1),
    end: isoDate(y, m, lastDayOfMonth(y, m)),
    fy: fyFor(y, m),
  };
}

/** FY quarter index 1-4 for a calendar month. */
export function fyQuarterOf(m: number): 1 | 2 | 3 | 4 {
  if (m >= 4 && m <= 6) return 1;
  if (m >= 7 && m <= 9) return 2;
  if (m >= 10 && m <= 12) return 3;
  return 4;
}

export function quarterPeriod(fy: string, q: 1 | 2 | 3 | 4): Period {
  const sy = fyStartYear(fy);
  const startMonth = [4, 7, 10, 1][q - 1];
  const startYear = q === 4 ? sy + 1 : sy;
  const endMonth = startMonth + 2;
  const endYear = startYear;
  return {
    key: `${sy}-Q${q}`,
    label: `${SHORT[startMonth - 1]}–${SHORT[endMonth - 1]} ${endYear}`,
    start: isoDate(startYear, startMonth, 1),
    end: isoDate(endYear, endMonth, lastDayOfMonth(endYear, endMonth)),
    fy,
  };
}

export function annualPeriod(fy: string): Period {
  const sy = fyStartYear(fy);
  return {
    key: `FY${fy}`,
    label: `FY ${fy}`,
    start: isoDate(sy, 4, 1),
    end: isoDate(sy + 1, 3, 31),
    fy,
  };
}

/** Assessment-year label for the FY, e.g. '2025-26' -> 'AY 2026-27'. */
export function ayLabel(fy: string): string {
  const sy = fyStartYear(fy) + 1;
  return `AY ${sy}-${String((sy + 1) % 100).padStart(2, "0")}`;
}

/** Shifts a {y, m} pair by n months. */
function addMonths(y: number, m: number, n: number): { y: number; m: number } {
  const total = y * 12 + (m - 1) + n;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

export interface DueRule {
  kind: "after_period_end" | "after_fy_end";
  months: number;
  /** Day of month, or 'last'. Clamped to the month's real length. */
  day: number | "last";
  /**
   * Per-period overrides keyed by period suffix — '03' for March in a monthly
   * rule, 'Q4' for the last quarter. This is how the real deadlines work:
   * March TDS payment is 30 April, not 7 April, and the Q4 TDS return is 31 May.
   */
  exceptions?: Record<string, { months: number; day: number | "last" }>;
}

/** Resolves a template's due date for one period. */
export function dueDateFor(rule: DueRule, period: Period): string {
  const suffix = period.key.includes("-Q")
    ? period.key.slice(period.key.indexOf("-Q") + 1)
    : period.key.slice(-2);
  const effective = rule.exceptions?.[suffix] ?? rule;

  const base =
    rule.kind === "after_fy_end"
      ? { y: fyStartYear(period.fy) + 1, m: 3 }
      : { y: Number(period.end.slice(0, 4)), m: Number(period.end.slice(5, 7)) };

  const { y, m } = addMonths(base.y, base.m, effective.months);
  const last = lastDayOfMonth(y, m);
  const day = effective.day === "last" ? last : Math.min(effective.day, last);
  return isoDate(y, m, day);
}

/**
 * Periods of a recurrence whose due date falls within the horizon. Generating
 * a rolling window rather than all history keeps the task table meaningful —
 * nobody wants 900 clients × 10 years of retrospective checklists.
 */
export function periodsInHorizon(
  recurrence: Recurrence,
  rule: DueRule,
  horizonDays: number,
  now: Date = new Date()
): Period[] {
  const today = istToday(now);
  const todayIso = isoDate(today.y, today.m, today.d);
  const horizon = new Date(Date.UTC(today.y, today.m - 1, today.d + horizonDays))
    .toISOString()
    .slice(0, 10);
  // Look back far enough that a period whose deadline has just passed is still
  // generated — an overdue filing is exactly what staff need to see.
  const lookback = new Date(Date.UTC(today.y, today.m - 1, today.d - 400))
    .toISOString()
    .slice(0, 10);

  const candidates: Period[] = [];

  if (recurrence === "monthly") {
    for (let i = -18; i <= 3; i++) {
      const { y, m } = addMonths(today.y, today.m, i);
      candidates.push(monthPeriod(y, m));
    }
  } else if (recurrence === "quarterly") {
    const thisFy = fyFor(today.y, today.m);
    const sy = fyStartYear(thisFy);
    for (const fy of [`${sy - 2}-${String((sy - 1) % 100).padStart(2, "0")}`,
                      `${sy - 1}-${String(sy % 100).padStart(2, "0")}`,
                      thisFy]) {
      for (const q of [1, 2, 3, 4] as const) candidates.push(quarterPeriod(fy, q));
    }
  } else {
    const thisFy = fyFor(today.y, today.m);
    const sy = fyStartYear(thisFy);
    for (const offset of [-2, -1, 0]) {
      const s = sy + offset;
      candidates.push(annualPeriod(`${s}-${String((s + 1) % 100).padStart(2, "0")}`));
    }
  }

  return candidates.filter((p) => {
    const due = dueDateFor(rule, p);
    // Only periods that have actually ended can be filed.
    return p.end <= todayIso && due >= lookback && due <= horizon;
  });
}
