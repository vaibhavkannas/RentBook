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

/**
 * Prepare my Sheet: creates the tabs the app needs that are not there, with their headers (and Settings from the
 * Schedule's header row), the way the app does on its first page view. It is `ensureTabs`, whose rules are the
 * safety: it never reseeds Settings over existing tabs (a Settings tab missing beside the others is refused), never
 * overwrites a cell and never deletes anything. This looks at the Sheet fresh (it forgets that the tabs were checked,
 * and never reads a page cache), takes its turn among the writes, lists the tabs again to see that they are there, and
 * throws the page caches away whatever happens. `created` names the tabs it made, as the owner named them.
 */
export async function prepareSheet(ctx: SheetsContext): Promise<{ created: string[] }> {
  return withWriteLock(async () => {
    try {
      const before = await ctx.gateway.listTabs();
      resetBootstrap(ctx.gateway);
      await ensureTabs(ctx.gateway, ctx.scheduleTab);
      const after = await ctx.gateway.listTabs();
      const named = (tab: string) => (namesTabs(ctx.gateway) ? ctx.gateway.configuredTabName(tab) : tab);
      const missing = APP_TABS.filter((tab) => !after.includes(tab));
      if (missing.length > 0) {
        throw conflict(
          `Your Sheet may not be fully prepared: ${listWords(missing.map(named))} ${missing.length === 1 ? "is" : "are"} not there yet. ${reloadThen("check Set up")}`,
        );
      }
      return { created: APP_TABS.filter((tab) => !before.includes(tab)).map(named) };
    } finally {
      invalidateCaches(ctx);
    }
  });
}
