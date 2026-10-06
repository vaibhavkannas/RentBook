import { AppError } from "@/lib/errors";
import { ymKey } from "@/lib/domain/year-month";
import { colLetter } from "./a1";
import type { SheetsGateway } from "./gateway";
import { findHeaderRowIndex, parseSchedule } from "./schedule";
import { inferPortions, LOG_TAB, SETTINGS_TAB } from "./settings-store";

export type ReconReport = {
  tabs: string[];
  hasSettingsTab: boolean;
  hasLogTab: boolean;
  headerRow: number | null;
  headers: string[];
  portions: { id: string; tenantHeader: string; countHeader: string; amountHeader: string }[];
  monthFormat: string | null;
  firstMonth: string | null;
  lastMonth: string | null;
  monthRows: number;
  lastDataRow: number | null;
  totalHeader: string;
  totalCellIsFormula: boolean | null;
  totalCellSample: string | null;
  rowBelowTableEmpty: boolean | null;
  problems: string[];
};

/**
 * Read-only check of a real spreadsheet against what the app expects. Never
 * writes, never creates tabs. Run it on a copy before the first real save.
 */
export async function describeSheet(
  gateway: SheetsGateway,
  scheduleTab: string,
  totalHeader: string,
): Promise<ReconReport> {
  const report: ReconReport = {
    tabs: [],
    hasSettingsTab: false,
    hasLogTab: false,
    headerRow: null,
    headers: [],
    portions: [],
    monthFormat: null,
    firstMonth: null,
    lastMonth: null,
    monthRows: 0,
    lastDataRow: null,
    totalHeader,
    totalCellIsFormula: null,
    totalCellSample: null,
    rowBelowTableEmpty: null,
    problems: [],
  };
  try {
    report.tabs = await gateway.listTabs();
  } catch (error) {
    report.problems.push(error instanceof AppError ? error.message : String(error));
    return report;
  }
  report.hasSettingsTab = report.tabs.includes(SETTINGS_TAB);
  report.hasLogTab = report.tabs.includes(LOG_TAB);
  if (!report.tabs.includes(scheduleTab)) {
    report.problems.push(`Tab "${scheduleTab}" not found. Tabs are: ${report.tabs.join(", ")}.`);
    return report;
  }

  try {
    const values = await gateway.getValues(scheduleTab, "A1:ZZ", "UNFORMATTED_VALUE");
    const headerIndex = findHeaderRowIndex(values);
    if (headerIndex === -1) {
      report.problems.push('No header row containing "Month" in the first 25 rows.');
      return report;
    }
    report.headerRow = headerIndex + 1;
    report.headers = values[headerIndex].map((cell) => String(cell ?? ""));

    const portions = inferPortions(values[headerIndex]);
    report.portions = portions.map(({ id, tenantHeader, countHeader, amountHeader }) => ({
      id,
      tenantHeader,
      countHeader,
      amountHeader,
    }));

    const { layout, rows } = parseSchedule(values, portions, totalHeader);
    report.monthFormat =
      layout.codec.kind === "serial"
        ? "date cells"
        : `text such as "${String(values[layout.lastDataRow - 1][layout.monthCol])}"`;
    report.monthRows = rows.length;
    report.firstMonth = ymKey(rows[0].month);
    report.lastMonth = ymKey(rows[rows.length - 1].month);
    report.lastDataRow = layout.lastDataRow;

    const totalA1 = `${colLetter(layout.totalCol)}${layout.lastDataRow}`;
    const total = (await gateway.getValues(scheduleTab, totalA1, "FORMULA"))[0]?.[0];
    report.totalCellIsFormula = typeof total === "string" && total.startsWith("=");
    report.totalCellSample = total === undefined ? null : String(total);

    const nextRow = layout.lastDataRow + 1;
    const below = await gateway.getValues(scheduleTab, `A${nextRow}:ZZ${nextRow}`, "FORMULA");
    report.rowBelowTableEmpty = !below.some((row) =>
      row.some((cell) => cell !== undefined && cell !== ""),
    );
    if (!report.rowBelowTableEmpty) {
      report.problems.push(
        `Row ${nextRow}, right under the last month, is not empty. The app cannot add a new month there.`,
      );
    }
  } catch (error) {
    report.problems.push(error instanceof AppError ? error.message : String(error));
  }
  return report;
}
