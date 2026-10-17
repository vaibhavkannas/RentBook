import { getBrand } from "@/lib/brand";
import { MAX_NAME_LENGTH, textProblem } from "@/lib/domain/input-rules";
import type { PortionConfig } from "@/lib/domain/types";
import { conflict, sheetStructure, unknownPortion, validation } from "@/lib/errors";
import { RELOAD_HINT } from "@/lib/recovery-hint";
import { colIndex, colLetter } from "./a1";
import { isBlankCell } from "./cells";
import type { CellWrite } from "./gateway";
import { findHeader, headerKey } from "./headers";
import { findHeaderRowIndex, shorten } from "./schedule";
import {
  ACTIVE_COLUMN,
  ACTIVE_HEADER,
  hasActiveColumn,
  isActiveFlag,
  isOffFlag,
  requireCycleLength,
  requireHikePercent,
  SETTINGS_TAB,
} from "./settings-store";

/**
 * Which cells of the owner's Sheet change when a portion is added, switched off or on, or moved. Everything here is pure: a planner
 * is given what the Sheet held and returns every cell to write (RAW, by the caller), and nothing else. It never writes, reads or
 * guesses; when the Sheet is not as it needs it to be it refuses in words, and then nothing is written at all. The services in
 * portion-service.ts read the Sheet, call a planner, write what it says and check what they wrote.
 *
 * What a planner is given (`PlanInput`) is the Schedule's A1:ZZ and the Settings tab's A1:Z50, both read with the FORMULA render so
 * a formula can be told from a value, and the portions the Settings tab parsed to. The portions are matched to the Settings rows
 * again here: when they no longer agree, someone changed the tab between the two reads and the plan is refused.
 */

/** The most portions there can be, switched off ones included. */
export const MAX_PORTIONS = 20;

/** The last column of the Schedule the app reads (ZZ), 0-based. */
const LAST_COLUMN = colIndex("ZZ");
/** The last row of the Settings tab the app reads, and how many columns a free row must be empty in (A to Z). */
const LAST_SETTINGS_ROW = 50;
const SETTINGS_WIDTH = 26;

export type PlanInput = {
  scheduleTab: string;
  /** The Schedule tab, A1:ZZ, read with the FORMULA render. */
  schedule: unknown[][];
  /** The Settings tab, A1:Z50, read with the FORMULA render. */
  settings: unknown[][];
  /** The portions the Settings tab parsed to, in the order of their rows. */
  portions: PortionConfig[];
  /**
   * Portion ids besides those in Settings that a new portion must not take: the ones the Tenants tab still refers to. A portion
   * removed from Settings by hand leaves its history there, and a new portion with the same id would inherit it.
   */
  retiredIds?: readonly string[];
};

export type NewPortion = { name: string; cycleLength: number | null; hikePercent: number };

export type AddPlan = {
  id: string;
  /** Tenant, Count and Amount, as they are written in the Schedule's header row. */
  headers: [string, string, string];
  /** The 0-based Schedule columns of the three headers. */
  columns: [number, number, number];
  /** True when the three headers were already in the Schedule (typed by hand, or by an add that stopped half way) and nothing is written there. */
  adopted: boolean;
  /** The columns the Schedule tab must have for the three to exist (a count, not an index). */
  minColumns: number;
  /** The 1-based row of the Schedule's header row, and of the new portion in the Settings tab. */
  headerRow: number;
  settingsRow: number;
  scheduleWrites: CellWrite[];
  settingsWrites: CellWrite[];
};

/** Strictly empty: a cell of spaces holds something, and no plan writes over it. */
const isEmpty = (cell: unknown) => cell === undefined || cell === null || cell === "";

const isFormula = (cell: unknown) => typeof cell === "string" && cell.startsWith("=");

/** The Settings tab and the portions the app parsed from it no longer describe the same rows: someone changed it in between. */
const settingsChanged = () => conflict(`Someone changed the Settings tab a moment ago. ${RELOAD_HINT}`);

/**
 * The request for a new portion, checked: the name trimmed and 1 to 60 characters, the cycle a whole number from 1 to 120 or null,
 * the hike from 0 to 100. The same checks, and words, as saving the settings of a portion that is there. Throws a validation error
 * with the field the request calls it by.
 */
export function checkNewPortion(request: NewPortion): NewPortion {
  const name = request.name.trim();
  const problem = textProblem(name, "Portion name", { max: MAX_NAME_LENGTH, required: true });
  if (problem !== null) throw validation(problem, "name");
  return {
    name,
    cycleLength: requireCycleLength(request.cycleLength, "cycleLength"),
    hikePercent: requireHikePercent(request.hikePercent, "hikePercent"),
  };
}

type PortionRow = { portion: PortionConfig; sheetRow: number };

/**
 * The portions with the Settings row each sits on, found in the grid by the rule the parse uses (a row is a portion when its
 * Tenant, Count and Amount header cells and its id are filled in; a note has no headers). Refused when they are not the portions
 * the parse found, in the same order.
 */
function portionRows(input: PlanInput): PortionRow[] {
  const found: { id: string; sheetRow: number }[] = [];
  for (let at = 1; at < Math.min(input.settings.length, LAST_SETTINGS_ROW); at++) {
    const row = input.settings[at] ?? [];
    if ([row[2], row[3], row[4]].some(isBlankCell) || isBlankCell(row[0])) continue;
    found.push({ id: String(row[0]).trim(), sheetRow: at + 1 });
  }
  const same = found.length === input.portions.length && found.every((entry, i) => entry.id === input.portions[i].id);
  if (!same) throw settingsChanged();
  return found.map((entry, i) => ({ portion: input.portions[i], sheetRow: entry.sheetRow }));
}

/** The Schedule's header row: its 0-based index in the grid and its cells (a missing cell is undefined). */
function headerRowOf(schedule: unknown[][]): { index: number; cells: unknown[] } {
  const index = findHeaderRowIndex(schedule);
  if (index === -1) throw sheetStructure('No header row containing "Month" was found in the Schedule tab.');
  return { index, cells: Array.from(schedule[index]) };
}

/** `headerKey` of every non-blank cell in the Settings rows below the header, columns A to Z: any of them may be a name already in use. */
function settingsKeys(settings: unknown[][]): Set<string> {
  const keys = new Set<string>();
  for (let at = 1; at < Math.min(settings.length, LAST_SETTINGS_ROW); at++) {
    for (let col = 0; col < SETTINGS_WIDTH; col++) {
      const cell = settings[at]?.[col];
      if (!isBlankCell(cell)) keys.add(headerKey(cell));
    }
  }
  return keys;
}

/** The smallest `p{k}` that no row of Settings column A and no id in `retired` has, ignoring case and the spaces around an id. */
function newId(settings: unknown[][], retired: readonly string[]): string {
  const used = new Set(retired.map((id) => id.trim().toLowerCase()));
  for (let at = 1; at < Math.min(settings.length, LAST_SETTINGS_ROW); at++) {
    const cell = settings[at]?.[0];
    if (!isBlankCell(cell)) used.add(String(cell).trim().toLowerCase());
  }
  for (let k = 1; ; k++) if (!used.has(`p${k}`)) return `p${k}`;
}

type Placement = { names: [string, string, string]; columns: [number, number, number]; adopted: boolean };

/**
 * Where the new portion's three headers go. An exact, adjacent Tenant{n}, Count{n}, Amount{n} in the header row (n from 2 up, in
 * the Sheet's own style) that Settings does not use, whose three names are each in the header row once and that has nothing under
 * it, is taken as it is: the owner added it, or an earlier add wrote it and stopped before its Settings row. Otherwise n is the
 * smallest number from 2 up whose three names are in neither the header row nor Settings, and the columns are the three right of
 * everything in the Schedule.
 */
function placeHeaders(input: PlanInput, header: { index: number; cells: unknown[] }): Placement {
  const { cells, index: headerIndex } = header;
  const last = input.portions.at(-1);
  // The Schedule's own style: "Tenant 2" when its last portion's Tenant header has a space before the number.
  const space = last !== undefined && /\s\d+$/.test(last.tenantHeader.trim()) ? " " : "";
  const namesFor = (n: number, gap = space): [string, string, string] => [`Tenant${gap}${n}`, `Count${gap}${n}`, `Amount${gap}${n}`];
  const headerKeys = cells.map(headerKey);
  const used = settingsKeys(input.settings);
  const text = (cell: unknown) => String(cell ?? "").trim();

  const pattern = new RegExp(`^Tenant${space}(\\d+)$`);
  const numbers = [...new Set(cells.flatMap((cell) => {
    const found = pattern.exec(text(cell));
    return found !== null && Number(found[1]) >= 2 ? [Number(found[1])] : [];
  }))].sort((a, b) => a - b);
  for (const n of numbers) {
    const names = namesFor(n);
    const at = cells.findIndex((_, i) => names.every((name, k) => text(cells[i + k]) === name));
    if (at === -1) continue;
    const keys = names.map(headerKey);
    if (keys.some((key) => used.has(key) || headerKeys.filter((other) => other === key).length !== 1)) continue;
    let clear = true;
    for (let row = headerIndex + 1; row < input.schedule.length && clear; row++) {
      clear = names.every((_, k) => isEmpty(input.schedule[row]?.[at + k]));
    }
    if (clear) return { names, columns: [at, at + 1, at + 2], adopted: true };
  }

  // A number is taken when a name with it is there in either style: "Tenant 2" beside an existing "Tenant2" would only confuse.
  const taken = (n: number) =>
    ["", " "].some((gap) => namesFor(n, gap).some((name) => headerKeys.includes(headerKey(name)) || used.has(headerKey(name))));
  let n = 2;
  while (taken(n)) n++;
  let rightmost = -1;
  for (const row of input.schedule) {
    for (let col = row.length - 1; col > rightmost; col--) {
      if (!isEmpty(row[col])) {
        rightmost = col;
        break;
      }
    }
  }
  const start = rightmost + 1;
  if (start + 2 > LAST_COLUMN) {
    throw validation(`Your Schedule has no room for three more columns (it is full up to column ${colLetter(LAST_COLUMN)}).`);
  }
  return { names: namesFor(n), columns: [start, start + 1, start + 2], adopted: false };
}

/** The first Settings row under the last portion whose cells A to Z are all empty, up to the last row the app reads. */
function freeSettingsRow(input: PlanInput, rows: PortionRow[]): number {
  const lastPortionRow = rows.reduce((most, row) => Math.max(most, row.sheetRow), 1);
  for (let sheetRow = lastPortionRow + 1; sheetRow <= LAST_SETTINGS_ROW; sheetRow++) {
    const row = input.settings[sheetRow - 1] ?? [];
    if (Array.from({ length: SETTINGS_WIDTH }, (_, col) => row[col]).every(isEmpty)) return sheetRow;
  }
  throw validation(
    `The Settings tab has no free row up to row ${LAST_SETTINGS_ROW} for a new portion. Clear an unused row, then try again.`,
  );
}

/**
 * The cells to write to add a portion: its three headers in the Schedule's header row (none when they are already there) and its
 * row in the Settings tab. Nothing in the Sheet is overwritten: the header cells are right of everything, or are the owner's own
 * headers over empty columns, and the Settings row is one whose cells A to Z were all empty.
 */
export function planAddPortion(input: PlanInput, request: NewPortion): AddPlan {
  const { name, cycleLength, hikePercent } = checkNewPortion(request);
  const rows = portionRows(input);
  if (rows.length >= MAX_PORTIONS) throw validation(`You can have at most ${MAX_PORTIONS} portions.`);
  const twin = rows.find((row) => headerKey(row.portion.name) === headerKey(name));
  if (twin !== undefined) {
    throw validation(`There is already a portion called "${twin.portion.name}". Choose a different name.`, "name");
  }

  const header = headerRowOf(input.schedule);
  const placed = placeHeaders(input, header);
  const settingsRow = freeSettingsRow(input, rows);
  const id = newId(input.settings, input.retiredIds ?? []);
  const headerRow = header.index + 1;
  const [first, , third] = placed.columns;

  return {
    id,
    headers: placed.names,
    columns: placed.columns,
    adopted: placed.adopted,
    minColumns: third + 1,
    headerRow,
    settingsRow,
    scheduleWrites: placed.adopted
      ? []
      : [{ tab: input.scheduleTab, a1: `${colLetter(first)}${headerRow}:${colLetter(third)}${headerRow}`, values: [placed.names] }],
    settingsWrites: [
      {
        tab: SETTINGS_TAB,
        a1: `A${settingsRow}:G${settingsRow}`,
        values: [[id, name, ...placed.names, cycleLength ?? "", hikePercent]],
      },
    ],
  };
}

/** The refusal for a cell in column H that RentBook cannot read as the Active setting. */
const columnHTaken = (value: unknown) =>
  validation(
    `Column H of the Settings tab holds "${shorten(String(value))}". ${getBrand().name} keeps the Active setting there. Move that column further right, then try again.`,
  );

/** "a", "a and b" or "a, b and c". */
const list = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/**
 * The cells to write to switch a portion off ("No" in its Active cell) or on ("Yes"), and "Active" in H1 when H1 is blank. Nothing
 * when the portion already is as asked. Refused when column H holds anything else than an Active header and flags: H1 with other
 * text, a cell that is not a flag, or (under a blank H1) any cell at all, because writing the header would turn the owner's own
 * values into settings. Switching a portion on is refused when its three Schedule headers are not all in the header row once, since
 * every page would then fail to read the Sheet.
 */
export function planSetActive(input: PlanInput, id: string, active: boolean): CellWrite[] {
  const rows = portionRows(input);
  const target = rows.find((row) => row.portion.id === id);
  if (target === undefined) throw unknownPortion();

  const header = input.settings[0]?.[ACTIVE_COLUMN];
  const hasHeader = hasActiveColumn(input.settings);
  if (!hasHeader && !isBlankCell(header)) throw columnHTaken(header);
  for (const { sheetRow } of rows) {
    const cell = input.settings[sheetRow - 1]?.[ACTIVE_COLUMN];
    if (!isBlankCell(cell) && !(hasHeader && isActiveFlag(cell))) throw columnHTaken(cell);
  }

  const off = hasHeader && isOffFlag(input.settings[target.sheetRow - 1]?.[ACTIVE_COLUMN]);
  const cell = `${colLetter(ACTIVE_COLUMN)}${target.sheetRow}`;
  if (active) {
    if (!off) return [];
    const { portion } = target;
    const names = [portion.tenantHeader, portion.countHeader, portion.amountHeader];
    const { cells } = headerRowOf(input.schedule);
    if (!names.every((name) => "index" in findHeader(cells, name))) {
      throw validation(
        `${portion.name} can't be switched on: its columns (${list(names.map(shorten))}) are not in the Schedule's header row, once each. Put them back, then try again.`,
      );
    }
    return [{ tab: SETTINGS_TAB, a1: cell, values: [["Yes"]] }];
  }
  if (off) return [];
  return [
    ...(hasHeader ? [] : [{ tab: SETTINGS_TAB, a1: `${colLetter(ACTIVE_COLUMN)}1`, values: [[ACTIVE_HEADER]] }]),
    { tab: SETTINGS_TAB, a1: cell, values: [["No"]] },
  ];
}

/**
 * The cells to write to put the portions in the order of `ids`. The Settings rows that hold portions stay where they are; each
 * of them gets the cells (A to G, and H when the tab has an Active column) of the portion that is to be there, as they were read.
 * Only a row whose portion changes is written, so an order that has not changed writes nothing. The Schedule's columns do not
 * move. `ids` must be exactly the portions there are, once each. A formula in a row that would move is refused: it would be
 * copied as a value, or point at the wrong row.
 */
export function planReorder(input: PlanInput, ids: readonly string[]): CellWrite[] {
  const rows = portionRows(input);
  const current = rows.map((row) => row.portion.id);
  if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some((id) => !current.includes(id))) {
    throw conflict(`Your portions changed since this page loaded. ${RELOAD_HINT}`);
  }
  const width = hasActiveColumn(input.settings) ? ACTIVE_COLUMN + 1 : ACTIVE_COLUMN;
  const cellsOf = (sheetRow: number) => Array.from({ length: width }, (_, col) => input.settings[sheetRow - 1]?.[col]);
  // The rows whose portion changes: each gives its cells to another of them and takes another's, so each is looked at once.
  const moved = rows.flatMap(({ sheetRow }, slot) =>
    ids[slot] === current[slot] ? [] : [{ sheetRow, from: rows.find((row) => row.portion.id === ids[slot])!.sheetRow }],
  );
  for (const { sheetRow } of moved) {
    if (cellsOf(sheetRow).some(isFormula)) {
      throw validation(
        `Settings row ${sheetRow} has a formula in it, which ${getBrand().name} cannot move. Replace it with its value, then try again.`,
      );
    }
  }
  return moved.map(({ sheetRow, from }) => ({
    tab: SETTINGS_TAB,
    a1: `A${sheetRow}:${colLetter(width - 1)}${sheetRow}`,
    values: [cellsOf(from).map((cell) => cell ?? "")],
  }));
}

/**
 * What to tell the owner after an add when the Schedule's total column adds the amounts up with a formula (the last month's row
 * holds one): the app never edits a formula, so the new Amount column has to be added to it by hand. Null when there is no total
 * column or its cell holds a typed value, which the app keeps up to date itself.
 */
export function planTotalNote(
  schedule: unknown[][],
  layout: { totalCol: number | null; lastDataRow: number },
  totalHeader: string | null,
  plan: AddPlan,
  name: string,
): string | null {
  if (layout.totalCol === null || totalHeader === null) return null;
  if (!isFormula(schedule[layout.lastDataRow - 1]?.[layout.totalCol])) return null;
  return `Your ${shorten(totalHeader)} column adds up the amounts with a formula. Add column ${colLetter(plan.columns[2])} (${plan.headers[2]}) to it in your Sheet so the total includes ${name}.`;
}
