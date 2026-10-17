"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Sheet } from "@/components/ui/Sheet";
import type { PortionCard } from "@/lib/domain/types";
import type { LogRetryResponse } from "@/lib/payment-request";
import { postJson } from "@/lib/post-json";
import {
  undoConfirmationText,
  undoLogRetryFailureMessage,
  undoToastText,
  UNDO_CONFLICT_MESSAGE,
} from "@/lib/undo-copy";

type Props = {
  monthKey: string;
  monthLabel: string;
  /** The paid card as it was when Undo was tapped. It must have an entry. */
  card: PortionCard;
  onClose: () => void;
  onDone: (message: string) => void;
};

type ApiBody = LogRetryResponse & {
  error?: { code: string; message: string };
  /** Present when the log entry did not save: the signed token to send back to retry it. */
  retryToken?: string;
};

const NO_CONFIRMATION =
  "Couldn't confirm that the undo went through. Check your connection and refresh the page before trying again.";

export default function UndoSheet({ monthKey, monthLabel, card, onClose, onDone }: Props) {
  const router = useRouter();
  const entry = card.entry!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The Sheet no longer matches what this sheet was opened on, so it must not offer the undo again. */
  const [conflicted, setConflicted] = useState(false);
  // The token that retries the Payments Log entry, once the undo saved but its log entry did not. "" if none came.
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const logPending = pendingToken !== null;
  const safeButton = useRef<HTMLButtonElement>(null);
  const toastText = undoToastText(card.name);

  // Focus the safe choice: Keep, then Close once the card changed, or Retry after a log failure. The Sheet puts focus
  // on it when it opens (initialFocus) and gives focus back to what opened the sheet when it closes.
  useEffect(() => {
    safeButton.current?.focus();
  }, [conflicted, logPending]);

  async function undo() {
    setBusy(true);
    setError(null);
    const body = await postJson<ApiBody>("/api/payments/undo", {
      month: monthKey,
      portionId: card.portionId,
      expected: entry,
    });
    setBusy(false);
    if (!body) return setError(NO_CONFIRMATION);
    if (body.ok) {
      router.refresh();
      if (body.logWritten === false) return setPendingToken(body.retryToken ?? "");
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
    const body = await postJson<ApiBody>("/api/payments/log-retry", { token: pendingToken });
    setBusy(false);
    if (body?.ok && body.logWritten) {
      onDone(toastText);
      return onClose();
    }
    setError(undoLogRetryFailureMessage(body));
  }

  return (
    <Sheet
      labelledBy="undo-title"
      describedBy="undo-description"
      onClose={onClose}
      canClose={!busy}
      closeOnBackdrop={false}
      initialFocus={safeButton}
    >
      <h2 id="undo-title" className="text-lg font-semibold">
        Undo payment?
      </h2>
      <p className="text-sm text-muted">
        {monthLabel} · {card.name}
      </p>

      {logPending ? (
        <div className="mt-4 space-y-3">
          <Notice tone="warn" id="undo-description">
            The payment was undone in your Schedule, but the Payments Log entry didn&apos;t save.
          </Notice>
          {error && (
            <p role="alert" className="text-sm text-danger-ink">
              {error}
            </p>
          )}
          <Button
            ref={safeButton}
            size="lg"
            className="w-full"
            onClick={retryLog}
            pending={busy}
            pendingLabel="Retrying…"
          >
            Retry log entry
          </Button>
          <Button
            variant="quiet"
            className="w-full"
            onClick={() => {
              onDone(toastText);
              onClose();
            }}
            disabled={busy}
          >
            Skip for now
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {conflicted ? (
            <Notice tone="danger" role="alert" id="undo-description">
              {UNDO_CONFLICT_MESSAGE}
            </Notice>
          ) : (
            <p id="undo-description" className="text-sm">
              {undoConfirmationText(entry, card.name, monthLabel)}
            </p>
          )}
          {error && (
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          )}
          {!conflicted && (
            <Button
              variant="danger"
              size="lg"
              className="w-full"
              onClick={undo}
              pending={busy}
              pendingLabel="Undoing…"
            >
              Undo payment
            </Button>
          )}
          <Button ref={safeButton} variant="quiet" className="w-full" onClick={onClose} disabled={busy}>
            {conflicted ? "Close" : "Keep"}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
