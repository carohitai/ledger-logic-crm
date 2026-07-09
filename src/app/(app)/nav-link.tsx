"use client";

import { usePathname } from "next/navigation";
import { AppLink } from "@/components/nav-progress";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
  return (
    <AppLink
      href={href}
      inlineSpinner
      style={
        active
          ? {
              color: "var(--brand-blue-deep)",
              fontWeight: 600,
              borderBottom: "2px solid var(--brand-green)",
              paddingBottom: 2,
            }
          : { color: "var(--ink-500)" }
      }
      className="inline-flex items-center transition-colors hover:!text-[var(--ink-900)]"
    >
      {children}
    </AppLink>
  );
}
