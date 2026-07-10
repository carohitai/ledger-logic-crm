"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/button";

const MicrosoftLogo = (
  <svg width="17" height="17" viewBox="0 0 21 21" aria-hidden="true">
    <rect x="1" y="1" width="9" height="9" fill="#F25022" />
    <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
    <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
    <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
  </svg>
);

const GROUP = [
  { src: "/logos/kolte-associates.png", alt: "Kolte & Associates LLP" },
  { src: "/logos/kolte-bizsol.png", alt: "Kolte Bizsol" },
  { src: "/logos/kolte-enterprises.png", alt: "Kolte Enterprises" },
];

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showEmail, setShowEmail] = useState(false);

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) setError(err);
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(error.message);
    else router.replace("/my-clients");
  }

  async function signInWithMicrosoft() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        scopes: "openid profile email",
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  return (
    <main
      className="flex min-h-screen flex-col"
      style={{ background: "var(--paper)" }}
    >
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-12 pt-16">
        <div className="ll-rise flex flex-col items-center">
          <Image
            src="/logos/ledger-logic.png"
            alt="Ledger Logic"
            width={473}
            height={122}
            priority
            className="h-[52px] w-auto"
          />
        </div>

        <div className="dot-rule my-7 w-[220px]" />

        <h1
          className="ll-rise m-0 mb-3 text-center text-[40px] font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--brand-blue-deep)",
            letterSpacing: "-0.01em",
            animationDelay: "80ms",
          }}
        >
          Client Connect - CRM
        </h1>
        <p
          className="ll-rise m-0 mb-9 max-w-[460px] text-center text-lg leading-relaxed"
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--ink-500)",
            animationDelay: "140ms",
          }}
        >
          Client allotment and compliance follow-up for the Kolte group of
          companies.
        </p>

        <div
          className="ll-rise flex w-full max-w-[400px] flex-col gap-4 p-8"
          style={{
            background: "var(--white)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-md)",
            animationDelay: "200ms",
          }}
        >
          <div
            className="text-center text-[11px] font-semibold uppercase"
            style={{ letterSpacing: "0.18em", color: "var(--brand-blue)" }}
          >
            Sign in to continue
          </div>

          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={signInWithMicrosoft}
            loading={busy}
            icon={MicrosoftLogo}
          >
            {busy ? "Signing in…" : "Sign in with Microsoft 365"}
          </Button>

          <p
            className="m-0 text-center text-[12.5px] leading-snug"
            style={{ color: "var(--ink-400)" }}
          >
            Use your{" "}
            <span style={{ color: "var(--ink-700)", fontWeight: 600 }}>
              @kolteassociates.in
            </span>{" "}
            Microsoft&nbsp;365 account. Access is limited to staff of the Firm.
          </p>

          {showEmail ? (
            <form onSubmit={signIn} className="mt-1 flex flex-col gap-2 border-t pt-3" style={{ borderColor: "var(--border-default)" }}>
              <input
                type="email"
                required
                placeholder="Firm email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm"
                style={{ border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)" }}
              />
              <input
                type="password"
                required
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm"
                style={{ border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)" }}
              />
              <Button type="submit" variant="ink" size="md" fullWidth loading={busy}>
                {busy ? "Signing in…" : "Sign in with email"}
              </Button>
            </form>
          ) : (
            <button
              onClick={() => setShowEmail(true)}
              className="text-center text-[11.5px] underline"
              style={{ color: "var(--ink-400)", textUnderlineOffset: "3px" }}
            >
              Use firm email instead
            </button>
          )}

          {error && (
            <p className="text-center text-sm" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}
        </div>
      </div>

      <footer
        className="px-6 py-9"
        style={{ borderTop: "1px solid var(--paper-3)", background: "var(--paper-2)" }}
      >
        <p
          className="m-0 text-center text-[11px] font-semibold uppercase"
          style={{ letterSpacing: "0.18em", color: "var(--ink-400)" }}
        >
          Part of the Kolte group
        </p>
        <div className="mx-auto mt-6 flex max-w-[900px] flex-wrap items-center justify-center gap-12">
          {GROUP.map((g) => (
            <Image
              key={g.src}
              src={g.src}
              alt={g.alt}
              width={200}
              height={120}
              className="h-14 w-auto object-contain"
            />
          ))}
        </div>
        <p
          className="mb-0 mt-7 text-center text-[11px] uppercase"
          style={{ letterSpacing: "0.14em", color: "var(--ink-400)" }}
        >
          Mumbai&nbsp;&nbsp;|&nbsp;&nbsp;Bhusawal&nbsp;&nbsp;|&nbsp;&nbsp;Pune&nbsp;&nbsp;|&nbsp;&nbsp;Solapur&nbsp;&nbsp;|&nbsp;&nbsp;Pachora
        </p>
      </footer>
    </main>
  );
}
