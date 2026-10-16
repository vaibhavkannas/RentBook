import type { PortionConfig } from "@/lib/domain/types";
import { sheetStructure, tabMissing, validation } from "@/lib/errors";
import { findHeaderRowIndex, isBlankCell, shorten } from "./schedule";
import type { SheetsGateway } from "./gateway";
import { addTabIfMissing } from "./tabs";
import { ensureTenantsTab, TENANTS_TAB } from "./tenants-store";

export const SETTINGS_TAB = "Settings";
export const LOG_TAB = "Payments Log";

export const SETTINGS_HEADERS = [
  "Portion",
  "Name",
  "Tenant header",
  "Count header",
  "Amount header",
  "Cycle length",
  "Hike %",
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

export const DEFAULT_CYCLE_LENGTH = 11;
export const DEFAULT_HIKE_PERCENT = 5;

const TENANT_HEADER = /^tenant\s*\d*$/i;
const COUNT_HEADER = /^count\s*\d*$/i;
const AMOUNT_HEADER = /^amount\s*\d*$/i;

/**
 * Builds default portion settings from the Schedule header row: every
 * "Tenant*" header must be followed by a "Count*" and an "Amount*" header.
 */
export function inferPortions(headerRow: unknown[]): PortionConfig[] {
  const cells = headerRow.map((cell) => String(cell ?? "").trim());
  const portions: PortionConfig[] = [];
  const seen = new Set<string>();
  cells.forEach((header, index) => {
    if (/^tenant/i.test(header) && !TENANT_HEADER.test(header)) {
      throw sheetStructure(
        `"${header}" looks like a Tenant column but is not named like one. Use Tenant, Tenant2, Tenant3 and so on.`,
      );
    }
    if (!TENANT_HEADER.test(header)) return;
    for (const name of [header, cells[index + 1] ?? "", cells[index + 2] ?? ""]) {
      const key = name.toLowerCase();
      if (key && seen.has(key)) {
        throw sheetStructure(
          `Header "${name}" appears more than once in the Schedule tab. Give each portion its own headers, for example Tenant, Count, Amount, then Tenant2, Count2, Amount2.`,
        );
      }
      seen.add(key);
    }
    const count = cells[index + 1] ?? "";
    const amount = cells[index + 2] ?? "";
    if (!COUNT_HEADER.test(count) || !AMOUNT_HEADER.test(amount)) {
      throw sheetStructure(
        `"${header}" must be followed by a Count and an Amount column in the Schedule tab.`,
      );
    }
    const position = portions.length;
    portions.push({
      id: `p${position + 1}`,
      name: DEFAULT_PORTION_NAMES[position] ?? `Portion ${position + 1}`,
      tenantHeader: header,
      countHeader: count,
      amountHeader: amount,
      cycleLength: DEFAULT_CYCLE_LENGTH,
      hikePercent: DEFAULT_HIKE_PERCENT,
    });
  });
  if (portions.length === 0) {
    throw sheetStructure('No "Tenant" columns were found in the Schedule header row.');
  }
  return portions;
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

const SETTINGS_MISSING =
  "The Settings tab is missing. Restore it from File > Version history or rename it back. RentBook will not recreate it because that would reset your rent cycle lengths and hike percentages.";

const isBlankRow = (row: unknown[]) =>
  row.every((cell) => cell === undefined || cell === null || String(cell).trim() === "");

/**
 * True when a Settings tab holds nothing but, at most, its header row, so it is safe to fill in. Anything
 * else (a note, a header that is not ours, rows without a portion id) is left exactly as it is.
 */
function settingsIsEmpty(values: unknown[][]): boolean {
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
): Promise<void> {
  const top = await gateway.getValues(scheduleTab, "A1:ZZ25", "FORMATTED_VALUE");
  const headerIndex = findHeaderRowIndex(top);
  if (headerIndex === -1) {
    throw sheetStructure('No header row containing "Month" was found in the Schedule tab.');
  }
  const portions = inferPortions(top[headerIndex]);
  if (!exists && !(await addTabIfMissing(gateway, SETTINGS_TAB))) {
    const theirs = await gateway.getValues(SETTINGS_TAB, "A1:G50", "UNFORMATTED_VALUE");
    if (!settingsIsEmpty(theirs)) return;
  }
  await gateway.updateValues([
    {
      tab: SETTINGS_TAB,
      a1: "A1",
      values: [SETTINGS_HEADERS, ...portions.map(toSettingsRow)],
    },
  ]);
}

/**
 * Creates the Settings, Payments Log and Tenants tabs when they are missing, once per gateway instance
 * (until resetBootstrap). Settings is seeded from the Schedule header row, and only on a Sheet that has none
 * of the three app tabs yet, or whose Settings tab holds no portions: a Settings tab that went missing while
 * the others are still there is refused, never recreated, because the defaults would silently replace the
 * owner's cycle lengths and hike percentages.
 */
export async function ensureTabs(gateway: SheetsGateway, scheduleTab: string): Promise<void> {
  if (bootstrapped.has(gateway)) return;
  const tabs = await gateway.listTabs();
  if (!tabs.includes(scheduleTab)) throw tabMissing(scheduleTab);

  const hasSettings = tabs.includes(SETTINGS_TAB);
  if (!hasSettings && (tabs.includes(LOG_TAB) || tabs.includes(TENANTS_TAB))) {
    throw sheetStructure(SETTINGS_MISSING);
  }
  const settings = hasSettings
    ? await gateway.getValues(SETTINGS_TAB, "A1:G50", "UNFORMATTED_VALUE")
    : [];
  if (settingsIsEmpty(settings)) await seedSettings(gateway, scheduleTab, hasSettings);

  // A Payments Log tab that another instance added a moment ago is treated as an existing one.
  if (!tabs.includes(LOG_TAB) && (await addTabIfMissing(gateway, LOG_TAB))) {
    await gateway.updateValues([{ tab: LOG_TAB, a1: "A1", values: [LOG_HEADERS] }]);
  } else {
    // An older Payments Log has only the first seven columns. Add the two new headers once.
    const header = (await gateway.getValues(LOG_TAB, "A1:I1", "FORMATTED_VALUE"))[0] ?? [];
    if (header.length === 0) {
      await gateway.updateValues([{ tab: LOG_TAB, a1: "A1", values: [LOG_HEADERS] }]);
    } else if (header[7] !== LOG_HEADERS[7] || header[8] !== LOG_HEADERS[8]) {
      await gateway.updateValues([{ tab: LOG_TAB, a1: "H1:I1", values: [LOG_HEADERS.slice(7)] }]);
    }
  }
  await ensureTenantsTab(gateway, tabs);
  bootstrapped.add(gateway);
}

type SettingsRow = { portion: PortionConfig; sheetRow: number };

/** A portion id is typed by hand and becomes a key and a URL part, so it is kept to letters, digits, - and _. */
const PORTION_ID = /^[A-Za-z0-9_-]{1,20}$/;

/**
 * Portions with the 1-based Settings-tab row each one was read from. Rows that are not portions are skipped:
 * blank rows, and a note typed under the table (its Tenant, Count and Amount header cells, columns C to E, are
 * all blank). A row with only some of those three filled in is a half-typed portion: refused, by row number.
 */
async function readSettingsRows(gateway: SheetsGateway): Promise<SettingsRow[]> {
  const values = await gateway.getValues(SETTINGS_TAB, "A1:G50", "UNFORMATTED_VALUE");
  const portions: SettingsRow[] = [];
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
    const id = String(row[0]);
    if (!PORTION_ID.test(id)) {
      throw sheetStructure(
        `Settings row ${sheetRow}: the portion id "${shorten(id)}" can only use letters, numbers, - and _, up to 20 characters.`,
      );
    }
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
      },
    });
  });
  if (portions.length === 0) {
    throw sheetStructure("The Settings tab has no portions.");
  }
  return portions;
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
  const writes = updates.map((update) => {
    const found = current.find((entry) => entry.portion.id === update.id);
    if (!found) throw validation(`Unknown portion "${update.id}".`);
    const name = update.name.trim();
    if (name.length === 0 || name.length > 60) {
      throw validation("Portion name must be 1 to 60 characters.");
    }
    if (
      update.cycleLength !== null &&
      !(Number.isInteger(update.cycleLength) && update.cycleLength >= 1 && update.cycleLength <= 120)
    ) {
      throw validation("Cycle length must be a whole number from 1 to 120, or blank.");
    }
    if (!(Number.isFinite(update.hikePercent) && update.hikePercent >= 0 && update.hikePercent <= 100)) {
      throw validation("Hike % must be between 0 and 100.");
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
