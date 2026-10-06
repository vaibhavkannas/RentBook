"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PortionCard } from "@/lib/domain/types";
import { formatRupees } from "@/lib/format";

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
  const [pendingLog, setPendingLog] = useState<unknown[] | null>(null);

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
      onDone("Payment undone");
      return onClose();
    }
    if (body.error?.code === "conflict") router.refresh();
    setError(body.error?.message ?? "Something went wrong. Try again.");
  }

  async function retryLog() {
    setBusy(true);
    setError(null);
    const body = await post("/api/payments/log-retry", { row: pendingLog });
    setBusy(false);
    if (body?.ok && body.logWritten) {
      onDone("Payment undone");
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
            <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">
              The payment was undone in your Schedule, but the Payments Log entry didn&apos;t save.
            </p>
            {error && (
              <p role="alert" className="text-sm text-danger-ink">
                {error}
              </p>
            )}
            <button
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
                onDone("Payment undone");
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
            <p className="text-sm">
              This clears {entry.tenant}&apos;s payment {entry.count} of {formatRupees(entry.amount)} for{" "}
              {card.name} in {monthLabel}. The Payments Log keeps a record.
            </p>
            {error && (
              <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-ink">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={undo}
              disabled={busy}
              className="min-h-12 w-full rounded-xl bg-danger-bg px-4 font-medium text-danger-ink"
            >
              {busy ? "Undoing…" : "Undo payment"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              autoFocus
              className="min-h-11 w-full text-muted"
            >
              Keep
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
