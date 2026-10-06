import type { PortionEntry } from "@/lib/domain/types";
import { formatRupees } from "@/lib/format";

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
