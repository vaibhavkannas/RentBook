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
 * result is a whole rupee and the owner can always edit it before saving.
 */
export function suggestAmount(
  previousAmount: number,
  hikePercent: number,
  newCycle: boolean,
): number {
  if (!newCycle) return previousAmount;
  return Math.round((previousAmount * (100 + hikePercent)) / 100);
}

export function sumAmounts(amounts: Array<number | null | undefined>): number {
  return amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
}
