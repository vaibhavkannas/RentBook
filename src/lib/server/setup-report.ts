import "server-only";
import { AppError } from "@/lib/errors";
import { waitingChecks, checkSheet, type SheetFacts } from "@/lib/sheets/sheet-checks";
import { NamedTabsGateway } from "@/lib/sheets/named-tabs";
import type { TabKey } from "@/lib/sheets/tab-names";
import type { SheetsContext } from "@/lib/sheets/service";
import type { Check } from "@/lib/setup-checks";
import { readEnv, type AppEnv } from "./env";
import { errorLogFields, logEvent } from "./log";
import { envChecks } from "./setup-env";

/** What the Set up page and Diagnostics both show: every check, the counts and times, and the names the owner gave the tabs. */
export type SetupReport = {
  checks: Check[];
  /** Null when the Sheet could not be looked at (the settings are wrong). */
  facts: SheetFacts | null;
  /** The names the app's own tabs have in the Sheet (the usual ones where the owner gave none); null when the settings cannot be read. */
  appTabNames: { settings: string; log: string; tenants: string } | null;
  /** The title each tab has in the Sheet, when the tabs were listed through the tab wrapper; null otherwise. */
  realTitles: Record<TabKey, string | null> | null;
};

/** What the Sheet's checks say when the settings are too wrong to open the Sheet at all. */
export const FIX_SETTINGS_FIRST = "Fix the settings above first.";

const tabNamesOf = (env: AppEnv) => ({ settings: env.settingsTab, log: env.logTab, tenants: env.tenantsTab });

/**
 * Runs every check: the environment first (nothing is read for it), then the Sheet (read only, see checkSheet). When the
 * settings cannot make a connection (`getContext` or `readEnv` refuses) the Sheet's checks wait, and the environment's say
 * what is wrong. `getContext` is the app's shared Sheets context; the page passes it in, so it is the page that uses the Sheet.
 */
export async function setupReport(rawEnv: Record<string, string | undefined>, getContext: () => SheetsContext): Promise<SetupReport> {
  const env = envChecks(rawEnv);
  let app: AppEnv | null = null;
  let ctx: SheetsContext | null = null;
  try {
    app = readEnv(rawEnv);
    ctx = getContext();
  } catch (error) {
    // A config error is what the environment's checks already say. Anything else is ours to log.
    if (!(error instanceof AppError)) {
      logEvent("error", "setup-context-failed", errorLogFields(error, "The Set up check could not start the connection"));
    }
  }
  if (app === null || ctx === null) {
    return { checks: [...env, ...waitingChecks(FIX_SETTINGS_FIRST)], facts: null, appTabNames: app === null ? null : tabNamesOf(app), realTitles: null };
  }
  const gateway = ctx.gateway;
  const appTabNames = tabNamesOf(app);
  let realTitles: Record<TabKey, string | null> | null = null;
  const sheet = await checkSheet(gateway, {
    scheduleTab: ctx.scheduleTab,
    totalHeader: ctx.totalHeader,
    appTabNames,
    realTitles: gateway instanceof NamedTabsGateway ? () => (realTitles = gateway.knownTitles()) : undefined,
  });
  return { checks: [...env, ...sheet.checks], facts: sheet.facts, appTabNames, realTitles };
}
