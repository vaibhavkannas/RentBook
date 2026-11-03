import { TENANCY_LOG_ACTIONS, type TenancyLogAction } from "@/lib/domain/tenancy-log";
import { colLetter } from "./a1";
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
 * it did ("created", "filled", or "none"). A tab with anything in it is never touched, and its headers are not judged here: a
 * wrong one is told on every read (see `parseTenancyLog`), and never stops anything else. `existingTabs` is the tab list the
 * caller already read.
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
 * `headerKey`). The first wrong or missing one in plain words, or null when columns A to H are right.
 */
function headerProblem(header: unknown[]): string | null {
  for (let index = 0; index < TENANCY_LOG_HEADERS.length; index++) {
    const found = String(header[index] ?? "").trim();
    if (headerKey(found) !== headerKey(TENANCY_LOG_HEADERS[index])) {
      // The header is typed by hand: only a short stretch of it is quoted.
      const quoted = shorten(found);
      return (
        `The Tenancy Log tab must have "${TENANCY_LOG_HEADERS[index]}" in column ${colLetter(index)} ` +
        `(found ${quoted === "" ? "nothing" : `"${quoted}"`}). Put the headers back to see the history; saving changes still works.`
      );
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
  const problem = headerProblem(values[0] ?? []);
  if (problem !== null) return { items: [], problem };
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
