/**
 * The sheet that is open is told apart by a nonce. A sheet closes only itself: a late answer of a sheet that was let go must
 * never close the sheet that is open now, with whatever the person has typed in it.
 */
export function closeIfCurrent<T extends { nonce: number }>(active: T | null, nonce: number): T | null {
  return active && active.nonce === nonce ? null : active;
}
