import { formatRupees } from "@/lib/format";

export type DifferenceTone = "more" | "less";

/**
 * How an amount received compares with the rent, in plain words that name no one: "₹ 30 more than
 * rent" or "₹ 1 less than rent". The amount is rounded to a whole rupee like every amount on the
 * page; null when that leaves nothing to say (equal, or not a number).
 */
export function describeDifference(difference: number): { tone: DifferenceTone; text: string } | null {
  if (!Number.isFinite(difference)) return null;
  const whole = Math.round(difference);
  if (whole === 0) return null;
  return whole > 0
    ? { tone: "more", text: `${formatRupees(whole)} more than rent` }
    : { tone: "less", text: `${formatRupees(-whole)} less than rent` };
}

/**
 * The line under a paid card's amount: the difference and, in brackets, the rent it is measured
 * against ("₹ 30 more than rent (₹ 6,330)"). Null when there is nothing to say.
 */
export function cardDifferenceText(difference: number | null, reference: number | null): string | null {
  if (difference === null) return null;
  const described = describeDifference(difference);
  if (!described) return null;
  return reference === null ? described.text : `${described.text} (${formatRupees(reference)})`;
}

/** How full the month's progress bar is: received as a share of the rent due, never above 100. */
export function progressPercent(received: number, due: number): number {
  if (!(due > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((received / due) * 100)));
}
