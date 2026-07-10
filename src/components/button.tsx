"use client";

import { forwardRef, useEffect, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Spinner } from "./spinner";
import { useNavProgress } from "./nav-progress";

export type ButtonVariant =
  | "primary"
  | "ink"
  | "success"
  | "secondary"
  | "ghost"
  | "danger";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

const BASE =
  "ll-press inline-flex items-center justify-center rounded-[var(--radius-md)] font-semibold whitespace-nowrap select-none disabled:cursor-not-allowed disabled:opacity-60";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--brand-blue)] text-white shadow-[var(--shadow-sm)] hover:bg-[var(--brand-blue-deep)]",
  ink: "bg-[var(--ink-900)] text-white shadow-[var(--shadow-sm)] hover:bg-[var(--ink-700)]",
  success:
    "bg-[var(--brand-green-deep)] text-white shadow-[var(--shadow-sm)] hover:bg-[#6d9633]",
  secondary:
    "bg-[var(--white)] text-[var(--ink-700)] border border-[var(--border-strong)] hover:bg-[var(--paper-2)]",
  ghost:
    "bg-transparent text-[var(--ink-400)] hover:bg-[var(--paper-2)] hover:text-[var(--ink-900)]",
  danger: "bg-[var(--danger)] text-white shadow-[var(--shadow-sm)] hover:bg-[#9c3232]",
};

const SIZES: Record<ButtonSize, string> = {
  xs: "px-2 py-1 text-[11px] gap-1",
  sm: "px-3 py-1.5 text-xs gap-1.5",
  md: "px-4 py-2 text-sm gap-2",
  lg: "px-4 py-3 text-sm gap-2.5",
};

const SPINNER_SIZE: Record<ButtonSize, number> = { xs: 12, sm: 13, md: 15, lg: 16 };

const SOLID: Record<ButtonVariant, boolean> = {
  primary: true,
  ink: true,
  success: true,
  danger: true,
  secondary: false,
  ghost: false,
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  /** Leading element (icon). Replaced by the spinner while loading. */
  icon?: ReactNode;
  /** Trailing element (icon). Hidden while loading. */
  iconRight?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "sm",
    loading = false,
    fullWidth = false,
    icon,
    iconRight,
    className = "",
    disabled,
    children,
    type,
    ...rest
  },
  ref
) {
  const solid = SOLID[variant];
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${
        fullWidth ? "w-full" : ""
      } ${className}`}
      {...rest}
    >
      {loading ? (
        <Spinner
          size={SPINNER_SIZE[size]}
          color={solid ? "#fff" : "currentColor"}
          track={solid ? "rgba(255,255,255,0.35)" : undefined}
        />
      ) : (
        icon
      )}
      {children}
      {!loading && iconRight}
    </button>
  );
});

/**
 * Submit button for forms backed by a Server Action (or any async `action`).
 * Reads React's `useFormStatus`, so it shows its spinner and lights the global
 * progress bar automatically for the duration of the submission — no wiring
 * needed at each call site beyond rendering it inside the `<form>`.
 */
export function SubmitButton({ children, ...props }: ButtonProps) {
  const { pending } = useFormStatus();
  const { begin } = useNavProgress();
  useEffect(() => {
    if (!pending) return;
    return begin();
  }, [pending, begin]);
  return (
    <Button type="submit" loading={pending} {...props}>
      {children}
    </Button>
  );
}

/**
 * Submit button for plain `method="get"` filter forms that navigate. It turns
 * the submit into a client transition so we get an accurate pending state
 * (spinner + top bar) that lasts until the new page has actually rendered.
 */
export function NavSubmitButton({ children, onClick, ...props }: ButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { begin } = useNavProgress();

  useEffect(() => {
    if (!pending) return;
    return begin();
  }, [pending, begin]);

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    onClick?.(e);
    const form = e.currentTarget.form;
    if (e.defaultPrevented || !form) return;
    e.preventDefault();
    const base = form.getAttribute("action") || window.location.pathname;
    const qs = new URLSearchParams();
    for (const [key, value] of new FormData(form).entries()) {
      const str = typeof value === "string" ? value : "";
      if (str) qs.set(key, str);
    }
    const query = qs.toString();
    startTransition(() => router.push(query ? `${base}?${query}` : base));
  }

  return (
    <Button type="submit" loading={pending} onClick={handleClick} {...props}>
      {children}
    </Button>
  );
}
