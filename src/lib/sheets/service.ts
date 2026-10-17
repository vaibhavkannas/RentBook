import { cleanText, MAX_NAME_LENGTH, requireDay } from "@/lib/domain/input-rules";
import { writeMonth } from "@/lib/domain/month-codec";
import {
  deriveMonthView,
  findEntryForMonth,
  findPriorEntry,
  hasLaterEntry,
  LATER_ENTRY_REASON,
} from "@/lib/domain/month-view";
import { nextCount, sumAmounts } from "@/lib/domain/rent-rules";
import { MAX_RUPEES, type Tenancy, type TenancyFields } from "@/lib/domain/tenancy";
import type {
  MonthView,
  PortionConfig,
  PortionEntry,
  ScheduleRow,
  YearMonth,
} from "@/lib/domain/types";
import { addMonths, compareYm, ymKey } from "@/lib/domain/year-month";
import { AppError, conflict, sheetStructure, unknownPortion, validation } from "@/lib/errors";
import { formatMonthTitle, formatRupees, wholeRupeesMessage } from "@/lib/format";
import { RELOAD_HINT, RELOAD_STEP, reloadThen } from "@/lib/recovery-hint";
import { errorLogFields, logEvent } from "@/lib/server/log";
import { colLetter } from "./a1";
import { text } from "./cells";
import type { SheetsGateway } from "./gateway";
import { columnsOf, parseSchedule, type ScheduleLayout } from "./schedule";
import {
  ensureTabs,
  LOG_TAB,
  parseSettings,
  readSettings,
  SETTINGS_RANGE,
  SETTINGS_TAB,
  updateSettings,
  type SettingsUpdate,
} from "./settings-store";
import { createSnapshotCache, type SnapshotCache } from "./snapshot-cache";
import { checkNewTenancy, recordNewTenant } from "./tenancy-writes";
import { parseTenancies, readTenancies, TENANTS_RANGE, TENANTS_TAB } from "./tenants-store";
import { withWriteLock } from "./write-lock";

export type Snapshot = {
  portions: PortionConfig[];
  layout: ScheduleLayout;
  rows: ScheduleRow[];
  /** Every row of the Tenants tab. Empty when the tab has a problem (see `tenantsProblem`). */
  tenancies: Tenancy[];
  /**
   * Set when the Tenants tab cannot be used, for example because a header was changed: what is wrong, in
   * words. Everything else in the snapshot is still good, so rent logging and the month views keep working;
   * the tenancy writes refuse and the tenant page shows this.
   */
  tenantsProblem?: string;
};

export type SheetsContext = {
  gateway: SheetsGateway;
  scheduleTab: string;
  /** The header of the monthly total column, or null for none (TOTAL_HEADER not set): the app then writes no total. */
  totalHeader: string | null;
  /** Short-lived copy of the Settings, Schedule and Tenants reads. Page views use it; writes never do. */
  cache?: SnapshotCache<Snapshot>;
  /** Short-lived copy of the Payments Log, for the Activity page. */
  activityCache?: SnapshotCache<ActivityItem[]>;
  /** Short-lived copy of the Settings tab, for the Settings page. */
  settingsCache?: SnapshotCache<PortionConfig[]>;
};

/**
 * The Tenants tab's rows, or none and what is wrong with the tab when its structure is wrong. Only a
 * sheet-structure problem is turned into a message: any other failure is still a failure of the whole read.
 */
function parseTenanciesOrProblem(values: unknown[][]): { tenancies: Tenancy[]; tenantsProblem?: string } {
  try {
    return { tenancies: parseTenancies(values) };
  } catch (error) {
    if (error instanceof AppError && error.code === "sheet-structure") {
      return { tenancies: [], tenantsProblem: error.message };
    }
    throw error;
  }
}

/**
 * Reads Settings, the Schedule and the Tenants tab with ONE request to Google (after the one-time tab check),
 * so the three always describe the same moment and a page view costs one call against the quota. Never cached.
 * A problem with the Tenants tab alone does not fail the read: see `Snapshot.tenantsProblem`.
 */
export async function loadSnapshot(ctx: SheetsContext): Promise<Snapshot> {
  await ensureTabs(ctx.gateway, ctx.scheduleTab);
  const [settings, schedule, tenants] = await ctx.gateway.getManyValues(
    [
      { tab: SETTINGS_TAB, a1: SETTINGS_RANGE },
      { tab: ctx.scheduleTab, a1: "A1:ZZ" },
      { tab: TENANTS_TAB, a1: TENANTS_RANGE },
    ],
    "UNFORMATTED_VALUE",
  );
  const portions = parseSettings(settings);
  return { portions, ...parseSchedule(schedule, portions, ctx.totalHeader), ...parseTenanciesOrProblem(tenants) };
}

export const SNAPSHOT_TTL_MS = 15_000;

/** Adds the page-view caches to a context: the month views and tenants, the Activity page and the Settings page. */
export function withSnapshotCache(ctx: SheetsContext, ttlMs = SNAPSHOT_TTL_MS): SheetsContext {
  ctx.cache = createSnapshotCache(() => loadSnapshot(ctx), ttlMs);
  ctx.activityCache = createSnapshotCache(() => loadActivity(ctx), ttlMs);
  ctx.settingsCache = createSnapshotCache(() => loadSettings(ctx), ttlMs);
  return ctx;
}

/** Throws away every page-view copy. Every write calls this, whether it worked or not, so no page shows what it replaced. */
export function invalidateCaches(ctx: SheetsContext): void {
  ctx.cache?.invalidate();
  ctx.activityCache?.invalidate();
  ctx.settingsCache?.invalidate();
}

export async function getMonthView(
  ctx: SheetsContext,
  month: YearMonth,
  options: { minFetchedAt?: number } = {},
): Promise<MonthView> {
  const { portions, rows, tenancies } = ctx.cache
    ? await ctx.cache.get(options.minFetchedAt)
    : await loadSnapshot(ctx);
  return deriveMonthView(rows, portions, month, tenancies);
}

async function loadSettings(ctx: SheetsContext): Promise<PortionConfig[]> {
  await ensureTabs(ctx.gateway, ctx.scheduleTab);
  return readSettings(ctx.gateway);
}

/** The portions in the Settings tab. `minFetchedAt` (ms since epoch) rejects a cached copy read before that time. */
export async function getSettings(
  ctx: SheetsContext,
  options: { minFetchedAt?: number } = {},
): Promise<PortionConfig[]> {
  return ctx.settingsCache ? ctx.settingsCache.get(options.minFetchedAt) : loadSettings(ctx);
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
    invalidateCaches(ctx);
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

/**
 * The total column when the app has to fill it in itself on `row`: there is one, and the cell holds a typed value
 * (read with the FORMULA render), not a formula that adds the row up. Null when there is no total column (nothing
 * is read) or the total is a formula.
 */
async function typedTotalCol(
  ctx: SheetsContext,
  layout: ScheduleLayout,
  row: number,
): Promise<number | null> {
  const col = layout.totalCol;
  if (col === null) return null;
  const cells = await ctx.gateway.getValues(ctx.scheduleTab, `${colLetter(col)}${row}`, "FORMULA");
  const value = cells[0]?.[0];
  return typeof value === "string" && value.startsWith("=") ? null : col;
}

/**
 * Returns the sheet row for `month`. A missing month is added below the last
 * month row, cloned from it (so formatting and the total formula carry over)
 * with every payment cell blanked. Months are only ever added in order: a
 * month that is not later than the last month row is refused.
 *
 * The clone OVERWRITES its target row without looking at it, and the Sheet cannot make "check, then
 * clone" one step. So the target row is read again as late as possible, right before the clone, and a row
 * that is no longer empty (someone added this month, or typed under the table, a moment ago) is refused.
 */
async function ensureMonthRow(
  ctx: SheetsContext,
  loaded: Snapshot,
  month: YearMonth,
  typedTotal: number | null,
): Promise<number> {
  const existing = findMonthRow(loaded.rows, month);
  if (existing) return existing.rowNumber;

  const last = loaded.rows[loaded.rows.length - 1];
  if (!last) {
    throw sheetStructure("The Schedule tab has no month rows to copy the format from.");
  }
  // Month rows are only ever added in order, so a month with no row of its own is refused unless it is
  // the very next one. The words say what to do: add the row by hand, or log the earlier month first.
  const title = formatMonthTitle(month);
  if (compareYm(month, last.month) <= 0) {
    throw validation(
      `Can't add ${title}: the Schedule already has ${formatMonthTitle(last.month)} below it. Add the row for ${title} in your Sheet, in date order, then try again.`,
    );
  }
  const following = addMonths(last.month, 1);
  if (compareYm(month, following) > 0) {
    throw validation(
      `Can't add ${title} yet: the Schedule's last month is ${formatMonthTitle(last.month)}. Log ${formatMonthTitle(following)} first, or add the row for ${title} in your Sheet.`,
    );
  }

  const { layout, portions } = loaded;
  const newRow = layout.lastDataRow + 1;

  // Blank every value the copy would carry over (portion cells, a typed total, notes,
  // columns of portions missing from Settings); keep only formulas and the Month cell.
  const source =
    (await ctx.gateway.getValues(ctx.scheduleTab, `A${layout.lastDataRow}:ZZ${layout.lastDataRow}`, "FORMULA"))[0] ?? [];
  const clearCols = new Set(
    portions.flatMap((p) => {
      const cols = columnsOf(layout, p.id);
      return [cols.tenant, cols.count, cols.amount];
    }),
  );
  source.forEach((cell, col) => {
    const isFormula = typeof cell === "string" && cell.startsWith("=");
    if (col !== layout.monthCol && cell !== "" && cell !== undefined && !isFormula) clearCols.add(col);
  });
  if (typedTotal !== null) clearCols.add(typedTotal);

  const below = await ctx.gateway.getValues(ctx.scheduleTab, `A${newRow}:ZZ${newRow}`, "FORMULA");
  const occupied = below.some((row) => row.some((cell) => cell !== undefined && cell !== ""));
  if (occupied) {
    throw conflict(
      `Row ${newRow} of the Schedule tab in your Sheet is below the last month but not empty, so a new month row cannot be added there. If someone else just added this month, ${RELOAD_STEP}, then try again.`,
    );
  }
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
  /**
   * Tenancy details for the new tenant. Only used together with `newTenantName`. Checked before
   * anything is written, so bad details refuse the whole request.
   */
  tenancy?: TenancyFields;
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
  /**
   * Only present when a new tenant was named. False when the payment was saved but the tenancy
   * rows could not be written; the details can be added from the tenant's page.
   */
  tenancyWritten?: boolean;
};

export type LogPaymentOptions = {
  now: Date;
  /** Email of the signed-in person. */
  loggedBy: string;
  retryDelayMs?: number;
};

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
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > MAX_RUPEES) {
    throw validation(wholeRupeesMessage("Amount", 1, MAX_RUPEES), "amount");
  }
  requireDay(input.dateReceived, "Date received");
  if (input.newTenantName === undefined) return undefined;
  return cleanText(input.newTenantName, "Tenant name", { max: MAX_NAME_LENGTH, required: true });
}

/** Writes are taken one at a time, in the order they arrive (see withWriteLock). */
export async function logPayment(
  ctx: SheetsContext,
  input: LogPaymentInput,
  options: LogPaymentOptions,
): Promise<LogPaymentResult> {
  return withWriteLock(async () => {
    try {
      return await logPaymentUnchecked(ctx, input, options);
    } finally {
      invalidateCaches(ctx);
    }
  });
}

const NOT_SAVED_MESSAGE = `Your change may not have been saved. ${reloadThen("check this month")}`;

type WrittenCell = { col: number; value: unknown };

const isEmptyCell = (cell: unknown) => cell === undefined || cell === null || cell === "";

/**
 * Reads the row just written (ONE read, unformatted) and refuses with a conflict when a cell this request
 * wrote does not hold what was written: the write did not land, or someone changed the cell a moment
 * later. Only the cells in `written` are compared; the rest of the row is nobody's business here.
 *
 * When the read itself fails (Google slow, limiting requests, a lost connection) nothing is known about the
 * cells, and they are already written. That is "written but not verified", not a conflict: it is logged on
 * the server and the caller carries on, so the Payments Log row is still added and the owner sees the
 * normal result. Only a read that came back and did not match is refused.
 */
async function confirmWritten(ctx: SheetsContext, row: number, written: WrittenCell[]): Promise<void> {
  let stored: unknown[];
  try {
    stored = (await ctx.gateway.getValues(ctx.scheduleTab, `A${row}:ZZ${row}`, "UNFORMATTED_VALUE"))[0] ?? [];
  } catch (error) {
    logEvent(
      "warn",
      "read-back-failed",
      errorLogFields(error, `Schedule row ${row} was written but could not be read back (written, not verified); carrying on`),
    );
    return;
  }
  const same = written.every(({ col, value }) =>
    isEmptyCell(value) ? isEmptyCell(stored[col]) : stored[col] === value,
  );
  if (!same) throw conflict(NOT_SAVED_MESSAGE);
}

async function logPaymentUnchecked(
  ctx: SheetsContext,
  input: LogPaymentInput,
  options: LogPaymentOptions,
): Promise<LogPaymentResult> {
  const newTenant = validateInput(input);
  // Bad tenancy details refuse the whole request, before anything is read or written.
  const newTenancy =
    newTenant !== undefined && input.tenancy !== undefined
      ? checkNewTenancy(input.portionId, newTenant, input.tenancy)
      : undefined;
  const loaded = await loadSnapshot(ctx);
  const portion = loaded.portions.find((p) => p.id === input.portionId);
  if (!portion) throw unknownPortion();

  const monthRow = findMonthRow(loaded.rows, input.month);
  const existing = findEntryForMonth(loaded.rows, portion.id, input.month);
  if (input.expected) {
    if (!existing) {
      throw conflict(
        `Nothing to edit. ${portion.name} has no payment recorded for ${formatMonthTitle(input.month)} any more. ${reloadThen("check the card")}`,
      );
    }
    if (!sameEntry(existing, input.expected)) {
      throw conflict(
        `${portion.name} for ${formatMonthTitle(input.month)} was changed by someone else. ${RELOAD_HINT}`,
      );
    }
  }
  if (existing && !input.overwrite) {
    throw conflict(
      `${portion.name} already has ${formatRupees(existing.amount)} recorded for ${formatMonthTitle(input.month)}.`,
      // The whole entry, so a Replace can send it back as `expected` and be refused if it changed since.
      { existingAmount: existing.amount, existingTenant: existing.tenant, existingCount: existing.count },
    );
  }
  if (!existing && monthRow && !input.overwrite) {
    // A cell with an amount but no valid count is not a complete entry, yet it is not empty either.
    const cols = columnsOf(loaded.layout, portion.id);
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
    throw validation("This portion has no tenant yet. Enter a tenant name.", "newTenantName");
  }

  // The total's style (formula or typed value) is read from the row being written;
  // for a new month that is the last month row, which the new row is cloned from.
  const totalRow = monthRow ? monthRow.rowNumber : loaded.layout.lastDataRow;
  const typedTotal = await typedTotalCol(ctx, loaded.layout, totalRow);
  const rowNumber = await ensureMonthRow(ctx, loaded, input.month, typedTotal);
  const cols = columnsOf(loaded.layout, portion.id);
  const at = (col: number) => `${colLetter(col)}${rowNumber}`;

  const cells: WrittenCell[] = [
    { col: cols.tenant, value: tenant },
    { col: cols.count, value: count },
    { col: cols.amount, value: input.amount },
  ];
  if (typedTotal !== null) {
    const others = loaded.portions
      .filter((p) => p.id !== portion.id)
      .map((p) => monthRow?.entries.get(p.id)?.amount);
    cells.push({ col: typedTotal, value: sumAmounts(others) + input.amount });
  }
  await ctx.gateway.updateValues(
    cells.map(({ col, value }) => ({ tab: ctx.scheduleTab, a1: at(col), values: [[value]] })),
  );
  await confirmWritten(ctx, rowNumber, cells);

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
  const result: LogPaymentResult = { entry: { tenant, count, amount: input.amount }, logWritten, logRow };

  if (newTenant !== undefined) {
    // The payment is already saved, so a tenancy failure is reported but never undoes it.
    try {
      // Read the Tenants tab again right before writing to it. A wrong header (even one changed since this
      // payment began) is a sheet-structure error here, and then nothing is written to the tab.
      const tenancies = await readTenancies(ctx.gateway);
      await recordNewTenant(
        ctx.gateway,
        tenancies,
        { portionId: portion.id, newTenancy, dateReceived: input.dateReceived },
        { now: options.now, updatedBy: options.loggedBy },
      );
      result.tenancyWritten = true;
    } catch (error) {
      logEvent("error", "tenancy-write-failed", errorLogFields(error, "The payment was saved, but the tenancy details were not"));
      result.tenancyWritten = false;
    }
  }
  return result;
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
  return withWriteLock(async () => {
    try {
      return await undoPaymentUnchecked(ctx, input, options);
    } finally {
      invalidateCaches(ctx);
    }
  });
}

async function undoPaymentUnchecked(
  ctx: SheetsContext,
  input: UndoPaymentInput,
  options: LogPaymentOptions,
): Promise<UndoPaymentResult> {
  validateMonth(input.month);
  const loaded = await loadSnapshot(ctx);
  const portion = loaded.portions.find((p) => p.id === input.portionId);
  if (!portion) throw unknownPortion();

  const matching = loaded.rows.filter(
    (row) => compareYm(row.month, input.month) === 0 && row.entries.get(portion.id),
  );
  const monthRow = matching[matching.length - 1];
  const existing = monthRow?.entries.get(portion.id);
  if (!monthRow || !existing) {
    throw conflict(
      `Nothing to undo. ${portion.name} has no payment recorded for ${formatMonthTitle(input.month)} any more. ${reloadThen("check the card")}`,
    );
  }
  if (!sameEntry(existing, input.expected)) {
    throw conflict(
      `${portion.name} for ${formatMonthTitle(input.month)} was changed by someone else. ${RELOAD_HINT}`,
    );
  }
  if (hasLaterEntry(loaded.rows, portion.id, input.month)) {
    throw conflict(LATER_ENTRY_REASON);
  }

  const cols = columnsOf(loaded.layout, portion.id);
  const at = (col: number) => `${colLetter(col)}${monthRow.rowNumber}`;
  const cells: WrittenCell[] = [
    { col: cols.tenant, value: "" },
    { col: cols.count, value: "" },
    { col: cols.amount, value: "" },
  ];
  const typedTotal = await typedTotalCol(ctx, loaded.layout, monthRow.rowNumber);
  if (typedTotal !== null) {
    const others = loaded.portions
      .filter((p) => p.id !== portion.id)
      .map((p) => monthRow.entries.get(p.id)?.amount);
    cells.push({ col: typedTotal, value: sumAmounts(others) });
  }
  await ctx.gateway.updateValues(
    cells.map(({ col, value }) => ({ tab: ctx.scheduleTab, a1: at(col), values: [[value]] })),
  );
  await confirmWritten(ctx, monthRow.rowNumber, cells);

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

/** At most this many tries to add one Payments Log row in a request. */
const LOG_ATTEMPTS = 3;
/** The longest wait between two tries, whatever delay the caller asks for. */
const LOG_MAX_WAIT_MS = 1_000;
/**
 * No new try starts when the tries so far, plus the wait before it, would pass this. The request holds the
 * write lock and must finish inside maxDuration (15 s), after its own reads and writes.
 */
const LOG_BUDGET_MS = 4_000;

/**
 * Adds a row to the Payments Log. Returns false when the row is not known to be there (the owner's "Try
 * again" button takes over). The reason of every failed try goes to the server log, without the row: it holds
 * a tenant's name and amounts.
 *
 * It adds the row a second time ONLY after Google refused it for sending too many requests: that refusal
 * means nothing was done. A timeout, a 5xx, a lost connection or any other error can come back after the
 * row was already added, so trying again could put it in twice. Those stop at once.
 */
async function appendLogRow(
  gateway: SheetsGateway,
  row: LogRow,
  retryDelayMs: number,
): Promise<boolean> {
  const started = Date.now();
  for (let attempt = 1; attempt <= LOG_ATTEMPTS; attempt++) {
    try {
      await gateway.appendRow(LOG_TAB, row);
      return true;
    } catch (error) {
      logEvent(
        "error",
        "payments-log-append-failed",
        errorLogFields(error, `Payments Log: try ${attempt} of ${LOG_ATTEMPTS} did not add the row`),
      );
      const cannotHaveLanded = error instanceof AppError && error.code === "rate-limited";
      if (!cannotHaveLanded || attempt === LOG_ATTEMPTS) return false;
      const wait = Math.min(retryDelayMs * attempt, LOG_MAX_WAIT_MS);
      if (Date.now() - started + wait > LOG_BUDGET_MS) return false;
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
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

const num = (value: unknown) => (typeof value === "number" ? value : null);

/** Every Payments Log row, newest first. */
async function loadActivity(ctx: SheetsContext): Promise<ActivityItem[]> {
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
  return items.reverse();
}

/**
 * The Payments Log rows, newest first: all of them, or the newest `limit`. The whole log is read (and kept) either way, so
 * asking for all of it costs no more than asking for a few. Rows from before "Logged by" and "Action" existed have no
 * logged-by and no action. `minFetchedAt` (ms since epoch) rejects a cached copy read before that time.
 */
export async function readActivity(
  ctx: SheetsContext,
  limit?: number,
  options: { minFetchedAt?: number } = {},
): Promise<ActivityItem[]> {
  const items = ctx.activityCache ? await ctx.activityCache.get(options.minFetchedAt) : await loadActivity(ctx);
  return items.slice(0, limit);
}

/** How many of the newest Payments Log rows a retry looks through for the row it is about to add. */
const RETRY_LOOKBACK_ROWS = 30;

/** The same entry of the log: saved at, month, portion and action match. Whoever logged it, and the amounts, do not matter. */
const sameLogEntry = (stored: unknown[], row: LogRow) =>
  text(stored[0]) === row[0] && text(stored[1]) === row[1] && text(stored[2]) === row[2] && text(stored[8]) === row[8];

/**
 * Second chance for a Payments Log row that failed after the Schedule was saved. Safe to repeat: when the newest
 * 30 rows of the log already hold this entry (an earlier try landed although it said it failed, or the same
 * retry arrived twice) it returns true and adds nothing. When the log cannot be read it cannot tell, so it adds
 * nothing and returns false: the person can try again.
 */
export async function retryLogRow(
  ctx: SheetsContext,
  row: LogRow,
  retryDelayMs = 400,
): Promise<boolean> {
  // One at a time, so two retries that arrive together cannot both find the log without the row.
  return withWriteLock(async () => {
    try {
      await ensureTabs(ctx.gateway, ctx.scheduleTab);
      let recent: unknown[][];
      try {
        recent = (await ctx.gateway.getValues(LOG_TAB, "A1:I", "UNFORMATTED_VALUE")).slice(-RETRY_LOOKBACK_ROWS);
      } catch (error) {
        logEvent(
          "error",
          "payments-log-check-failed",
          errorLogFields(error, "Payments Log: could not check whether the row is already there, so nothing was added"),
        );
        return false;
      }
      if (recent.some((stored) => sameLogEntry(stored, row))) return true;
      return await appendLogRow(ctx.gateway, row, retryDelayMs);
    } finally {
      invalidateCaches(ctx);
    }
  });
}
