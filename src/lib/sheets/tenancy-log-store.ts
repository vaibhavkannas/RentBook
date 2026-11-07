import { TENANCY_LOG_ACTIONS, type TenancyLogAction, type TenancyLogRow } from "@/lib/domain/tenancy-log";
import { errorLogFields, logEvent } from "@/lib/server/log";
import { colLetter } from "./a1";
import { appendWithRetry } from "./append-log";
import { isBlankCell, text } from "./cells";
import type { SheetsGateway } from "./gateway";
import { headerKey } from "./headers";
import { shorten } from "./schedule";
import { addTabIfMissing } from "./tabs";
import { DEFAULT_TAB_NAMES } from "./tab-names";

/**
 * The Tenancy Log tab: the app's own record of what was changed in a tenant's details, by whom and when. One row per
 * changed field, added and never edited or deleted (see src/lib/domain/tenancy-log.ts for what a row holds). It is never
 * part of the snapshot read: the pages that show it read it on their own.
 */

export const TENANCY_LOG_TAB = DEFAULT_TAB_NAMES["tenancy-log"];

/** Columns A to H, in this order. Columns to the right of H may be added by hand and are ignored. */
export const TENANCY_LOG_HEADERS = [
  "Saved at",
  "Tenancy ID",
  "Portion",
  "Action",
  "Field",
  "Old value",
  "New value",
  "Changed by",
];

const LAST_COLUMN = colLetter(TENANCY_LOG_HEADERS.length - 1);

/** The Tenancy Log cells the app reads: the header and every row, columns A to H. */
export const TENANCY_LOG_RANGE = `A1:${LAST_COLUMN}`;

/**
 * Creates the Tenancy Log tab with its headers when it is missing, and writes the headers into a tab that is empty. Says which
 * it did ("created", "filled", or "none"). A tab whose first row holds anything is never written over, and its headers are not
 * judged here: a wrong one is told on every read (see `parseTenancyLog`), and never stops anything else. Only an empty first
 * row (columns A to H) is filled with the headers, whatever sits below it. `existingTabs` is the tab list the caller already
 * read.
 */
export async function ensureTenancyLogTab(
  gateway: SheetsGateway,
  existingTabs: string[],
): Promise<"created" | "filled" | "none"> {
  // A tab another instance added a moment ago is treated as an existing one: its header row is looked at below.
  if (!existingTabs.includes(TENANCY_LOG_TAB) && (await addTabIfMissing(gateway, TENANCY_LOG_TAB))) {
    await gateway.updateValues([{ tab: TENANCY_LOG_TAB, a1: "A1", values: [TENANCY_LOG_HEADERS] }]);
    return "created";
  }
  // A row 1 that holds anything, even a space, is not empty: it is never written over.
  const header = (await gateway.getValues(TENANCY_LOG_TAB, `A1:${LAST_COLUMN}1`, "FORMATTED_VALUE"))[0] ?? [];
  if (header.length === 0) {
    await gateway.updateValues([{ tab: TENANCY_LOG_TAB, a1: "A1", values: [TENANCY_LOG_HEADERS] }]);
    return "filled";
  }
  return "none";
}

/** One row of the tab. A value is a day or a status as text, an amount as a number, "" for none. */
export type TenancyLogItem = {
  savedAt: string;
  tenancyId: string;
  portionId: string;
  /** Null for an action this version does not know (typed by hand, or written by a later version). */
  action: TenancyLogAction | null;
  field: string;
  oldValue: string | number;
  newValue: string | number;
  changedBy: string;
};

/**
 * Compares row 1 with the eight headers, by position (capitals, spaces and invisible characters do not matter: see
 * `headerKey`). The first wrong or missing one in plain words, or null when columns A to H are right. Used by the Set up
 * check, which adds its own advice; the History's message adds the advice for it (see `parseTenancyLog`).
 */
export function tenancyLogHeaderProblem(header: unknown[]): string | null {
  for (let index = 0; index < TENANCY_LOG_HEADERS.length; index++) {
    const found = String(header[index] ?? "").trim();
    if (headerKey(found) !== headerKey(TENANCY_LOG_HEADERS[index])) {
      // The header is typed by hand: only a short stretch of it is quoted.
      const quoted = shorten(found);
      return `The Tenancy Log tab must have "${TENANCY_LOG_HEADERS[index]}" in column ${colLetter(index)} (found ${quoted === "" ? "nothing" : `"${quoted}"`}).`;
    }
  }
  return null;
}

const actionOf = (cell: unknown): TenancyLogAction | null => TENANCY_LOG_ACTIONS.find((action) => action === cell) ?? null;

/** An old or new value: an amount stays a number, anything else is its text, trimmed. */
const valueOf = (cell: unknown): string | number => (typeof cell === "number" ? cell : text(cell).trim());

/**
 * The rows of the Tenancy Log tab's raw values (what `TENANCY_LOG_RANGE` returns, unformatted), oldest first as the tab holds
 * them. Row 1 is compared with the headers on every call: a wrong one gives `problem` and no rows, so the history says it
 * cannot be shown instead of guessing from the wrong columns. Blank rows are skipped. Reads nothing itself.
 */
export function parseTenancyLog(values: unknown[][]): { items: TenancyLogItem[]; problem?: string } {
  const found = tenancyLogHeaderProblem(values[0] ?? []);
  if (found !== null) {
    return { items: [], problem: `${found} Put the headers back to see the history; saving changes still works.` };
  }
  const items: TenancyLogItem[] = [];
  values.forEach((cells, index) => {
    if (index === 0 || cells.every(isBlankCell)) return;
    items.push({
      savedAt: text(cells[0]).trim(),
      tenancyId: text(cells[1]).trim(),
      portionId: text(cells[2]).trim(),
      action: actionOf(cells[3]),
      field: text(cells[4]).trim(),
      oldValue: valueOf(cells[5]),
      newValue: valueOf(cells[6]),
      changedBy: text(cells[7]).trim(),
    });
  });
  return { items };
}

/** At most this many tries to add the rows of one save: the write already holds the lock inside a 15 second request. */
export const HISTORY_ATTEMPTS = 2;
/** No new try starts when the tries so far, plus the wait before it, would pass this many milliseconds. */
export const HISTORY_BUDGET_MS = 2_000;
/**
 * The whole of adding the history (every try and the wait between them) may take this many milliseconds; then the save goes on
 * as for any other failed append. Google's own limit per call is 10 seconds, too long here: the append runs inside the write
 * lock and inside a 15 second request, after the Tenants write has already been saved, so a slow Google could cut the request
 * off with the change saved and the person told it failed, with every other write waiting behind it.
 */
export const HISTORY_LIMIT_MS = 3_000;
/** The longest wait between two tries. */
const HISTORY_MAX_WAIT_MS = 1_000;

/**
 * Adds the rows of one save to the Tenancy Log, all in ONE append, so they go in together or not at all. True when there is
 * nothing to add or the rows are in; false when they are not known to be there. It tries a second time only after Google
 * refused for sending too many requests (see appendWithRetry), logs each failed try (`tenancy-log-append-failed`, how many rows,
 * never the rows) and NEVER throws: the history is a convenience and must not fail or undo the change it describes.
 *
 * It also never takes longer than HISTORY_LIMIT_MS: when Google has not answered by then it gives up and says false, exactly as
 * for a failed append, and the caller hands the browser a token to retry once (see retryTenancyHistory). An append that was
 * given up on may still land afterwards. The retry looks for the rows before it adds them, which settles the usual case; a retry
 * that looks in the instant between the give-up and the late landing would add the rows a second time. That tiny race is
 * accepted: the Payments Log has the same property, and a repeated row in an append-only history does no harm, where a save the
 * owner was told had failed would.
 */
export async function appendTenancyHistory(
  gateway: SheetsGateway,
  rows: readonly TenancyLogRow[],
  retryDelayMs = 400,
): Promise<boolean> {
  if (rows.length === 0) return true;
  const count = `${rows.length} ${rows.length === 1 ? "row" : "rows"}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const appending = appendWithRetry({
      append: () => gateway.appendRows(TENANCY_LOG_TAB, rows.map((row) => [...row])),
      attempts: HISTORY_ATTEMPTS,
      retryDelayMs,
      maxWaitMs: HISTORY_MAX_WAIT_MS,
      budgetMs: HISTORY_BUDGET_MS,
      event: "tenancy-log-append-failed",
      what: (attempt) => `Tenancy Log: try ${attempt} of ${HISTORY_ATTEMPTS} did not add ${count}`,
    });
    const timedOut = new Promise<"timed-out">((resolve) => {
      timer = setTimeout(() => resolve("timed-out"), HISTORY_LIMIT_MS);
    });
    const outcome = await Promise.race([appending, timedOut]);
    if (outcome !== "timed-out") return outcome;
    // The loop is left to finish on its own: it logs a failure of its own and never throws, and nothing waits for it.
    appending.catch(() => undefined);
    logEvent("error", "tenancy-log-append-failed", {
      message: `Tenancy Log: ${count} not confirmed within ${HISTORY_LIMIT_MS / 1000} seconds, so treated as not added (the append may still land).`,
    });
    return false;
  } catch (error) {
    logEvent("error", "tenancy-log-append-failed", errorLogFields(error, `Tenancy Log: the ${count} could not be added`));
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What a tenancy write says about its history: whether the rows are in the Tenancy Log, and the rows themselves. The rows
 * stay on the server: the route turns them into a signed retry token when they did not save (see retry-token.ts).
 */
export type HistoryOutcome = { historyWritten: boolean; historyRows: TenancyLogRow[] };

/**
 * Works out the rows of a save that has already been written (`build`) and adds them (see appendTenancyHistory). It never
 * throws, whatever `build` or the append does: a tenancy change that is saved stays saved. A save that changed nothing has
 * no rows, adds nothing and counts as written.
 */
export async function recordTenancyHistory(
  gateway: SheetsGateway,
  build: () => TenancyLogRow[],
  retryDelayMs = 400,
): Promise<HistoryOutcome> {
  let rows: TenancyLogRow[];
  try {
    rows = build();
  } catch (error) {
    logEvent("error", "tenancy-log-rows-failed", errorLogFields(error, "Tenancy Log: the rows of a saved change could not be worked out"));
    return { historyWritten: false, historyRows: [] };
  }
  return { historyWritten: await appendTenancyHistory(gateway, rows, retryDelayMs), historyRows: rows };
}
