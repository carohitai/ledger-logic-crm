import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./signout";
import { NavLink } from "./nav-link";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("staff")
    .select("id, full_name, app_role")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const isAdmin = me?.app_role === "admin";
  const displayName = me?.full_name ?? user.email ?? "";
  const initials = displayName
    .replace(/^(CA|CS|Adv)\s+/i, "")
    .split(/\s+/)
    .map((w: string) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--paper)" }}>
      <header
        className="sticky top-0 z-50 bg-white"
        style={{ borderBottom: "1px solid var(--border-default)" }}
      >
        <nav className="mx-auto flex max-w-[1200px] items-center gap-7 px-6 py-3.5 text-[13px] font-medium">
          <Link href="/" className="flex items-center">
            <Image
              src="/logos/ledger-logic.png"
              alt="Ledger Logic CRM"
              width={473}
              height={122}
              className="h-[22px] w-auto"
            />
          </Link>
          <NavLink href="/dashboard">Dashboard</NavLink>
          <NavLink href="/my-clients">My Clients</NavLink>
          <NavLink href="/clients">All Clients</NavLink>
          {isAdmin && (
            <>
              <NavLink href="/admin/import">Import</NavLink>
              <NavLink href="/admin/staff">Staff</NavLink>
            </>
          )}
          <span className="ml-auto flex items-center gap-2.5">
            <span
              className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full text-[11px] font-bold tracking-wide"
              style={{ background: "var(--brand-blue-pale)", color: "var(--brand-blue-deep)" }}
            >
              {initials || "?"}
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-[12.5px] font-semibold" style={{ color: "var(--ink-900)" }}>
                {displayName}
              </span>
              <span className="text-[10.5px]" style={{ color: "var(--ink-400)" }}>
                {user.email}
              </span>
            </span>
          </span>
          <SignOutButton />
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 pb-20 pt-9">{children}</main>
      <footer
        className="px-6 py-6"
        style={{ borderTop: "1px solid var(--paper-3)", background: "var(--paper-2)" }}
      >
        <p
          className="text-center text-[11px] uppercase"
          style={{ letterSpacing: "0.14em", color: "var(--ink-400)" }}
        >
          Kolte &amp; Associates LLP · Mumbai&nbsp;&nbsp;|&nbsp;&nbsp;Bhusawal&nbsp;&nbsp;|&nbsp;&nbsp;Pune&nbsp;&nbsp;|&nbsp;&nbsp;Solapur&nbsp;&nbsp;|&nbsp;&nbsp;Pachora
        </p>
      </footer>
    </div>
  );
}
