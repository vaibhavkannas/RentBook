import { conflict } from "@/lib/errors";
import { reloadThen } from "@/lib/recovery-hint";
import { listWords } from "@/lib/setup-checks";
import { namesTabs } from "./gateway";
import { invalidateCaches, type SheetsContext } from "./service";
import { ensureTabs, LOG_TAB, resetBootstrap, SETTINGS_TAB } from "./settings-store";
import { TENANTS_TAB } from "./tenants-store";
import { withWriteLock } from "./write-lock";

/** The tabs the app keeps beside the owner's Schedule, by the names the app calls them. */
const APP_TABS = [SETTINGS_TAB, LOG_TAB, TENANTS_TAB];

/** What Prepare my Sheet did, by the names the owner gave the tabs: the tabs it made, and the tabs that were there but empty (or had blank header cells) that it filled in. */
export type PrepareResult = { created: string[]; filled: string[] };

/**
 * Prepare my Sheet: creates the tabs the app needs that are not there, with their headers (and Settings from the
 * Schedule's header row), and fills in a tab that is there but empty and the blank header cells of a Payments Log, the
 * way the app does on its first page view. It is `ensureTabs`, whose rules are the safety: it never reseeds Settings over
 * existing tabs (a Settings tab missing beside the others is refused), never writes into a cell that holds anything
 * (a header row of only spaces is left alone) and never deletes anything. This looks at the Sheet fresh (it forgets that
 * the tabs were checked, and never reads a page cache), takes its turn among the writes, lists the tabs again to see that
 * they are there, and throws the page caches away whatever happens. `created` and `filled` say what was done.
 */
export async function prepareSheet(ctx: SheetsContext): Promise<PrepareResult> {
  return withWriteLock(async () => {
    try {
      resetBootstrap(ctx.gateway);
      const report = await ensureTabs(ctx.gateway, ctx.scheduleTab);
      const after = await ctx.gateway.listTabs();
      const named = (tab: string) => (namesTabs(ctx.gateway) ? ctx.gateway.configuredTabName(tab) : tab);
      const missing = APP_TABS.filter((tab) => !after.includes(tab));
      if (missing.length > 0) {
        throw conflict(
          `Your Sheet may not be fully prepared: ${listWords(missing.map(named))} ${missing.length === 1 ? "is" : "are"} not there yet. ${reloadThen("check Set up")}`,
        );
      }
      // In the order the tabs are kept in, as the owner names them.
      const said = (done: string[]) => APP_TABS.filter((tab) => done.includes(tab)).map(named);
      return { created: said(report.created), filled: said(report.filled) };
    } finally {
      invalidateCaches(ctx);
    }
  });
}
