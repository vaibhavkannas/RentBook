import { withMonth } from "@/lib/app-nav";
import { AGREEMENT_NOTICE_DAYS, HIKE_NOTICE_MONTHS, type AgreementAlert, type HikeAlert } from "@/lib/domain/alerts";
import { overdueTotals, type OverdueItem, type OverdueMonth } from "@/lib/domain/overdue";
import { OVERDUE_GRACE_DAYS, RENT_DUE_DAY } from "@/lib/domain/rent-due";
import type { YearMonth } from "@/lib/domain/types";
import type { YearCell, YearCellState } from "@/lib/domain/year-view";
import { formatDay, formatMonthTitle, formatRupees } from "@/lib/format";
import type { PillTone } from "@/lib/ui-classes";

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

/** "4 portions · counted up to October 2026": under the total on the Overdue screen. */
export function overdueCountLine(portions: number, upTo: YearMonth): string {
  return `${plural(portions, "portion")} · counted up to ${formatMonthTitle(upTo)}`;
}

/** What the Overdue screen says when no portion owes anything. */
export function nothingOverdueText(upTo: YearMonth): string {
  return `Every let portion has paid in full up to ${formatMonthTitle(upTo)}.`;
}

/** Above the Overdue list when the Tenants tab cannot be read: without it a tenant who moved out is not known to have left. */
export const TENANTS_PROBLEM_NOTICE = (problem: string) =>
  `The Tenants tab can't be read, so tenants who moved out may show here. ${problem}`;

/** How many months a portion's card lists on the Overdue screen; older ones are only counted. */
export const OVERDUE_MONTHS_SHOWN = 12;

/** The months a portion's card lists, newest first (`months` is oldest first), and how many older ones are left out. */
export function overdueMonthsShown<T>(months: readonly T[]): { shown: T[]; earlier: number } {
  const newestFirst = [...months].reverse();
  return { shown: newestFirst.slice(0, OVERDUE_MONTHS_SHOWN), earlier: Math.max(0, newestFirst.length - OVERDUE_MONTHS_SHOWN) };
}

/** "and 4 earlier months": after the 12 newest months of a portion that has been behind for longer. */
export const earlierMonthsText = (count: number) => `and ${plural(count, "earlier month")}`;

/** The hint about a move-out comes when a portion's oldest overdue month is more than this many months before this month. */
const MOVED_OUT_HINT_MONTHS = 3;

/** Whether a portion's card carries `MOVED_OUT_HINT`: its oldest overdue month is more than 3 months before `thisMonth`. */
export function showMovedOutHint(oldest: YearMonth, thisMonth: YearMonth): boolean {
  return thisMonth.year * 12 + thisMonth.month - (oldest.year * 12 + oldest.month) > MOVED_OUT_HINT_MONTHS;
}

// Year at a glance

/** The Year screen's title when a year has nothing in it. */
export const yearEmptyTitle = (year: number) => `Nothing recorded for ${year}`;

/** Under it: where the Schedule starts, or that it has no months yet. */
export function yearEmptyText(firstMonth: YearMonth | null): string {
  return firstMonth === null ? "Your Schedule has no months yet." : `Your Schedule starts in ${formatMonthTitle(firstMonth)}.`;
}

/** Above the year when the Tenants tab cannot be read: without it a month after a move-out cannot be told from an unpaid one. */
export const YEAR_TENANTS_PROBLEM_NOTICE = (problem: string) =>
  `The Tenants tab can't be read, so months after a move-out may show as unpaid. ${problem}`;

/**
 * What a screen reader says for one cell of the year view: "January 2026, First floor: paid ₹ 5,450". A cell shows a glyph
 * and a short month name, so this is its full name.
 */
export function yearCellLabel(cell: Pick<YearCell, "month" | "state" | "received" | "due">, portionName: string): string {
  const where = `${formatMonthTitle(cell.month)}, ${portionName}`;
  switch (cell.state) {
    case "paid":
      return `${where}: paid ${formatRupees(cell.received)}`;
    case "partial":
      return `${where}: part paid ${formatRupees(cell.received)} of ${formatRupees(cell.due)}`;
    case "unpaid":
      return `${where}: unpaid, ${formatRupees(cell.due)} due`;
    case "vacant":
      return `${where}: vacant`;
    case "upcoming":
      return `${where}: not due yet`;
    case "none":
      return `${where}: no record`;
  }
}

/**
 * The key to the year view: a glyph and a word for each state a cell can show, so a state is never told by colour alone. A
 * month with no record (`none`) is a plain dash with no key.
 */
export const YEAR_LEGEND: ReadonlyArray<{ state: Exclude<YearCellState, "none">; glyph: string; label: string }> = [
  { state: "paid", glyph: "✓", label: "Paid" },
  { state: "partial", glyph: "½", label: "Part paid" },
  { state: "unpaid", glyph: "!", label: "Unpaid" },
  { state: "vacant", glyph: "–", label: "Vacant" },
  { state: "upcoming", glyph: "·", label: "Not due yet" },
];

// Agreements and hikes

/** "Agreement ended 12 days ago, on 5 Oct 2026.", "Agreement ends today.", "Agreement ends in 45 days, on 1 Dec 2026." */
export function agreementSentence(alert: Pick<AgreementAlert, "state" | "days" | "agreementEnd">): string {
  switch (alert.state) {
    case "ended":
      return `Agreement ended ${plural(-alert.days, "day")} ago, on ${formatDay(alert.agreementEnd)}.`;
    case "today":
      return "Agreement ends today.";
    case "soon":
      return `Agreement ends in ${plural(alert.days, "day")}, on ${formatDay(alert.agreementEnd)}.`;
  }
}

/** Under an ended agreement: what to do when the tenant stayed on. */
export const AGREEMENT_HINT = "Renewed? Change the agreement end in Details. Moved out? Record the move-out there.";

/**
 * What a rent hike is, and when: "Rent goes up 5% with the next payment (October 2026): ₹ 12,700 to ₹ 13,335." When payments
 * come first it says after how many ("from the payment for December 2026, after 2 more payments"). It goes by the payments
 * left, not by the alert's state, so a hike that is soon but for the very next payment (paid ahead) does not say "after 0".
 */
export function hikeSentence(
  alert: Pick<HikeAlert, "hikePercent" | "hikeMonth" | "paymentsLeft" | "currentRent" | "newRent">,
): string {
  const rents = `${formatRupees(alert.currentRent)} to ${formatRupees(alert.newRent)}`;
  const month = formatMonthTitle(alert.hikeMonth);
  const when =
    alert.paymentsLeft === 0
      ? `with the next payment (${month})`
      : `from the payment for ${month}, after ${plural(alert.paymentsLeft, "more payment")}`;
  return `Rent goes up ${alert.hikePercent}% ${when}: ${rents}.`;
}

/** The pill on an agreement's card: Ended (danger), Ends today, or the days left (both warn). */
export function agreementPill(alert: Pick<AgreementAlert, "state" | "days" | "agreementEnd">): { tone: PillTone; label: string } {
  switch (alert.state) {
    case "ended":
      return { tone: "danger", label: "Ended" };
    case "today":
      return { tone: "warn", label: "Ends today" };
    case "soon":
      return { tone: "warn", label: `${plural(alert.days, "day")} left` };
  }
}

/** The pill on a hike's card: Next payment (warn) when it is due, else the month it comes (neutral). */
export function hikePill(alert: Pick<HikeAlert, "state" | "hikeMonth">): { tone: PillTone; label: string } {
  return alert.state === "due"
    ? { tone: "warn", label: "Next payment" }
    : { tone: "neutral", label: formatMonthTitle(alert.hikeMonth) };
}

/** What each section of the Agreements and hikes screen says when it has nothing, from the constants that decide it. */
export const NO_AGREEMENTS_TEXT = `No agreement ends in the next ${AGREEMENT_NOTICE_DAYS} days.`;
export const NO_HIKES_TEXT = `No rent hike in the next ${HIKE_NOTICE_MONTHS} months.`;

/** Under both sections: where the hike comes from, and that nothing is sent. */
export const ALERTS_FOOTNOTE =
  "A hike comes with the first payment of a new cycle (see Portion settings). The app sends no reminders: check here.";

/** In place of the agreements when the Tenants tab cannot be read: without it no agreement is known, so none can be said to be far off. */
export const ALERTS_TENANTS_PROBLEM_NOTICE = (problem: string) => `The Tenants tab can't be read, so agreements can't be checked. ${problem}`;

// The home screen's "Needs attention" card

export type AttentionTone = "danger" | "warn" | "neutral";
export type AttentionItem = { href: string; text: string; tone: AttentionTone };

/**
 * The rows of the home screen's "Needs attention" card, most pressing first, each with the screen it leads to (carrying the
 * month on show, so the way back returns to it). Empty when nothing is due. An agreement that ends today is counted with the
 * ones ending within the notice period.
 */
export function attentionItems(input: {
  overdue: ReadonlyArray<Pick<OverdueItem, "owed">>;
  agreements: ReadonlyArray<Pick<AgreementAlert, "state">>;
  hikes: readonly unknown[];
  monthKey: string | null;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const alertsHref = withMonth("/alerts", input.monthKey);

  if (input.overdue.length > 0) {
    const totals = overdueTotals(input.overdue);
    items.push({
      href: withMonth("/overdue", input.monthKey),
      text: `Rent overdue: ${plural(totals.portions, "portion")}, ${formatRupees(totals.owed)}`,
      tone: "danger",
    });
  }

  const ended = input.agreements.filter((a) => a.state === "ended").length;
  if (ended > 0) items.push({ href: alertsHref, text: `${plural(ended, "agreement")} ended`, tone: "danger" });
  const ending = input.agreements.length - ended;
  if (ending > 0) {
    const verb = ending === 1 ? "ends" : "end";
    items.push({ href: alertsHref, text: `${plural(ending, "agreement")} ${verb} within ${AGREEMENT_NOTICE_DAYS} days`, tone: "warn" });
  }

  if (input.hikes.length > 0) {
    items.push({ href: `${alertsHref}#hikes`, text: `Rent goes up soon for ${plural(input.hikes.length, "portion")}`, tone: "neutral" });
  }
  return items;
}
