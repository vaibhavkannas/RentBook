import type { PortionConfig } from "@/lib/domain/types";
import { sheetStructure, validation } from "@/lib/errors";
import { findHeaderRowIndex } from "./schedule";
import type { SheetsGateway } from "./gateway";

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
 * Creates the Settings and Payments Log tabs when they are missing. Settings
 * is seeded from the Schedule header row. Runs once per gateway instance.
 */
export async function ensureTabs(gateway: SheetsGateway, scheduleTab: string): Promise<void> {
  if (bootstrapped.has(gateway)) return;
  const tabs = await gateway.listTabs();
  if (!tabs.includes(scheduleTab)) {
    throw sheetStructure(`The tab "${scheduleTab}" was not found in the Google Sheet.`);
  }
  if (!tabs.includes(SETTINGS_TAB)) {
    const top = await gateway.getValues(scheduleTab, "A1:ZZ25", "FORMATTED_VALUE");
    const headerIndex = findHeaderRowIndex(top);
    if (headerIndex === -1) {
      throw sheetStructure('No header row containing "Month" was found in the Schedule tab.');
    }
    const portions = inferPortions(top[headerIndex]);
    await gateway.addTab(SETTINGS_TAB);
    await gateway.updateValues([
      {
        tab: SETTINGS_TAB,
        a1: "A1",
        values: [SETTINGS_HEADERS, ...portions.map(toSettingsRow)],
      },
    ]);
  }
  if (!tabs.includes(LOG_TAB)) {
    await gateway.addTab(LOG_TAB);
    await gateway.updateValues([{ tab: LOG_TAB, a1: "A1", values: [LOG_HEADERS] }]);
  }
  bootstrapped.add(gateway);
}

type SettingsRow = { portion: PortionConfig; sheetRow: number };

/** Portions with the 1-based Settings-tab row each one was read from (blank rows are skipped). */
async function readSettingsRows(gateway: SheetsGateway): Promise<SettingsRow[]> {
  const values = await gateway.getValues(SETTINGS_TAB, "A1:G50", "UNFORMATTED_VALUE");
  const portions: SettingsRow[] = [];
  values.slice(1).forEach((row, offset) => {
    if (row.length === 0 || row[0] === undefined || row[0] === "") return;
    const sheetRow = offset + 2;
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
        id: String(row[0]),
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
