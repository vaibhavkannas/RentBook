import { cleanText, requireDay } from "@/lib/domain/input-rules";
import { findLatestEntry } from "@/lib/domain/month-view";
import {
  currentTenancy,
  isAdvanceStatus,
  MAX_NOTES_LENGTH,
  MAX_RUPEES,
  newTenancyId,
  pastTenancies,
  sameTenantName,
  validateTenancyFields,
  validateTenantName,
  type AdvanceStatus,
  type Tenancy,
  type TenancyFields,
} from "@/lib/domain/tenancy";
import type { PortionConfig } from "@/lib/domain/types";
import { lastRentMonth, vacancyOf } from "@/lib/domain/vacancy";
import { isValidIsoDay, ymKey } from "@/lib/domain/year-month";
import { conflict, PAGE_OUT_OF_DATE_MESSAGE, sheetStructure, unknownPortion, validation } from "@/lib/errors";
import { formatMonthTitle, wholeRupeesMessage } from "@/lib/format";
import { RELOAD_HINT, reloadThen } from "@/lib/recovery-hint";
import { invalidateCaches, loadSnapshot, type SheetsContext, type Snapshot } from "./service";
import { withWriteLock } from "./write-lock";
import { checkNewTenancy, recordNewTenant, type WriteStamp } from "./tenancy-writes";
import { appendTenancy, readTenancies, writeTenancyEdit, writeTenancyMoveOut } from "./tenants-store";

export type SaveTenancyInput = {
  portionId: string;
  /** Used only when creating. */
  tenant: string;
  fields: TenancyFields;
  /** Present = update that tenancy. */
  id?: string;
  /** Required when `id` is present: the `updatedAt` the person saw. */
  expectedUpdatedAt?: string;
};

export type MoveOutInput = {
  id: string;
  expectedUpdatedAt: string;
  /** YYYY-MM-DD */
  moveOut: string;
  advanceStatus?: AdvanceStatus | null;
  refund?: number | null;
  deductions?: number | null;
  notes?: string;
};

/** Recording that the Schedule's tenant has moved out, when no details were ever added for them. */
export type MoveOutWithoutDetailsInput = {
  portionId: string;
  /** The tenant the person saw named in the Schedule. */
  tenant: string;
  /** YYYY-MM-DD */
  moveOut: string;
  notes?: string;
};

export type PortionTenants = {
  portion: PortionConfig;
  /** Tenant named in the Schedule's latest entry for this portion, or null. */
  scheduleTenant: string | null;
  /** Current tenancy only when its tenant matches scheduleTenant. */
  current: Tenancy | null;
  /** A current tenancy on file for a different tenant name (will be closed when new details are added). */
  mismatched: Tenancy | null;
  past: Tenancy[];
  /**
   * The day the portion's last tenant moved out (YYYY-MM-DD), when the Schedule's tenant has moved out and nothing since says
   * they stayed (see `vacancyOf`). Null when the portion is not vacant. Always null when the Tenants tab cannot be used.
   */
  vacantSince: string | null;
  /**
   * Set when the Tenants tab cannot be used (for example a header was changed): what is wrong. Then there are
   * no tenancies to show, and saving details is refused until the tab is fixed.
   */
  tenantsProblem?: string;
};

/** A tenancy write needs a usable Tenants tab: a wrong header refuses it, before anything is written. */
function requireUsableTenants(snapshot: Snapshot): void {
  if (snapshot.tenantsProblem !== undefined) throw sheetStructure(snapshot.tenantsProblem);
}

function requirePortion(snapshot: Snapshot, portionId: string): PortionConfig {
  const portion = snapshot.portions.find((p) => p.id === portionId);
  if (!portion) throw unknownPortion();
  return portion;
}

/** The tenant the Schedule's latest entry for the portion names, or null when there is none (or the cell is blank). */
function scheduleTenantOf(snapshot: Snapshot, portionId: string): string | null {
  return findLatestEntry(snapshot.rows, portionId)?.tenant || null;
}

/**
 * The tenancy with this id, which must still be current. If a row was copied by hand and kept its id,
 * the LAST row with that id is the one that counts, like every other "last row wins" rule of the Sheet.
 */
function requireOpenTenancy(snapshot: Snapshot, id: string): Tenancy {
  const found = snapshot.tenancies.findLast((t) => t.id === id);
  if (!found) {
    throw conflict(`These tenant details are no longer in the Tenants tab in your Sheet. ${reloadThen("check the details")}`);
  }
  if (found.moveOut !== "") {
    throw conflict(`${found.tenant} has already moved out. ${reloadThen("check the details")}`);
  }
  return found;
}

/** A stale screen must never overwrite a newer change. */
function requireSeen(found: Tenancy, expectedUpdatedAt: string): void {
  if (found.updatedAt !== expectedUpdatedAt) {
    throw conflict(
      `The tenancy of ${found.tenant} was changed by someone else. ${RELOAD_HINT}`,
    );
  }
}

/**
 * Creates a tenancy (no `id`) or updates one. Creating closes the portion's previous current tenancy
 * when its tenant name is different. Both read fresh data, never the cache, and clear the cache after.
 */
export async function saveTenancy(
  ctx: SheetsContext,
  input: SaveTenancyInput,
  options: WriteStamp,
): Promise<{ tenancy: Tenancy }> {
  return withWriteLock(async () => {
    try {
      return input.id === undefined
        ? await createTenancy(ctx, input, options)
        : await updateTenancy(ctx, input, input.id, options);
    } finally {
      invalidateCaches(ctx);
    }
  });
}

async function createTenancy(
  ctx: SheetsContext,
  input: SaveTenancyInput,
  stamp: WriteStamp,
): Promise<{ tenancy: Tenancy }> {
  const checked = checkNewTenancy(input.portionId, input.tenant, input.fields);
  const snapshot = await loadSnapshot(ctx);
  requireUsableTenants(snapshot);
  const portion = requirePortion(snapshot, input.portionId);

  // The person saw one tenant's name; the Schedule must still name that tenant.
  const scheduleTenant = scheduleTenantOf(snapshot, input.portionId);
  if (scheduleTenant === null) throw validation("This portion has no tenant yet.");
  if (!sameTenantName(scheduleTenant, checked.tenant)) {
    throw conflict(`The tenant for ${portion.name} changed. ${RELOAD_HINT}`);
  }

  // Add the new row first; only then close the ones it replaces, so a failed append closes nothing.
  const tenancy = await recordNewTenant(
    ctx.gateway,
    snapshot.tenancies,
    { portionId: input.portionId, newTenancy: checked, dateReceived: checked.fields.moveIn },
    stamp,
  );
  // A new tenancy was given, so recordNewTenant returns it as it is stored.
  return { tenancy: tenancy! };
}

async function updateTenancy(
  ctx: SheetsContext,
  input: SaveTenancyInput,
  id: string,
  stamp: WriteStamp,
): Promise<{ tenancy: Tenancy }> {
  const fields = validateTenancyFields(input.fields);
  // Only a missing value is refused: a hand-typed row can have an empty Updated at, which a screen sends as "".
  if (input.expectedUpdatedAt === undefined) {
    throw validation(PAGE_OUT_OF_DATE_MESSAGE);
  }
  const snapshot = await loadSnapshot(ctx);
  requireUsableTenants(snapshot);
  requirePortion(snapshot, input.portionId);

  const stored = requireOpenTenancy(snapshot, id);
  if (stored.portionId !== input.portionId) {
    throw validation("That tenancy belongs to a different portion.");
  }
  requireSeen(stored, input.expectedUpdatedAt);

  // Only what the person actually changed is written. A cell the app cannot read (text typed into Advance, an
  // unknown status) and a value that is the same as before are left exactly as they are in the Sheet.
  const columns = {
    phone: fields.phone !== stored.phone.trim(),
    moveIn: fields.moveIn !== stored.moveIn,
    agreementEnd: fields.agreementEnd !== stored.agreementEnd,
    advance: fields.advance !== stored.advance,
    advanceDate: fields.advanceDate !== stored.advanceDate,
    // The status follows the advance only when the advance appears or goes away: no advance, no status; a new
    // advance starts as Held; a changed amount keeps its status.
    status: (fields.advance === null) !== (stored.advance === null),
    notes: fields.notes !== stored.notes.trim(),
  };
  const updated: Tenancy = {
    ...stored,
    phone: columns.phone ? fields.phone : stored.phone,
    moveIn: columns.moveIn ? fields.moveIn : stored.moveIn,
    agreementEnd: columns.agreementEnd ? fields.agreementEnd : stored.agreementEnd,
    advance: columns.advance ? fields.advance : stored.advance,
    advanceDate: columns.advanceDate ? fields.advanceDate : stored.advanceDate,
    advanceStatus: columns.status
      ? fields.advance === null
        ? null
        : (stored.advanceStatus ?? "Held")
      : stored.advanceStatus,
    notes: columns.notes ? fields.notes : stored.notes,
    updatedBy: stamp.updatedBy,
    updatedAt: stamp.now.toISOString(),
  };
  await writeTenancyEdit(ctx.gateway, stored.rowNumber, updated, columns);
  return { tenancy: updated };
}

/** Whole rupees from 0 to MAX_RUPEES, or null. `undefined` means "not given". */
function checkRupees(value: number | null | undefined, label: string): number | null | undefined {
  if (value === undefined || value === null) return value;
  if (!Number.isInteger(value) || value < 0 || value > MAX_RUPEES) {
    throw validation(wholeRupeesMessage(label, 0, MAX_RUPEES));
  }
  return value;
}

/**
 * A move-out cannot come before the first day of the month the tenant's rent was last logged for in the Schedule: that
 * rent says they lived there. A tenant the Schedule never names for the portion has no such month.
 */
function requireMoveOutAfterRent(snapshot: Snapshot, portionId: string, tenant: string, moveOut: string): void {
  const last = lastRentMonth(snapshot.rows, portionId, tenant);
  if (last === null || moveOut >= `${ymKey(last)}-01`) return;
  const title = formatMonthTitle(last);
  throw validation(
    `${tenant.trim()} has rent logged for ${title}. Choose a move-out date in ${title} or later, or undo that payment first.`,
    "moveOut",
  );
}

/**
 * Closes a current tenancy: records the move-out date, what happened to the advance, the refund,
 * the deductions and (when given) new notes. The Schedule is not touched; the portion shows as vacant from
 * the first month on or after the move-out (see vacancy.ts).
 */
export async function moveOutTenancy(
  ctx: SheetsContext,
  input: MoveOutInput,
  options: WriteStamp,
): Promise<{ tenancy: Tenancy }> {
  return withWriteLock(async () => {
    try {
      return await moveOutUnchecked(ctx, input, options);
    } finally {
      invalidateCaches(ctx);
    }
  });
}

async function moveOutUnchecked(
  ctx: SheetsContext,
  input: MoveOutInput,
  stamp: WriteStamp,
): Promise<{ tenancy: Tenancy }> {
  const moveOut = (input.moveOut ?? "").trim();
  requireDay(moveOut, "Move-out date");
  const refund = checkRupees(input.refund, "Refund");
  const deductions = checkRupees(input.deductions, "Deductions");
  if (
    input.advanceStatus !== undefined &&
    input.advanceStatus !== null &&
    !isAdvanceStatus(input.advanceStatus)
  ) {
    throw validation("Advance outcome must be Held, Refunded or Adjusted.");
  }
  const notes =
    input.notes === undefined
      ? undefined
      : cleanText(input.notes, "Notes", { max: MAX_NOTES_LENGTH, allowNewlines: true });
  if (input.expectedUpdatedAt === undefined) {
    throw validation(PAGE_OUT_OF_DATE_MESSAGE);
  }

  const snapshot = await loadSnapshot(ctx);
  requireUsableTenants(snapshot);
  const stored = requireOpenTenancy(snapshot, input.id);
  requireSeen(stored, input.expectedUpdatedAt);
  if (isValidIsoDay(stored.moveIn) && moveOut < stored.moveIn) {
    throw validation("Move-out date cannot be before the move-in date.", "moveOut");
  }
  requireMoveOutAfterRent(snapshot, stored.portionId, stored.tenant, moveOut);

  // Only a tenancy with an advance has an outcome. A column the person gave nothing for is not written at all,
  // so text typed by hand into it stays; the returned tenancy then shows what the Sheet still holds.
  const columns = {
    status: input.advanceStatus != null && stored.advance !== null,
    refund: refund !== undefined,
    deductions: deductions !== undefined,
    notes: notes !== undefined,
  };
  const closed: Tenancy = {
    ...stored,
    moveOut,
    advanceStatus: columns.status ? (input.advanceStatus ?? null) : stored.advanceStatus,
    refund: refund === undefined ? stored.refund : refund,
    deductions: deductions === undefined ? stored.deductions : deductions,
    notes: notes === undefined ? stored.notes : notes,
    updatedBy: stamp.updatedBy,
    updatedAt: stamp.now.toISOString(),
  };
  await writeTenancyMoveOut(ctx.gateway, stored.rowNumber, closed, columns);
  return { tenancy: closed };
}

/**
 * Records that the tenant the Schedule names for a portion has moved out, when the Tenants tab has no details for them:
 * adds one closed row (a new id, the portion, the tenant, no move-in date, the move-out date, the notes, who and when). Reads
 * fresh and refuses with a conflict when the Schedule no longer names `tenant`, when the portion has an open tenancy, or when
 * the tenant has already moved out, so a page that is out of date adds nothing. Nothing is overwritten, and the Schedule is
 * not touched. The row is read back by its id, as the row's number is where Google put it.
 */
export async function moveOutWithoutDetails(
  ctx: SheetsContext,
  input: MoveOutWithoutDetailsInput,
  stamp: WriteStamp,
): Promise<{ tenancy: Tenancy }> {
  return withWriteLock(async () => {
    try {
      return await moveOutWithoutDetailsUnchecked(ctx, input, stamp);
    } finally {
      invalidateCaches(ctx);
    }
  });
}

async function moveOutWithoutDetailsUnchecked(
  ctx: SheetsContext,
  input: MoveOutWithoutDetailsInput,
  stamp: WriteStamp,
): Promise<{ tenancy: Tenancy }> {
  const tenant = validateTenantName(input.tenant);
  const moveOut = (input.moveOut ?? "").trim();
  requireDay(moveOut, "Move-out date");
  const notes =
    input.notes === undefined
      ? ""
      : cleanText(input.notes, "Notes", { max: MAX_NOTES_LENGTH, allowNewlines: true });

  const snapshot = await loadSnapshot(ctx);
  requireUsableTenants(snapshot);
  const portion = requirePortion(snapshot, input.portionId);

  // The person saw one tenant's name; the Schedule must still name that tenant.
  const scheduleTenant = scheduleTenantOf(snapshot, input.portionId);
  if (scheduleTenant === null) throw validation("This portion has no tenant yet.");
  if (!sameTenantName(scheduleTenant, tenant)) {
    throw conflict(`The tenant for ${portion.name} changed. ${RELOAD_HINT}`);
  }
  // With details on file, the tenant is moved out with Move out on those details; and a tenant who has moved out already
  // is not moved out twice.
  const open = currentTenancy(snapshot.tenancies, input.portionId);
  if (open) {
    throw conflict(`${portion.name} already has details on file for ${open.tenant}. ${reloadThen("check the details")}`);
  }
  if (vacancyOf(snapshot.rows, snapshot.tenancies, input.portionId) !== null) {
    throw conflict(`${scheduleTenant.trim()} has already moved out. ${reloadThen("check the details")}`);
  }
  requireMoveOutAfterRent(snapshot, portion.id, scheduleTenant, moveOut);

  const row: Omit<Tenancy, "rowNumber"> = {
    id: newTenancyId(),
    portionId: portion.id,
    tenant: scheduleTenant.trim(),
    phone: "",
    moveIn: "",
    agreementEnd: "",
    advance: null,
    advanceDate: "",
    advanceStatus: null,
    refund: null,
    deductions: null,
    notes,
    moveOut,
    updatedBy: stamp.updatedBy,
    updatedAt: stamp.now.toISOString(),
  };
  await appendTenancy(ctx.gateway, row);
  // Where Google put the row is not known (a blank row inside the tab makes it land there), so find it again by its id.
  const written = (await readTenancies(ctx.gateway)).findLast((t) => t.id === row.id);
  if (!written) {
    throw conflict(
      `The Tenants tab in your Sheet changed while the move-out was being saved. ${reloadThen("check the details")}`,
    );
  }
  return { tenancy: written };
}

/**
 * What a portion's tenant page shows. Uses the page-view cache when the context has one
 * (`minFetchedAt` demands data newer than that time), like `getMonthView`.
 */
export async function getPortionTenants(
  ctx: SheetsContext,
  portionId: string,
  options: { minFetchedAt?: number } = {},
): Promise<PortionTenants> {
  const snapshot = ctx.cache ? await ctx.cache.get(options.minFetchedAt) : await loadSnapshot(ctx);
  const portion = requirePortion(snapshot, portionId);

  const scheduleTenant = scheduleTenantOf(snapshot, portionId);
  if (snapshot.tenantsProblem !== undefined) {
    return {
      portion,
      scheduleTenant,
      current: null,
      mismatched: null,
      past: [],
      vacantSince: null,
      tenantsProblem: snapshot.tenantsProblem,
    };
  }
  const onFile = currentTenancy(snapshot.tenancies, portionId);
  const matches = onFile !== null && scheduleTenant !== null && sameTenantName(onFile.tenant, scheduleTenant);
  return {
    portion,
    scheduleTenant,
    current: matches ? onFile : null,
    mismatched: onFile !== null && !matches ? onFile : null,
    past: pastTenancies(snapshot.tenancies, portionId),
    vacantSince: vacancyOf(snapshot.rows, snapshot.tenancies, portionId)?.since ?? null,
  };
}
