/**
 * One-off seed / re-sync runner: pushes a CSV through the same runSync
 * pipeline the admin Import screen uses, signed in as the admin user.
 *
 * Usage:
 *   npx tsx scripts/seed-import.ts <file.csv> dryrun|commit [--apply-renames]
 * Env: SEED_EMAIL, SEED_PASSWORD (admin credentials)
 */
import { readFileSync } from "fs";
import { basename } from "path";
import Papa from "papaparse";
import { createClient } from "@supabase/supabase-js";
import { runSync } from "../src/lib/import/sync";

async function main() {
  const [file, mode = "dryrun", ...flags] = process.argv.slice(2);
  if (!file) throw new Error("Usage: seed-import.ts <file.csv> dryrun|commit");

  const env = Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
  );
  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: process.env.SEED_EMAIL!,
    password: process.env.SEED_PASSWORD!,
  });
  if (authErr) throw authErr;

  const text = readFileSync(file, "utf8").replace(/^﻿/, "");
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
  });

  const report = await runSync(supabase, parsed.data, {
    filename: basename(file),
    dryRun: mode !== "commit",
    applyRenames: flags.includes("--apply-renames"),
  });

  console.log(
    JSON.stringify(
      {
        batchId: report.batchId,
        dryRun: report.dryRun,
        counts: report.counts,
        missingFlagged: report.missingFlagged,
        unresolvedAliases: report.unresolvedAliases,
        attention: report.rows
          .filter((r) => ["error", "rename_candidate", "skipped"].includes(r.action))
          .map((r) => ({ row: r.rowNumber, name: r.clientName, action: r.action, messages: r.messages })),
      },
      null,
      2
    )
  );
}

main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
