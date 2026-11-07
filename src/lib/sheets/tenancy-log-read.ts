import { AppError, CONNECTION_NEEDS_ATTENTION } from "@/lib/errors";
import { errorLogFields, logEvent } from "@/lib/server/log";
import type { SheetsContext } from "./service";
import { ensureTabs } from "./settings-store";
import { parseTenancyLog, TENANCY_LOG_RANGE, TENANCY_LOG_TAB, type TenancyLogItem } from "./tenancy-log-store";

/**
 * Reading the Tenancy Log for the tenant page's History. It is never part of the snapshot (one read of the Schedule, Settings
 * and Tenants for every page): the page that shows it reads the tab on its own, and the context keeps that read for 15 seconds
 * like the others (`tenancyLogCache`, thrown away by every write).
 *
 * It sits beside the store and not in it because it needs `ensureTabs`, and settings-store.ts imports the store to put the tab
 * back: the store importing it would be a circle.
 */

/** The rows of the tab, oldest first as it holds them, or what is wrong with its headers (then no rows). */
export type TenancyLogRead = { items: TenancyLogItem[]; problem?: string };

/** Looks that the tabs exist, then reads columns A to H of the Tenancy Log in one call. Every row of every portion, never cut. */
export async function loadTenancyLog(ctx: SheetsContext): Promise<TenancyLogRead> {
  await ensureTabs(ctx.gateway, ctx.scheduleTab);
  return parseTenancyLog(await ctx.gateway.getValues(TENANCY_LOG_TAB, TENANCY_LOG_RANGE, "UNFORMATTED_VALUE"));
}

/** What a person is told when the log could not be read for a reason that is not theirs to fix. */
export const HISTORY_READ_FAILED = "Couldn't read the Tenancy Log. Try again in a minute.";

/** The reason a read failed, for the page: what Google said when it is something a person can act on, else a plain sentence. */
function readProblem(error: unknown): string {
  if (!(error instanceof AppError)) return HISTORY_READ_FAILED;
  // The detail of a connection problem is for the owner and the server log (see problemMessage).
  return error.code === "config" ? CONNECTION_NEEDS_ATTENTION : error.message;
}

/**
 * The Tenancy Log rows of one portion (its id, as the Tenants tab has it), newest first, for the History section. A header
 * that is wrong, or a read that fails, gives no rows and `problem` in words: the History says it cannot be shown and the rest of
 * the page goes on, so this never throws. A failed read is logged (`tenancy-log-read-failed`, no value from the tab) and is not
 * kept. `minFetchedAt` (ms since epoch) rejects a cached copy read before that time, so a person sees their own save.
 */
export async function readTenancyHistory(
  ctx: SheetsContext,
  portionId: string,
  options: { minFetchedAt?: number } = {},
): Promise<TenancyLogRead> {
  try {
    const log = ctx.tenancyLogCache ? await ctx.tenancyLogCache.get(options.minFetchedAt) : await loadTenancyLog(ctx);
    if (log.problem !== undefined) return { items: [], problem: log.problem };
    // `filter` makes a new list, so reversing it leaves the cached rows as they are.
    return { items: log.items.filter((item) => item.portionId === portionId).reverse() };
  } catch (error) {
    logEvent("error", "tenancy-log-read-failed", errorLogFields(error, "The Tenancy Log could not be read for the History"));
    return { items: [], problem: readProblem(error) };
  }
}
