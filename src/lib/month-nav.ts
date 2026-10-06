import { monthName, ymKey } from "@/lib/domain/year-month";

export type PickerCell = { key: string; label: string };

export function monthPickerCells(year: number): PickerCell[] {
  return Array.from({ length: 12 }, (_, index) => ({
    key: ymKey({ year, month: index + 1 }),
    label: monthName(index + 1, false),
  }));
}

/** The current month lives at "/"; any other month at "/?month=YYYY-MM". */
export function monthHref(key: string, currentKey: string): string {
  return key === currentKey ? "/" : `/?month=${key}`;
}

/** Which way a finger drag means, or null when it is too short or mostly vertical. */
export function swipeDirection(
  dx: number,
  dy: number,
  minDistance = 60,
): "next" | "prev" | null {
  if (Math.abs(dx) < minDistance) return null;
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? "next" : "prev";
}

/**
 * Whether a touch may begin a month swipe: one finger only (a pinch is not a swipe), and never
 * while a dialog is open, wherever on the screen the finger lands (including its dimmed backdrop).
 */
export function shouldStartSwipe(touchCount: number, dialogOpen: boolean): boolean {
  return touchCount === 1 && !dialogOpen;
}

/**
 * Keeps Tab inside a dialog. Given how many focusable controls it holds and which one has focus
 * (-1 when focus is on the dialog itself or outside it), returns the index to focus next, or null
 * to let the browser move focus normally.
 */
export function trapTabIndex(count: number, activeIndex: number, shiftKey: boolean): number | null {
  if (count === 0) return null;
  if (activeIndex === -1) return shiftKey ? count - 1 : 0;
  if (shiftKey && activeIndex === 0) return count - 1;
  if (!shiftKey && activeIndex === count - 1) return 0;
  return null;
}

/** Identity of the payment sheet; it includes the month so a sheet can never outlive a month change. */
export function sheetKey(monthKey: string, mode: string, portionId: string | null): string {
  return `${monthKey}-${mode}-${portionId}`;
}

/**
 * Whether a click on a dialog's dimmed backdrop should close it. Only a press that began and ended
 * on the backdrop itself counts: a drag that starts inside the panel (for example while selecting
 * text) and is released over the backdrop produces a click on the backdrop but must not close it.
 */
export function shouldCloseOnBackdrop(press: {
  downOnBackdrop: boolean;
  upOnBackdrop: boolean;
  clickOnBackdrop: boolean;
}): boolean {
  return press.downOnBackdrop && press.upOnBackdrop && press.clickOnBackdrop;
}
