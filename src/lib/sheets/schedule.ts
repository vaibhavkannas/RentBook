import {
  detectMonthCodec,
  readMonth,
  type MonthCodec,
} from "@/lib/domain/month-codec";
import type { PortionConfig, PortionEntry, ScheduleRow } from "@/lib/domain/types";
import { sheetStructure } from "@/lib/errors";
import { isBlankCell } from "./cells";

export type ScheduleLayout = {
  /** 1-based row number of the header row. */
  headerRow: number;
  monthCol: number;
  totalCol: number;
  /** By portion id. A Map, because ids are typed by hand and `__proto__` or `constructor` must be plain ids. */
  portionCols: Map<string, { tenant: number; count: number; amount: number }>;
  /** The style of the bottom-most month cell: used only to write a new month row, never to read. */
  codec: MonthCodec;
  /** 1-based row number of the last row holding a month. */
  lastDataRow: number;
};

const HEADER_SEARCH_ROWS = 25;

const norm = (value: unknown) => String(value ?? "").trim().toLowerCase();

const MESSAGE_CELL_LENGTH = 40;

/** A cell's text cut to 40 characters, so a long note cannot flood an error message. */
export const shorten = (text: string) =>
  text.length > MESSAGE_CELL_LENGTH ? `${text.slice(0, MESSAGE_CELL_LENGTH)}...` : text;

/** The Tenant, Count and Amount columns of a portion. Every portion given to parseSchedule has them, or the parse is refused. */
export function columnsOf(layout: ScheduleLayout, portionId: string) {
  const cols = layout.portionCols.get(portionId);
  if (!cols) throw sheetStructure(`The Schedule tab has no columns for the portion "${portionId}".`);
  return cols;
}

function findColumn(headers: unknown[], name: string): number {
  const wanted = norm(name);
  const matches = headers.flatMap((header, index) => (norm(header) === wanted ? [index] : []));
  if (matches.length === 0) {
    throw sheetStructure(`Header "${name}" was not found in the Schedule tab.`);
  }
  if (matches.length > 1) {
    throw sheetStructure(`Header "${name}" appears more than once in the Schedule tab.`);
  }
  return matches[0];
}

/** 0-based index of the row that holds the "Month" header, or -1. */
export function findHeaderRowIndex(values: unknown[][]): number {
  return values
    .slice(0, HEADER_SEARCH_ROWS)
    .findIndex((row) => row.some((cell) => norm(cell) === "month"));
}

/**
 * Reads the Schedule tab's raw values (unformatted) into a layout plus one
 * ScheduleRow per month row. Throws a sheet-structure error rather than
 * guessing when a header or the Month format is not as expected.
 */
export function parseSchedule(
  values: unknown[][],
  portions: PortionConfig[],
  totalHeader: string,
): { layout: ScheduleLayout; rows: ScheduleRow[] } {
  const headerIndex = findHeaderRowIndex(values);
  if (headerIndex === -1) {
    throw sheetStructure('No header row containing "Month" was found in the Schedule tab.');
  }
  const headers = values[headerIndex];
  const monthCol = findColumn(headers, "Month");
  const totalCol = findColumn(headers, totalHeader);

  const portionCols: ScheduleLayout["portionCols"] = new Map();
  for (const portion of portions) {
    portionCols.set(portion.id, {
      tenant: findColumn(headers, portion.tenantHeader),
      count: findColumn(headers, portion.countHeader),
      amount: findColumn(headers, portion.amountHeader),
    });
  }
  // Two Settings rows naming the same header would make two portions share cells.
  const owner = new Map<number, string>([[monthCol, "Month"], [totalCol, totalHeader]]);
  for (const [id, cols] of portionCols) {
    for (const col of [cols.tenant, cols.count, cols.amount]) {
      const other = owner.get(col);
      if (other !== undefined) {
        throw sheetStructure(
          `Portion "${id}" and "${other}" both use the column headed "${String(headers[col])}". Fix the header names in the Settings tab.`,
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
        `Row ${headerIndex + 2 + offset} of the Schedule tab has "${shorten(String(cell))}" in the Month column, which RentBook cannot read as a month. Change it to a month such as "Oct-26", or clear the cell.`,
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
    layout: { headerRow: headerIndex + 1, monthCol, totalCol, portionCols, codec, lastDataRow },
    rows,
  };
}
