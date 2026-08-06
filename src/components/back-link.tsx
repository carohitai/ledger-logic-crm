"use client";

import { useRouter } from "next/navigation";

export function BackLink({
  fallback = "/dashboard",
  label = "← Back",
  className = "mb-3.5",
}: {
  fallback?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
      className={`${className} inline-flex cursor-pointer items-center gap-[5px] text-[12.5px] font-semibold`}
      style={{ color: "var(--brand-blue)" }}
    >
      {label}
    </button>
  );
}
