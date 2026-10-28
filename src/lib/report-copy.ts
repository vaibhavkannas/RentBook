import type { OverdueItem, OverdueMonth } from "@/lib/domain/overdue";
import { OVERDUE_GRACE_DAYS, RENT_DUE_DAY } from "@/lib/domain/rent-due";
import { formatRupees } from "@/lib/format";

/**
 * The words the overdue list, the year view and the alerts show, kept here so they can be tested. Every figure in them comes
 * from the pure rules in src/lib/domain; this file only phrases it.
 */

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const ORDINAL_ENDINGS: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };

/** 1 -> "1st", 2 -> "2nd", 6 -> "6th", 11 -> "11th", 23 -> "23rd": a day of the month. */
export function ordinalDay(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  return `${day}${teen ? "th" : (ORDINAL_ENDINGS[day % 10] ?? "th")}`;
}

// Overdue rent

/** "1 day overdue", "16 days overdue", and from 60 days "about 2 months overdue". */
export function overdueAge(days: number): string {
  if (days >= 60) return `about ${Math.round(days / 30)} months overdue`;
  return `${plural(days, "day")} overdue`;
}

/** What is owed for one month: "Unpaid: ₹ 5,450", or "Paid ₹ 5,000 of ₹ 5,450: ₹ 450 short". */
export function overdueMonthLine(month: Pick<OverdueMonth, "kind" | "expected" | "paid" | "owed">): string {
  if (month.kind === "unpaid") return `Unpaid: ${formatRupees(month.owed)}`;
  return `Paid ${formatRupees(month.paid)} of ${formatRupees(month.expected)}: ${formatRupees(month.owed)} short`;
}

/**
 * Who owes and for how many months: "Asha · 2 unpaid months", with " · 1 paid short" after it when some months were paid
 * short. When every month is a short one the unpaid part is left out ("Asha · 1 month paid short"). A tenant the Schedule
 * does not name reads "No tenant name".
 */
export function overdueSummary(item: Pick<OverdueItem, "tenant" | "unpaid" | "short">): string {
  const parts = [item.tenant.trim() === "" ? "No tenant name" : item.tenant];
  if (item.unpaid > 0) {
    parts.push(plural(item.unpaid, "unpaid month"));
    if (item.short > 0) parts.push(`${item.short} paid short`);
  } else if (item.short > 0) {
    parts.push(`${plural(item.short, "month")} paid short`);
  }
  return parts.join(" · ");
}

/** "How this is worked out" on the Overdue screen, built from the constants the rule uses. */
export const OVERDUE_RULES: readonly string[] = [
  `Rent for a month is due on the ${ordinalDay(RENT_DUE_DAY)} and counts as overdue from the ${ordinalDay(RENT_DUE_DAY + OVERDUE_GRACE_DAYS)}.`,
  "Amounts are what each month's card shows: the suggested rent for an unpaid month, or the part missing from a short one.",
  "Only the current tenant's months count. Vacant months and months paid ahead never do.",
  "A deposit is not rent and is never counted.",
];

/** Under a portion that has been overdue for a long time: a tenant who has left is not asked for rent once the move-out is recorded. */
export const MOVED_OUT_HINT = "Moved out? Record the move-out on the tenant page and the months after it stop counting.";
