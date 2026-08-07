import { dueDateFor, monthPeriod, quarterPeriod, annualPeriod, ayLabel } from "./periods.ts";

const cases: [string, string, string][] = [
  // [what, computed, expected]
  ["GSTR-1 monthly Jul-2026", dueDateFor({kind:"after_period_end",months:1,day:11}, monthPeriod(2026,7)), "2026-08-11"],
  ["GSTR-3B monthly Jul-2026", dueDateFor({kind:"after_period_end",months:1,day:20}, monthPeriod(2026,7)), "2026-08-20"],
  ["GSTR-1 QRMP Q1 FY26-27", dueDateFor({kind:"after_period_end",months:1,day:13}, quarterPeriod("2026-27",1)), "2026-07-13"],
  ["GSTR-3B QRMP Q1 FY26-27", dueDateFor({kind:"after_period_end",months:1,day:22}, quarterPeriod("2026-27",1)), "2026-07-22"],
  ["GSTR-9 FY2025-26", dueDateFor({kind:"after_fy_end",months:9,day:31}, annualPeriod("2025-26")), "2026-12-31"],
  ["ITR non-audit FY2025-26", dueDateFor({kind:"after_fy_end",months:4,day:31}, annualPeriod("2025-26")), "2026-07-31"],
  ["Tax audit 3CD FY2025-26", dueDateFor({kind:"after_fy_end",months:6,day:30}, annualPeriod("2025-26")), "2026-09-30"],
  ["ITR audit FY2025-26", dueDateFor({kind:"after_fy_end",months:7,day:31}, annualPeriod("2025-26")), "2026-10-31"],
  ["Form 16 FY2025-26", dueDateFor({kind:"after_fy_end",months:3,day:15}, annualPeriod("2025-26")), "2026-06-15"],
  ["PTRC annual FY2025-26", dueDateFor({kind:"after_fy_end",months:0,day:31}, annualPeriod("2025-26")), "2026-03-31"],
  ["TDS pay Jul-2026", dueDateFor({kind:"after_period_end",months:1,day:7,exceptions:{"03":{months:1,day:30}}}, monthPeriod(2026,7)), "2026-08-07"],
  ["TDS pay Mar-2026 (exception)", dueDateFor({kind:"after_period_end",months:1,day:7,exceptions:{"03":{months:1,day:30}}}, monthPeriod(2026,3)), "2026-04-30"],
  ["TDS return Q1 FY26-27", dueDateFor({kind:"after_period_end",months:1,day:31,exceptions:{Q4:{months:2,day:31}}}, quarterPeriod("2026-27",1)), "2026-07-31"],
  ["TDS return Q2 FY26-27", dueDateFor({kind:"after_period_end",months:1,day:31,exceptions:{Q4:{months:2,day:31}}}, quarterPeriod("2026-27",2)), "2026-10-31"],
  ["TDS return Q3 FY26-27", dueDateFor({kind:"after_period_end",months:1,day:31,exceptions:{Q4:{months:2,day:31}}}, quarterPeriod("2026-27",3)), "2027-01-31"],
  ["TDS return Q4 FY26-27 (exception)", dueDateFor({kind:"after_period_end",months:1,day:31,exceptions:{Q4:{months:2,day:31}}}, quarterPeriod("2026-27",4)), "2027-05-31"],
  ["PTRC monthly Feb-2026 (last day)", dueDateFor({kind:"after_period_end",months:1,day:"last"}, monthPeriod(2026,2)), "2026-03-31"],
  ["Books close Jan-2026", dueDateFor({kind:"after_period_end",months:1,day:10}, monthPeriod(2026,1)), "2026-02-10"],
  ["Day clamp: 31 -> Feb", dueDateFor({kind:"after_period_end",months:1,day:31}, monthPeriod(2026,1)), "2026-02-28"],
  ["Q4 period bounds FY2025-26", quarterPeriod("2025-26",4).start + ".." + quarterPeriod("2025-26",4).end, "2026-01-01..2026-03-31"],
  ["Q1 period bounds FY2026-27", quarterPeriod("2026-27",1).start + ".." + quarterPeriod("2026-27",1).end, "2026-04-01..2026-06-30"],
  ["AY label FY2025-26", ayLabel("2025-26"), "AY 2026-27"],
];

let fail = 0;
for (const [what, got, want] of cases) {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what.padEnd(36)} got=${got} want=${want}`);
}
console.log(fail ? `\n${fail} FAILURES` : "\nall due dates correct");

// Run with: npm run test:dates
