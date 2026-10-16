/**
 * The end of the line of writes waiting for their turn. A write starts only after the one before it has
 * finished, whether that one succeeded or threw, so the line never gets stuck.
 */
let tail: Promise<unknown> = Promise.resolve();

/**
 * Runs `run` once every write asked for before it has finished: one at a time, first come first served.
 *
 * This keeps the writes of one server process from interleaving (two people logging the first payment of
 * a new month would otherwise each read the Sheet, each clone the month row, and the second clone would
 * wipe the first payment). It does nothing for a second server process, or for a person typing in the
 * Sheet itself; the checks inside the writes (the row re-read before a clone, the read-back after a
 * write) are what notice those.
 */
export function withWriteLock<T>(run: () => Promise<T>): Promise<T> {
  const result = tail.then(run);
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
