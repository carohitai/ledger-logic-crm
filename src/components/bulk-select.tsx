"use client";

// Checkbox selection for the client lists plus the floating bulk-action bar
// that sends an approved WhatsApp template to everyone selected. Server pages
// render <BulkSelectProvider> around their table and drop <RowCheckbox> /
// <SelectAllCheckbox> into cells, so the tables stay server-rendered.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "./button";
import { WA_TEMPLATES } from "@/lib/whatsapp-templates";

interface SelectionCtx {
  selected: Set<string>;
  toggle: (id: string) => void;
  pageIds: string[];
  allFilteredIds: string[];
  setMany: (ids: string[], on: boolean) => void;
  clear: () => void;
}

const Ctx = createContext<SelectionCtx | null>(null);

function useSelection() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Selection components must be inside <BulkSelectProvider>");
  return ctx;
}

export function BulkSelectProvider({
  pageIds,
  allFilteredIds = [],
  initialSelected,
  children,
}: {
  pageIds: string[];
  /** Every id matching the current filter (may exceed the visible page). */
  allFilteredIds?: string[];
  /** Start with these selected — used by the campaign-style Bulk Send screen. */
  initialSelected?: string[];
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected ?? []));

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setMany = useCallback((ids: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const value = useMemo(
    () => ({ selected, toggle, pageIds, allFilteredIds, setMany, clear }),
    [selected, toggle, pageIds, allFilteredIds, setMany, clear]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const BOX = "h-[15px] w-[15px] cursor-pointer accent-[var(--brand-blue)] align-middle";

export function RowCheckbox({ id }: { id: string }) {
  const { selected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      className={BOX}
      checked={selected.has(id)}
      onChange={() => toggle(id)}
      aria-label="Select client"
    />
  );
}

export function SelectAllCheckbox() {
  const { selected, pageIds, setMany } = useSelection();
  const allOn = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  return (
    <input
      type="checkbox"
      className={BOX}
      checked={allOn}
      onChange={() => setMany(pageIds, !allOn)}
      aria-label="Select all on this page"
    />
  );
}

const SENDABLE = WA_TEMPLATES.filter((t) => t.nextel);

export function BulkActionBar() {
  const { selected, allFilteredIds, setMany, clear } = useSelection();
  const router = useRouter();
  const [templateKey, setTemplateKey] = useState(SENDABLE[0]?.key ?? "");
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const ids = [...selected];
  if (!ids.length) return null;

  const moreToSelect = allFilteredIds.filter((id) => !selected.has(id)).length;

  async function call(dryRun: boolean) {
    setBusy(dryRun ? "preview" : "send");
    setResult(null);
    try {
      const res = await fetch("/api/whatsapp/bulk-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientIds: ids, templateKey, dryRun }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult(data.error ?? "Request failed");
      } else if (dryRun) {
        setResult(
          `${data.due} of ${data.requested} selected will receive this — ${data.skippedNoPhone} have no valid mobile.`
        );
      } else {
        setResult(
          `Sent to ${data.sent}. ${data.failed} failed${
            data.skippedNoPhone ? `, ${data.skippedNoPhone} skipped (no mobile)` : ""
          }.`
        );
        clear();
        setConfirming(false);
        router.refresh();
      }
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sticky bottom-4 z-40 mx-auto w-full max-w-[900px]">
      <div
        className="flex flex-wrap items-center gap-3 px-5 py-3.5"
        style={{
          background: "var(--white)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg, 0 8px 30px rgba(0,0,0,0.14))",
        }}
      >
        <span className="text-[13px] font-semibold" style={{ color: "var(--ink-900)" }}>
          {ids.length} selected
        </span>
        {moreToSelect > 0 && (
          <button
            type="button"
            onClick={() => setMany(allFilteredIds, true)}
            className="cursor-pointer text-[12px] font-semibold underline"
            style={{ color: "var(--brand-blue)" }}
          >
            Select all {allFilteredIds.length} matching
          </button>
        )}
        <button
          type="button"
          onClick={clear}
          className="cursor-pointer text-[12px] font-semibold"
          style={{ color: "var(--ink-400)" }}
        >
          Clear
        </button>

        <select
          value={templateKey}
          onChange={(e) => {
            setTemplateKey(e.target.value);
            setConfirming(false);
            setResult(null);
          }}
          className="ml-auto cursor-pointer px-3 py-2 text-[13px]"
          style={{
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-md)",
            background: "var(--white)",
            color: "var(--ink-900)",
          }}
        >
          {SENDABLE.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>

        <Button
          variant="secondary"
          size="md"
          loading={busy === "preview"}
          disabled={busy !== null}
          onClick={() => call(true)}
        >
          Preview
        </Button>
        {confirming ? (
          <Button
            variant="danger"
            size="md"
            loading={busy === "send"}
            disabled={busy !== null}
            onClick={() => call(false)}
          >
            Confirm send to {ids.length}
          </Button>
        ) : (
          <Button variant="success" size="md" disabled={busy !== null} onClick={() => setConfirming(true)}>
            Send WhatsApp
          </Button>
        )}

        {result && (
          <p className="m-0 w-full text-[12.5px]" style={{ color: "var(--ink-700)" }}>
            {result}
          </p>
        )}
      </div>
    </div>
  );
}
