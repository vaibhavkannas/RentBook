import type { PortionEntry } from "@/lib/domain/types";
import { formatRupees } from "@/lib/format";
import { logRetryFailureMessage, type LogRetryResponse } from "@/lib/payment-request";
import type { LogEntryState } from "@/lib/toast-copy";

/** What the undo sheet tells the person before they confirm. */
export function undoConfirmationText(
  entry: PortionEntry,
  portionName: string,
  monthLabel: string,
): string {
  return `This clears ${entry.tenant}'s payment ${entry.count} (${formatRupees(entry.amount)}) for ${portionName} in ${monthLabel}. The Payments Log keeps a record.`;
}

/** Shown instead of the confirmation when the Sheet no longer matches what the person was looking at. */
export const UNDO_CONFLICT_MESSAGE =
  "This payment just changed. Close this and look at the updated card.";

/** The toast after an undo. It names the portion because several cards share the screen. */
export function undoToastText(portionName: string): string {
  return `${portionName}: payment undone`;
}

/**
 * The toast for an undo that is in the Schedule while its Payments Log entry did not save (the person skipped the retry, or
 * closed the sheet on it): it says where the undo is and where it is not.
 */
export function undoLogUnsavedToastText(portionName: string): string {
  return `${portionName}: payment undone in your Schedule, but not recorded in the Payments Log`;
}

/**
 * The same, after a retry that got no answer: the log entry may have been saved after all, so the toast says it is not
 * confirmed, not that it is missing.
 */
export function undoLogUnconfirmedToastText(portionName: string): string {
  return `${portionName}: payment undone in your Schedule, but not confirmed in the Payments Log`;
}

/** The toast for the moment the undo sheet closes: which of the three is true depends on where the log entry stands. */
export function undoExitToastText(portionName: string, logEntry: LogEntryState): string {
  if (logEntry === "saved") return undoToastText(portionName);
  return logEntry === "unsaved" ? undoLogUnsavedToastText(portionName) : undoLogUnconfirmedToastText(portionName);
}

/**
 * What to tell the person when retrying the Payments Log entry of an undo did not succeed. `body` is the answer of
 * the retry, or null when none arrived: the entry may then have been saved, so the person is sent to the Activity screen.
 */
export function undoLogRetryFailureMessage(body: LogRetryResponse | null): string {
  return body === null || body.error?.code === "validation"
    ? logRetryFailureMessage(body)
    : "The log entry still didn't save. The undo itself is safe in your Schedule.";
}
