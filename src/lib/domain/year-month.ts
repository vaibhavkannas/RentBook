import type { YearMonth } from "./types";

const KEY_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Days from 1899-12-30 (Google Sheets serial 0) to 1970-01-01. */
const SERIAL_UNIX_OFFSET = 25569;
const MS_PER_DAY = 86_400_000;

export function ymKey(ym: YearMonth): string {
  return `${ym.year}-${String(ym.month).padStart(2, "0")}`;
}

export function parseYmKey(value: string): YearMonth | null {
  const match = KEY_PATTERN.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function compareYm(a: YearMonth, b: YearMonth): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

export function addMonths(ym: YearMonth, delta: number): YearMonth {
  const index = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Serial number of the first day of the month, as Google Sheets stores dates. */
export function serialFromYm(ym: YearMonth): number {
  return Date.UTC(ym.year, ym.month - 1, 1) / MS_PER_DAY + SERIAL_UNIX_OFFSET;
}

export function ymFromSerial(serial: number): YearMonth {
  const date = new Date((Math.floor(serial) - SERIAL_UNIX_OFFSET) * MS_PER_DAY);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/**
 * The calendar day (YYYY-MM-DD) of a Google Sheets date serial; the time of day is dropped.
 * Null when the number cannot be a date (not finite, or a year outside 0001 to 9999).
 */
export function isoDayFromSerial(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const date = new Date((Math.floor(serial) - SERIAL_UNIX_OFFSET) * MS_PER_DAY);
  const year = date.getUTCFullYear();
  if (Number.isNaN(year) || year < 1 || year > 9999) return null;
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  return `${pad(year, 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/** Calendar month that `now` falls in, for the given IANA time zone. */
export function currentYm(now: Date, timeZone = "Asia/Kolkata"): YearMonth {
  const [year, month] = todayIso(now, timeZone).split("-").map(Number);
  return { year, month };
}

/** Calendar day of `now` as YYYY-MM-DD in the given IANA time zone. */
export function todayIso(now: Date, timeZone = "Asia/Kolkata"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isValidIsoDay(value: string): boolean {
  const match = DAY_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const LONG_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthName(month: number, long: boolean): string {
  const name = LONG_NAMES[month - 1];
  return long ? name : name.slice(0, 3);
}

/** The full English name when `name` is one. Used to tell "September" (long style) from "Sept" (short). */
export function isFullMonthName(name: string): boolean {
  return LONG_NAMES.some((long) => long.toLowerCase() === name.toLowerCase());
}

/**
 * 1 to 12 for an English month name or a prefix of one of at least three letters, with an optional trailing
 * dot: "Sep", "Sept", "sept.", "September". Three letters tell every month apart.
 */
export function monthIndexFromName(name: string): number | null {
  const lower = name.toLowerCase().replace(/\.$/, "");
  if (lower.length < 3) return null;
  const index = LONG_NAMES.findIndex((long) => long.toLowerCase().startsWith(lower));
  return index === -1 ? null : index + 1;
}
