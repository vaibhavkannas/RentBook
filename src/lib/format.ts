import type { YearMonth } from "@/lib/domain/types";
import { APP_TIME_ZONE, isValidIsoDay, monthName, parseYmKey } from "@/lib/domain/year-month";

const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/**
 * 5450 -> "₹ 5,450", 1234567 -> "₹ 12,34,567". The space is a non-breaking one (U+00A0), so a line never ends after the
 * sign with the number on the next. A person can still copy an amount out of a screen and type it back: stripRupeeFormatting
 * takes out spaces of any kind.
 */
export function formatRupees(amount: number): string {
  return `₹\u00a0${rupees.format(amount)}`;
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
  timeZone: APP_TIME_ZONE,
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

/**
 * A saved-at time with its date, an hour and minute and a zone ("2026-10-05T04:30:00.000Z", "2026-10-05T10:00:00+05:30").
 * Anything looser ("5 Oct", "10/5/2026", a date with no time or no zone) is read differently by each runtime, or by
 * the server's own time zone, so it is not a time the app can place on a day.
 */
const SAVED_AT_TIME =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/;

/** The moment a saved-at text names, or null when it is not a time written out in full (see SAVED_AT_TIME). */
function readSavedAt(iso: string): Date | null {
  const match = SAVED_AT_TIME.exec(iso);
  if (!match || !isValidIsoDay(match[1])) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

const dayInZone = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The calendar day (YYYY-MM-DD) a saved-at time falls on in the app's time zone: "2026-10-15T19:00:00Z" -> "2026-10-16",
 * as India is 5.5 hours ahead. Null when the time cannot be read.
 */
export function indiaDayKey(iso: string): string | null {
  const date = readSavedAt(iso);
  if (!date) return null;
  const key = dayInZone.format(date);
  return isValidIsoDay(key) ? key : null;
}

const clockInZone = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * The time of day of a saved-at time in the app's time zone: "2026-10-05T04:30:00.000Z" -> "10:00 am". Null when the
 * time cannot be read. The am or pm is added here, not taken from Intl, whose spelling and spacing differ by runtime.
 */
export function formatTime(iso: string): string | null {
  const date = readSavedAt(iso);
  if (!date) return null;
  const parts = clockInZone.formatToParts(date);
  const part = (type: "hour" | "minute") => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(part("hour"));
  return `${hour % 12 === 0 ? 12 : hour % 12}:${part("minute")} ${hour < 12 ? "am" : "pm"}`;
}
