import type { PortionEntry } from "@/lib/domain/types";
import { formatRupees } from "@/lib/format";
import { logRetryFailureMessage } from "@/lib/payment-request";

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
 * What to tell the person when retrying the Payments Log entry of an undo did not succeed. `body` is the answer of
 * the retry, or null when none arrived: the entry may then have been saved, so the person is sent to the Activity screen.
 */
export function undoLogRetryFailureMessage(body: { ok: boolean; logWritten?: boolean } | null): string {
  return body === null
    ? logRetryFailureMessage(body)
    : "The log entry still didn't save. The undo itself is safe in your Schedule.";
}
