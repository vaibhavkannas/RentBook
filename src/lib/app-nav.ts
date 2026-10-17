import { parseYmKey } from "@/lib/domain/year-month";

/**
 * How the tab bar and the back arrows move around the app. The history is kept as "the month screen, and one other
 * screen": a tab or an arrow that leads back to a screen the person came from goes back to it, one that leads
 * somewhere else replaces the screen it is on, and only leaving the month screen adds an entry. So the system Back
 * button returns to the month that was showing. Pure on purpose, so the rules can be tested; the components only read
 * the browser, ask these functions, and carry the answer out.
 */

/** The month of an address, as the month screen shows it: a valid YYYY-MM, or null (no month, or not one). */
export function monthParam(value: string | readonly string[] | null | undefined): string | null {
  const first = typeof value === "string" || value == null ? value : value[0];
  return first != null && parseYmKey(first) ? first : null;
}

/**
 * The path with `month=` set to the month (added, or replaced where it stands). Without a month, or with one that is
 * not a month, the path is returned as it is. The rest of the address is kept.
 */
export function withMonth(path: string, monthKey: string | null | undefined): string {
  const month = monthParam(monthKey);
  if (month === null) return path;
  const at = path.indexOf("?");
  const base = at === -1 ? path : path.slice(0, at);
  const params = new URLSearchParams(at === -1 ? "" : path.slice(at + 1));
  params.set("month", month);
  return `${base}?${params.toString()}`;
}

/** The month screen of a month: `/?month=K`, or `/` when there is no month to carry. */
export function monthScreenHref(monthKey: string | null | undefined): string {
  return withMonth("/", monthKey);
}

export type TabId = "month" | "activity" | "more";
export type Tab = { id: TabId; label: string; path: string };

export const TABS: readonly Tab[] = [
  { id: "month", label: "Month", path: "/" },
  { id: "activity", label: "Activity", path: "/activity" },
  { id: "more", label: "More", path: "/more" },
];

/** A path without a trailing slash (the root stays "/"). */
function plain(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * The tab a screen belongs to: the month screen and a tenant page are Month, Activity is Activity, More and the
 * settings page are More. Anything else (the sign-in page, a page that was not found) has none, and then no bar shows.
 */
export function tabForPath(pathname: string | null | undefined): TabId | null {
  if (!pathname) return null;
  const path = plain(pathname);
  if (path === "/" || /^\/tenants\/[^/]+$/.test(path)) return "month";
  if (path === "/activity") return "activity";
  if (path === "/more" || path === "/settings") return "more";
  return null;
}

/** The path and the month of an address, which may be a whole URL or only a path with its query. */
function parts(url: string): { path: string; month: string | null } {
  const parsed = new URL(url, "http://localhost");
  return { path: plain(parsed.pathname), month: monthParam(parsed.searchParams.get("month")) };
}

/** The path of an address (a whole URL, or a path with its query), without a trailing slash. */
export function hrefPath(url: string): string {
  return parts(url).path;
}

export type NavAction = "none" | "back" | "push" | "replace";

/**
 * What a tap on a tab or a back arrow does.
 *  - none: the person is already on the target's root, so there is nowhere to go.
 *  - back: the previous history entry is that root, in the same month, so going back is the same trip and shows the
 *    month that was showing.
 *  - push: the person leaves the month screen, so Back can return to it.
 *  - replace: anything else, so the history stays "the month screen, and one other screen". It is also what happens
 *    where the previous entry cannot be read (`previousUrl` is null), and it goes to the address that carries the month.
 *
 * `to` is the address the link leads to, with its month. `previousUrl` is the address of the entry before this one.
 * The app leaves the current month out of an address, so when `currentKey` is given an address with that month and one
 * with none are the same month.
 */
export function navAction(args: {
  fromPath: string;
  to: string;
  previousUrl: string | null;
  currentKey?: string | null;
}): NavAction {
  const target = parts(args.to);
  if (plain(args.fromPath) === target.path) return "none";
  if (args.previousUrl !== null) {
    const previous = parts(args.previousUrl);
    const same = (a: string | null, b: string | null) =>
      (a === args.currentKey ? null : a) === (b === args.currentKey ? null : b);
    if (previous.path === target.path && same(previous.month, target.month)) return "back";
  }
  return plain(args.fromPath) === "/" ? "push" : "replace";
}

/** The part of the Navigation API that is read. The type is not in the DOM library this project builds with. */
export type NavigationLike = {
  currentEntry?: { index: number } | null;
  entries?: () => ArrayLike<{ url?: string | null }>;
};

/**
 * The address of the history entry before this one, from the Navigation API (`window.navigation`), or null where
 * there is none: a browser without the API, the first entry, or anything that throws.
 */
export function previousEntryUrl(navigation: NavigationLike | null | undefined): string | null {
  try {
    const index = navigation?.currentEntry?.index;
    if (typeof index !== "number" || index < 1) return null;
    return navigation?.entries?.()[index - 1]?.url ?? null;
  } catch {
    return null;
  }
}
