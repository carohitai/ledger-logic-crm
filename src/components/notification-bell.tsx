"use client";

// Notification bell for the top-right of the app header. Polls the activity
// feed, badges the unread count, chimes when something new arrives and opens a
// dropdown of recent client edits / additions / bulk sends.
//
// The chime is synthesised with the Web Audio API rather than an audio file,
// and browsers only allow it after the user has interacted with the page — so
// the first ping after a fresh load may be silent by design.

import { useCallback, useEffect, useRef, useState } from "react";
import { AppLink } from "./nav-progress";

const POLL_MS = 30_000;

interface Item {
  id: string;
  clientId: string | null;
  action: string;
  summary: string | null;
  createdAt: string;
  actor: string;
  client: string | null;
}

const ACTION_LABEL: Record<string, string> = {
  created: "added",
  updated: "updated",
  bulk_message: "sent a bulk message",
  allotment_change: "re-allotted",
  sheet_insert: "added",
  sheet_update: "changed",
  sheet_missing: "dropped",
};

function timeAgo(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
  });
}

function chime() {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const now = ctx.currentTime;
    // Two short notes — a soft "ti-ding" rather than an alarm.
    for (const [at, freq] of [
      [0, 880],
      [0.12, 1174.66],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.16, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.24);
    }
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch {
    // Audio is a nicety — never let it break the bell.
  }
}

export function NotificationBell() {
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const latestSeenId = useRef<string | null>(null);
  const primed = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const next: Item[] = data.items ?? [];
      setItems(next);
      setUnread(data.unread ?? 0);

      const newestId = next[0]?.id ?? null;
      // Chime only for genuinely new activity, never on the first poll.
      if (primed.current && newestId && newestId !== latestSeenId.current && (data.unread ?? 0) > 0) {
        chime();
      }
      latestSeenId.current = newestId;
      primed.current = true;
    } catch {
      // Offline / transient — the next poll will catch up.
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0);
      await fetch("/api/notifications", { method: "POST" }).catch(() => {});
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={toggle}
        aria-label={unread ? `${unread} new notifications` : "Notifications"}
        className="ll-press relative inline-flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-full"
        style={{ background: open ? "var(--paper-2)" : "transparent", color: "var(--ink-700)" }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unread > 0 && (
          <span
            className="absolute -right-[2px] -top-[2px] inline-flex min-w-[16px] items-center justify-center px-[4px] text-[9.5px] font-bold text-white"
            style={{ background: "var(--danger, #b93b3b)", borderRadius: "var(--radius-pill)", lineHeight: "16px" }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-[38px] z-50 w-[340px] overflow-hidden bg-white"
          style={{
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "0 10px 34px rgba(0,0,0,0.16)",
          }}
        >
          <div
            className="px-4 py-2.5 text-[11px] font-bold uppercase"
            style={{ letterSpacing: "0.1em", color: "var(--ink-400)", background: "var(--paper-2)" }}
          >
            Client activity
          </div>
          {!items.length ? (
            <p className="m-0 px-4 py-5 text-center text-[12.5px]" style={{ color: "var(--ink-400)" }}>
              Nothing yet. Client edits and additions will show up here.
            </p>
          ) : (
            <ul className="m-0 max-h-[380px] list-none overflow-y-auto p-0">
              {items.map((n) => {
                const body = (
                  <>
                    <div className="text-[12.5px]" style={{ color: "var(--ink-900)" }}>
                      <strong>{n.actor}</strong> {ACTION_LABEL[n.action] ?? n.action}
                      {n.client ? (
                        <>
                          {" "}
                          <strong>{n.client}</strong>
                        </>
                      ) : null}
                    </div>
                    {n.summary && (
                      <div className="mt-[3px] text-[11.5px]" style={{ color: "var(--ink-500)" }}>
                        {n.summary}
                      </div>
                    )}
                    <div className="mt-[3px] text-[10.5px]" style={{ color: "var(--ink-400)" }}>
                      {timeAgo(n.createdAt)}
                    </div>
                  </>
                );
                return (
                  <li key={n.id} style={{ borderTop: "1px solid var(--ink-100)" }}>
                    {n.clientId ? (
                      <AppLink
                        href={`/clients/${n.clientId}`}
                        inlineSpinner
                        onClick={() => setOpen(false)}
                        className="block px-4 py-2.5 no-underline hover:bg-[var(--paper)]"
                      >
                        {body}
                      </AppLink>
                    ) : (
                      <div className="px-4 py-2.5">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
