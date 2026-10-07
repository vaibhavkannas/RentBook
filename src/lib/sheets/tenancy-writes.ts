import {
  currentTenancy,
  newTenancyId,
  sameTenantName,
  validateTenancyFields,
  validateTenantName,
  type Tenancy,
  type TenancyFields,
} from "@/lib/domain/tenancy";
import { isValidIsoDay } from "@/lib/domain/year-month";
import { conflict } from "@/lib/errors";
import type { SheetsGateway } from "./gateway";
import { appendTenancy, closeTenancyRow } from "./tenants-store";

/**
 * The tenancy write steps that `saveTenancy` (tenancy-service.ts) and `logPayment` (service.ts) share.
 * They live in their own module, which imports neither of those two, so that service.ts can use
 * them without a circular import. They never read the sheet: callers pass the tenancies they loaded.
 */

/** Who changed a row and when: written to the row's Updated by and Updated at cells. */
export type WriteStamp = { now: Date; updatedBy: string };

/** A new tenancy whose name and fields have already been checked. */
export type NewTenancy = {
  portionId: string;
  tenant: string;
  fields: ReturnType<typeof validateTenancyFields>;
};

/** Checks a new tenancy's name and fields without touching the sheet. Throws validation() when they are wrong. */
export function checkNewTenancy(portionId: string, tenant: string, fields: TenancyFields): NewTenancy {
  return {
    portionId,
    tenant: validateTenantName(tenant),
    fields: validateTenancyFields(fields),
  };
}

/**
 * The day a tenancy ends when a new tenant starts on `newMoveIn`: that day, but never before
 * the old tenancy's own move-in date. An old move-in that is not a real day (typed by hand) is ignored.
 */
export function closingDay(previousMoveIn: string, newMoveIn: string): string {
  return isValidIsoDay(previousMoveIn) && previousMoveIn > newMoveIn ? previousMoveIn : newMoveIn;
}

/**
 * Appends a new current tenancy. Refused with a conflict, before anything is written, when the portion's
 * current tenancy (in `tenancies`) already belongs to the same tenant name. The returned row number is
 * where the app appends: the row after the last one it read.
 */
export async function appendNewTenancy(
  gateway: SheetsGateway,
  tenancies: Tenancy[],
  checked: NewTenancy,
  stamp: WriteStamp,
): Promise<Tenancy> {
  const { portionId, tenant, fields } = checked;
  const existing = currentTenancy(tenancies, portionId);
  if (existing && sameTenantName(existing.tenant, tenant)) {
    throw conflict(`Details already exist for ${tenant}. Refresh the page.`);
  }
  const row: Omit<Tenancy, "rowNumber"> = {
    id: newTenancyId(stamp.now),
    portionId,
    tenant,
    phone: fields.phone,
    moveIn: fields.moveIn,
    agreementEnd: fields.agreementEnd,
    advance: fields.advance,
    advanceDate: fields.advanceDate,
    advanceStatus: fields.advance === null ? null : "Held",
    refund: null,
    deductions: null,
    notes: fields.notes,
    moveOut: "",
    updatedBy: stamp.updatedBy,
    updatedAt: stamp.now.toISOString(),
  };
  await appendTenancy(gateway, row);
  const lastRow = tenancies.reduce((last, t) => Math.max(last, t.rowNumber), 1);
  return { rowNumber: lastRow + 1, ...row };
}

/**
 * Writes `moveOut` (and who and when) into the tenancy's own row, with one write that touches only the
 * Move-out date, Updated by and Updated at cells. The rest of the row is never rewritten.
 */
export async function closeTenancy(
  gateway: SheetsGateway,
  tenancy: Tenancy,
  moveOut: string,
  stamp: WriteStamp,
): Promise<Tenancy> {
  const updatedAt = stamp.now.toISOString();
  await closeTenancyRow(gateway, tenancy.rowNumber, { moveOut, updatedBy: stamp.updatedBy, updatedAt });
  return { ...tenancy, moveOut, updatedBy: stamp.updatedBy, updatedAt };
}

/**
 * Closes EVERY open row of the portion in `tenancies` (not only the last one, so a row copied by hand
 * cannot stay open behind the new tenancy), in sheet order, each on `newMoveIn` but never before its own move-in.
 * `tenancies` is what the caller read before it appended anything, so a row it just added is not in it.
 */
export async function closeOpenTenancies(
  gateway: SheetsGateway,
  tenancies: Tenancy[],
  portionId: string,
  newMoveIn: string,
  stamp: WriteStamp,
): Promise<void> {
  for (const open of tenancies) {
    if (open.portionId !== portionId || open.moveOut !== "") continue;
    await closeTenancy(gateway, open, closingDay(open.moveIn, newMoveIn), stamp);
  }
}

/**
 * The tenancy work of a payment that starts a new tenant: add the new tenancy when details were given
 * (new row first), then close every open tenancy of the portion on the new move-in date, or on
 * the date received when no details were given. `tenancies` is what the payment's own load read.
 */
export async function recordNewTenant(
  gateway: SheetsGateway,
  tenancies: Tenancy[],
  input: { portionId: string; newTenancy: NewTenancy | undefined; dateReceived: string },
  stamp: WriteStamp,
): Promise<void> {
  if (input.newTenancy) await appendNewTenancy(gateway, tenancies, input.newTenancy, stamp);
  const newMoveIn = input.newTenancy?.fields.moveIn ?? input.dateReceived;
  await closeOpenTenancies(gateway, tenancies, input.portionId, newMoveIn, stamp);
}
