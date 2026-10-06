import {
  detectMonthCodec,
  readMonth,
  type MonthCodec,
} from "@/lib/domain/month-codec";
import type { PortionConfig, PortionEntry, ScheduleRow } from "@/lib/domain/types";
import { sheetStructure } from "@/lib/errors";

export type ScheduleLayout = {
  /** 1-based row number of the header row. */
  headerRow: number;
  monthCol: number;
  totalCol: number;
  portionCols: Record<string, { tenant: number; count: number; amount: number }>;
  codec: MonthCodec;
  /** 1-based row number of the last row holding a month. */
  lastDataRow: number;
};

const HEADER_SEARCH_ROWS = 25;

const norm = (value: unknown) => String(value ?? "").trim().toLowerCase();

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

  const portionCols: ScheduleLayout["portionCols"] = {};
  for (const portion of portions) {
    portionCols[portion.id] = {
      tenant: findColumn(headers, portion.tenantHeader),
      count: findColumn(headers, portion.countHeader),
      amount: findColumn(headers, portion.amountHeader),
    };
  }
  // Two Settings rows naming the same header would make two portions share cells.
  const owner = new Map<number, string>([[monthCol, "Month"], [totalCol, totalHeader]]);
  for (const portion of portions) {
    const cols = portionCols[portion.id];
    for (const col of [cols.tenant, cols.count, cols.amount]) {
      const other = owner.get(col);
      if (other !== undefined) {
        throw sheetStructure(
          `Portion "${portion.id}" and "${other}" both use the column headed "${String(headers[col])}". Fix the header names in the Settings tab.`,
        );
      }
      owner.set(col, portion.id);
    }
  }

  const dataRows = values.slice(headerIndex + 1);
  let codec: MonthCodec | null = null;
  for (let i = dataRows.length - 1; i >= 0 && !codec; i--) {
    const cell = dataRows[i][monthCol];
    if (cell === undefined || cell === "") continue;
    try {
      codec = detectMonthCodec(cell);
    } catch {
      // Not a month (for example a footer label). Keep looking upwards.
    }
  }
  if (!codec) {
    throw sheetStructure("The Schedule tab has no month rows to copy the format from.");
  }

  const rows: ScheduleRow[] = [];
  dataRows.forEach((raw, offset) => {
    const month = readMonth(codec, raw[monthCol]);
    if (!month) return;
    const entries: Record<string, PortionEntry | null> = {};
    for (const portion of portions) {
      const cols = portionCols[portion.id];
      const count = raw[cols.count];
      const amount = raw[cols.amount];
      entries[portion.id] =
        typeof count === "number" && typeof amount === "number"
          ? { tenant: String(raw[cols.tenant] ?? "").trim(), count, amount }
          : null;
    }
    rows.push({ rowNumber: headerIndex + 2 + offset, month, entries });
  });

  const lastDataRow = rows.length > 0 ? rows[rows.length - 1].rowNumber : headerIndex + 1;
  return {
    layout: { headerRow: headerIndex + 1, monthCol, totalCol, portionCols, codec, lastDataRow },
    rows,
  };
}
