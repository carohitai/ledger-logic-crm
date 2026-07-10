"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import Link, { useLinkStatus } from "next/link";
import { Spinner } from "./spinner";

/**
 * A ref-counted "something is loading" signal. Any control that kicks off a
 * navigation or a server mutation calls `begin()` and holds the returned
 * release until it finishes. The global top bar is visible whenever the count
 * is above zero, so a single click anywhere in the app produces immediate,
 * graphical feedback that the page is working.
 */
type NavProgress = { begin: () => () => void };

const NavProgressContext = createContext<NavProgress | null>(null);

export function useNavProgress(): NavProgress {
  return (
    useContext(NavProgressContext) ?? {
      // No provider mounted (e.g. the login screen) — degrade to a no-op so
      // consumers never need to null-check.
      begin: () => () => {},
    }
  );
}

export function NavProgressProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const count = useRef(0);

  const begin = useCallback(() => {
    count.current += 1;
    setActive(true);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      count.current = Math.max(0, count.current - 1);
      if (count.current === 0) setActive(false);
    };
  }, []);

  const value = useMemo(() => ({ begin }), [begin]);

  return (
    <NavProgressContext.Provider value={value}>
      <div className="ll-topbar" data-active={active} aria-hidden={!active}>
        {active && <span className="ll-topbar__bar" />}
      </div>
      {children}
    </NavProgressContext.Provider>
  );
}

/**
 * Bridges a single `<Link>`'s pending state (from Next's `useLinkStatus`) into
 * the global bar, and optionally renders an inline spinner on the control the
 * user just clicked. Must be rendered as a descendant of a `<Link>`.
 */
function LinkStatus({ inlineSpinner = false }: { inlineSpinner?: boolean }) {
  const { pending } = useLinkStatus();
  const { begin } = useNavProgress();

  useEffect(() => {
    if (!pending) return;
    return begin();
  }, [pending, begin]);

  if (!inlineSpinner || !pending) return null;
  return <Spinner size={13} className="ml-1.5 -mb-px align-[-1px]" />;
}

/**
 * Drop-in replacement for `next/link` that lights the global progress bar
 * while the destination is loading. Pass `inlineSpinner` to also show a small
 * ring on the link itself (nice for buttons and pagination controls).
 */
export function AppLink({
  children,
  inlineSpinner = false,
  ...props
}: ComponentProps<typeof Link> & { inlineSpinner?: boolean }) {
  return (
    <Link {...props}>
      {children}
      <LinkStatus inlineSpinner={inlineSpinner} />
    </Link>
  );
}
