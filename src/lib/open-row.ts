/**
 * Which portion row of the month screen is open. It lives outside React so that opening a row draws the two rows that
 * change (the one that closes and the one that opens) and nothing else: a row reads it with useSyncExternalStore, and the
 * screen does not draw again. One row is open at a time.
 */
export function createOpenRowStore() {
  let open: string | null = null;
  const listeners = new Set<() => void>();
  const set = (next: string | null) => {
    if (next === open) return;
    open = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    get: () => open,
    /** Opens the row, or closes it when it is the one that is open. */
    toggle: (id: string) => set(open === id ? null : id),
    close: () => set(null),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export type OpenRowStore = ReturnType<typeof createOpenRowStore>;
