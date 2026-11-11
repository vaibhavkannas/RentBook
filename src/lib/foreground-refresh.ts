/**
 * Quiet refresh when the app comes back to the front. A phone puts a page to sleep when the person switches away, so the figures
 * can be old when they return. If the page was hidden for more than HIDDEN_MS it is loaded again (the caller passes router.refresh
 * in a transition, so what is on the screen stays until the new data is there), and never more than once in MIN_GAP_MS. The
 * "Updated N min ago" words follow by themselves, since they read the time the server read the Sheet. Pure apart from the
 * document it is given and the clock, so it can be tested with a fake of each.
 */

export const HIDDEN_MS = 60_000;
export const MIN_GAP_MS = 60_000;

/** The part of `document` this needs. */
export type VisibilityDocument = {
  visibilityState: DocumentVisibilityState;
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
};

/** Starts watching; returns the function that stops. */
export function watchForeground(doc: VisibilityDocument, refresh: () => void): () => void {
  let hiddenAt: number | null = null;
  let lastRefresh = Number.NEGATIVE_INFINITY;
  const onChange = () => {
    const now = Date.now();
    if (doc.visibilityState === "hidden") {
      // The first hidden event of an absence is when it started.
      hiddenAt ??= now;
      return;
    }
    const wasAway = hiddenAt === null ? 0 : now - hiddenAt;
    hiddenAt = null;
    if (wasAway > HIDDEN_MS && now - lastRefresh >= MIN_GAP_MS) {
      lastRefresh = now;
      refresh();
    }
  };
  doc.addEventListener("visibilitychange", onChange);
  return () => doc.removeEventListener("visibilitychange", onChange);
}
