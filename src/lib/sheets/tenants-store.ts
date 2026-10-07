import type { AdvanceStatus, Tenancy } from "@/lib/domain/tenancy";
import { isoDayFromSerial } from "@/lib/domain/year-month";
import { sheetStructure } from "@/lib/errors";
import { colLetter } from "./a1";
import type { SheetsGateway } from "./gateway";

export const TENANTS_TAB = "Tenants";

/** Columns A to O, in this order. Columns to the right of O may be added by hand and are ignored. */
export const TENANT_HEADERS = [
  "Tenancy ID",
  "Portion",
  "Tenant",
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
  "Updated by",
  "Updated at",
];

const LAST_COLUMN = colLetter(TENANT_HEADERS.length - 1);
const ADVANCE_STATUSES: readonly string[] = ["Held", "Refunded", "Adjusted"] satisfies AdvanceStatus[];

/**
 * Creates the Tenants tab with its headers when it is missing (or empty).
 * An existing tab must hold the fifteen headers in columns A to O, in order:
 * the first wrong or missing one is reported and nothing is written.
 * `existingTabs` is the tab list the caller already read.
 */
export async function ensureTenantsTab(
  gateway: SheetsGateway,
  existingTabs: string[],
): Promise<void> {
  if (!existingTabs.includes(TENANTS_TAB)) {
    await gateway.addTab(TENANTS_TAB);
    await gateway.updateValues([{ tab: TENANTS_TAB, a1: "A1", values: [TENANT_HEADERS] }]);
    return;
  }
  const header = (await gateway.getValues(TENANTS_TAB, `A1:${LAST_COLUMN}1`, "FORMATTED_VALUE"))[0] ?? [];
  if (header.length === 0) {
    await gateway.updateValues([{ tab: TENANTS_TAB, a1: "A1", values: [TENANT_HEADERS] }]);
    return;
  }
  for (let index = 0; index < TENANT_HEADERS.length; index++) {
    const found = String(header[index] ?? "").trim();
    if (found !== TENANT_HEADERS[index]) {
      throw sheetStructure(
        `The Tenants tab must have "${TENANT_HEADERS[index]}" in column ${colLetter(index)} ` +
          `(found ${found === "" ? "nothing" : `"${found}"`}). Columns A to ${LAST_COLUMN} must keep the ` +
          `${TENANT_HEADERS.length} Tenants headers in their original order; extra columns may go to the right.`,
      );
    }
  }
}

const isBlank = (cell: unknown) => cell === undefined || cell === null || String(cell).trim() === "";

const text = (cell: unknown) => (cell === undefined || cell === null ? "" : String(cell));

/** A date column: text stays as it is, a number (a date typed into a Sheet date cell) becomes YYYY-MM-DD. */
const day = (cell: unknown) =>
  typeof cell === "number" ? (isoDayFromSerial(cell) ?? String(cell)) : text(cell);

const amount = (cell: unknown) => (typeof cell === "number" && Number.isFinite(cell) ? cell : null);

const status = (cell: unknown): AdvanceStatus | null =>
  typeof cell === "string" && ADVANCE_STATUSES.includes(cell) ? (cell as AdvanceStatus) : null;

/** Every tenancy row, with its true 1-based row number. The header and fully blank rows are skipped. */
export async function readTenancies(gateway: SheetsGateway): Promise<Tenancy[]> {
  const values = await gateway.getValues(TENANTS_TAB, `A1:${LAST_COLUMN}`, "UNFORMATTED_VALUE");
  const tenancies: Tenancy[] = [];
  values.forEach((cells, index) => {
    if (index === 0 || cells.every(isBlank)) return;
    tenancies.push({
      rowNumber: index + 1,
      id: text(cells[0]),
      portionId: text(cells[1]),
      tenant: text(cells[2]),
      phone: text(cells[3]),
      moveIn: day(cells[4]),
      agreementEnd: day(cells[5]),
      advance: amount(cells[6]),
      advanceDate: day(cells[7]),
      advanceStatus: status(cells[8]),
      refund: amount(cells[9]),
      deductions: amount(cells[10]),
      notes: text(cells[11]),
      moveOut: day(cells[12]),
      updatedBy: text(cells[13]),
      updatedAt: text(cells[14]),
    });
  });
  return tenancies;
}

/** The cells of a row: amounts as numbers, or "" when empty. Writes through the gateway are RAW. */
function toCells(row: Omit<Tenancy, "rowNumber">): unknown[] {
  return [
    row.id,
    row.portionId,
    row.tenant,
    row.phone,
    row.moveIn,
    row.agreementEnd,
    row.advance ?? "",
    row.advanceDate,
    row.advanceStatus ?? "",
    row.refund ?? "",
    row.deductions ?? "",
    row.notes,
    row.moveOut,
    row.updatedBy,
    row.updatedAt,
  ];
}

export async function appendTenancy(
  gateway: SheetsGateway,
  row: Omit<Tenancy, "rowNumber">,
): Promise<void> {
  await gateway.appendRow(TENANTS_TAB, toCells(row));
}

/** Rewrites one row (columns A to O) in a single call. */
export async function writeTenancy(
  gateway: SheetsGateway,
  rowNumber: number,
  row: Omit<Tenancy, "rowNumber">,
): Promise<void> {
  await gateway.updateValues([
    {
      tab: TENANTS_TAB,
      a1: `A${rowNumber}:${LAST_COLUMN}${rowNumber}`,
      values: [toCells(row)],
    },
  ]);
}
