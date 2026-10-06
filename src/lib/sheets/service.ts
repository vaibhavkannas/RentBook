import { writeMonth } from "@/lib/domain/month-codec";
import {
  deriveMonthView,
  findEntryForMonth,
  findPriorEntry,
  hasLaterEntry,
  LATER_ENTRY_REASON,
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
import { formatMonthTitle } from "@/lib/format";
import { colLetter } from "./a1";
import type { CellWrite, SheetsGateway } from "./gateway";
import { parseSchedule, type ScheduleLayout } from "./schedule";
import {
  ensureTabs,
  LOG_TAB,
  readSettings,
  updateSettings,
  type SettingsUpdate,
} from "./settings-store";
import { createSnapshotCache, type SnapshotCache } from "./snapshot-cache";

export type Snapshot = {
  portions: PortionConfig[];
  layout: ScheduleLayout;
  rows: ScheduleRow[];
};

export type SheetsContext = {
  gateway: SheetsGateway;
  scheduleTab: string;
  totalHeader: string;
  /** Short-lived copy of the Settings and Schedule reads. Page views use it; writes never do. */
  cache?: SnapshotCache<Snapshot>;
};

async function load(ctx: SheetsContext): Promise<Snapshot> {
  await ensureTabs(ctx.gateway, ctx.scheduleTab);
  const [portions, values] = await Promise.all([
    readSettings(ctx.gateway),
    ctx.gateway.getValues(ctx.scheduleTab, "A1:ZZ", "UNFORMATTED_VALUE"),
  ]);
  return { portions, ...parseSchedule(values, portions, ctx.totalHeader) };
}

export const SNAPSHOT_TTL_MS = 15_000;

/** Adds the page-view cache to a context. */
export function withSnapshotCache(ctx: SheetsContext, ttlMs = SNAPSHOT_TTL_MS): SheetsContext {
  ctx.cache = createSnapshotCache(() => load(ctx), ttlMs);
  return ctx;
}

export async function getMonthView(
  ctx: SheetsContext,
  month: YearMonth,
  options: { minFetchedAt?: number } = {},
): Promise<MonthView> {
  const { portions, rows } = ctx.cache ? await ctx.cache.get(options.minFetchedAt) : await load(ctx);
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
  try {
    await ensureTabs(ctx.gateway, ctx.scheduleTab);
    await updateSettings(ctx.gateway, updates);
    return await readSettings(ctx.gateway);
  } finally {
    ctx.cache?.invalidate();
  }
}

/** The sheet row for `month`. If a month appears twice, the lower row on the sheet wins. */
function findMonthRow(rows: ScheduleRow[], month: YearMonth): ScheduleRow | undefined {
  const matches = rows.filter((row) => compareYm(row.month, month) === 0);
  return matches[matches.length - 1];
}

function sameEntry(a: PortionEntry, b: PortionEntry): boolean {
  return a.tenant === b.tenant && a.count === b.count && a.amount === b.amount;
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
  loaded: Snapshot,
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
  /**
   * What the person saw on screen when they chose to edit. The edit is refused if the Sheet
   * no longer holds exactly this entry, so a stale screen cannot change or recreate a payment.
   */
  expected?: PortionEntry;
};

export type LogAction = "Logged" | "Edited" | "Undone";

/** Saved at, month, portion, tenant, amount, count, date received, logged by, action. */
export type LogRow = [string, string, string, string, number, number, string, string, LogAction];

export type LogPaymentResult = {
  entry: PortionEntry;
  /** False when the Schedule was saved but the Payments Log row could not be written. */
  logWritten: boolean;
  logRow: LogRow;
};

export type LogPaymentOptions = {
  now: Date;
  /** Email of the signed-in person. */
  loggedBy: string;
  retryDelayMs?: number;
};

const MAX_AMOUNT = 10_000_000;

function validateMonth({ year, month }: YearMonth): void {
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
}

function validateInput(input: LogPaymentInput): string | undefined {
  validateMonth(input.month);
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
  try {
    return await logPaymentUnchecked(ctx, input, options);
  } finally {
    ctx.cache?.invalidate();
  }
}

async function logPaymentUnchecked(
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
  if (input.expected) {
    if (!existing) {
      throw conflict(
        `Nothing to edit. ${portion.name} has no payment recorded for ${formatMonthTitle(input.month)} any more. Refresh the page.`,
      );
    }
    if (!sameEntry(existing, input.expected)) {
      throw conflict(
        `${portion.name} for ${formatMonthTitle(input.month)} was changed by someone else. Refresh the page and try again.`,
      );
    }
  }
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

  const action: LogAction = existing ? "Edited" : "Logged";
  const logRow: LogRow = [
    options.now.toISOString(),
    ymKey(input.month),
    portion.name,
    tenant,
    input.amount,
    count,
    input.dateReceived,
    options.loggedBy,
    action,
  ];
  const logWritten = await appendLogRow(ctx.gateway, logRow, options.retryDelayMs ?? 400);
  return { entry: { tenant, count, amount: input.amount }, logWritten, logRow };
}

export type UndoPaymentInput = {
  month: YearMonth;
  portionId: string;
  /** What the person saw on screen. The undo is refused if the Sheet no longer matches. */
  expected: PortionEntry;
};

export type UndoPaymentResult = {
  removed: PortionEntry;
  logWritten: boolean;
  logRow: LogRow;
};

/**
 * Clears one portion's tenant, count and amount for a month. Only the portion's
 * latest entry can be undone, and only if the Sheet still matches `expected`.
 */
export async function undoPayment(
  ctx: SheetsContext,
  input: UndoPaymentInput,
  options: LogPaymentOptions,
): Promise<UndoPaymentResult> {
  try {
    return await undoPaymentUnchecked(ctx, input, options);
  } finally {
    ctx.cache?.invalidate();
  }
}

async function undoPaymentUnchecked(
  ctx: SheetsContext,
  input: UndoPaymentInput,
  options: LogPaymentOptions,
): Promise<UndoPaymentResult> {
  validateMonth(input.month);
  const loaded = await load(ctx);
  const portion = loaded.portions.find((p) => p.id === input.portionId);
  if (!portion) throw validation(`Unknown portion "${input.portionId}".`);

  const matching = loaded.rows.filter(
    (row) => compareYm(row.month, input.month) === 0 && row.entries[portion.id],
  );
  const monthRow = matching[matching.length - 1];
  const existing = monthRow?.entries[portion.id];
  if (!monthRow || !existing) {
    throw conflict(
      `Nothing to undo. ${portion.name} has no payment recorded for ${formatMonthTitle(input.month)} any more. Refresh the page.`,
    );
  }
  if (!sameEntry(existing, input.expected)) {
    throw conflict(
      `${portion.name} for ${formatMonthTitle(input.month)} was changed by someone else. Refresh the page and try again.`,
    );
  }
  if (hasLaterEntry(loaded.rows, portion.id, input.month)) {
    throw conflict(LATER_ENTRY_REASON);
  }

  const cols = loaded.layout.portionCols[portion.id];
  const at = (col: number) => `${colLetter(col)}${monthRow.rowNumber}`;
  const writes: CellWrite[] = [
    { tab: ctx.scheduleTab, a1: at(cols.tenant), values: [[""]] },
    { tab: ctx.scheduleTab, a1: at(cols.count), values: [[""]] },
    { tab: ctx.scheduleTab, a1: at(cols.amount), values: [[""]] },
  ];
  if (!(await totalIsFormula(ctx, loaded.layout, monthRow.rowNumber))) {
    const others = loaded.portions
      .filter((p) => p.id !== portion.id)
      .map((p) => monthRow.entries[p.id]?.amount);
    writes.push({
      tab: ctx.scheduleTab,
      a1: at(loaded.layout.totalCol),
      values: [[sumAmounts(others)]],
    });
  }
  await ctx.gateway.updateValues(writes);

  const logRow: LogRow = [
    options.now.toISOString(),
    ymKey(input.month),
    portion.name,
    existing.tenant,
    existing.amount,
    existing.count,
    "",
    options.loggedBy,
    "Undone",
  ];
  const logWritten = await appendLogRow(ctx.gateway, logRow, options.retryDelayMs ?? 400);
  return { removed: existing, logWritten, logRow };
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

export type ActivityItem = {
  savedAt: string;
  month: string;
  portion: string;
  tenant: string;
  amount: number | null;
  count: number | null;
  dateReceived: string;
  loggedBy: string;
  /** Null for a row with no recognised action, such as one from before the Action column existed. */
  action: LogAction | null;
};

const ACTIONS: readonly LogAction[] = ["Logged", "Edited", "Undone"];

const text = (value: unknown) => (value === undefined || value === null ? "" : String(value));
const num = (value: unknown) => (typeof value === "number" ? value : null);

/** The latest Payments Log rows, newest first. Rows from before "Logged by" and "Action" existed have no logged-by and no action. */
export async function readActivity(ctx: SheetsContext, limit = 50): Promise<ActivityItem[]> {
  await ensureTabs(ctx.gateway, ctx.scheduleTab);
  const values = await ctx.gateway.getValues(LOG_TAB, "A1:I", "UNFORMATTED_VALUE");
  const items = values
    .slice(1)
    .filter((row) => row.some((cell) => cell !== undefined && cell !== ""))
    .map((row): ActivityItem => {
      const action = ACTIONS.find((candidate) => candidate === row[8]) ?? null;
      return {
        savedAt: text(row[0]),
        month: text(row[1]),
        portion: text(row[2]),
        tenant: text(row[3]),
        amount: num(row[4]),
        count: num(row[5]),
        dateReceived: text(row[6]),
        loggedBy: text(row[7]),
        action,
      };
    });
  return items.reverse().slice(0, limit);
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
