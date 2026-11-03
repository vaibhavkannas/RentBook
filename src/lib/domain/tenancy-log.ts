import type { Tenancy } from "./tenancy";

/**
 * What the Tenancy Log holds: one row for every detail a save of a tenancy changed, so the tenant's page can say what was
 * changed, by whom and when. Pure: this only compares two tenancies as the Tenants tab stores them. The tab itself, its
 * headers and the writes are in src/lib/sheets/tenancy-log-store.ts.
 */

/** Added: a tenancy was started with details. Edited: its details were saved. Moved out: the tenant left. Closed: the next tenant's start ended it. */
export const TENANCY_LOG_ACTIONS = ["Added", "Edited", "Moved out", "Closed"] as const;
export type TenancyLogAction = (typeof TENANCY_LOG_ACTIONS)[number];

/**
 * One row of the tab, in the order of its columns: saved at, tenancy id, portion (its id, as the Tenants tab has it), action,
 * field (the Tenants header of the column that changed, blank for Added), old value, new value (a day as text, an amount as
 * a number, "" for none), changed by. No tenant's name is copied: the history finds it by the tenancy id.
 */
export type TenancyLogRow = [
  savedAt: string,
  tenancyId: string,
  portion: string,
  action: TenancyLogAction,
  field: string,
  oldValue: string | number,
  newValue: string | number,
  changedBy: string,
];

/** The Tenants headers of the columns that hold a person's details, in the order of the Tenants tab. */
export const LOGGED_FIELDS = [
  "Phone",
  "Move-in date",
  "Agreement end",
  "Advance",
  "Advance date",
  "Advance status",
  "Refund",
  "Deductions",
  "Notes",
  "Move-out date",
] as const;
type LoggedField = (typeof LOGGED_FIELDS)[number];

/** The fields whose values are never copied: a row says only that they changed (both values blank). */
export const PRIVATE_FIELDS: readonly LoggedField[] = ["Phone", "Notes"];

/** What a save did to a tenancy. `before` and `after` are the tenancy as the Tenants tab stores it. */
export type TenancyChange =
  | { kind: "added"; after: Tenancy }
  | { kind: "edited"; before: Tenancy; after: Tenancy }
  /** `before` is null when the tenant had no details on file: the move-out added a closed row, compared with an empty one. */
  | { kind: "moved-out"; before: Tenancy | null; after: Tenancy }
  /** A new tenant's start ended this tenancy on `moveOut`. */
  | { kind: "closed"; before: Tenancy; moveOut: string };

type Value = string | number;

/** A tenancy's value for a logged field, as the Tenants tab stores it: text trimmed, an amount a number, "" for none. */
function valueOf(tenancy: Tenancy, field: LoggedField): Value {
  switch (field) {
    case "Phone":
      return tenancy.phone.trim();
    case "Move-in date":
      return tenancy.moveIn.trim();
    case "Agreement end":
      return tenancy.agreementEnd.trim();
    case "Advance":
      return tenancy.advance ?? "";
    case "Advance date":
      return tenancy.advanceDate.trim();
    case "Advance status":
      return tenancy.advanceStatus ?? "";
    case "Refund":
      return tenancy.refund ?? "";
    case "Deductions":
      return tenancy.deductions ?? "";
    case "Notes":
      return tenancy.notes.trim();
    case "Move-out date":
      return tenancy.moveOut.trim();
  }
}

/** What a tenancy that holds nothing looks like, for a tenant who had no details on file. */
const EMPTY: Tenancy = {
  rowNumber: 0,
  id: "",
  portionId: "",
  tenant: "",
  phone: "",
  moveIn: "",
  agreementEnd: "",
  advance: null,
  advanceDate: "",
  advanceStatus: null,
  refund: null,
  deductions: null,
  notes: "",
  moveOut: "",
  updatedBy: "",
  updatedAt: "",
};

/**
 * The rows of one save, in the order of the Tenants columns: a row for each logged field whose stored value changed. A private
 * field (Phone, Notes) leaves both values blank. An Added tenancy is one row with no field; a Closed one is one row for
 * the Move-out date. An edit that changed nothing gives no rows. `now` is the moment of the save and `changedBy` the person.
 */
export function tenancyLogRows(change: TenancyChange, stamp: { now: Date; changedBy: string }): TenancyLogRow[] {
  const savedAt = stamp.now.toISOString();
  const row = (tenancy: Pick<Tenancy, "id" | "portionId">, action: TenancyLogAction, field: string, oldValue: Value, newValue: Value): TenancyLogRow => [
    savedAt,
    tenancy.id,
    tenancy.portionId,
    action,
    field,
    oldValue,
    newValue,
    stamp.changedBy,
  ];

  if (change.kind === "added") return [row(change.after, "Added", "", "", "")];
  if (change.kind === "closed") {
    return [row(change.before, "Closed", "Move-out date", valueOf(change.before, "Move-out date"), change.moveOut.trim())];
  }

  const action: TenancyLogAction = change.kind === "edited" ? "Edited" : "Moved out";
  const before = change.before ?? EMPTY;
  const rows: TenancyLogRow[] = [];
  for (const field of LOGGED_FIELDS) {
    const was = valueOf(before, field);
    const now = valueOf(change.after, field);
    if (was === now) continue;
    const kept = PRIVATE_FIELDS.includes(field);
    rows.push(row(change.after, action, field, kept ? "" : was, kept ? "" : now));
  }
  return rows;
}
