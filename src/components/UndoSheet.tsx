"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Sheet } from "@/components/ui/Sheet";
import { SlowHint } from "@/components/ui/SlowHint";
import { useToast } from "@/components/ui/Toast";
import type { PortionCard } from "@/lib/domain/types";
import { LOG_RETRY_UNCONFIRMED_MESSAGE, type LogRetryResponse } from "@/lib/payment-request";
import { sendJson } from "@/lib/post-json";
import { apiErrorMessage, sendFailureMessage, UNDO_NO_CONFIRMATION } from "@/lib/request-copy";
import { logEntryState, type LogEntryState } from "@/lib/toast-copy";
import {
  undoConfirmationText,
  undoLogRetryFailureMessage,
  undoExitToastText,
  UNDO_CONFLICT_MESSAGE,
} from "@/lib/undo-copy";

type Props = {
  monthKey: string;
  monthLabel: string;
  /** The paid card as it was when Undo was tapped. It must have an entry. */
  card: PortionCard;
  onClose: () => void;
};

type ApiBody = LogRetryResponse & {
  error?: { code: string; message: string };
  /** Present when the log entry did not save: the signed token to send back to retry it. */
  retryToken?: string;
};

export default function UndoSheet({ monthKey, monthLabel, card, onClose }: Props) {
  const router = useRouter();
  const toast = useToast();
  const entry = card.entry!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The Sheet no longer matches what this sheet was opened on, so it must not offer the undo again. */
  const [conflicted, setConflicted] = useState(false);
  // The token that retries the Payments Log entry, once the undo saved but its log entry did not. "" if none came.
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const logPending = pendingToken !== null;
  /** The last retry of the Payments Log entry got no answer, so the entry may have saved after all. */
  const [retryUnanswered, setRetryUnanswered] = useState(false);
  const safeButton = useRef<HTMLButtonElement>(null);

  /** The undo is saved: say so, and close. The words say whether its Payments Log entry is saved, not saved or not confirmed. */
  function done(logEntry: LogEntryState) {
    toast.show(undoExitToastText(card.name, logEntry));
    onClose();
  }
  /** Skip for now, and Escape or the x on the retry notice: the entry is not saved, or not confirmed if the last retry got no answer. */
  const skip = () => done(logEntryState(true, retryUnanswered));

  // Focus the safe choice: Keep, then Close once the card changed, or Retry after a log failure. The Sheet puts focus
  // on it when it opens (initialFocus) and gives focus back to what opened the sheet when it closes.
  useEffect(() => {
    safeButton.current?.focus();
  }, [conflicted, logPending]);

  async function undo() {
    setBusy(true);
    setError(null);
    const sent = await sendJson<ApiBody>("/api/payments/undo", {
      month: monthKey,
      portionId: card.portionId,
      expected: entry,
    });
    setBusy(false);
    if (sent.kind !== "answer") return setError(sendFailureMessage(sent, UNDO_NO_CONFIRMATION));
    const body = sent.body;
    if (body.ok) {
      router.refresh();
      if (body.logWritten === false) return setPendingToken(body.retryToken ?? "");
      return done("saved");
    }
    if (body.error?.code === "conflict") {
      router.refresh();
      return setConflicted(true);
    }
    setError(apiErrorMessage(body.error));
  }

  async function retryLog() {
    setBusy(true);
    setError(null);
    const sent = await sendJson<ApiBody>("/api/payments/log-retry", { token: pendingToken });
    setBusy(false);
    const body = sent.kind === "answer" ? sent.body : null;
    if (body?.ok && body.logWritten) return done("saved");
    setRetryUnanswered(body === null);
    setError(
      sent.kind === "answer"
        ? undoLogRetryFailureMessage(body)
        : sendFailureMessage(sent, LOG_RETRY_UNCONFIRMED_MESSAGE),
    );
  }

  return (
    <Sheet
      labelledBy="undo-title"
      describedBy="undo-description"
      onClose={logPending ? skip : onClose}
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
            onClick={skip}
            disabled={busy}
          >
            Skip for now
          </Button>
          <SlowHint busy={busy} />
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
          <SlowHint busy={busy} />
        </div>
      )}
    </Sheet>
  );
}
