import type { YearMonth } from "@/lib/domain/types";
import { isValidIsoDay, monthName, parseYmKey } from "@/lib/domain/year-month";

const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** 5450 -> "₹ 5,450", 1234567 -> "₹ 12,34,567". */
export function formatRupees(amount: number): string {
  return `₹ ${rupees.format(amount)}`;
}

/**
 * What a person typed into an amount field without the marks they use to read it: commas, spaces of any kind and the
 * rupee sign. "₹ 5,450" -> "5450". What is left is empty for a blank field, and otherwise the digits or the slip.
 */
export function stripRupeeFormatting(text: string): string {
  return text.replace(/[,\s₹]/g, "");
}

/**
 * "Advance must be whole rupees, from ₹ 0 to ₹ 1,00,00,000.": what is wrong with an amount that is out of range, with the
 * range written like every other amount in the app.
 */
export function wholeRupeesMessage(label: string, min: number, max: number): string {
  return `${label} must be whole rupees, from ${formatRupees(min)} to ${formatRupees(max)}.`;
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

/** "2027-03-15" -> "15 Mar 2027". Text that is not a real YYYY-MM-DD day is returned unchanged. */
export function formatDay(iso: string): string {
  if (!isValidIsoDay(iso)) return iso;
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${monthName(month, false)} ${year}`;
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
