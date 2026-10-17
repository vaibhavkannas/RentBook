/** A counted lock: `onLock` runs when the first holder acquires it, `onUnlock` when the last holder has released it. */
export type Lock = {
  acquire: () => void;
  /** Releasing more than was acquired does nothing. */
  release: () => void;
  readonly count: number;
};

export function createLock(onLock: () => void, onUnlock: () => void): Lock {
  let count = 0;
  return {
    acquire() {
      count += 1;
      if (count === 1) onLock();
    },
    release() {
      if (count === 0) return;
      count -= 1;
      if (count === 0) onUnlock();
    },
    get count() {
      return count;
    },
  };
}

/** The class on <html> that stops the page behind an open sheet from scrolling (see globals.css). */
export const SHEET_OPEN_CLASS = "sheet-open";

/**
 * Every open sheet holds this lock. Counted, so that when two sheets are open at once, closing one does not free the
 * page behind the other.
 */
export const sheetLock = createLock(
  () => document.documentElement.classList.add(SHEET_OPEN_CLASS),
  () => document.documentElement.classList.remove(SHEET_OPEN_CLASS),
);
