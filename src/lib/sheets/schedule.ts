import {
  detectMonthCodec,
  readMonth,
  type MonthCodec,
} from "@/lib/domain/month-codec";
import type { PortionConfig, PortionEntry, ScheduleRow } from "@/lib/domain/types";
import { BRAND } from "@/lib/brand";
import { sheetStructure } from "@/lib/errors";
import { isBlankCell } from "./cells";
import { findHeader, headerKey } from "./headers";

export type ScheduleLayout = {
  /** 1-based row number of the header row. */
  headerRow: number;
  monthCol: number;
  /** The monthly total column, or null when the app was told of none (no TOTAL_HEADER): then no total is ever written. */
  totalCol: number | null;
  /**
   * By portion id. A Map, because ids are typed by hand and `__proto__` or `constructor` must be plain ids. A switched-off portion
   * whose columns were deleted has no entry here, and no entries in any row either.
   */
  portionCols: Map<string, { tenant: number; count: number; amount: number }>;
  /** The style of the bottom-most month cell: used only to write a new month row, never to read. */
  codec: MonthCodec;
  /** 1-based row number of the last row holding a month. */
  lastDataRow: number;
};

const HEADER_SEARCH_ROWS = 25;

const MESSAGE_CELL_LENGTH = 40;

/** Control characters, line and paragraph separators, and invisible text-direction marks. */
const isUnprintable = (code: number) =>
  code <= 0x1f ||
  (code >= 0x7f && code <= 0x9f) ||
  (code >= 0x200b && code <= 0x200f) ||
  (code >= 0x2028 && code <= 0x202e) ||
  (code >= 0x2060 && code <= 0x2064) ||
  (code >= 0x2066 && code <= 0x2069) ||
  code === 0xfeff;

/**
 * A cell's text as it is safe to show inside an error message: each run of unprintable characters (line breaks,
 * tabs, other control or text-direction characters) becomes one space, then the text is cut to 40 characters so
 * a long note cannot flood the message. The cell is typed by hand and the message reaches the owner's screen
 * and the server log, so neither can be broken up by what is in it.
 */
export function shorten(text: string): string {
  let plain = "";
  let gap = false;
  for (const char of text) {
    if (isUnprintable(char.charCodeAt(0))) {
      gap = true;
      continue;
    }
    plain += gap ? ` ${char}` : char;
    gap = false;
  }
  plain = plain.trim();
  return plain.length > MESSAGE_CELL_LENGTH ? `${plain.slice(0, MESSAGE_CELL_LENGTH)}...` : plain;
}

/**
 * The Tenant, Count and Amount columns of a portion. Every portion given to parseSchedule has them, or the parse is refused,
 * except a switched-off portion whose columns were deleted.
 */
export function columnsOf(layout: ScheduleLayout, portionId: string) {
  const cols = layout.portionCols.get(portionId);
  if (!cols) throw sheetStructure(`The Schedule tab has no columns for the portion "${portionId}".`);
  return cols;
}

/** What a header is looked for in, for the message that says it is missing: a portion's headers come from Settings, the total's from TOTAL_HEADER. */
type HeaderSource = "month" | "settings" | "total";

const WHERE_TO_LOOK: Record<HeaderSource, string> = {
  month: ".",
  settings: " and in the Settings tab.",
  total: " and in TOTAL_HEADER.",
};

/**
 * The column of a header, or an error in words. `headerRow` is the header row's 1-based number, for the message, and `source`
 * says where else to check the spelling. The header's text is typed by hand, so it is shortened before it is quoted.
 */
function findColumn(headers: unknown[], name: string, headerRow: number, source: HeaderSource): number {
  const found = findHeader(headers, name);
  if ("index" in found) return found.index;
  if (found.problem === "duplicate") {
    throw sheetStructure(`Header "${shorten(name)}" appears more than once in the Schedule tab.`);
  }
  throw sheetStructure(
    `Header "${shorten(name)}" was not found in the Schedule tab. Check the spelling in the Schedule header row (row ${headerRow})${WHERE_TO_LOOK[source]}`,
  );
}

/** 0-based index of the row that holds the "Month" header, or -1. */
export function findHeaderRowIndex(values: unknown[][]): number {
  return values
    .slice(0, HEADER_SEARCH_ROWS)
    .findIndex((row) => row.some((cell) => headerKey(cell) === "month"));
}

/**
 * Reads the Schedule tab's raw values (unformatted) into a layout plus one
 * ScheduleRow per month row. Throws a sheet-structure error rather than
 * guessing when a header or the Month format is not as expected.
 */
export function parseSchedule(
  values: unknown[][],
  portions: PortionConfig[],
  totalHeader: string | null,
): { layout: ScheduleLayout; rows: ScheduleRow[] } {
  const headerIndex = findHeaderRowIndex(values);
  if (headerIndex === -1) {
    throw sheetStructure('No header row containing "Month" was found in the Schedule tab.');
  }
  const headers = values[headerIndex];
  const headerRow = headerIndex + 1;
  const monthCol = findColumn(headers, "Month", headerRow, "month");
  const totalCol = totalHeader === null ? null : findColumn(headers, totalHeader, headerRow, "total");

  const portionCols: ScheduleLayout["portionCols"] = new Map();
  for (const portion of portions) {
    // A portion that is switched off may have had its columns deleted (its history is then the owner's to keep elsewhere): with
    // all three headers gone it has no columns and no entries. Some of them gone is still a mistake, and so is a portion that is on.
    if (
      portion.inactive &&
      [portion.tenantHeader, portion.countHeader, portion.amountHeader].every((name) => {
        const found = findHeader(headers, name);
        return "problem" in found && found.problem === "missing";
      })
    ) {
      continue;
    }
    portionCols.set(portion.id, {
      tenant: findColumn(headers, portion.tenantHeader, headerRow, "settings"),
      count: findColumn(headers, portion.countHeader, headerRow, "settings"),
      amount: findColumn(headers, portion.amountHeader, headerRow, "settings"),
    });
  }
  // Two Settings rows naming the same header would make two portions share cells.
  const owner = new Map<number, string>([[monthCol, "Month"]]);
  if (totalCol !== null && totalHeader !== null) owner.set(totalCol, totalHeader);
  for (const [id, cols] of portionCols) {
    for (const col of [cols.tenant, cols.count, cols.amount]) {
      const other = owner.get(col);
      if (other !== undefined) {
        throw sheetStructure(
          `Portion "${id}" and "${shorten(other)}" both use the column headed "${shorten(String(headers[col]))}". Fix the header names in the Settings tab.`,
        );
      }
      owner.set(col, id);
    }
  }

  // Every Month cell is read on its own, so dates and text may be mixed. The bottom-most readable cell
  // only decides the style of a NEW month row (see `layout.codec`).
  const dataRows = values.slice(headerIndex + 1);
  const months = dataRows.map((raw) => readMonth(raw[monthCol]));
  const lastMonthIndex = months.findLastIndex((month) => month !== null);
  if (lastMonthIndex === -1) {
    throw sheetStructure("The Schedule tab has no month rows to copy the format from.");
  }
  const codec = detectMonthCodec(dataRows[lastMonthIndex][monthCol]);
  // A cell with something in it that is not a month, inside the table, would silently drop that row's
  // payments. Below the last month row it is a footer such as "Total", and is ignored.
  months.slice(0, lastMonthIndex).forEach((month, offset) => {
    const cell = dataRows[offset][monthCol];
    if (month === null && !isBlankCell(cell)) {
      throw sheetStructure(
        `Row ${headerIndex + 2 + offset} of the Schedule tab has "${shorten(String(cell))}" in the Month column, which ${BRAND.name} cannot read as a month. Change it to a month such as "Oct-26", or clear the cell.`,
      );
    }
  });

  const rows: ScheduleRow[] = [];
  dataRows.forEach((raw, offset) => {
    const month = months[offset];
    if (!month) return;
    const entries = new Map<string, PortionEntry | null>();
    for (const [id, cols] of portionCols) {
      const count = raw[cols.count];
      const amount = raw[cols.amount];
      entries.set(
        id,
        typeof count === "number" && typeof amount === "number"
          ? { tenant: String(raw[cols.tenant] ?? "").trim(), count, amount }
          : null,
      );
    }
    rows.push({ rowNumber: headerIndex + 2 + offset, month, entries });
  });

  const lastDataRow = rows.length > 0 ? rows[rows.length - 1].rowNumber : headerIndex + 1;
  return {
    layout: { headerRow, monthCol, totalCol, portionCols, codec, lastDataRow },
    rows,
  };
}
