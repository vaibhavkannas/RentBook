/** True when the payment after `lastCount` starts a new cycle. */
export function startsNewCycle(lastCount: number, cycleLength: number | null): boolean {
  return cycleLength !== null && lastCount >= cycleLength;
}

/** Payment number of the next payment: lastCount + 1, wrapping to 1 after a full cycle. */
export function nextCount(lastCount: number, cycleLength: number | null): number {
  return startsNewCycle(lastCount, cycleLength) ? 1 : lastCount + 1;
}

/**
 * Suggested rent for the next payment, worked from `previousAmount`: the portion's true rent (the first payment of its cycle),
 * or the last payment's amount for a portion whose count never resets. Only a new cycle raises the rent; the
 * result is a whole rupee (halves round up) and the owner can always edit it before saving.
 *
 * The hike is taken in whole basis points (hundredths of a percent) and worked out with whole numbers,
 * because with fractions a half rupee can land just below the half: 20500 at 0.1% is exactly 20520.5,
 * which floating point turns into 20520.4999... and rounds down.
 */
export function suggestAmount(
  previousAmount: number,
  hikePercent: number,
  newCycle: boolean,
): number {
  if (!newCycle) return previousAmount;
  const basisPoints = Math.round(hikePercent * 100);
  return Math.floor((previousAmount * (10_000 + basisPoints) + 5_000) / 10_000);
}

/**
 * How far, in percent of the suggested rent, the first payment of a new cycle may be before the log sheet asks the owner to
 * confirm it: that payment becomes the rent of the whole cycle, so a slip would last the cycle. A rounded hike is well within.
 */
export const HIKE_CONFIRM_PERCENT = 5;

/** True when `amount` is more than HIKE_CONFIRM_PERCENT of `suggested` away from it, either side. */
export function farFromSuggestion(amount: number, suggested: number): boolean {
  return Math.abs(amount - suggested) * 100 > suggested * HIKE_CONFIRM_PERCENT;
}

/**
 * Suggested hiked rent rounded to the nearest 5 and to the nearest 10 (halves round up), left out
 * when equal to the suggestion itself or to each other. Lowest first.
 */
export function roundedChoices(suggested: number): number[] {
  const choices = [5, 10].map((step) => Math.round(suggested / step) * step);
  return [...new Set(choices)].filter((value) => value !== suggested).sort((a, b) => a - b);
}

export function sumAmounts(amounts: Array<number | null | undefined>): number {
  return amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
}
