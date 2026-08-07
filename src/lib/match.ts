// Resolving an inbound email address / phone number to a client.
//
// Backed by `client_contacts`, which the DB keeps derived from clients.email /
// clients.phone via a trigger (see supabase/migrations/20260807_0001) and which
// also accumulates addresses staff teach it from the inbox triage queue.
//
// The rule everywhere is: match ONLY when exactly one client matches. 44 email
// addresses and 40 phone numbers in this dataset are shared across two or more
// clients (group entities, family firms, a shared accountant), and silently
// attributing a message to the wrong one is worse than leaving it for triage.
// This generalises the rule the WhatsApp webhook already applied inline.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Canonical email form. Mirrors extract_emails() in SQL. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(value) ? value : null;
}

/**
 * Canonical Indian mobile form: bare 10 digits, or null. Mirrors
 * normalize_phone() in SQL — keep the two in step.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 10 && /^[6-9]/.test(d)) return d;
  if (d.length === 11 && d.startsWith("0") && /^[6-9]/.test(d.slice(1))) return d.slice(1);
  if (d.length === 12 && d.startsWith("91") && /^[6-9]/.test(d.slice(2))) return d.slice(2);
  return null;
}

/** Every valid address in a free-text field. Mirrors extract_emails() in SQL. */
export function extractEmails(raw: string | null | undefined): string[] {
  const found = (raw ?? "").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  return [...new Set(found.map((e) => e.toLowerCase()))];
}

/** Every valid mobile in a free-text field. Mirrors extract_phones() in SQL. */
export function extractPhones(raw: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const run of (raw ?? "").match(/[0-9][0-9 -]{8,}[0-9]/g) ?? []) {
    const n = normalizePhone(run);
    if (n) out.add(n);
  }
  const whole = normalizePhone(raw);
  if (whole) out.add(whole);
  return [...out];
}

async function uniqueClientFor(
  db: SupabaseClient,
  kind: "email" | "phone",
  valueNorm: string
): Promise<string | null> {
  const { data } = await db
    .from("client_contacts")
    .select("client_id")
    .eq("kind", kind)
    .eq("value_norm", valueNorm)
    .limit(5);

  const ids = [...new Set((data ?? []).map((r) => r.client_id as string))];
  return ids.length === 1 ? ids[0] : null;
}

/** Resolves one address to a client id, or null when unknown or ambiguous. */
export async function matchClientByEmail(
  db: SupabaseClient,
  address: string | null | undefined
): Promise<string | null> {
  const norm = normalizeEmail(address);
  return norm ? uniqueClientFor(db, "email", norm) : null;
}

/** Resolves one number to a client id, or null when unknown or ambiguous. */
export async function matchClientByPhone(
  db: SupabaseClient,
  phone: string | null | undefined
): Promise<string | null> {
  const norm = normalizePhone(phone);
  return norm ? uniqueClientFor(db, "phone", norm) : null;
}

/**
 * Resolves a mail's participants to a client. Tries each address in turn and
 * takes the first unambiguous hit — a thread with the client plus an unrelated
 * CC still lands on the right client.
 */
export async function matchClientByAddresses(
  db: SupabaseClient,
  addresses: (string | null | undefined)[]
): Promise<string | null> {
  const seen = new Set<string>();
  for (const address of addresses) {
    const norm = normalizeEmail(address);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    const clientId = await uniqueClientFor(db, "email", norm);
    if (clientId) return clientId;
  }
  return null;
}

/**
 * Records an address/number against a client so future messages match on their
 * own. Called from inbox triage. Never overwrites a trigger-managed 'import'
 * row — `on conflict do nothing` leaves the existing provenance intact.
 */
export async function learnContact(
  db: SupabaseClient,
  clientId: string,
  kind: "email" | "phone",
  value: string
): Promise<string | null> {
  const norm = kind === "email" ? normalizeEmail(value) : normalizePhone(value);
  if (!norm) return null;
  await db
    .from("client_contacts")
    .upsert(
      { client_id: clientId, kind, value, value_norm: norm, source: "learned" },
      { onConflict: "client_id,kind,value_norm", ignoreDuplicates: true }
    );
  return norm;
}
