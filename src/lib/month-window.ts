import { deriveMonthView } from "@/lib/domain/month-view";
import type { MonthView, PortionConfig, ScheduleRow, YearMonth } from "@/lib/domain/types";
import type { Tenancy } from "@/lib/domain/tenancy";
import { addMonths, compareYm, parseYmKey, ymKey } from "@/lib/domain/year-month";

/**
 * The months the month screen carries, so that moving between them needs no request: from a year back to a quarter ahead,
 * counted from the current month. The month the address asks for is added when it lies outside, so the page always has the
 * view it was asked for. Every view is derived from the one snapshot the page already read, so a wider window costs no
 * further read of the Sheet. Pure on purpose, so the window can be tested.
 */
export const WINDOW_BEFORE = 11;
export const WINDOW_AFTER = 2;

/** The month keys of the window, oldest first: the current month's neighbours, plus the requested month when outside them. */
export function monthWindow(current: YearMonth, requested: YearMonth): string[] {
  const months = Array.from({ length: WINDOW_BEFORE + 1 + WINDOW_AFTER }, (_, index) =>
    addMonths(current, index - WINDOW_BEFORE),
  );
  if (!months.some((month) => compareYm(month, requested) === 0)) months.push(requested);
  return months.sort(compareYm).map(ymKey);
}

/** Whether the page carries the month, so a switch to it can happen on the spot. Anything else is a navigation to the server. */
export function canSwitchHere(views: Readonly<Record<string, unknown>>, key: string): boolean {
  return parseYmKey(key) !== null && Object.hasOwn(views, key);
}

/** The part of a snapshot a month view is derived from. */
type ViewSource = { rows: ScheduleRow[]; portions: PortionConfig[]; tenancies: Tenancy[] };

/**
 * The view of every month in `keys`, from one snapshot. `handed` is a view the page already has for one of them (the
 * requested month, which carries the page's problem handling): it is used as it is instead of being derived again.
 */
export function windowViews(source: ViewSource, keys: readonly string[], handed?: MonthView): Record<string, MonthView> {
  const views: Record<string, MonthView> = {};
  for (const key of keys) {
    views[key] =
      handed && ymKey(handed.month) === key
        ? handed
        : deriveMonthView(source.rows, source.portions, parseYmKey(key)!, source.tenancies);
  }
  return views;
}
