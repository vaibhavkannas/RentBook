/** True when the payment after `lastCount` starts a new cycle. */
export function startsNewCycle(lastCount: number, cycleLength: number | null): boolean {
  return cycleLength !== null && lastCount >= cycleLength;
}

/** Payment number of the next payment: lastCount + 1, wrapping to 1 after a full cycle. */
export function nextCount(lastCount: number, cycleLength: number | null): number {
  return startsNewCycle(lastCount, cycleLength) ? 1 : lastCount + 1;
}

/**
 * Suggested rent for the next payment. Only a new cycle raises the rent; the
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
 * On a new cycle the owner may round the hiked rent to a figure they like (nearest 5 or 10). An
 * amount this close to the suggested hike (inclusive) counts as the new rent, not as extra or short.
 */
export const HIKE_ROUNDING_ALLOWANCE = 10;

/** True when `amount` is within the rounding allowance of the suggested hiked rent. */
export function isHikeRounding(amount: number, suggested: number): boolean {
  return Math.abs(amount - suggested) <= HIKE_ROUNDING_ALLOWANCE;
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
