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
