import { headerKey } from "./headers";

/**
 * The names of the five tabs the app works with, and what is wrong when two of them are given the same one. A module of
 * its own, importing only the header matching, so the environment can check the names without loading the Sheet code.
 */

/**
 * The five tabs: the owner's Schedule, and the app's own Settings, Payments Log, Tenants and Tenancy Log. An app tab's key
 * is also the id of its Set up check, and `${key}-tab-name` the id of the check of the setting that renames it.
 */
export type TabKey = "schedule" | "settings" | "log" | "tenants" | "tenancy-log";

/** The four tabs the app keeps beside the owner's Schedule. */
export type AppTab = Exclude<TabKey, "schedule">;

/** The name each of the five tabs has in the owner's Sheet (SCHEDULE_TAB, SETTINGS_TAB, LOG_TAB, TENANTS_TAB, TENANCY_LOG_TAB). */
export type TabNames = Record<TabKey, string>;

/** What the four app tabs are called when the owner does not say otherwise: the names the rest of the app uses for them. */
export const DEFAULT_TAB_NAMES: Record<AppTab, string> = {
  settings: "Settings",
  log: "Payments Log",
  tenants: "Tenants",
  "tenancy-log": "Tenancy Log",
};

/** The environment variable that gives each of the app's tabs another name. */
export const TAB_VARIABLES: Record<AppTab, string> = {
  settings: "SETTINGS_TAB",
  log: "LOG_TAB",
  tenants: "TENANTS_TAB",
  "tenancy-log": "TENANCY_LOG_TAB",
};

export const APP_TABS = ["settings", "log", "tenants", "tenancy-log"] as const satisfies readonly AppTab[];

/**
 * What is wrong with the five tab names, in words, or null. Each must name a different tab (compared with
 * `headerKey`), and the Schedule may not be named like one of the app's own tabs that has been given another
 * name: the app calls that tab by its own name inside, so the two could not be told apart.
 */
export function tabNamesProblem(names: TabNames): string | null {
  const keys = (["schedule", ...APP_TABS] as const).map((key) => headerKey(names[key]));
  if (new Set(keys).size !== keys.length) {
    return "SCHEDULE_TAB, SETTINGS_TAB, LOG_TAB, TENANTS_TAB and TENANCY_LOG_TAB must each name a different tab.";
  }
  for (const key of APP_TABS) {
    if (headerKey(names.schedule) === headerKey(DEFAULT_TAB_NAMES[key])) {
      return `SCHEDULE_TAB can't be "${DEFAULT_TAB_NAMES[key]}": the app keeps that name for its own tab, even when it is stored under another name. Give your Schedule tab a different name and set SCHEDULE_TAB to it.`;
    }
  }
  return null;
}
