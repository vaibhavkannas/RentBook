import { getBrand } from "@/lib/brand";
import { cleanText, MAX_NAME_LENGTH } from "@/lib/domain/input-rules";
import type { PortionConfig } from "@/lib/domain/types";
import { sheetStructure, tabMissing, unknownPortion, validation } from "@/lib/errors";
import { logEvent } from "@/lib/server/log";
import { colLetter } from "./a1";
import { isBlankCell } from "./cells";
import { namesTabs, type CellWrite, type SheetsGateway } from "./gateway";
import { headerKey } from "./headers";
import { findHeaderRowIndex, shorten } from "./schedule";
import { addTabIfMissing } from "./tabs";
import { DEFAULT_TAB_NAMES } from "./tab-names";
import { ensureTenantsTab, TENANTS_TAB } from "./tenants-store";

export const SETTINGS_TAB = DEFAULT_TAB_NAMES.settings;
export const LOG_TAB = DEFAULT_TAB_NAMES.log;

export const SETTINGS_HEADERS = [
  "Portion",
  "Name",
  "Tenant header",
  "Count header",
  "Amount header",
  "Cycle length",
  "Hike %",
  "Active",
];

export const LOG_HEADERS = [
  "Saved at",
  "Month",
  "Portion",
  "Tenant",
  "Amount",
  "Count",
  "Date received",
  "Logged by",
  "Action",
];

export const DEFAULT_PORTION_NAMES = [
  "First floor, single bedroom",
  "First floor, double bedroom",
  "Second floor, single bedroom",
  "Second floor, double bedroom",
  "Third floor, hall and kitchen",
];

/** The Settings cells the app reads: a header and up to 49 portions, columns A to H. */
export const SETTINGS_RANGE = "A1:H50";

/** The 0-based column of the Active setting (H) and the header that says a Settings tab has one. A tab whose H1 holds anything else has none. */
export const ACTIVE_COLUMN = 7;
export const ACTIVE_HEADER = SETTINGS_HEADERS[ACTIVE_COLUMN];

/** What an Active cell says to switch a portion off (a checkbox that is unticked reads false). Anything else, blank included, is on. */
const OFF_FLAGS = new Set(["no", "inactive", "off", "false"]);
/** What the app counts as a deliberate "on" when it has to tell a flag from other text: it writes Yes itself. */
const ON_FLAGS = new Set(["yes", "active", "on", "true"]);

/** True for an Active cell that switches its portion off: no, inactive, off or false, in any case and spacing. */
export const isOffFlag = (cell: unknown) => OFF_FLAGS.has(headerKey(cell));

/** True for an Active cell that is a flag: one of the off flags, or yes, active, on or true. */
export const isActiveFlag = (cell: unknown) => OFF_FLAGS.has(headerKey(cell)) || ON_FLAGS.has(headerKey(cell));

/** True when the Settings tab's header row has an Active column (H1 reads Active, by the looser header rule). */
export const hasActiveColumn = (values: unknown[][]) => headerKey(values[0]?.[ACTIVE_COLUMN]) === headerKey(ACTIVE_HEADER);

export const DEFAULT_CYCLE_LENGTH = 11;
export const DEFAULT_HIKE_PERCENT = 5;

const TENANT_HEADER = /^tenant\s*(\d*)$/;
const COUNT_HEADER = /^count\s*(\d*)$/;
const AMOUNT_HEADER = /^amount\s*(\d*)$/;

/** The number a Tenant, Count or Amount header ends in ("" when it has none), or null when it is not that kind of header. */
const numberOf = (pattern: RegExp, header: string) => pattern.exec(headerKey(header))?.[1] ?? null;

const duplicateHeader = (name: string) =>
  sheetStructure(
    `Header "${name}" appears more than once in the Schedule tab. Give each portion its own headers, for example Tenant, Count, Amount, then Tenant2, Count2, Amount2.`,
  );

/**
 * Builds default portion settings from the Schedule header row: every "Tenant*" header must be followed by a
 * "Count*" and an "Amount*" header. Straight after the Tenant header they are taken whatever their numbers; with
 * other columns in between (a Phone column, say) the Count and the Amount must carry the Tenant's own number and
 * lie before the next Tenant header, the Amount after the Count. Headers are recognised by `headerKey`, and the
 * Settings get them as typed.
 */
export function inferPortions(headerRow: unknown[]): PortionConfig[] {
  const cells = headerRow.map((cell) => String(cell ?? "").trim());
  const portions: PortionConfig[] = [];
  const seen = new Set<string>();
  // The columns taken as a portion's Count and Amount.
  const chosen: number[] = [];
  cells.forEach((header, index) => {
    if (/^tenant/.test(headerKey(header)) && numberOf(TENANT_HEADER, header) === null) {
      throw sheetStructure(
        `"${header}" looks like a Tenant column but is not named like one. Use Tenant, Tenant2, Tenant3 and so on.`,
      );
    }
    const number = numberOf(TENANT_HEADER, header);
    if (number === null) return;
    if (seen.has(header.toLowerCase())) {
      throw duplicateHeader(header);
    }
    const [count, amount] = pairWith(cells, index, number);
    if (count === null || amount === null) {
      throw sheetStructure(
        `"${header}" must be followed by a Count and an Amount column in the Schedule tab.`,
      );
    }
    for (const name of [header, cells[count], cells[amount]]) {
      const key = name.toLowerCase();
      if (seen.has(key)) throw duplicateHeader(name);
      seen.add(key);
    }
    chosen.push(count, amount);
    const position = portions.length;
    portions.push({
      id: `p${position + 1}`,
      name: DEFAULT_PORTION_NAMES[position] ?? `Portion ${position + 1}`,
      tenantHeader: header,
      countHeader: cells[count],
      amountHeader: cells[amount],
      cycleLength: DEFAULT_CYCLE_LENGTH,
      hikePercent: DEFAULT_HIKE_PERCENT,
    });
  });
  if (portions.length === 0) {
    throw sheetStructure('No "Tenant" columns were found in the Schedule header row.');
  }
  // The Settings keep the header text and the Schedule is matched by it later. A Count or an Amount that another
  // column's header reads the same as is refused: renaming the first of them would quietly re-point the portion
  // at the other.
  for (const at of chosen) {
    if (cells.filter((other) => headerKey(other) === headerKey(cells[at])).length > 1) throw duplicateHeader(cells[at]);
  }
  return portions;
}

/**
 * The columns of the Count and the Amount that belong to the Tenant header at `tenantAt` (null for one that is
 * not there). The two columns right after it count, whatever their numbers. Otherwise the first Count with the
 * Tenant's `number`, then the first Amount with it after that Count, both before the next Tenant header.
 */
function pairWith(cells: string[], tenantAt: number, number: string): [number | null, number | null] {
  const next = cells.findIndex((cell, at) => at > tenantAt && numberOf(TENANT_HEADER, cell) !== null);
  const end = next === -1 ? cells.length : next;
  if (numberOf(COUNT_HEADER, cells[tenantAt + 1]) !== null && numberOf(AMOUNT_HEADER, cells[tenantAt + 2]) !== null) {
    return [tenantAt + 1, tenantAt + 2];
  }
  const firstWith = (pattern: RegExp, from: number) => {
    for (let at = from; at < end; at++) if (numberOf(pattern, cells[at]) === number) return at;
    return null;
  };
  const count = firstWith(COUNT_HEADER, tenantAt + 1);
  return [count, count === null ? null : firstWith(AMOUNT_HEADER, count + 1)];
}

const toSettingsRow = (p: PortionConfig) => [
  p.id,
  p.name,
  p.tenantHeader,
  p.countHeader,
  p.amountHeader,
  p.cycleLength ?? "",
  p.hikePercent,
];

const bootstrapped = new WeakSet<SheetsGateway>();

/**
 * Forgets that a gateway's tabs were checked, so the next ensureTabs looks at them again. The Google gateway
 * calls this when Google says a tab is gone, so a tab deleted or renamed while the app runs is noticed (and a
 * deleted Payments Log or Tenants tab put back) without a restart.
 */
export function resetBootstrap(gateway: SheetsGateway): void {
  bootstrapped.delete(gateway);
}

/**
 * Why a Settings tab that went missing, beside the other app tabs, is never recreated (the Set up page says the same).
 * `tab` is what the owner called it (SETTINGS_TAB), named when it is not the usual "Settings".
 * A function, not a constant: the product's name is read when the message is made (wave 3 reads it from the Config tab).
 */
export const settingsMissing = (tab: string = SETTINGS_TAB) =>
  `The ${tab === SETTINGS_TAB ? "Settings tab" : `Settings tab, "${tab}",`} is missing. Restore it from File > Version history or rename it back. ${getBrand().name} will not recreate it because that would reset your rent cycle lengths and hike percentages.`;

const isBlankRow = (row: unknown[]) => row.every(isBlankCell);

/**
 * True when a Settings tab holds nothing but, at most, its header row, so it is safe to fill in. Anything
 * else (a note, a header that is not ours, rows without a portion id) is left exactly as it is.
 */
export function settingsIsEmpty(values: unknown[][]): boolean {
  const [header = [], ...rest] = values;
  const headerOnly = isBlankRow(header) || String(header[0] ?? "").trim().toLowerCase() === "portion";
  return headerOnly && rest.every(isBlankRow);
}

/**
 * Writes the default Settings (header and one row per portion found in the Schedule header). The Schedule
 * header is read first, so a header that cannot be read creates nothing. `exists` says the tab is already
 * there; otherwise it is added, and when another instance added it first the tab is left alone if that
 * instance has already filled it.
 */
async function seedSettings(
  gateway: SheetsGateway,
  scheduleTab: string,
  exists: boolean,
): Promise<"created" | "filled" | "none"> {
  const top = await gateway.getValues(scheduleTab, "A1:ZZ25", "FORMATTED_VALUE");
  const headerIndex = findHeaderRowIndex(top);
  if (headerIndex === -1) {
    throw sheetStructure('No header row containing "Month" was found in the Schedule tab.');
  }
  const portions = inferPortions(top[headerIndex]);
  let added = false;
  if (!exists) {
    added = await addTabIfMissing(gateway, SETTINGS_TAB);
    if (!added) {
      const theirs = await gateway.getValues(SETTINGS_TAB, SETTINGS_RANGE, "UNFORMATTED_VALUE");
      if (!settingsIsEmpty(theirs)) return "none";
    }
  }
  await gateway.updateValues([
    {
      tab: SETTINGS_TAB,
      a1: "A1",
      values: [SETTINGS_HEADERS, ...portions.map(toSettingsRow)],
    },
  ]);
  return added ? "created" : "filled";
}

/** The Payments Log columns that were added after the first seven (0-based): Logged by (H) and Action (I). */
const NEWER_LOG_COLUMNS = [7, 8];

/**
 * What an older Payments Log's header row needs, by 0-based column: `fill` are the cells of H1 and I1 that are
 * blank (the header goes there), `taken` the ones that hold other text (left alone: it is the owner's). A cell
 * that already holds the header, in any case or spacing (`headerKey`), is neither.
 */
export function logHeaderUpgrade(header: unknown[]): { fill: number[]; taken: number[] } {
  const fill: number[] = [];
  const taken: number[] = [];
  for (const column of NEWER_LOG_COLUMNS) {
    const found = headerKey(header[column]);
    if (found === "") fill.push(column);
    else if (found !== headerKey(LOG_HEADERS[column])) taken.push(column);
  }
  return { fill, taken };
}

/** The writes for `fill` (see logHeaderUpgrade): H1:I1 in one write when both are blank, otherwise just the blank cell. */
function logHeaderWrites(fill: number[]): CellWrite[] {
  const a1 = fill.length === NEWER_LOG_COLUMNS.length ? "H1:I1" : `${colLetter(fill[0])}1`;
  return [{ tab: LOG_TAB, a1, values: [fill.map((column) => LOG_HEADERS[column])] }];
}

/**
 * What `ensureTabs` did, by the app's name for each tab: the tabs it added (with their headers, and Settings with its first
 * rows) and the tabs that were there but empty, or had blank header cells, that it filled in. Nothing else is ever written.
 */
export type EnsureReport = { created: string[]; filled: string[] };

/**
 * Creates the Settings, Payments Log and Tenants tabs when they are missing, once per gateway instance
 * (until resetBootstrap). Settings is seeded from the Schedule header row, and only on a Sheet that has none
 * of the three app tabs yet, or whose Settings tab holds no portions: a Settings tab that went missing while
 * the others are still there is refused, never recreated, because the defaults would silently replace the
 * owner's cycle lengths and hike percentages.
 */
export async function ensureTabs(gateway: SheetsGateway, scheduleTab: string): Promise<EnsureReport> {
  const report: EnsureReport = { created: [], filled: [] };
  if (bootstrapped.has(gateway)) return report;
  const tabs = await gateway.listTabs();
  if (!tabs.includes(scheduleTab)) throw tabMissing(scheduleTab);

  const hasSettings = tabs.includes(SETTINGS_TAB);
  if (!hasSettings && (tabs.includes(LOG_TAB) || tabs.includes(TENANTS_TAB))) {
    throw sheetStructure(settingsMissing(namesTabs(gateway) ? gateway.configuredTabName(SETTINGS_TAB) : SETTINGS_TAB));
  }
  if (hasSettings) {
    // An empty answer is read once more before it is believed: seeding writes over A1:G6, so a read that came
    // back empty by mistake must never be what decides to replace the owner's settings.
    let settings = await gateway.getValues(SETTINGS_TAB, SETTINGS_RANGE, "UNFORMATTED_VALUE");
    if (settingsIsEmpty(settings)) {
      settings = await gateway.getValues(SETTINGS_TAB, SETTINGS_RANGE, "UNFORMATTED_VALUE");
    }
    if (settingsIsEmpty(settings)) note(report, SETTINGS_TAB, await seedSettings(gateway, scheduleTab, true));
  } else {
    note(report, SETTINGS_TAB, await seedSettings(gateway, scheduleTab, false));
  }

  // A Payments Log tab that another instance added a moment ago is treated as an existing one.
  if (!tabs.includes(LOG_TAB) && (await addTabIfMissing(gateway, LOG_TAB))) {
    await gateway.updateValues([{ tab: LOG_TAB, a1: "A1", values: [LOG_HEADERS] }]);
    note(report, LOG_TAB, "created");
  } else {
    const header = (await gateway.getValues(LOG_TAB, "A1:I1", "FORMATTED_VALUE"))[0] ?? [];
    if (header.length === 0) {
      await gateway.updateValues([{ tab: LOG_TAB, a1: "A1", values: [LOG_HEADERS] }]);
      note(report, LOG_TAB, "filled");
    } else {
      // An older Payments Log has only the first seven columns. Add the two new headers once, into blank cells only.
      const { fill, taken } = logHeaderUpgrade(header);
      if (fill.length > 0) {
        await gateway.updateValues(logHeaderWrites(fill));
        note(report, LOG_TAB, "filled");
      }
      if (taken.length > 0) {
        const cells = taken.map((column) => `${colLetter(column)}1`).join(" and ");
        logEvent("warn", "payments-log-header-taken", {
          message: `Payments Log ${taken.length === 1 ? "cell" : "cells"} ${cells} already ${taken.length === 1 ? "holds" : "hold"} other text, so no header was written there. Rows are still saved by column position.`,
        });
      }
    }
  }
  note(report, TENANTS_TAB, await ensureTenantsTab(gateway, tabs));
  bootstrapped.add(gateway);
  return report;
}

/** Puts what was done to a tab in the report. */
function note(report: EnsureReport, tab: string, done: "created" | "filled" | "none"): void {
  if (done !== "none") report[done].push(tab);
}

type SettingsRow = { portion: PortionConfig; sheetRow: number };

/** A portion id is typed by hand and becomes a key and a URL part, so it is kept to letters, digits, - and _. */
const PORTION_ID = /^[A-Za-z0-9_-]{1,20}$/;

/**
 * Portions with the 1-based Settings-tab row each one was read from. Rows that are not portions are skipped:
 * blank rows, and a note typed under the table (its Tenant, Count and Amount header cells, columns C to E, are
 * all blank). A row with only some of those three filled in is a half-typed portion: refused, by row number.
 */
function parseSettingsRows(values: unknown[][]): SettingsRow[] {
  const portions: SettingsRow[] = [];
  // Column H is read only when H1 says Active: a Settings tab without that header is read exactly as it always was.
  const hasActive = hasActiveColumn(values);
  // The first row to use each id (compared in lower case), and the id as it is typed there: two portions with one id
  // would share a card, a URL and a write.
  const idRows = new Map<string, { row: number; id: string }>();
  values.slice(1).forEach((row, offset) => {
    const sheetRow = offset + 2;
    const headerCells = [row[2], row[3], row[4]];
    if (headerCells.every(isBlankCell)) return;
    if (headerCells.some(isBlankCell)) {
      throw sheetStructure(
        `Settings row ${sheetRow}: Tenant header, Count header and Amount header must all be filled in, or all left blank for a note.`,
      );
    }
    if (isBlankCell(row[0])) return;
    // A stray space or line break around a hand-typed id is not part of it (the Schedule header is matched trimmed too).
    const id = String(row[0]).trim();
    if (!PORTION_ID.test(id)) {
      throw sheetStructure(
        `Settings row ${sheetRow}: the portion id "${shorten(id)}" can only use letters, numbers, - and _, up to 20 characters.`,
      );
    }
    const first = idRows.get(id.toLowerCase());
    if (first !== undefined) {
      throw sheetStructure(
        `Settings rows ${first.row} and ${sheetRow} both use the portion id "${first.id}". Give each portion its own id.`,
      );
    }
    idRows.set(id.toLowerCase(), { row: sheetRow, id });
    const cycle = row[5];
    const hike = row[6];
    if (cycle !== undefined && cycle !== "" && !(Number.isInteger(cycle) && (cycle as number) >= 1)) {
      throw sheetStructure(
        `Settings row ${sheetRow}: cycle length must be a whole number, or blank for "never resets".`,
      );
    }
    if (hike !== undefined && hike !== "" && !(typeof hike === "number" && hike >= 0)) {
      throw sheetStructure(`Settings row ${sheetRow}: hike % must be a number, 0 or more.`);
    }
    portions.push({
      sheetRow,
      portion: {
        id,
        name: String(row[1] ?? row[0]),
        tenantHeader: String(row[2] ?? ""),
        countHeader: String(row[3] ?? ""),
        amountHeader: String(row[4] ?? ""),
        cycleLength: typeof cycle === "number" ? cycle : null,
        hikePercent: typeof hike === "number" ? hike : DEFAULT_HIKE_PERCENT,
        ...(hasActive && isOffFlag(row[ACTIVE_COLUMN]) ? { inactive: true } : {}),
      },
    });
  });
  if (portions.length === 0) {
    throw sheetStructure("The Settings tab has no portions.");
  }
  return portions;
}

/** The portions in the Settings tab's raw values (what `SETTINGS_RANGE` returns, unformatted). Reads nothing itself. */
export function parseSettings(values: unknown[][]): PortionConfig[] {
  return parseSettingsRows(values).map((entry) => entry.portion);
}

async function readSettingsRows(gateway: SheetsGateway): Promise<SettingsRow[]> {
  return parseSettingsRows(await gateway.getValues(SETTINGS_TAB, SETTINGS_RANGE, "UNFORMATTED_VALUE"));
}

export async function readSettings(gateway: SheetsGateway): Promise<PortionConfig[]> {
  return (await readSettingsRows(gateway)).map((entry) => entry.portion);
}

export type SettingsUpdate = {
  id: string;
  name: string;
  cycleLength: number | null;
  hikePercent: number;
};

/** Updates name, cycle length and hike % only. Header mapping is never edited here. */
export async function updateSettings(
  gateway: SheetsGateway,
  updates: SettingsUpdate[],
): Promise<void> {
  const current = await readSettingsRows(gateway);
  const writes = updates.map((update, index) => {
    const found = current.find((entry) => entry.portion.id === update.id);
    if (!found) throw unknownPortion();
    const name = cleanText(update.name, "Portion name", { max: MAX_NAME_LENGTH, required: true });
    if (
      update.cycleLength !== null &&
      !(Number.isInteger(update.cycleLength) && update.cycleLength >= 1 && update.cycleLength <= 120)
    ) {
      // The words and the field are the screen's (Payments per cycle, Hike), and the field is the request's own path.
      throw validation("Payments per cycle must be a whole number from 1 to 120.", `portions.${index}.cycleLength`);
    }
    if (!(Number.isFinite(update.hikePercent) && update.hikePercent >= 0 && update.hikePercent <= 100)) {
      throw validation("Hike must be a number from 0 to 100.", `portions.${index}.hikePercent`);
    }
    const row = found.sheetRow;
    return [
      { tab: SETTINGS_TAB, a1: `B${row}`, values: [[name]] },
      {
        tab: SETTINGS_TAB,
        a1: `F${row}:G${row}`,
        values: [[update.cycleLength ?? "", update.hikePercent]],
      },
    ];
  });
  await gateway.updateValues(writes.flat());
}
