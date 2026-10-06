export type SnapshotCache<T> = {
  /** `minFetchedAt` (ms since epoch) rejects any value whose load began before that time. */
  get(minFetchedAt?: number): Promise<T>;
  invalidate(): void;
};

export function createSnapshotCache<T>(
  load: () => Promise<T>,
  ttlMs: number,
  now: () => number = Date.now,
): SnapshotCache<T> {
  let entry: { value: T; startedAt: number } | null = null;
  let inflight: { promise: Promise<T>; startedAt: number } | null = null;
  let generation = 0;

  return {
    async get(minFetchedAt = 0) {
      const t = now();
      if (entry && t - entry.startedAt < ttlMs && entry.startedAt >= minFetchedAt) return entry.value;
      if (inflight && inflight.startedAt >= minFetchedAt) return inflight.promise;

      const startedAt = t;
      const startedGeneration = generation;
      const promise: Promise<T> = load()
        .then((value) => {
          if (startedGeneration === generation) entry = { value, startedAt };
          return value;
        })
        .finally(() => {
          if (inflight?.promise === promise) inflight = null;
        });
      inflight = { promise, startedAt };
      return promise;
    },
    invalidate() {
      generation += 1;
      entry = null;
      inflight = null;
    },
  };
}
