import { AppLink } from "./nav-progress";

/** Pencil link to a client's edit form, used from the client list tables. */
export function EditIconLink({ href, label = "Edit" }: { href: string; label?: string }) {
  return (
    <AppLink
      href={href}
      inlineSpinner
      title="Edit client profile"
      className="ll-press inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-semibold no-underline"
      style={{
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-md)",
        color: "var(--ink-700)",
        background: "var(--white)",
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <path d="M12 20h9" strokeLinecap="round" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" strokeLinejoin="round" />
      </svg>
      {label}
    </AppLink>
  );
}
