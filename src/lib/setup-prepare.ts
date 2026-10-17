import { listWords, stepStatus, type Check } from "@/lib/setup-checks";
import { DEFAULT_TAB_NAMES } from "@/lib/sheets/named-tabs";
import type { SheetFacts } from "@/lib/sheets/sheet-checks";
import { DEFAULT_CYCLE_LENGTH, DEFAULT_HIKE_PERCENT } from "@/lib/sheets/settings-store";

/** What Prepare my Sheet is offered to do: the tabs, as the owner names them, and the sentences that say so. */
export type PrepareOffer = { tabs: string[]; lines: string[] };

type AppTab = "settings" | "log" | "tenants";

const VARIABLE: Record<AppTab, string> = { settings: "SETTINGS_TAB", log: "LOG_TAB", tenants: "TENANTS_TAB" };

/** The checks of the app's three tabs, which say they are to do when the tab is missing or has nothing in it. */
const APP_TAB_CHECKS: AppTab[] = ["settings", "log", "tenants"];

/**
 * What the Prepare my Sheet card says, or null when it is not offered. It is offered when one of the app's tabs is still to
 * do and nothing before it is failing (the service account, the Sheet, the Schedule tab: Prepare cannot work round those).
 * A warning does not hold it back. The words are about what it adds, and for a tab the owner named, to rename an old tab
 * first: a name that is not in the Sheet yet makes a new tab, and the old one is left alone.
 */
export function prepareOffer(
  checks: readonly Check[],
  facts: Pick<SheetFacts, "seedPortions"> | null,
  appTabNames: Partial<Record<AppTab, string>> = {},
): PrepareOffer | null {
  if (([2, 3, 4] as const).some((step) => stepStatus(checks, step) === "fail")) return null;
  const todo = APP_TAB_CHECKS.filter((id) => checks.some((check) => check.id === id && check.status === "todo"));
  if (todo.length === 0) return null;

  const names = todo.map((id) => appTabNames[id] ?? DEFAULT_TAB_NAMES[id]);
  const one = todo.length === 1;
  const lines = [
    `Adds the missing ${one ? "tab" : "tabs"} (${listWords(names)}) with ${one ? "its" : "their"} headers. Nothing already in your Sheet is changed.`,
  ];
  const seed = facts?.seedPortions ?? null;
  if (todo.includes("settings") && seed !== null) {
    lines.push(
      seed === 1
        ? `Settings starts with 1 portion from your Schedule header, with ${DEFAULT_CYCLE_LENGTH} payments per cycle and a ${DEFAULT_HIKE_PERCENT}% hike. Check it in Portion settings before the first payment.`
        : `Settings starts with ${seed} portions from your Schedule header, each with ${DEFAULT_CYCLE_LENGTH} payments per cycle and a ${DEFAULT_HIKE_PERCENT}% hike. Check them in Portion settings before the first payment.`,
    );
  }
  const named = todo.filter((id) => appTabNames[id] !== undefined && appTabNames[id] !== DEFAULT_TAB_NAMES[id]);
  if (named.length > 0) {
    const single = named.length === 1;
    lines.push(
      `You gave ${listWords(named.map((id) => VARIABLE[id]))} a name that is not in your Sheet yet. If you already have ${single ? "that tab" : "those tabs"} under ${single ? "another name" : "other names"}, rename ${single ? "it" : "them"} in your Sheet first, then use Check again: Prepare my Sheet would start ${single ? "a new, empty one" : "new, empty ones"} and leave your old ${single ? "tab" : "tabs"} alone.`,
    );
  }
  return { tabs: names, lines };
}
