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
import { compareYm, isValidIsoDay, ymKey } from "@/lib/domain/year-month";
import { conflict, validation } from "@/lib/errors";
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

async function totalIsFormula(ctx: SheetsContext, layout: ScheduleLayout): Promise<boolean> {
  const a1 = `${colLetter(layout.totalCol)}${layout.lastDataRow}`;
  const cells = await ctx.gateway.getValues(ctx.scheduleTab, a1, "FORMULA");
  const value = cells[0]?.[0];
  return typeof value === "string" && value.startsWith("=");
}

/**
 * Returns the sheet row for `month`, creating it below the last month row when
 * missing. The new row is cloned from the last month row (so formatting and
 * the total formula carry over) with every payment cell blanked.
 */
async function ensureMonthRow(
  ctx: SheetsContext,
  loaded: Loaded,
  month: YearMonth,
  totalHasFormula: boolean,
): Promise<number> {
  const existing = loaded.rows.filter((row) => compareYm(row.month, month) === 0);
  if (existing.length > 0) return existing[existing.length - 1].rowNumber;

  const { layout, portions } = loaded;
  const newRow = layout.lastDataRow + 1;
  const below = await ctx.gateway.getValues(ctx.scheduleTab, `A${newRow}:ZZ${newRow}`, "FORMULA");
  const occupied = below.some((row) => row.some((cell) => cell !== undefined && cell !== ""));
  if (occupied) {
    throw conflict(
      `Row ${newRow} of the Schedule tab is below the last month but not empty, so a new month row cannot be added there.`,
    );
  }

  const clearCols = portions.flatMap((p) => {
    const cols = layout.portionCols[p.id];
    return [cols.tenant, cols.count, cols.amount];
  });
  if (!totalHasFormula) clearCols.push(layout.totalCol);

  await ctx.gateway.cloneRow(ctx.scheduleTab, layout.lastDataRow, newRow, clearCols, [
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
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > MAX_AMOUNT) {
    throw validation("Amount must be a whole number of rupees, more than 0.");
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

  const existing = findEntryForMonth(loaded.rows, portion.id, input.month);
  if (existing && !input.overwrite) {
    throw conflict(
      `${portion.name} already has ₹${existing.amount} recorded for ${ymKey(input.month)}.`,
      { existingAmount: existing.amount, existingTenant: existing.tenant },
    );
  }

  const prior = findPriorEntry(loaded.rows, portion.id, input.month);
  let tenant: string;
  let count: number;
  if (newTenant !== undefined) {
    tenant = newTenant;
    count = 1;
  } else if (prior) {
    tenant = prior.tenant;
    count = nextCount(prior.count, portion.cycleLength);
  } else {
    throw validation("This portion has no tenant yet. Enter a tenant name.");
  }

  const totalHasFormula = await totalIsFormula(ctx, loaded.layout);
  const rowNumber = await ensureMonthRow(ctx, loaded, input.month, totalHasFormula);
  const cols = loaded.layout.portionCols[portion.id];
  const at = (col: number) => `${colLetter(col)}${rowNumber}`;

  const writes = [
    { tab: ctx.scheduleTab, a1: at(cols.tenant), values: [[tenant]] },
    { tab: ctx.scheduleTab, a1: at(cols.count), values: [[count]] },
    { tab: ctx.scheduleTab, a1: at(cols.amount), values: [[input.amount]] },
  ];
  if (!totalHasFormula) {
    const monthRow = loaded.rows.find((row) => row.rowNumber === rowNumber);
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
