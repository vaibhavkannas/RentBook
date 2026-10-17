import { hrefPath } from "@/lib/app-nav";

/**
 * Going back in the history shows the screen the browser kept, however old it is, so a month someone else has changed
 * since (another person, another phone, the Sheet itself) looks as it did. After a tap that goes back, the screen it
 * lands on is loaded again, once: the history stays as short as it was, and the screen shows what the Sheet holds.
 * The decision is here so it can be tested; BackRefresh (src/components/BackRefresh.tsx) carries it out.
 */

/** How long a back that was asked for may take to arrive. */
export const BACK_REFRESH_MAX_AGE_MS = 10_000;

/** The screen a tap that goes back is heading for, and when the tap was. */
export type BackTarget = { path: string; at: number } | null;

/**
 *  - none: no back was asked for.
 *  - refresh: the screen the back was heading for is showing.
 *  - skip: that screen is showing but the device is offline, so loading it again is not worth it: the router would fall
 *    back to a full browser navigation and the person would land on the browser's own error page. Forget the wish.
 *  - wait: another screen is showing, the traversal has not arrived.
 *  - drop: the back never arrived (it is older than BACK_REFRESH_MAX_AGE_MS), so forget it.
 */
export type BackRefreshStep = "none" | "wait" | "refresh" | "skip" | "drop";

export function backRefreshStep(target: BackTarget, pathname: string, now: number, online = true): BackRefreshStep {
  if (target === null) return "none";
  if (now - target.at > BACK_REFRESH_MAX_AGE_MS) return "drop";
  if (hrefPath(pathname) !== target.path) return "wait";
  return online ? "refresh" : "skip";
}

let target: BackTarget = null;

/** A tap is about to go back to `href`: remember the screen, so it is loaded again when it shows. */
export function expectBack(href: string, now: number = Date.now()): void {
  target = { path: hrefPath(href), at: now };
}

/**
 * Asked each time the screen changes. True once, when the screen a tap went back to is showing and the device is
 * online; the wish is spent then (offline too), so the refresh it causes cannot cause another. A wish that is too old
 * is forgotten.
 */
export function takeBackRefresh(pathname: string, now: number = Date.now(), online = true): boolean {
  const step = backRefreshStep(target, pathname, now, online);
  if (step === "refresh" || step === "skip" || step === "drop") target = null;
  return step === "refresh";
}
