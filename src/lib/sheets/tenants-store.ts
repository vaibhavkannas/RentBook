import { isAdvanceStatus, type AdvanceStatus, type Tenancy } from "@/lib/domain/tenancy";
import { isoDayFromSerial } from "@/lib/domain/year-month";
import { sheetStructure } from "@/lib/errors";
import { colLetter } from "./a1";
import { isBlankCell, text } from "./cells";
import type { CellWrite, SheetsGateway } from "./gateway";
import { headerKey } from "./headers";
import { shorten } from "./schedule";
import { addTabIfMissing } from "./tabs";
import { DEFAULT_TAB_NAMES } from "./tab-names";

export const TENANTS_TAB = DEFAULT_TAB_NAMES.tenants;

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

/** The Tenants cells the app reads: the header and every row, columns A to O. */
export const TENANTS_RANGE = `A1:${LAST_COLUMN}`;


/**
 * Creates the Tenants tab with its headers when it is missing, and writes the headers into a tab that is empty.
 * It never refuses a tab for what its headers say: a wrong header must not stop the rest of the app. That is
 * checked on every read (see readTenancies). `existingTabs` is the tab list the caller already read.
 */
export async function ensureTenantsTab(
  gateway: SheetsGateway,
  existingTabs: string[],
): Promise<void> {
  // A tab another instance added a moment ago is treated as an existing one: its header is checked below.
  if (!existingTabs.includes(TENANTS_TAB) && (await addTabIfMissing(gateway, TENANTS_TAB))) {
    await gateway.updateValues([{ tab: TENANTS_TAB, a1: "A1", values: [TENANT_HEADERS] }]);
    return;
  }
  const header = (await gateway.getValues(TENANTS_TAB, `A1:${LAST_COLUMN}1`, "FORMATTED_VALUE"))[0] ?? [];
  if (header.length === 0) {
    await gateway.updateValues([{ tab: TENANTS_TAB, a1: "A1", values: [TENANT_HEADERS] }]);
  }
}

/**
 * Compares row 1 with the fifteen headers, by position (capitals, spaces around a header, doubled or no-break
 * spaces and invisible characters do not matter: see `headerKey`). Returns the first wrong or missing one in plain
 * words, or null when columns A to O are right. Columns to the right of O are not looked at.
 */
function headerProblem(header: unknown[]): string | null {
  for (let index = 0; index < TENANT_HEADERS.length; index++) {
    const found = String(header[index] ?? "").trim();
    if (headerKey(found) !== headerKey(TENANT_HEADERS[index])) {
      // The header is typed by hand: only a short stretch of it is quoted.
      const quoted = shorten(found);
      return (
        `The Tenants tab must have "${TENANT_HEADERS[index]}" in column ${colLetter(index)} ` +
        `(found ${quoted === "" ? "nothing" : `"${quoted}"`}). Columns A to ${LAST_COLUMN} must keep the ` +
        `${TENANT_HEADERS.length} Tenants headers in their original order; extra columns may go to the right.`
      );
    }
  }
  return null;
}

/**
 * A date column: a number (a date typed into a Sheet date cell) becomes YYYY-MM-DD, text is trimmed. A cell that
 * holds only spaces is blank, so a Move-out date of " " still means the tenancy is current.
 */
const day = (cell: unknown) =>
  typeof cell === "number" ? (isoDayFromSerial(cell) ?? String(cell)) : text(cell).trim();

const amount = (cell: unknown) => (typeof cell === "number" && Number.isFinite(cell) ? cell : null);

const status = (cell: unknown): AdvanceStatus | null => (isAdvanceStatus(cell) ? cell : null);

/**
 * Every tenancy row of the Tenants tab's raw values (what `TENANTS_RANGE` returns, unformatted), with its true
 * 1-based row number. The header and fully blank rows are skipped. Row 1 is compared with the headers on EVERY
 * call, because everything else here (and every write) goes by column position: a wrong or missing header is a
 * sheet-structure error that names it. Reads nothing itself.
 */
export function parseTenancies(values: unknown[][]): Tenancy[] {
  const problem = headerProblem(values[0] ?? []);
  if (problem !== null) throw sheetStructure(problem);
  const tenancies: Tenancy[] = [];
  values.forEach((cells, index) => {
    if (index === 0 || cells.every(isBlankCell)) return;
    tenancies.push({
      rowNumber: index + 1,
      id: text(cells[0]),
      portionId: text(cells[1]).trim(),
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

/** Reads the Tenants tab and parses it (see `parseTenancies`). */
export async function readTenancies(gateway: SheetsGateway): Promise<Tenancy[]> {
  return parseTenancies(await gateway.getValues(TENANTS_TAB, TENANTS_RANGE, "UNFORMATTED_VALUE"));
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

const columnOf = (header: string) => TENANT_HEADERS.indexOf(header);

/**
 * One CellWrite per run of neighbouring columns, all for the same row. Only the named columns are written,
 * so every other cell of the row (hand-typed text, columns added to the right of O) is left exactly as it is.
 */
function columnWrites(
  rowNumber: number,
  row: Omit<Tenancy, "rowNumber">,
  headers: string[],
): CellWrite[] {
  const cells = toCells(row);
  const columns = headers.map(columnOf).sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const column of columns) {
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === column - 1) last.push(column);
    else runs.push([column]);
  }
  return runs.map((run) => {
    const first = `${colLetter(run[0])}${rowNumber}`;
    return {
      tab: TENANTS_TAB,
      a1: run.length === 1 ? first : `${first}:${colLetter(run[run.length - 1])}${rowNumber}`,
      values: [run.map((column) => cells[column])],
    };
  });
}

/** Which of the editable columns an edit writes. The others keep whatever the Sheet holds. */
export type EditColumns = {
  /** Phone (D). */
  phone: boolean;
  /** Move-in date (E). */
  moveIn: boolean;
  /** Agreement end (F). */
  agreementEnd: boolean;
  /** Advance (G). */
  advance: boolean;
  /** Advance date (H). */
  advanceDate: boolean;
  /** Advance status (I). */
  status: boolean;
  /** Notes (L). */
  notes: boolean;
};

/**
 * Saves an edit of a tenancy with one updateValues call: always Updated by and Updated at (N, O), and only the
 * editable columns named in `columns` (Phone, Move-in date, Agreement end, Advance, Advance date, Advance
 * status, Notes). Every other cell of the row, including hand-typed text the app cannot read in a column the
 * edit did not change, and any column added to the right of O, is never touched.
 */
export async function writeTenancyEdit(
  gateway: SheetsGateway,
  rowNumber: number,
  row: Omit<Tenancy, "rowNumber">,
  columns: EditColumns,
): Promise<void> {
  await gateway.updateValues(
    columnWrites(rowNumber, row, [
      ...(columns.phone ? ["Phone"] : []),
      ...(columns.moveIn ? ["Move-in date"] : []),
      ...(columns.agreementEnd ? ["Agreement end"] : []),
      ...(columns.advance ? ["Advance"] : []),
      ...(columns.advanceDate ? ["Advance date"] : []),
      ...(columns.status ? ["Advance status"] : []),
      ...(columns.notes ? ["Notes"] : []),
      "Updated by",
      "Updated at",
    ]),
  );
}

/** Which of the optional move-out columns a move-out writes. The others keep whatever the Sheet holds. */
export type MoveOutColumns = {
  /** Advance status (I). */
  status: boolean;
  /** Refund (J). */
  refund: boolean;
  /** Deductions (K). */
  deductions: boolean;
  /** Notes (L). */
  notes: boolean;
};

/**
 * Saves a move-out with one updateValues call: always Move-out date, Updated by and Updated at (M to O), and only
 * the optional columns named in `columns` (Advance status, Refund, Deductions, Notes). Every other cell of the row,
 * including hand-typed text in a column the person gave nothing for, is never touched.
 */
export async function writeTenancyMoveOut(
  gateway: SheetsGateway,
  rowNumber: number,
  row: Omit<Tenancy, "rowNumber">,
  columns: MoveOutColumns,
): Promise<void> {
  await gateway.updateValues(
    columnWrites(rowNumber, row, [
      ...(columns.status ? ["Advance status"] : []),
      ...(columns.refund ? ["Refund"] : []),
      ...(columns.deductions ? ["Deductions"] : []),
      ...(columns.notes ? ["Notes"] : []),
      "Move-out date",
      "Updated by",
      "Updated at",
    ]),
  );
}

/** The columns `closeTenancyRow` writes: Move-out date, Updated by and Updated at, which end the row at column O. */
const MOVE_OUT_COLUMN = colLetter(TENANT_HEADERS.indexOf("Move-out date"));

/**
 * Closes a tenancy by writing only its Move-out date, Updated by and Updated at cells (columns M to O),
 * with one call. Every other cell of the row is left exactly as it is in the Sheet, so text typed by hand
 * into the amount, status or notes columns survives, and a change someone saved a moment ago is not reverted.
 */
export async function closeTenancyRow(
  gateway: SheetsGateway,
  rowNumber: number,
  close: { moveOut: string; updatedBy: string; updatedAt: string },
): Promise<void> {
  await gateway.updateValues([
    {
      tab: TENANTS_TAB,
      a1: `${MOVE_OUT_COLUMN}${rowNumber}:${LAST_COLUMN}${rowNumber}`,
      values: [[close.moveOut, close.updatedBy, close.updatedAt]],
    },
  ]);
}
