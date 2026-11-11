import type { PortionEntry } from "@/lib/domain/types";
import { formatRupees } from "@/lib/format";
import { paymentOutcome, TENANCY_NOT_SAVED_MESSAGE } from "@/lib/payment-request";
import { UNDO_CONFLICT_MESSAGE } from "@/lib/undo-copy";
import { apiErrorMessage } from "@/lib/request-copy";
import type { WriteNotice } from "@/lib/write-notices";
import type { PaymentStep, UndoStep } from "@/lib/write-flow";

/**
 * What the owner is told when a payment or an undo is answered after its sheet is gone (so nothing on the screen can say it):
 * notices that wait to be dealt with, a toast for a plain failure, and whether the screen should look at the Sheet again.
 */
export type AwayOutcome = { notices: WriteNotice[]; toast: string | null; refresh: boolean };
type Context = { portion: string; monthLabel: string };

const nothing: AwayOutcome = { notices: [], toast: null, refresh: false };

const duplicateText = (entry: PortionEntry, c: Context) =>
  `${c.portion} already has ${formatRupees(entry.amount)} recorded for ${c.monthLabel}${entry.tenant ? ` (${entry.tenant})` : ""}. Nothing was changed. The screen was loaded again; tap the portion to replace the amount if you meant to.`;

export function paymentOutcomeAway(step: PaymentStep, c: Context): AwayOutcome {
  switch (step.kind) {
    case "saved": {
      const outcome = paymentOutcome(step.body);
      const notices: WriteNotice[] = [];
      if (outcome.retryToken !== null) {
        notices.push({ text: `${c.portion}: saved to your Schedule, but the Payments Log entry didn't save.`, retryToken: outcome.retryToken });
      }
      if (outcome.tenancyNotSaved) notices.push({ text: TENANCY_NOT_SAVED_MESSAGE });
      return { ...nothing, notices };
    }
    case "duplicate":
      return { notices: [{ text: duplicateText(step.entry, c) }], toast: null, refresh: true };
    case "stale":
      return { notices: [{ text: `${c.portion}: someone else changed this payment. Nothing was changed. The screen was loaded again.` }], toast: null, refresh: true };
    case "refused":
      return { notices: [], toast: apiErrorMessage(step.error), refresh: false };
    case "failed":
      return { notices: [], toast: step.message, refresh: step.refresh };
  }
}

export function undoOutcomeAway(step: UndoStep, c: Context): AwayOutcome {
  switch (step.kind) {
    case "saved":
      return step.body.logWritten === false
        ? { ...nothing, notices: [{ text: `${c.portion}: undone in your Schedule, but the Payments Log entry didn't save.`, retryToken: step.body.retryToken ?? "" }] }
        : nothing;
    case "conflict":
      return { notices: [{ text: `${c.portion}: ${UNDO_CONFLICT_MESSAGE}` }], toast: null, refresh: true };
    case "failed":
      return { notices: [], toast: step.message, refresh: step.refresh };
  }
}
