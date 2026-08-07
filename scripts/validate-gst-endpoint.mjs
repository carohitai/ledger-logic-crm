#!/usr/bin/env node
/**
 * Validates a candidate public GST return-status endpoint against the exact
 * assumptions src/lib/dept/public-gst.ts makes.
 *
 * The adapter is deliberately written so that ANY failure yields state
 * "unknown" rather than "not_filed" — a provider outage must never mark the
 * client base delinquent. The consequence is that a wrongly-shaped response
 * fails *silently and safely*: every task stays open and nothing tells you the
 * mapping is wrong. This script is how you find that out on purpose.
 *
 * Usage:
 *   PUBLIC_GST_API_URL='https://host/path' \
 *   [PUBLIC_GST_API_KEY=...] \
 *   node scripts/validate-gst-endpoint.mjs 27AAAAA0000A1Z5 [GSTR3B] [2026-06]
 *
 * Pick a GSTIN you KNOW has filed the return you're asking about, so a
 * "not filed" answer is unambiguously the endpoint being wrong.
 */

const [, , gstin, formArg, periodArg] = process.argv;
const formCode = (formArg ?? "GSTR3B").toUpperCase();
const periodKey = periodArg ?? defaultPeriod();
const base = process.env.PUBLIC_GST_API_URL;
const apiKey = process.env.PUBLIC_GST_API_KEY;

if (!gstin || !base) {
  console.error(
    "Need a GSTIN argument and PUBLIC_GST_API_URL in the environment.\n" +
      "  PUBLIC_GST_API_URL='https://…' node scripts/validate-gst-endpoint.mjs 27AAAAA0000A1Z5 GSTR3B 2026-06"
  );
  process.exit(2);
}

/** Last completed month, as the adapter's period key. */
function defaultPeriod() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Same conversion as the adapter: '2026-06' -> '062026', '2026-Q1' -> '062026'. */
function toReturnPeriod(key) {
  const monthly = key.match(/^(\d{4})-(\d{2})$/);
  if (monthly) return `${monthly[2]}${monthly[1]}`;
  const quarterly = key.match(/^(\d{4})-Q([1-4])$/);
  if (quarterly) {
    const fyStart = Number(quarterly[1]);
    const q = Number(quarterly[2]);
    const endMonth = [6, 9, 12, 3][q - 1];
    const year = q === 4 ? fyStart + 1 : fyStart;
    return `${String(endMonth).padStart(2, "0")}${year}`;
  }
  return null;
}

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const url = `${base}${base.includes("?") ? "&" : "?"}gstin=${encodeURIComponent(gstin)}`;
const wanted = toReturnPeriod(periodKey);

console.log(`\nEndpoint : ${base}`);
console.log(`GSTIN    : ${gstin}`);
console.log(`Looking  : ${formCode} for ${periodKey}  (ret_prd "${wanted}")\n`);

let res, text;
try {
  res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });
  text = await res.text();
} catch (e) {
  console.error(`\nRequest failed outright: ${e.message}`);
  console.error(
    "The adapter would return state:'unknown' here — safe, but it means this " +
      "endpoint can never close a task. Fix reachability before enabling it."
  );
  process.exit(1);
}

check("HTTP 200", res.ok, `got ${res.status}`);

let payload;
try {
  payload = JSON.parse(text);
  check("Response is JSON", true);
} catch {
  check("Response is JSON", false, `body starts: ${text.slice(0, 120)}`);
  console.log("\nRaw body:\n" + text.slice(0, 1500));
  summarise();
}

const rows = payload.returns ?? payload.filing ?? null;
check(
  "Has a `returns` or `filing` array (adapter reads payload.returns ?? payload.filing)",
  Array.isArray(rows),
  Array.isArray(rows)
    ? `${rows.length} rows`
    : `top-level keys: ${Object.keys(payload ?? {}).join(", ") || "(none)"}`
);

if (!Array.isArray(rows) || !rows.length) {
  console.log("\nRaw payload:\n" + JSON.stringify(payload, null, 2).slice(0, 2500));
  summarise();
}

const sample = rows[0];
check("Rows carry `rtntype`", sample.rtntype !== undefined, `sample: ${JSON.stringify(sample.rtntype)}`);
check("Rows carry `ret_prd`", sample.ret_prd !== undefined, `sample: ${JSON.stringify(sample.ret_prd)}`);
check("Rows carry `dof` (date of filing)", sample.dof !== undefined, `sample: ${JSON.stringify(sample.dof)}`);
check("Rows carry `arn`", sample.arn !== undefined, `sample: ${JSON.stringify(sample.arn)}`);

check(
  "`ret_prd` is MMYYYY",
  typeof sample.ret_prd === "string" && /^\d{6}$/.test(sample.ret_prd),
  `sample: ${JSON.stringify(sample.ret_prd)}`
);
check(
  "`dof` is DD/MM/YYYY (adapter's toIsoDate expects this)",
  typeof sample.dof === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(sample.dof),
  `sample: ${JSON.stringify(sample.dof)}`
);

// The real test: does the adapter's matching logic find the row?
const match = rows.find(
  (r) =>
    (r.rtntype ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase() === formCode &&
    r.ret_prd === wanted
);
check(
  `Adapter finds ${formCode} for ${periodKey}`,
  Boolean(match),
  match
    ? `filed ${match.dof}, ARN ${match.arn}`
    : `no row matched. Available: ${[
        ...new Set(rows.map((r) => `${r.rtntype}/${r.ret_prd}`)),
      ]
        .slice(0, 12)
        .join(", ")}`
);

console.log("\nFirst row verbatim:\n" + JSON.stringify(sample, null, 2));
summarise();

function summarise() {
  const failed = checks.filter((c) => !c.ok);
  console.log("\n" + "─".repeat(64));
  if (!failed.length) {
    console.log("All checks passed. Safe to set:");
    console.log("  DEPT_PROVIDER_GST=public-gst");
    console.log(`  PUBLIC_GST_API_URL=${base}`);
    console.log("  DEPT_SYNC_ENABLED=true");
    process.exit(0);
  }
  console.log(`${failed.length} check(s) failed:`);
  for (const f of failed) console.log(`  · ${f.name}`);
  console.log(
    "\nDo NOT enable public-gst yet. Adjust the field mapping in\n" +
      "src/lib/dept/public-gst.ts (toReturnPeriod / toIsoDate / the rows lookup)\n" +
      "to match the shape printed above, then re-run this script.\n" +
      "\nNote: a wrong mapping fails SILENTLY in production — the adapter returns\n" +
      "'unknown' and every task simply stays open. That is safe, but it is also\n" +
      "invisible, which is why this check exists."
  );
  process.exit(1);
}
