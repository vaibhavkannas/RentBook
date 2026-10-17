import { monthParam, withMonth } from "@/lib/app-nav";
import { isValidIsoDay, monthName } from "@/lib/domain/year-month";
import { formatMonthKey, formatRupees, formatTime, indiaDayKey } from "@/lib/format";
import type { ActivityItem } from "@/lib/sheets/service";
import type { PillTone } from "@/lib/ui-classes";

/**
 * What the Activity screen says about the Payments Log: one sentence for each row, the day it is listed under, and the
 * filters that narrow it. All of it is pure, so it can be tested with odd and hand-edited rows; the page only reads the
 * log, asks these functions and draws the answers.
 */

/** How many of the newest Payments Log rows the screen looks through. The filters work on these. */
export const ACTIVITY_SCAN_LIMIT = 500;
/** How many of the matching rows it shows, newest first. */
export const ACTIVITY_SHOWN_LIMIT = 50;

/** The heading of the rows whose saved time cannot be read. */
export const DATE_NOT_RECORDED = "Date not recorded";
/** The key of that group. It is never a day, so it cannot clash with one. */
export const UNKNOWN_DAY_KEY = "unknown";

export type ActivityEntry = {
  /** The portion's name, or a note when the row has none. */
  portion: string;
  /** The colour of the pill. */
  tone: PillTone;
  /** The word on the pill. */
  label: string;
  /** What happened, in a sentence. */
  summary: string;
  /** The amount, written out; null when the row has none. */
  amount: string | null;
  /** True when the amount is for a payment that was taken back, so it is drawn struck through. */
  struck: boolean;
  /** When, who, and (for a payment) the day the money was received. */
  meta: string;
};

const clean = (text: string) => text.trim();

/** A number a person typed into the Sheet can be anything; only a real, finite one is an amount. */
const amountText = (amount: number | null) => (amount !== null && Number.isFinite(amount) ? formatRupees(amount) : null);

/** The payment number: a whole number from 1, or nothing. */
const paymentNumber = (count: number | null) => (count !== null && Number.isInteger(count) && count > 0 ? count : null);

/** "Asha's", or "the" when the row names nobody. */
const possessive = (tenant: string) => (tenant === "" ? "the" : `${tenant}'s`);

/** "5 Oct" for a real YYYY-MM-DD day, or null. The year is left off: the money came in around when it was logged. */
function shortDay(text: string): string | null {
  if (!isValidIsoDay(text)) return null;
  const [, month, day] = text.split("-").map(Number);
  return `${day} ${monthName(month, false)}`;
}

type Parts = { amount: string | null; tenant: string; month: string; count: number | null };

/** The sentence for a payment that was logged: "Logged ₹ 5,450 from Asha for October 2026 (payment 4)." */
function loggedSentence({ amount, tenant, month, count }: Parts): string {
  return `Logged${amount ? ` ${amount}` : ""}${tenant ? ` from ${tenant}` : ""}${month ? ` for ${month}` : ""}${count ? ` (payment ${count})` : ""}.`;
}

/** The sentence for a payment that was changed: "Changed Asha's October 2026 payment to ₹ 5,450." */
function changedSentence({ amount, tenant, month }: Parts): string {
  return `Changed ${possessive(tenant)} ${month ? `${month} ` : ""}payment${amount ? ` to ${amount}` : ""}.`;
}

/** The sentence for a payment that was undone: "Undid Asha's October 2026 payment of ₹ 5,450." */
function undoneSentence({ amount, tenant, month }: Parts): string {
  return `Undid ${possessive(tenant)} ${month ? `${month} ` : ""}payment${amount ? ` of ${amount}` : ""}.`;
}

/** An older row that says nothing about what happened: just what it holds, "₹ 5,450 from Asha for October 2026." */
function plainSentence({ amount, tenant, month }: Parts): string {
  const words = [amount, tenant && `from ${tenant}`, month && `for ${month}`].filter(Boolean).join(" ");
  return words === "" ? "No details recorded." : `${words.charAt(0).toUpperCase()}${words.slice(1)}.`;
}

/** The look and the words of each kind of row. A row with no recognised action is an older one. */
const KINDS: Record<
  "Logged" | "Edited" | "Undone" | "none",
  { tone: PillTone; label: string; sentence: (parts: Parts) => string; showsReceived: boolean }
> = {
  Logged: { tone: "success", label: "Logged", sentence: loggedSentence, showsReceived: true },
  Edited: { tone: "warn", label: "Changed", sentence: changedSentence, showsReceived: true },
  Undone: { tone: "danger", label: "Undone", sentence: undoneSentence, showsReceived: false },
  none: { tone: "neutral", label: "Entry", sentence: plainSentence, showsReceived: false },
};

/** "by you" for the signed-in person's own address (however its capitals are written), "by {address}", or who: not recorded. */
function whoText(loggedBy: string, viewerEmail: string | null | undefined): string {
  const who = clean(loggedBy);
  if (who === "") return "who: not recorded";
  const me = clean(viewerEmail ?? "");
  return me !== "" && who.toLowerCase() === me.toLowerCase() ? "by you" : `by ${who}`;
}

/**
 * How one Payments Log row reads on the screen. Anything the row does not have (an amount, a payment number, a tenant,
 * a month, a time) is left out of the sentence, with no stray punctuation, so an older or hand-edited row still reads.
 */
export function toActivityEntry(item: ActivityItem, viewerEmail: string | null | undefined): ActivityEntry {
  const kind = KINDS[item.action ?? "none"];
  const amount = amountText(item.amount);
  const month = clean(item.month);
  const parts: Parts = {
    amount,
    tenant: clean(item.tenant),
    month: month === "" ? "" : formatMonthKey(month),
    count: paymentNumber(item.count),
  };
  const received = kind.showsReceived ? shortDay(clean(item.dateReceived)) : null;
  const meta = [formatTime(item.savedAt), whoText(item.loggedBy, viewerEmail), received && `received ${received}`]
    .filter(Boolean)
    .join(" · ");
  return {
    portion: clean(item.portion) === "" ? "Portion not recorded" : item.portion,
    tone: kind.tone,
    label: kind.label,
    summary: kind.sentence(parts),
    amount,
    struck: item.action === "Undone",
    meta,
  };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The day before a YYYY-MM-DD day, as YYYY-MM-DD. */
function dayBefore(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/**
 * The heading over a day's entries: "Today", "Yesterday", "Wednesday, 14 October" for an earlier day this year, and
 * "14 October 2025" for another year. `todayKey` is today's day in the app's time zone, or null when it is not known
 * (then every day is written out with its year). A key that is not a real day is Date not recorded.
 */
export function dayHeading(dayKey: string, todayKey: string | null): string {
  if (!isValidIsoDay(dayKey)) return DATE_NOT_RECORDED;
  const today = todayKey !== null && isValidIsoDay(todayKey) ? todayKey : null;
  if (today !== null) {
    if (dayKey === today) return "Today";
    if (dayKey === dayBefore(today)) return "Yesterday";
  }
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = `${day} ${monthName(month, true)}`;
  if (today === null || year !== Number(today.slice(0, 4))) return `${date} ${year}`;
  return `${WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}, ${date}`;
}

export type ActivityDay<T> = { key: string; heading: string; entries: T[] };

/**
 * The rows of the log under the day each was saved on in the app's time zone, newest day first; the rows of a day keep
 * the order they were given in (newest first). A row whose saved time cannot be read goes in a last group, Date not
 * recorded. The rows of one day share a group even when they are not next to each other (a Payments Log row that was
 * retried is added after rows saved later), so a day never has two headings.
 */
export function groupByDay<T extends { savedAt: string }>(rows: readonly T[], now: Date): ActivityDay<T>[] {
  const todayKey = Number.isNaN(now.getTime()) ? null : indiaDayKey(now.toISOString());
  const byDay = new Map<string, T[]>();
  const unreadable: T[] = [];
  for (const row of rows) {
    const key = indiaDayKey(row.savedAt);
    if (key === null) {
      unreadable.push(row);
      continue;
    }
    const day = byDay.get(key);
    if (day) day.push(row);
    else byDay.set(key, [row]);
  }
  // A day key is YYYY-MM-DD, so sorting the text sorts the days.
  const days = [...byDay.keys()].sort().reverse();
  const groups = days.map((key) => ({ key, heading: dayHeading(key, todayKey), entries: byDay.get(key) ?? [] }));
  if (unreadable.length > 0) groups.push({ key: UNKNOWN_DAY_KEY, heading: DATE_NOT_RECORDED, entries: unreadable });
  return groups;
}

export type ActivityShow = "all" | "logged" | "edited" | "undone";
export type ActivityFilters = { show: ActivityShow; portion: string | null };

const SHOWS: readonly ActivityShow[] = ["all", "logged", "edited", "undone"];

/** The log action each kind of entry stands for. */
const ACTION_OF: Record<Exclude<ActivityShow, "all">, NonNullable<ActivityItem["action"]>> = {
  logged: "Logged",
  edited: "Edited",
  undone: "Undone",
};

const firstValue = (value: string | readonly string[] | undefined) => (typeof value === "string" ? value : value?.[0]);

/**
 * The filters in an address (`?show=undone&portion=Attic`). Anything it does not know is "show everything": a kind of
 * entry that is not one of the four, a blank portion. A name given twice is the first.
 */
export function parseActivityFilters(
  searchParams: Record<string, string | readonly string[] | undefined> | undefined,
): ActivityFilters {
  const show = firstValue(searchParams?.show);
  const portion = firstValue(searchParams?.portion);
  return {
    show: SHOWS.find((candidate) => candidate === show) ?? "all",
    portion: portion === undefined || clean(portion) === "" ? null : portion,
  };
}

/** The rows the filters keep, in the order they were given. A row is kept by its portion's exact name. */
export function filterActivity<T extends Pick<ActivityItem, "action" | "portion">>(
  items: readonly T[],
  filters: ActivityFilters,
): T[] {
  const action = filters.show === "all" ? null : ACTION_OF[filters.show];
  return items.filter((row) => (action === null || row.action === action) && (filters.portion === null || row.portion === filters.portion));
}

/** Each portion name in the rows once, in the order they are first seen (the portion with the newest entry first). A blank name is left out. */
export function portionsIn(items: readonly Pick<ActivityItem, "portion">[]): string[] {
  const names = new Set<string>();
  for (const { portion } of items) if (clean(portion) !== "") names.add(portion);
  return [...names];
}

/** The address of the Activity screen with these filters, in the month the person was looking at. The defaults are left out. */
export function activityHref(filters: ActivityFilters, monthKey: string | null | undefined): string {
  const params = new URLSearchParams();
  if (filters.show !== "all") params.set("show", filters.show);
  if (filters.portion !== null && clean(filters.portion) !== "") params.set("portion", filters.portion);
  const query = params.toString();
  return withMonth(query === "" ? "/activity" : `/activity?${query}`, monthParam(monthKey));
}
