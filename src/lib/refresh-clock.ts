/**
 * A logical clock for the month screen's loads and writes, so that a load which was asked for BEFORE a write was confirmed can
 * never undo it. Every load the screen asks for takes the next number when it starts; a confirmed write takes the next number
 * when it is confirmed. Loads are answered in the order they were asked for, so the number of the oldest load still waiting is
 * the one that arrives. A load whose number is lower than the write's cannot contain the write.
 *
 * A load the screen did not ask for (the back refresh, a navigation) arrives with nothing waiting: it is not counted, so it
 * cannot end a change early. A load that was dropped (a later one replaced it) makes a newer one look older, which only keeps a
 * change a little longer; the cap in optimistic.ts ends that.
 */
export type ClockState = { arrivedSeq: number; now: number };

export function createRefreshClock(now: () => number = Date.now) {
  let counter = 0;
  const waiting: number[] = [];
  let state: ClockState = { arrivedSeq: 0, now: now() };
  const listeners = new Set<() => void>();
  const set = (next: ClockState) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    /** A load is about to be asked for. */
    startLoad(): number {
      counter += 1;
      waiting.push(counter);
      return counter;
    },
    /** A write was confirmed by the server. */
    confirmWrite(): number {
      counter += 1;
      return counter;
    },
    /** New data arrived from the server. */
    arrive() {
      const seq = waiting.shift();
      if (seq === undefined) return;
      set({ arrivedSeq: Math.max(state.arrivedSeq, seq), now: now() });
    },
    /** Time passed (the cap): tells the screen to look again. */
    poke() {
      set({ ...state, now: now() });
    },
    now,
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export type RefreshClock = ReturnType<typeof createRefreshClock>;
