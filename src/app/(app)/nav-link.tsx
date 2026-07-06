"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
  return (
    <Link
      href={href}
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
      className="transition-colors hover:!text-[var(--ink-900)]"
    >
      {children}
    </Link>
  );
}
