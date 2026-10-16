import { cleanText, requireDay } from "@/lib/domain/input-rules";
import { findLatestEntry } from "@/lib/domain/month-view";
import {
  currentTenancy,
  isAdvanceStatus,
  MAX_NOTES_LENGTH,
  MAX_RUPEES,
  pastTenancies,
  sameTenantName,
  validateTenancyFields,
  type AdvanceStatus,
  type Tenancy,
  type TenancyFields,
} from "@/lib/domain/tenancy";
import type { PortionConfig } from "@/lib/domain/types";
import { isValidIsoDay } from "@/lib/domain/year-month";
import { conflict, sheetStructure, validation } from "@/lib/errors";
import { invalidateCaches, loadSnapshot, type SheetsContext, type Snapshot } from "./service";
import { withWriteLock } from "./write-lock";
import { checkNewTenancy, recordNewTenant, type WriteStamp } from "./tenancy-writes";
import { writeTenancyEdit, writeTenancyMoveOut } from "./tenants-store";

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
  if (!portion) throw validation(`Unknown portion "${portionId}".`);
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
    throw conflict("These tenant details are no longer in the Tenants tab. Refresh the page.");
  }
  if (found.moveOut !== "") {
    throw conflict(`${found.tenant} has already moved out. Refresh the page.`);
  }
  return found;
}

/** A stale screen must never overwrite a newer change. */
function requireSeen(found: Tenancy, expectedUpdatedAt: string): void {
  if (found.updatedAt !== expectedUpdatedAt) {
    throw conflict(
      `The tenancy of ${found.tenant} was changed by someone else. Refresh the page and try again.`,
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
    throw conflict(`The tenant for ${portion.name} changed. Refresh the page.`);
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
    throw validation("Updating a tenancy needs the updated-at value the person saw.");
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
    throw validation(`${label} must be a whole number of rupees from 0 to 10,000,000.`);
  }
  return value;
}

/**
 * Closes a current tenancy: records the move-out date, what happened to the advance, the refund,
 * the deductions and (when given) new notes. The Schedule is not touched.
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
    throw validation("Moving out needs the updated-at value the person saw.");
  }

  const snapshot = await loadSnapshot(ctx);
  requireUsableTenants(snapshot);
  const stored = requireOpenTenancy(snapshot, input.id);
  requireSeen(stored, input.expectedUpdatedAt);
  if (isValidIsoDay(stored.moveIn) && moveOut < stored.moveIn) {
    throw validation("Move-out date cannot be before the move-in date.");
  }

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
  };
}
