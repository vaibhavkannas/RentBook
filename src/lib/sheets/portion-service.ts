import { currentTenancy } from "@/lib/domain/tenancy";
import { findLatestEntry } from "@/lib/domain/month-view";
import type { PortionConfig } from "@/lib/domain/types";
import { occupancyFor } from "@/lib/domain/vacancy";
import { addMonths, isValidIsoDay } from "@/lib/domain/year-month";
import { AppError, conflict, sheetStructure, unknownPortion, validation } from "@/lib/errors";
import { RELOAD_HINT } from "@/lib/recovery-hint";
import { colLetter } from "./a1";
import type { CellWrite } from "./gateway";
import {
  checkNewPortion,
  planAddPortion,
  planReorder,
  planSetActive,
  planTotalNote,
  settingsHaveId,
  settingsRowIsFree,
  type NewPortion,
  type PlanInput,
} from "./portion-plan";
import { invalidateCaches, loadSnapshot, type SheetsContext, type Snapshot } from "./service";
import { readSettings, SETTINGS_TAB } from "./settings-store";
import { withWriteLock } from "./write-lock";

/**
 * Adding, switching off and switching on, and reordering portions: the only code that changes which portions the app has. The cells
 * each change writes are decided by portion-plan.ts; this reads the Sheet, asks for the plan, writes it RAW in an order whose
 * failure is always harmless, and checks what it wrote. Every change runs alone (withWriteLock), reads fresh (never a page cache),
 * never deletes or overwrites a cell that holds something, and throws the page caches away whether it worked or not.
 */

const SET_UP_HINT = " Set up shows what is wrong.";

/** The cells a plan reads: the Schedule's and the Settings tab's, wide enough for a new portion's columns and a free row. */
const SCHEDULE_RANGE = "A1:ZZ";
const SETTINGS_PLAN_RANGE = "A1:Z50";

/**
 * Runs a change on its own, and throws the page caches away when it ends, however it ends: a change that failed half way may
 * have written something, and a refusal after a read must not leave a page showing what was read before it.
 */
function changeSheet<T>(ctx: SheetsContext, run: () => Promise<T>): Promise<T> {
  return withWriteLock(async () => {
    try {
      return await run();
    } finally {
      invalidateCaches(ctx);
    }
  });
}

/** A fresh snapshot, which refuses a Sheet the app cannot read with its own message and where to look. */
async function loadForChange(ctx: SheetsContext): Promise<Snapshot> {
  try {
    return await loadSnapshot(ctx);
  } catch (error) {
    if (error instanceof AppError && error.code === "sheet-structure") {
      throw new AppError("sheet-structure", `${error.message}${SET_UP_HINT}`, error.details);
    }
    throw error;
  }
}

/** The snapshot, and what the planners are made from: both tabs read again, in one call, with the FORMULA render. */
async function readForPlan(ctx: SheetsContext): Promise<{ snapshot: Snapshot; plan: PlanInput }> {
  const snapshot = await loadForChange(ctx);
  const [schedule, settings] = await ctx.gateway.getManyValues(
    [
      { tab: ctx.scheduleTab, a1: SCHEDULE_RANGE },
      { tab: SETTINGS_TAB, a1: SETTINGS_PLAN_RANGE },
    ],
    "FORMULA",
  );
  return {
    snapshot,
    plan: {
      scheduleTab: ctx.scheduleTab,
      schedule,
      settings,
      portions: snapshot.portions,
      // A portion removed from Settings by hand leaves its tenants behind: its id is not given to a new portion.
      retiredIds: snapshot.tenancies.map((tenancy) => tenancy.portionId),
    },
  };
}

const isEmptyCell = (cell: unknown) => cell === undefined || cell === null || cell === "";

/**
 * Reads the cells just written back (ONE read, unformatted) and says whether each holds what was written, a cell written empty
 * reading empty. A read that fails is not swallowed: nothing is known about the cells, and the caller must not go on to a step
 * that depends on them.
 */
async function holdsWritten(ctx: SheetsContext, writes: CellWrite[]): Promise<boolean> {
  const answers = await ctx.gateway.getManyValues(
    writes.map(({ tab, a1 }) => ({ tab, a1 })),
    "UNFORMATTED_VALUE",
  );
  return writes.every((write, at) =>
    write.values.every((values, row) =>
      values.every((value, col) => {
        const stored = answers[at]?.[row]?.[col];
        return isEmptyCell(value) ? isEmptyCell(stored) : stored === value;
      }),
    ),
  );
}

export type AddPortionResult = {
  portion: PortionConfig;
  /** The Schedule columns of the new portion's Tenant, Count and Amount headers. */
  columns: { header: string; letter: string }[];
  /**
   * What to tell the owner when the Schedule's total adds the amounts up with a formula, which the app never edits: which column
   * to add to it. Null when there is nothing to add (the total holds typed numbers, which the app keeps up to date, or there is none).
   */
  totalNote: string | null;
};

/**
 * Adds a portion: three headers at the right of the Schedule and a row in the Settings tab. The steps are in an order whose failure
 * is always harmless. Headers without a Settings row are ignored by the app, and the next try adopts them; a Settings row without
 * its headers would stop every page from reading the Sheet, so it is always last, and only once the headers were read back.
 *
 * 1. room for the columns (never repeated),
 * 2. the header cells, read again right before they are written (they must still be empty), written, read back,
 * 3. the Settings tab read again: the planned row must still be empty and the id still unused,
 * 4. the Settings row, read back.
 */
export async function addPortion(ctx: SheetsContext, input: NewPortion): Promise<AddPortionResult> {
  // A bad request is refused before anything is read.
  const request = checkNewPortion(input);
  return changeSheet(ctx, async () => {
    const { snapshot, plan: planned } = await readForPlan(ctx);
    const plan = planAddPortion(planned, request);
    const headerCells: CellWrite = {
      tab: ctx.scheduleTab,
      a1: `${colLetter(plan.columns[0])}${plan.headerRow}:${colLetter(plan.columns[2])}${plan.headerRow}`,
      values: [plan.headers],
    };

    if (!plan.adopted) {
      await ctx.gateway.ensureColumnCount(ctx.scheduleTab, plan.minColumns);
      const there = await ctx.gateway.getValues(ctx.scheduleTab, headerCells.a1, "FORMULA");
      if (there.some((row) => row.some((cell) => !isEmptyCell(cell)))) {
        throw conflict(`Someone changed the Schedule tab a moment ago. ${RELOAD_HINT}`);
      }
      await ctx.gateway.updateValues(plan.scheduleWrites);
    }
    // Also for headers that were there already: a Settings row must never point at columns that are not.
    if (!(await holdsWritten(ctx, [headerCells]))) {
      throw conflict(`The new Schedule columns may not have been saved. Check row ${plan.headerRow} of your Schedule, then try again.`);
    }

    const settingsNow = await ctx.gateway.getValues(SETTINGS_TAB, SETTINGS_PLAN_RANGE, "FORMULA");
    if (!settingsRowIsFree(settingsNow, plan.settingsRow) || settingsHaveId(settingsNow, plan.id)) {
      throw conflict(`Someone changed the Settings tab a moment ago. ${RELOAD_HINT}`);
    }
    await ctx.gateway.updateValues(plan.settingsWrites);
    if (!(await holdsWritten(ctx, plan.settingsWrites))) {
      throw conflict(`The new portion may not have been saved. Check row ${plan.settingsRow} of your Settings tab, then try again.`);
    }

    return {
      portion: {
        id: plan.id,
        name: request.name,
        tenantHeader: plan.headers[0],
        countHeader: plan.headers[1],
        amountHeader: plan.headers[2],
        cycleLength: request.cycleLength,
        hikePercent: request.hikePercent,
      },
      columns: plan.headers.map((header, at) => ({ header, letter: colLetter(plan.columns[at]) })),
      totalNote: planTotalNote(planned.schedule, snapshot.layout, ctx.totalHeader, plan, request.name),
    };
  });
}

export type SetPortionActiveInput = {
  id: string;
  active: boolean;
  /** Today, YYYY-MM-DD in the app's time zone: a portion can be switched off once it is vacant in the month after today's. */
  today: string;
};

/**
 * Why a portion that is on may not be switched off yet, or nothing. It must have no open tenancy and be vacant, or never have had
 * a tenant, in the month after today's month (so a tenant who moves out on the 1st of next month already lets it be switched off).
 * Another portion must stay on. A Tenants tab that cannot be read refuses: a tenant cannot be ruled out.
 */
function requireCanSwitchOff(snapshot: Snapshot, portion: PortionConfig, today: string): void {
  if (snapshot.tenantsProblem !== undefined) throw sheetStructure(snapshot.tenantsProblem);
  const [year, month] = today.split("-").map(Number);
  const open = currentTenancy(snapshot.tenancies, portion.id);
  const occupancy = occupancyFor(snapshot.rows, snapshot.tenancies, portion.id, addMonths({ year, month }, 1));
  if (open !== null || occupancy.state === "occupied") {
    const tenant = open?.tenant || findLatestEntry(snapshot.rows, portion.id)?.tenant || "";
    throw conflict(`${portion.name} still has a tenant${tenant === "" ? "" : ` (${tenant})`}. Record the move-out on the tenant page first.`);
  }
  if (snapshot.portions.every((other) => other.id === portion.id || other.inactive)) {
    throw validation("Keep at least one portion switched on.");
  }
}

/**
 * Switches a portion off ("No" in its Active cell, and "Active" in H1 when it is blank) or on ("Yes"), then reads the cell back.
 * Writes nothing when the portion already is as asked. Its Schedule columns, entries and tenants are not touched: a switched-off
 * portion keeps its history.
 */
export async function setPortionActive(ctx: SheetsContext, input: SetPortionActiveInput): Promise<{ portions: PortionConfig[] }> {
  if (!isValidIsoDay(input.today)) throw validation("Today's date must be a real day, written YYYY-MM-DD.");
  return changeSheet(ctx, async () => {
    const { snapshot, plan } = await readForPlan(ctx);
    const portion = snapshot.portions.find((candidate) => candidate.id === input.id);
    if (portion === undefined) throw unknownPortion();
    const writes = planSetActive(plan, input.id, input.active);
    if (writes.length === 0) return { portions: snapshot.portions };
    if (!input.active) requireCanSwitchOff(snapshot, portion, input.today);

    await ctx.gateway.updateValues(writes);
    if (!(await holdsWritten(ctx, writes))) {
      throw conflict(`${portion.name} may not have been switched ${input.active ? "on" : "off"}. Check column H of the Settings tab, then try again.`);
    }
    return { portions: await readSettings(ctx.gateway) };
  });
}

/**
 * Puts the portions in the order of `ids`, which must be exactly the portions there are: one write of the Settings rows that
 * change, read back row by row. Nothing is written for an order that has not changed. The Schedule's columns do not move.
 */
export async function reorderPortions(ctx: SheetsContext, input: { ids: string[] }): Promise<{ portions: PortionConfig[] }> {
  return changeSheet(ctx, async () => {
    const { snapshot, plan } = await readForPlan(ctx);
    const writes = planReorder(plan, input.ids);
    if (writes.length === 0) return { portions: snapshot.portions };

    await ctx.gateway.updateValues(writes);
    if (!(await holdsWritten(ctx, writes))) {
      throw conflict("The new order may not have been saved fully. Open the Settings tab and check the order (File > Version history can restore it).");
    }
    return { portions: await readSettings(ctx.gateway) };
  });
}
