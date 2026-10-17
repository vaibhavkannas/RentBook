import { trapTabIndex } from "@/lib/month-nav";

/** What a bottom sheet does with a key press. `null` means nothing: the browser handles the key as usual. */
export type SheetKeyAction =
  | { type: "close" }
  /** Move focus to the control at `index` (of the tabbable controls, in order). The key press is cancelled. */
  | { type: "focus"; index: number }
  /** Nothing in the sheet can take focus: keep focus on the sheet itself. The key press is cancelled. */
  | { type: "focus-panel" }
  | null;

/**
 * Decides what a key press means for an open sheet: Escape closes it, but only while it may be closed (not while
 * something is being saved); Tab and Shift+Tab wrap around at the first and last control so focus never leaves the
 * sheet, and are otherwise left to the browser. `activeIndex` is the position of the focused element among the
 * `itemCount` tabbable controls, or -1 when focus is on the sheet itself or outside it.
 */
export function sheetKeyAction(press: {
  key: string;
  shiftKey: boolean;
  canClose: boolean;
  itemCount: number;
  activeIndex: number;
}): SheetKeyAction {
  if (press.key === "Escape") return press.canClose ? { type: "close" } : null;
  if (press.key !== "Tab") return null;
  if (press.itemCount === 0) return { type: "focus-panel" };
  const index = trapTabIndex(press.itemCount, press.activeIndex, press.shiftKey);
  return index === null ? null : { type: "focus", index };
}
