import { findLatestEntry } from "@/lib/domain/month-view";
import {
  currentTenancy,
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
import { conflict, validation } from "@/lib/errors";
import { loadSnapshot, type SheetsContext, type Snapshot } from "./service";
import {
  appendNewTenancy,
  checkNewTenancy,
  closeOpenTenancies,
  type WriteStamp,
} from "./tenancy-writes";
import { writeTenancyEdit, writeTenancyMoveOut } from "./tenants-store";

const ADVANCE_STATUSES: readonly string[] = ["Held", "Refunded", "Adjusted"] satisfies AdvanceStatus[];
const MAX_NOTES_LENGTH = 500;

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
};

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
  try {
    return input.id === undefined
      ? await createTenancy(ctx, input, options)
      : await updateTenancy(ctx, input, input.id, options);
  } finally {
    ctx.cache?.invalidate();
  }
}

async function createTenancy(
  ctx: SheetsContext,
  input: SaveTenancyInput,
  stamp: WriteStamp,
): Promise<{ tenancy: Tenancy }> {
  const checked = checkNewTenancy(input.portionId, input.tenant, input.fields);
  const snapshot = await loadSnapshot(ctx);
  const portion = requirePortion(snapshot, input.portionId);

  // The person saw one tenant's name; the Schedule must still name that tenant.
  const scheduleTenant = scheduleTenantOf(snapshot, input.portionId);
  if (scheduleTenant === null) throw validation("This portion has no tenant yet.");
  if (!sameTenantName(scheduleTenant, checked.tenant)) {
    throw conflict(`The tenant for ${portion.name} changed. Refresh the page.`);
  }

  // Add the new row first; only then close the ones it replaces, so a failed append closes nothing.
  const tenancy = await appendNewTenancy(ctx.gateway, snapshot.tenancies, checked, stamp);
  await closeOpenTenancies(ctx.gateway, snapshot.tenancies, input.portionId, tenancy.moveIn, stamp);
  return { tenancy };
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
  requirePortion(snapshot, input.portionId);

  const stored = requireOpenTenancy(snapshot, id);
  if (stored.portionId !== input.portionId) {
    throw validation("That tenancy belongs to a different portion.");
  }
  requireSeen(stored, input.expectedUpdatedAt);

  const updated: Tenancy = {
    ...stored,
    phone: fields.phone,
    moveIn: fields.moveIn,
    agreementEnd: fields.agreementEnd,
    advance: fields.advance,
    advanceDate: fields.advanceDate,
    // No advance, no status. A new advance starts as Held. A changed amount keeps its status.
    advanceStatus: fields.advance === null ? null : (stored.advanceStatus ?? "Held"),
    notes: fields.notes,
    updatedBy: stamp.updatedBy,
    updatedAt: stamp.now.toISOString(),
  };
  // Only the columns an edit changes are written: the rest of the row stays as it is in the Sheet.
  await writeTenancyEdit(ctx.gateway, stored.rowNumber, updated);
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
  try {
    return await moveOutUnchecked(ctx, input, options);
  } finally {
    ctx.cache?.invalidate();
  }
}

async function moveOutUnchecked(
  ctx: SheetsContext,
  input: MoveOutInput,
  stamp: WriteStamp,
): Promise<{ tenancy: Tenancy }> {
  const moveOut = (input.moveOut ?? "").trim();
  if (!isValidIsoDay(moveOut)) throw validation("Move-out date must be a real date (YYYY-MM-DD).");
  const refund = checkRupees(input.refund, "Refund");
  const deductions = checkRupees(input.deductions, "Deductions");
  if (
    input.advanceStatus !== undefined &&
    input.advanceStatus !== null &&
    !ADVANCE_STATUSES.includes(input.advanceStatus)
  ) {
    throw validation("Advance outcome must be Held, Refunded or Adjusted.");
  }
  const notes = input.notes === undefined ? undefined : input.notes.trim();
  if (notes !== undefined && notes.length > MAX_NOTES_LENGTH) {
    throw validation(`Notes can have at most ${MAX_NOTES_LENGTH} characters.`);
  }
  if (input.expectedUpdatedAt === undefined) {
    throw validation("Moving out needs the updated-at value the person saw.");
  }

  const snapshot = await loadSnapshot(ctx);
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
