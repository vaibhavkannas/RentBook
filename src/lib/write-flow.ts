import type { PortionEntry } from "@/lib/domain/types";
import { existingEntryFrom, type PaymentResponse } from "@/lib/payment-request";
import type { SendResult } from "@/lib/post-json";
import { apiErrorMessage, PAYMENT_NO_CONFIRMATION, sendFailureMessage, UNDO_NO_CONFIRMATION } from "@/lib/request-copy";

/**
 * What a payment or an undo is doing to the month screen while its request is on the way, and what each answer means for it.
 * The card is changed at once (`begin`), and the answer decides how it ends: saved (the "Saving" mark goes and the real data
 * is asked for), or one of the failures, which put the card back (`rollback`). The sheets decide what to tell the person; this
 * only says which of the cases an answer is, and which of the screen's hooks it calls. Pure on purpose, so each path (a log, an
 * edit, a Replace after a duplicate warning, a retry token, an undo that finds the Sheet changed) can be tested.
 */

/** What the screen does for a write. `refresh` loads the page again from the server. */
export type WriteHooks = { begin(): void; settle(): void; rollback(): void; refresh(): void };

type ApiError = { code?: string; message?: string; details?: Record<string, unknown> };
export type PaymentAnswer = PaymentResponse & { error?: ApiError };
export type UndoAnswer = { ok: boolean; error?: ApiError };

export type PaymentStep =
  /** Saved. The body may still carry a retry token (the Payments Log entry did not save) or say the tenancy did not save. */
  | { kind: "saved"; body: PaymentAnswer }
  /** Someone has recorded a payment for the month: the sheet offers Replace, which is checked against this entry. */
  | { kind: "duplicate"; entry: PortionEntry }
  /** Someone else changed this payment since the card was drawn: the screen is out of date. */
  | { kind: "stale"; error: ApiError | undefined }
  /** The server refused what was sent, and says which field: the sheet shows it beside the field. */
  | { kind: "refused"; error: ApiError | undefined }
  /** It did not go through (no answer, or an error answer nobody can fix in the form). `refresh`: it may have saved, so look. */
  | { kind: "failed"; message: string; refresh: boolean };

export function classifyPayment(sent: SendResult<PaymentAnswer>): PaymentStep {
  if (sent.kind !== "answer") {
    return { kind: "failed", message: sendFailureMessage(sent, PAYMENT_NO_CONFIRMATION), refresh: sent.kind !== "offline" };
  }
  const body = sent.body;
  if (body.ok) return { kind: "saved", body };
  const error = body.error;
  if (error?.code === "conflict") {
    const entry = existingEntryFrom(error.details);
    return entry ? { kind: "duplicate", entry } : { kind: "stale", error };
  }
  if (error?.code === "validation" || error?.details?.field !== undefined) return { kind: "refused", error };
  return { kind: "failed", message: apiErrorMessage(error), refresh: false };
}

export type UndoStep =
  | { kind: "saved"; body: UndoAnswer & PaymentResponse }
  /** The Sheet no longer matches what the sheet was opened on, so the undo is not offered again. */
  | { kind: "conflict" }
  | { kind: "failed"; message: string; refresh: boolean };

export function classifyUndo(sent: SendResult<UndoAnswer & PaymentResponse>): UndoStep {
  if (sent.kind !== "answer") {
    return { kind: "failed", message: sendFailureMessage(sent, UNDO_NO_CONFIRMATION), refresh: sent.kind !== "offline" };
  }
  if (sent.body.ok) return { kind: "saved", body: sent.body };
  if (sent.body.error?.code === "conflict") return { kind: "conflict" };
  return { kind: "failed", message: apiErrorMessage(sent.body.error), refresh: false };
}

/** Carries a step out on the screen: saved settles and loads the real data; anything else puts the card back. */
export function applyStep(step: { kind: string; refresh?: boolean }, hooks: WriteHooks): void {
  switch (step.kind) {
    case "saved":
      hooks.settle();
      hooks.refresh();
      return;
    // A duplicate means someone else has a payment there: the card goes back and the screen looks again, so it shows it.
    case "duplicate":
    case "stale":
    case "conflict":
      hooks.rollback();
      hooks.refresh();
      return;
    case "failed":
      hooks.rollback();
      if (step.refresh) hooks.refresh();
      return;
    default:
      hooks.rollback();
  }
}
