/**
 * What a Tab press can land on, for a dialog that keeps Tab inside itself. Not only buttons: a payment sheet is mostly
 * fields. Disabled controls, hidden inputs and anything with `tabindex="-1"` (the dialog panel itself) are left out.
 */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Whether the browser is showing the element. A field inside a closed `<details>` matches the selector but cannot take
 * focus, and counting it would put the "last" control somewhere nobody can reach.
 */
function isShown(element: HTMLElement): boolean {
  return typeof element.checkVisibility === "function"
    ? element.checkVisibility()
    : element.getClientRects().length > 0;
}

/** The elements inside `root` that Tab can reach, in document order. */
export function tabbable(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isShown);
}
