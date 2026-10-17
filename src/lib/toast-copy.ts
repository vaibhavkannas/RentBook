import { formatRupees } from "@/lib/format";

/**
 * What the toast says after a save. The portion comes first where there are several cards on the screen, then what
 * happened. (The toast after an undo is undoToastText in undo-copy.ts.)
 */

/** "Ground floor: ₹ 10,000 logged for October 2026". `monthLabel` is the month as the screen titles it. */
export function logToastText(portion: string, amount: number, monthLabel: string): string {
  return `${portion}: ${formatRupees(amount)} logged for ${monthLabel}`;
}

export function editToastText(portion: string, amount: number): string {
  return `${portion}: amount changed to ${formatRupees(amount)}`;
}

/** After Replace amount on a duplicate warning. */
export function replaceToastText(portion: string, amount: number): string {
  return `${portion}: amount replaced with ${formatRupees(amount)}`;
}

export function newTenantToastText(portion: string, tenant: string, amount: number): string {
  return `${portion}: ${tenant} added, ${formatRupees(amount)} logged`;
}

export const SETTINGS_SAVED_TOAST = "Settings saved";

/** After tenancy details were added or edited. */
export const DETAILS_SAVED_TOAST = "Details saved";

export function moveOutToastText(tenant: string): string {
  return `${tenant} has moved out`;
}

/** A payment the sheet saved, as far as its toast is concerned. */
type SavedPayment = {
  mode: "log" | "edit" | "new-tenant";
  /** The person confirmed Replace amount after a duplicate warning. */
  replaced: boolean;
  portion: string;
  tenant: string;
  amount: number;
  monthLabel: string;
};

/**
 * The toast for a payment the sheet saved. A new tenant is what changed, so that text wins; otherwise a Replace after a
 * duplicate warning says so, an edit says the amount changed, and a log says what was logged for which month.
 */
export function paymentToastText(saved: SavedPayment): string {
  if (saved.mode === "new-tenant") return newTenantToastText(saved.portion, saved.tenant, saved.amount);
  if (saved.replaced) return replaceToastText(saved.portion, saved.amount);
  if (saved.mode === "edit") return editToastText(saved.portion, saved.amount);
  return logToastText(saved.portion, saved.amount, saved.monthLabel);
}

/**
 * The toast for a payment that is in the Schedule while its Payments Log entry did not save (the person skipped the
 * retry, or closed the sheet on it). "Logged" would not be true, so it says where the payment is and where it is not.
 */
export function logUnsavedToastText(portion: string, amount: number): string {
  return `${portion}: ${formatRupees(amount)} saved to your Schedule, but not to the Payments Log`;
}

/** What the toast of a saved payment may say, kept while the sheet stops on a notice before it closes. */
export type PaymentToasts = { saved: string; logUnsaved: string };

export function paymentToasts(saved: SavedPayment): PaymentToasts {
  return { saved: paymentToastText(saved), logUnsaved: logUnsavedToastText(saved.portion, saved.amount) };
}

/** The toast for the moment the sheet closes: which of the two is true depends on whether the log entry has saved by now. */
export function exitToastText(toasts: PaymentToasts, logEntrySaved: boolean): string {
  return logEntrySaved ? toasts.saved : toasts.logUnsaved;
}
