import type { YearMonth } from "@/lib/domain/types";
import { monthName, parseYmKey } from "@/lib/domain/year-month";

const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** 5450 -> "₹ 5,450", 1234567 -> "₹ 12,34,567". */
export function formatRupees(amount: number): string {
  return `₹ ${rupees.format(amount)}`;
}

/** { year: 2026, month: 10 } -> "October 2026". */
export function formatMonthTitle(ym: YearMonth): string {
  return `${monthName(ym.month, true)} ${ym.year}`;
}

/** "2026-10" -> "October 2026". Text that is not a month key is returned unchanged. */
export function formatMonthKey(key: string): string {
  const ym = parseYmKey(key);
  return ym ? formatMonthTitle(ym) : key;
}

const savedAt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** "2026-10-05T04:30:00.000Z" -> "5 Oct, 10:00 am" (India time). */
export function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : savedAt.format(date);
}
