import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const GROUP = [
  { src: "/logos/kolte-associates.png", alt: "Kolte & Associates LLP", label: "Kolte & Associates LLP" },
  { src: "/logos/kolte-bizsol.png", alt: "Kolte Bizsol", label: "Kolte Bizsol" },
  { src: "/logos/kolte-enterprises.png", alt: "Kolte Enterprises", label: "Kolte Enterprises" },
];

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-screen flex-col bg-white">
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <Image
          src="/logos/ledger-logic.png"
          alt="Ledger Logic"
          width={473}
          height={122}
          priority
          className="h-16 w-auto"
        />

        <h1 className="mt-8 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Ledger Logic CRM
        </h1>
        <p className="mt-4 max-w-xl text-base text-slate-500">
          Client allotment and compliance follow-up for the Kolte group of
          companies. Sign in with your Kolte &amp; Associates Microsoft 365
          account.
        </p>

        <div className="mt-8 flex gap-3">
          {user ? (
            <Link
              href="/my-clients"
              className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
            >
              Open CRM
            </Link>
          ) : (
            <Link
              href="/login"
              className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>

      <footer className="border-t border-slate-100 bg-slate-50 px-6 py-10">
        <p className="text-center text-xs font-medium uppercase tracking-wide text-slate-400">
          Part of the Kolte group
        </p>
        <div className="mx-auto mt-6 flex max-w-4xl flex-wrap items-center justify-center gap-x-12 gap-y-8">
          {GROUP.map((g) => (
            <div key={g.src} className="flex flex-col items-center gap-2">
              <Image
                src={g.src}
                alt={g.alt}
                width={200}
                height={120}
                className="h-16 w-auto object-contain"
              />
              <span className="sr-only">{g.label}</span>
            </div>
          ))}
        </div>
      </footer>
    </main>
  );
}
