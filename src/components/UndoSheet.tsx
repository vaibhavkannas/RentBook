"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { PortionCard } from "@/lib/domain/types";
import { undoConfirmationText, undoToastText, UNDO_CONFLICT_MESSAGE } from "@/lib/undo-copy";

type Props = {
  monthKey: string;
  monthLabel: string;
  /** The paid card as it was when Undo was tapped. It must have an entry. */
  card: PortionCard;
  onClose: () => void;
  onDone: (message: string) => void;
};

type ApiBody = {
  ok: boolean;
  error?: { code: string; message: string };
  logWritten?: boolean;
  logRow?: unknown[];
};

async function post(url: string, payload: unknown): Promise<ApiBody | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as ApiBody;
  } catch {
    return null;
  }
}

const NO_CONFIRMATION =
  "Couldn't confirm that the undo went through. Check your connection and refresh the page before trying again.";

export default function UndoSheet({ monthKey, monthLabel, card, onClose, onDone }: Props) {
  const router = useRouter();
  const entry = card.entry!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The Sheet no longer matches what this sheet was opened on, so it must not offer the undo again. */
  const [conflicted, setConflicted] = useState(false);
  const [pendingLog, setPendingLog] = useState<unknown[] | null>(null);
  const logPending = pendingLog !== null;
  const safeButton = useRef<HTMLButtonElement>(null);
  const toastText = undoToastText(card.name);

  // Remember what opened the sheet and give focus back to it on close, if it is still on the page.
  // This must stay above the focus effect below, which moves focus into the sheet.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // Focus the safe choice: Keep, then Close once the card changed, or Retry after a log failure.
  useEffect(() => {
    safeButton.current?.focus();
  }, [conflicted, logPending]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function undo() {
    setBusy(true);
    setError(null);
    const body = await post("/api/payments/undo", {
      month: monthKey,
      portionId: card.portionId,
      expected: entry,
    });
    setBusy(false);
    if (!body) return setError(NO_CONFIRMATION);
    if (body.ok) {
      router.refresh();
      if (body.logWritten === false) return setPendingLog(body.logRow ?? []);
      onDone(toastText);
      return onClose();
    }
    if (body.error?.code === "conflict") {
      router.refresh();
      return setConflicted(true);
    }
    setError(body.error?.message ?? "Something went wrong. Try again.");
  }

  async function retryLog() {
    setBusy(true);
    setError(null);
    const body = await post("/api/payments/log-retry", { row: pendingLog });
    setBusy(false);
    if (body?.ok && body.logWritten) {
      onDone(toastText);
      return onClose();
    }
    setError("The log entry still didn't save. The undo itself is safe in your Schedule.");
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="undo-title"
        aria-describedby="undo-description"
        className="max-h-dvh w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5"
      >
        <h2 id="undo-title" className="text-lg font-semibold">
          Undo payment?
        </h2>
        <p className="text-sm text-muted">
          {monthLabel} · {card.name}
        </p>

        {pendingLog ? (
          <div className="mt-4 space-y-3">
            <p id="undo-description" className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">
              The payment was undone in your Schedule, but the Payments Log entry didn&apos;t save.
            </p>
            {error && (
              <p role="alert" className="text-sm text-danger-ink">
                {error}
              </p>
            )}
            <button
              ref={safeButton}
              type="button"
              onClick={retryLog}
              disabled={busy}
              className="min-h-12 w-full rounded-xl bg-accent px-4 font-medium text-accent-ink"
            >
              {busy ? "Retrying…" : "Retry log entry"}
            </button>
            <button
              type="button"
              onClick={() => {
                onDone(toastText);
                onClose();
              }}
              disabled={busy}
              className="min-h-11 w-full text-muted"
            >
              Skip for now
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {conflicted ? (
              <p
                id="undo-description"
                role="alert"
                className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-ink"
              >
                {UNDO_CONFLICT_MESSAGE}
              </p>
            ) : (
              <p id="undo-description" className="text-sm">
                {undoConfirmationText(entry, card.name, monthLabel)}
              </p>
            )}
            {error && (
              <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-ink">
                {error}
              </p>
            )}
            {!conflicted && (
              <button
                type="button"
                onClick={undo}
                disabled={busy}
                className="min-h-12 w-full rounded-xl bg-danger-bg px-4 font-medium text-danger-ink"
              >
                {busy ? "Undoing…" : "Undo payment"}
              </button>
            )}
            <button
              ref={safeButton}
              type="button"
              onClick={onClose}
              disabled={busy}
              className="min-h-11 w-full text-muted"
            >
              {conflicted ? "Close" : "Keep"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
