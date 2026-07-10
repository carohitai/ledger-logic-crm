"use client";

import { useState } from "react";
import { Spinner } from "./spinner";
import { WA_TEMPLATES, renderTemplate } from "@/lib/whatsapp-templates";

// 28px inline contact actions used in client tables (design: Admin interface
// redesign handoff) — click-to-call via Linkus and WhatsApp via Nextel.

export interface ContactClient {
  id: string;
  name: string;
  phone: string | null;
}

const PhoneSvg = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const WaSvg = (size = 15) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.6 6.32A7.85 7.85 0 0 0 12 4a7.94 7.94 0 0 0-6.9 11.9L4 20l4.2-1.1a7.9 7.9 0 0 0 3.8 1h.01a7.94 7.94 0 0 0 5.59-13.58zM12 18.5a6.5 6.5 0 0 1-3.3-.9l-.24-.14-2.45.64.65-2.39-.16-.25A6.5 6.5 0 1 1 12 18.5zm3.6-4.87c-.2-.1-1.17-.58-1.35-.64s-.31-.1-.44.1-.5.64-.62.77-.23.15-.43.05a5.3 5.3 0 0 1-1.56-.96 5.9 5.9 0 0 1-1.08-1.35c-.11-.2 0-.3.09-.4l.3-.35c.1-.12.13-.2.2-.33a.37.37 0 0 0 0-.35c0-.1-.44-1.06-.6-1.45s-.32-.34-.44-.34h-.38a.72.72 0 0 0-.52.24 2.18 2.18 0 0 0-.68 1.62 3.79 3.79 0 0 0 .8 2 8.7 8.7 0 0 0 3.33 2.94c.47.2.83.32 1.11.41a2.68 2.68 0 0 0 1.23.08 2 2 0 0 0 1.31-.93 1.63 1.63 0 0 0 .11-.92c-.05-.08-.18-.13-.38-.23z" />
  </svg>
);

const ICON_BTN =
  "ll-press inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] disabled:cursor-not-allowed disabled:opacity-45";

/** Click-to-call via the PBX (Linkus): rings the user's extension first. */
export function CallIconButton({ client }: { client: ContactClient }) {
  const [state, setState] = useState<"idle" | "calling" | "ok" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function call() {
    setState("calling");
    setMessage(null);
    try {
      const res = await fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Call failed");
      setState("ok");
      setMessage("Ringing your extension — pick up to connect.");
      setTimeout(() => setState("idle"), 4000);
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : "Call failed");
      setTimeout(() => setState("idle"), 5000);
    }
  }

  const palette =
    state === "ok"
      ? { background: "var(--brand-green-pale)", color: "var(--earth-moss)", border: "1px solid var(--brand-green-soft)" }
      : state === "error"
        ? { background: "rgba(178,58,58,0.09)", color: "var(--danger)", border: "1px solid rgba(178,58,58,0.35)" }
        : { background: "var(--brand-blue-pale)", color: "var(--brand-blue-deep)", border: "1px solid var(--border-default)" };

  return (
    <button
      onClick={call}
      disabled={!client.phone || state === "calling"}
      title={
        !client.phone
          ? "No mobile number"
          : (message ?? `Click to call ${client.phone} via Linkus`)
      }
      className={`${ICON_BTN} hover:!bg-[var(--brand-blue)] hover:!text-white`}
      style={palette}
      aria-label={`Call ${client.name} via Linkus`}
    >
      {state === "calling" ? <Spinner size={13} /> : PhoneSvg}
    </button>
  );
}

/** WhatsApp follow-up via Nextel — opens the template modal from the design. */
export function WhatsAppIconButton({ client }: { client: ContactClient }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={!client.phone}
        title={client.phone ? "Send WhatsApp via Nextel" : "No mobile number"}
        className={`${ICON_BTN} hover:!border-[#25D366] hover:!bg-[#25D366] hover:!text-white`}
        style={{
          background: "rgba(37,211,102,0.12)",
          color: "#1FA855",
          border: "1px solid rgba(37,211,102,0.4)",
        }}
        aria-label={`WhatsApp ${client.name} via Nextel`}
      >
        {WaSvg(15)}
      </button>
      {open && <WhatsAppModal client={client} onClose={() => setOpen(false)} />}
    </>
  );
}

function WhatsAppModal({ client, onClose }: { client: ContactClient; onClose: () => void }) {
  const [selected, setSelected] = useState(0);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = WA_TEMPLATES[selected];
  const preview = renderTemplate(template, client.name);
  const digits = "91" + (client.phone ?? "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");

  async function sendViaNextel() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, templateKey: template.key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-6"
      style={{ background: "rgba(26,34,51,0.45)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Send WhatsApp to ${client.name}`}
    >
      <div
        className="max-h-[90vh] w-full max-w-[520px] overflow-auto bg-white"
        style={{ borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-md)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-3 px-[22px] py-[18px]"
          style={{ borderBottom: "1px solid var(--border-default)", background: "var(--paper-2)" }}
        >
          <span
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-white"
            style={{ borderRadius: "var(--radius-md)", background: "#25D366" }}
          >
            {WaSvg(20)}
          </span>
          <div className="flex-1">
            <div
              className="text-[19px] font-semibold leading-tight"
              style={{ fontFamily: "var(--font-display)", color: "var(--ink-900)" }}
            >
              Send WhatsApp{" "}
              <span
                className="ml-1 px-[7px] py-[2px] align-middle text-[11px] font-bold uppercase"
                style={{
                  fontFamily: "var(--font-sans)",
                  letterSpacing: "0.1em",
                  color: "#1FA855",
                  background: "rgba(37,211,102,0.12)",
                  borderRadius: "var(--radius-pill)",
                }}
              >
                Nextel API
              </span>
            </div>
            <div className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-500)" }}>
              {client.name} · <span className="tabular-nums">{client.phone}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close"
            className="ll-press inline-flex h-[30px] w-[30px] items-center justify-center text-lg hover:bg-[var(--paper-3)] hover:text-[var(--ink-900)]"
            style={{ color: "var(--ink-400)", borderRadius: "var(--radius-md)" }}
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-4 px-[22px] py-5">
          <div
            className="text-[11px] font-bold uppercase"
            style={{ letterSpacing: "0.12em", color: "var(--ink-400)" }}
          >
            Choose a template
          </div>
          <div className="flex flex-col gap-2">
            {WA_TEMPLATES.map((t, i) => {
              const active = i === selected;
              return (
                <button
                  key={t.key}
                  onClick={() => {
                    setSelected(i);
                    setSent(false);
                    setError(null);
                  }}
                  className="ll-press flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] font-medium"
                  style={{
                    borderRadius: "var(--radius-md)",
                    border: active ? "1.5px solid var(--brand-green-deep)" : "1px solid var(--border-default)",
                    background: active ? "var(--brand-green-pale)" : "#fff",
                    color: active ? "var(--ink-900)" : "var(--ink-700)",
                  }}
                >
                  {active && (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--brand-green-deep)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                  <span>{t.label}</span>
                  {!t.nextel && (
                    <span className="ml-auto text-[10.5px] font-semibold" style={{ color: "var(--ink-400)" }}>
                      wa.me only
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div
            className="p-3.5"
            style={{ background: "var(--paper)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)" }}
          >
            <div className="mb-1.5 text-[10.5px] font-bold uppercase" style={{ letterSpacing: "0.12em", color: "var(--ink-400)" }}>
              Message preview
            </div>
            <p className="m-0 text-[13px] leading-relaxed" style={{ color: "var(--ink-700)" }}>
              {preview}
            </p>
          </div>

          {sent && (
            <div
              className="flex items-center gap-2.5 px-3.5 py-3 text-[13px] font-semibold"
              style={{ background: "var(--brand-green-pale)", borderRadius: "var(--radius-md)", color: "var(--earth-moss)" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Queued via Nextel — delivering to {client.name} shortly.
            </div>
          )}
          {error && (
            <p className="m-0 text-[12.5px]" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2.5">
            <a
              href={`https://wa.me/${digits}?text=${encodeURIComponent(preview)}`}
              target="_blank"
              rel="noreferrer"
              className="ll-press inline-flex items-center px-4 py-[9px] text-[13px] font-semibold no-underline hover:bg-[var(--paper-2)]"
              style={{
                color: "var(--ink-700)",
                background: "#fff",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-md)",
              }}
            >
              Open in WhatsApp
            </a>
            <button
              onClick={sendViaNextel}
              disabled={sending || !template.nextel}
              title={template.nextel ? "Send via the Nextel WhatsApp API" : "This template isn't approved on Nextel yet — use Open in WhatsApp"}
              className="ll-press inline-flex items-center gap-[7px] px-[18px] py-[9px] text-[13px] font-semibold text-white hover:!bg-[#1FA855] disabled:opacity-60"
              style={{ background: "#25D366", borderRadius: "var(--radius-md)" }}
            >
              {sending ? (
                <Spinner size={14} color="#fff" track="rgba(255,255,255,0.35)" />
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m22 2-7 20-4-9-9-4Z" />
                  <path d="M22 2 11 13" />
                </svg>
              )}
              Send via Nextel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
