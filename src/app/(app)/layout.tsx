import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./signout";

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

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 text-sm">
          <Link href="/" className="flex items-center">
            <Image
              src="/logos/ledger-logic.png"
              alt="Ledger Logic CRM"
              width={473}
              height={122}
              className="h-6 w-auto"
            />
          </Link>
          <Link href="/dashboard" className="text-slate-600 hover:text-slate-900">
            Dashboard
          </Link>
          <Link href="/my-clients" className="text-slate-600 hover:text-slate-900">
            My Clients
          </Link>
          <Link href="/clients" className="text-slate-600 hover:text-slate-900">
            All Clients
          </Link>
          {isAdmin && (
            <>
              <Link href="/admin/import" className="text-slate-600 hover:text-slate-900">
                Import
              </Link>
              <Link href="/admin/staff" className="text-slate-600 hover:text-slate-900">
                Staff
              </Link>
            </>
          )}
          <span className="ml-auto text-slate-400">
            {me?.full_name ?? user.email}
          </span>
          <SignOutButton />
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
