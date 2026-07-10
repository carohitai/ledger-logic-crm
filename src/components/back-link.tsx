"use client";

import { useRouter } from "next/navigation";

export function BackLink({ fallback = "/dashboard" }: { fallback?: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
      className="mb-3.5 inline-flex cursor-pointer items-center gap-[5px] text-[12.5px] font-semibold"
      style={{ color: "var(--brand-blue)" }}
    >
      ← Back
    </button>
  );
}
