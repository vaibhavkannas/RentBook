import { writeMonth } from "@/lib/domain/month-codec";
import {
  deriveMonthView,
  findEntryForMonth,
  findPriorEntry,
} from "@/lib/domain/month-view";
import { nextCount, sumAmounts } from "@/lib/domain/rent-rules";
import type {
  MonthView,
  PortionConfig,
  PortionEntry,
  ScheduleRow,
  YearMonth,
} from "@/lib/domain/types";
import { addMonths, compareYm, isValidIsoDay, ymKey } from "@/lib/domain/year-month";
import { conflict, sheetStructure, validation } from "@/lib/errors";
import { colLetter } from "./a1";
import type { SheetsGateway } from "./gateway";
import { parseSchedule, type ScheduleLayout } from "./schedule";
import {
  ensureTabs,
  LOG_TAB,
  readSettings,
  updateSettings,
  type SettingsUpdate,
} from "./settings-store";

export type SheetsContext = {
  gateway: SheetsGateway;
  scheduleTab: string;
  totalHeader: string;
};

type Loaded = {
  portions: PortionConfig[];
  layout: ScheduleLayout;
  rows: ScheduleRow[];
};

async function load(ctx: SheetsContext): Promise<Loaded> {
  await ensureTabs(ctx.gateway, ctx.scheduleTab);
  const portions = await readSettings(ctx.gateway);
  const values = await ctx.gateway.getValues(ctx.scheduleTab, "A1:ZZ", "UNFORMATTED_VALUE");
  return { portions, ...parseSchedule(values, portions, ctx.totalHeader) };
}

export async function getMonthView(ctx: SheetsContext, month: YearMonth): Promise<MonthView> {
  const { portions, rows } = await load(ctx);
  return deriveMonthView(rows, portions, month);
}

export async function getSettings(ctx: SheetsContext): Promise<PortionConfig[]> {
  await ensureTabs(ctx.gateway, ctx.scheduleTab);
  return readSettings(ctx.gateway);
}

export async function saveSettings(
  ctx: SheetsContext,
  updates: SettingsUpdate[],
): Promise<PortionConfig[]> {
  await ensureTabs(ctx.gateway, ctx.scheduleTab);
  await updateSettings(ctx.gateway, updates);
  return readSettings(ctx.gateway);
}

/** The sheet row for `month`. If a month appears twice, the lower row on the sheet wins. */
function findMonthRow(rows: ScheduleRow[], month: YearMonth): ScheduleRow | undefined {
  const matches = rows.filter((row) => compareYm(row.month, month) === 0);
  return matches[matches.length - 1];
}

/** Whether the total cell on `row` holds a formula (read with the FORMULA render). */
async function totalIsFormula(
  ctx: SheetsContext,
  layout: ScheduleLayout,
  row: number,
): Promise<boolean> {
  const a1 = `${colLetter(layout.totalCol)}${row}`;
  const cells = await ctx.gateway.getValues(ctx.scheduleTab, a1, "FORMULA");
  const value = cells[0]?.[0];
  return typeof value === "string" && value.startsWith("=");
}

/**
 * Returns the sheet row for `month`. A missing month is added below the last
 * month row, cloned from it (so formatting and the total formula carry over)
 * with every payment cell blanked. Months are only ever added in order: a
 * month that is not later than the last month row is refused.
 */
async function ensureMonthRow(
  ctx: SheetsContext,
  loaded: Loaded,
  month: YearMonth,
  totalHasFormula: boolean,
): Promise<number> {
  const existing = findMonthRow(loaded.rows, month);
  if (existing) return existing.rowNumber;

  const last = loaded.rows[loaded.rows.length - 1];
  if (!last) {
    throw sheetStructure("The Schedule tab has no month rows to copy the format from.");
  }
  if (compareYm(month, last.month) <= 0) {
    throw validation(
      `Can't add ${ymKey(month)}: the Schedule already has ${ymKey(last.month)} below it. Month rows are added in order.`,
    );
  }
  const following = addMonths(last.month, 1);
  if (compareYm(month, following) > 0) {
    throw validation(
      `Can't add ${ymKey(month)} yet: the Schedule's last month is ${ymKey(last.month)}. Log ${ymKey(following)} first, or add its row in the sheet.`,
    );
  }

  const { layout, portions } = loaded;
  const newRow = layout.lastDataRow + 1;
  const below = await ctx.gateway.getValues(ctx.scheduleTab, `A${newRow}:ZZ${newRow}`, "FORMULA");
  const occupied = below.some((row) => row.some((cell) => cell !== undefined && cell !== ""));
  if (occupied) {
    throw conflict(
      `Row ${newRow} of the Schedule tab is below the last month but not empty, so a new month row cannot be added there.`,
    );
  }

  // Blank every value the copy would carry over (portion cells, a typed total, notes,
  // columns of portions missing from Settings); keep only formulas and the Month cell.
  const source =
    (await ctx.gateway.getValues(ctx.scheduleTab, `A${layout.lastDataRow}:ZZ${layout.lastDataRow}`, "FORMULA"))[0] ?? [];
  const clearCols = new Set(
    portions.flatMap((p) => {
      const cols = layout.portionCols[p.id];
      return [cols.tenant, cols.count, cols.amount];
    }),
  );
  source.forEach((cell, col) => {
    const isFormula = typeof cell === "string" && cell.startsWith("=");
    if (col !== layout.monthCol && cell !== "" && cell !== undefined && !isFormula) clearCols.add(col);
  });
  if (!totalHasFormula) clearCols.add(layout.totalCol);

  await ctx.gateway.cloneRow(ctx.scheduleTab, layout.lastDataRow, newRow, [...clearCols], [
    { col: layout.monthCol, value: writeMonth(layout.codec, month) },
  ]);
  return newRow;
}

export type LogPaymentInput = {
  month: YearMonth;
  portionId: string;
  amount: number;
  /** YYYY-MM-DD */
  dateReceived: string;
  /** Set when a new tenant moves in: count restarts at 1. */
  newTenantName?: string;
  /** Replace an amount that is already recorded for this month. */
  overwrite?: boolean;
};

export type LogRow = [string, string, string, string, number, number, string];

export type LogPaymentResult = {
  entry: PortionEntry;
  /** False when the Schedule was saved but the Payments Log row could not be written. */
  logWritten: boolean;
  logRow: LogRow;
};

export type LogPaymentOptions = {
  now: Date;
  retryDelayMs?: number;
};

const MAX_AMOUNT = 10_000_000;

function validateInput(input: LogPaymentInput): string | undefined {
  const { year, month } = input.month;
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2200 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    throw validation("Month must be a real month.");
  }
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > MAX_AMOUNT) {
    throw validation("Amount must be a whole number of rupees from 1 to 10,000,000.");
  }
  if (!isValidIsoDay(input.dateReceived)) {
    throw validation("Date received must be a real date.");
  }
  if (input.newTenantName === undefined) return undefined;
  const name = input.newTenantName.trim();
  if (name.length === 0 || name.length > 60) {
    throw validation("Tenant name must be 1 to 60 characters.");
  }
  return name;
}

export async function logPayment(
  ctx: SheetsContext,
  input: LogPaymentInput,
  options: LogPaymentOptions,
): Promise<LogPaymentResult> {
  const newTenant = validateInput(input);
  const loaded = await load(ctx);
  const portion = loaded.portions.find((p) => p.id === input.portionId);
  if (!portion) throw validation(`Unknown portion "${input.portionId}".`);

  const monthRow = findMonthRow(loaded.rows, input.month);
  const existing = findEntryForMonth(loaded.rows, portion.id, input.month);
  if (existing && !input.overwrite) {
    throw conflict(
      `${portion.name} already has ₹${existing.amount} recorded for ${ymKey(input.month)}.`,
      { existingAmount: existing.amount, existingTenant: existing.tenant },
    );
  }
  if (!existing && monthRow && !input.overwrite) {
    // A cell with an amount but no valid count is not a complete entry, yet it is not empty either.
    const cols = loaded.layout.portionCols[portion.id];
    const rowCells =
      (
        await ctx.gateway.getValues(
          ctx.scheduleTab,
          `A${monthRow.rowNumber}:ZZ${monthRow.rowNumber}`,
          "UNFORMATTED_VALUE",
        )
      )[0] ?? [];
    const hasData = [cols.tenant, cols.count, cols.amount].some(
      (col) => rowCells[col] !== undefined && rowCells[col] !== "",
    );
    if (hasData) {
      throw conflict(
        `${portion.name} already has incomplete data in row ${monthRow.rowNumber} of the Schedule tab. Fix or clear it in the sheet first.`,
      );
    }
  }

  const prior = findPriorEntry(loaded.rows, portion.id, input.month);
  let tenant: string;
  let count: number;
  if (newTenant !== undefined) {
    tenant = newTenant;
    count = 1;
  } else if (existing) {
    // Overwriting keeps the tenant and count already recorded; only the amount changes.
    tenant = existing.tenant;
    count = existing.count;
  } else if (prior) {
    tenant = prior.tenant;
    count = nextCount(prior.count, portion.cycleLength);
  } else {
    throw validation("This portion has no tenant yet. Enter a tenant name.");
  }

  // The total's style (formula or typed value) is read from the row being written;
  // for a new month that is the last month row, which the new row is cloned from.
  const totalRow = monthRow ? monthRow.rowNumber : loaded.layout.lastDataRow;
  const totalHasFormula = await totalIsFormula(ctx, loaded.layout, totalRow);
  const rowNumber = await ensureMonthRow(ctx, loaded, input.month, totalHasFormula);
  const cols = loaded.layout.portionCols[portion.id];
  const at = (col: number) => `${colLetter(col)}${rowNumber}`;

  const writes = [
    { tab: ctx.scheduleTab, a1: at(cols.tenant), values: [[tenant]] },
    { tab: ctx.scheduleTab, a1: at(cols.count), values: [[count]] },
    { tab: ctx.scheduleTab, a1: at(cols.amount), values: [[input.amount]] },
  ];
  if (!totalHasFormula) {
    const others = loaded.portions
      .filter((p) => p.id !== portion.id)
      .map((p) => monthRow?.entries[p.id]?.amount);
    writes.push({
      tab: ctx.scheduleTab,
      a1: at(loaded.layout.totalCol),
      values: [[sumAmounts(others) + input.amount]],
    });
  }
  await ctx.gateway.updateValues(writes);

  const logRow: LogRow = [
    options.now.toISOString(),
    ymKey(input.month),
    portion.name,
    tenant,
    input.amount,
    count,
    input.dateReceived,
  ];
  const logWritten = await appendLogRow(ctx.gateway, logRow, options.retryDelayMs ?? 400);
  return { entry: { tenant, count, amount: input.amount }, logWritten, logRow };
}

const LOG_ATTEMPTS = 3;

async function appendLogRow(
  gateway: SheetsGateway,
  row: LogRow,
  retryDelayMs: number,
): Promise<boolean> {
  for (let attempt = 1; attempt <= LOG_ATTEMPTS; attempt++) {
    try {
      await gateway.appendRow(LOG_TAB, row);
      return true;
    } catch {
      if (attempt < LOG_ATTEMPTS && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
      }
    }
  }
  return false;
}

/** Second chance for a Payments Log row that failed after the Schedule was saved. */
export async function retryLogRow(
  ctx: SheetsContext,
  row: LogRow,
  retryDelayMs = 400,
): Promise<boolean> {
  await ensureTabs(ctx.gateway, ctx.scheduleTab);
  return appendLogRow(ctx.gateway, row, retryDelayMs);
}
