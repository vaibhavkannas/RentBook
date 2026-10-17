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
import { RELOAD_HINT, reloadThen } from "@/lib/recovery-hint";
import type { SheetsGateway } from "./gateway";
import { appendTenancy, closeTenancyRow, readTenancies, reopenTenancyRow } from "./tenants-store";

/**
 * The tenancy write steps that `saveTenancy` (tenancy-service.ts) and `logPayment` (service.ts) share.
 * They live in their own module, which imports neither of those two, so that service.ts can use
 * them without a circular import. Callers pass the tenancies they loaded; recordNewTenant reads the Tenants tab
 * once more after its append, to find the rows to close where they are now.
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
 * Appends a new current tenancy and returns the row it wrote (without a row number). Refused with a conflict,
 * before anything is written, when the portion's current tenancy (in `tenancies`) already belongs to the same
 * tenant name. Where Google puts the row is not known here: a blank row inside the tab makes it land there and
 * moves the rows below it down. The caller finds the row again by its id (see recordNewTenant).
 */
async function appendNewTenancy(
  gateway: SheetsGateway,
  tenancies: Tenancy[],
  checked: NewTenancy,
  stamp: WriteStamp,
): Promise<Omit<Tenancy, "rowNumber">> {
  const { portionId, tenant, fields } = checked;
  const existing = currentTenancy(tenancies, portionId);
  if (existing && sameTenantName(existing.tenant, tenant)) {
    throw conflict(`Details already exist for ${tenant}. ${reloadThen("check the details")}`);
  }
  const row: Omit<Tenancy, "rowNumber"> = {
    id: newTenancyId(),
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
  return row;
}

/**
 * Writes `moveOut` (and who and when) into the tenancy's own row, with one write that touches only the
 * Move-out date, Updated by and Updated at cells. The rest of the row is never rewritten.
 */
async function closeTenancy(
  gateway: SheetsGateway,
  tenancy: Tenancy,
  moveOut: string,
  stamp: WriteStamp,
): Promise<void> {
  await closeTenancyRow(gateway, tenancy.rowNumber, {
    moveOut,
    updatedBy: stamp.updatedBy,
    updatedAt: stamp.now.toISOString(),
  });
}

/**
 * The tenancy work of a new tenant: add the new tenancy when details were given (new row first), then close the
 * portion's previous open tenancies on the new move-in date, or on the date received when no details were given.
 * `tenancies` is what the caller read before it wrote anything. The previous open tenancies are taken from it,
 * but the rows to close are found again by their ID in a fresh read after the append, because the append can
 * move rows (a blank row inside the Tenants tab). A previous tenancy that is no longer there, or that someone
 * has closed in the meantime, is skipped. Each is closed no earlier than its own move-in date.
 *
 * An open tenancy of the same tenant name as the new tenant (`tenant`, compared as the vacancy rule compares names) is NOT
 * closed: it is the same person starting a count again, not a tenant who left, and a closed row of that name would read as
 * a move-out that nobody recorded and make the portion vacant. Only a different name means the old tenant left.
 *
 * Returns the new tenancy as it is stored now, or null when no details were given. Closes nothing and refuses
 * with a conflict when the row that was just appended cannot be found again.
 */
export async function recordNewTenant(
  gateway: SheetsGateway,
  tenancies: Tenancy[],
  input: { portionId: string; tenant: string; newTenancy: NewTenancy | undefined; dateReceived: string },
  stamp: WriteStamp,
): Promise<Tenancy | null> {
  const previousIds = new Set(
    tenancies
      .filter((t) => t.portionId === input.portionId && t.moveOut === "" && !sameTenantName(t.tenant, input.tenant))
      .map((t) => t.id),
  );
  const added = input.newTenancy
    ? await appendNewTenancy(gateway, tenancies, input.newTenancy, stamp)
    : undefined;
  if (!added && previousIds.size === 0) return null;

  const fresh = await readTenancies(gateway);
  const created = added ? fresh.findLast((t) => t.id === added.id) : undefined;
  if (added && !created) {
    throw conflict(`The Tenants tab in your Sheet changed while the details were being saved. ${RELOAD_HINT}`);
  }

  const newMoveIn = input.newTenancy?.fields.moveIn ?? input.dateReceived;
  for (const open of fresh) {
    if (!previousIds.has(open.id) || open.portionId !== input.portionId || open.moveOut !== "") continue;
    if (open.id === added?.id) continue;
    await closeTenancy(gateway, open, closingDay(open.moveIn, newMoveIn), stamp);
  }
  return created ?? null;
}

/**
 * The portion's closed tenancies that a New tenant request closed: the ones stamped with the moment and the person of that
 * request's Payments Log row (`closeTenancyRow` writes the request's own time and person in Updated at and Updated by,
 * and so does the log row). A move-out the owner recorded, an edit, or a row typed by hand never carries both, so those are
 * never taken for one.
 */
export function closedByRequest(
  tenancies: Tenancy[],
  portionId: string,
  request: { savedAt: string; loggedBy: string },
): Tenancy[] {
  return tenancies.filter(
    (t) =>
      t.portionId === portionId &&
      t.moveOut !== "" &&
      request.savedAt !== "" &&
      t.updatedAt === request.savedAt &&
      t.updatedBy === request.loggedBy,
  );
}

/**
 * Undoing a New tenant's first payment takes back what it did to the Tenants tab: the tenancies that request closed are
 * opened again (their Move-out date is cleared; Updated by and Updated at say who undid it and when). Without this the
 * closed rows would read as a move-out, and the portion's earlier tenant, still the tenant in the Schedule, would show as
 * vacant. Nothing is opened while the portion has an open tenancy (a New tenant with details added one), and nothing that
 * a Move out closed. `tenancies` is a fresh read. The rows are read back after the write; the answer says how many were
 * opened and how many did not show the change, for the caller to log.
 */
export async function reopenClosedByRequest(
  gateway: SheetsGateway,
  tenancies: Tenancy[],
  input: { portionId: string; request: { savedAt: string; loggedBy: string } },
  stamp: WriteStamp,
): Promise<{ reopened: number; notConfirmed: number }> {
  if (currentTenancy(tenancies, input.portionId) !== null) return { reopened: 0, notConfirmed: 0 };
  const closed = closedByRequest(tenancies, input.portionId, input.request);
  if (closed.length === 0) return { reopened: 0, notConfirmed: 0 };
  for (const t of closed) {
    await reopenTenancyRow(gateway, t.rowNumber, { updatedBy: stamp.updatedBy, updatedAt: stamp.now.toISOString() });
  }
  const fresh = await readTenancies(gateway);
  const notConfirmed = closed.filter((t) => {
    const now = fresh.find((candidate) => candidate.rowNumber === t.rowNumber && candidate.id === t.id);
    return now === undefined || now.moveOut !== "";
  }).length;
  return { reopened: closed.length - notConfirmed, notConfirmed };
}
