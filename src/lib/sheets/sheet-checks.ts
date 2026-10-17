import type { PortionConfig, ScheduleRow } from "@/lib/domain/types";
import { ymKey } from "@/lib/domain/year-month";
import { getBrand } from "@/lib/brand";
import { AppError } from "@/lib/errors";
import { formatMonthTitle, indiaDayKey } from "@/lib/format";
import { errorLogFields, logEvent } from "@/lib/server/log";
import { renameFirstAdvice, type Check, type CheckStatus, type SetupStep } from "@/lib/setup-checks";
import { colLetter } from "./a1";
import { isBlankCell } from "./cells";
import type { SheetsGateway } from "./gateway";
import { findHeader, headerKey } from "./headers";
import { DEFAULT_TAB_NAMES, TAB_VARIABLES, type AppTab, type TabKey } from "./tab-names";
import { findHeaderRowIndex, parseSchedule, shorten, type ScheduleLayout } from "./schedule";
import {
  inferPortions,
  LOG_TAB,
  logHeaderUpgrade,
  LOG_HEADERS,
  parseSettings,
  SETTINGS_RANGE,
  SETTINGS_TAB,
  settingsIsEmpty,
  settingsMissing,
} from "./settings-store";
import { parseTenancies, TENANTS_RANGE, TENANTS_TAB } from "./tenants-store";

/**
 * A read-only look at the owner's Sheet, for the Set up page and Diagnostics: one check for each part of the connection
 * (what was found, what to do about it) and a few counts and times. It reads three times (the tab list, ONE read of the
 * tabs that are there, ONE read of the last month's row and the row under it) and never writes, never creates a tab and
 * never runs the app's own tab check. Nothing it returns holds a person's name, a phone number or an amount: only counts,
 * times, tab titles and header texts, and the words of the Sheet's own error messages.
 */

/** The counts and times behind Diagnostics. A part that is not there, or cannot be read, is null. */
export type SheetFacts = {
  /** How long the tab list took, in milliseconds. */
  listMs: number;
  /** How long the read of the tabs took, in milliseconds; null when no tab was read. */
  readMs: number | null;
  monthRows: number | null;
  /** The first and the last month of the Schedule, as YYYY-MM. */
  firstMonth: string | null;
  lastMonth: string | null;
  /** Portions that are on, and switched off. */
  portionsOn: number | null;
  portionsOff: number | null;
  /** The portions Prepare my Sheet would put in a new Settings tab, from the Schedule's header; null when none is to be made. */
  seedPortions: number | null;
  logRows: number | null;
  /** The latest time in the Payments Log's Saved at column that is a time (an ISO time). */
  lastSavedAt: string | null;
  tenantsRows: number | null;
  /** Tenancies with no move-out date. */
  openTenancies: number | null;
  /** The latest time in the Tenants tab's Updated at column that is a time (an ISO time). */
  lastUpdatedAt: string | null;
};

export type SheetCheckResult = { checks: Check[]; facts: SheetFacts };

export type SheetCheckOptions = {
  scheduleTab: string;
  /** The header of the Schedule's total column, or null when TOTAL_HEADER is not set. */
  totalHeader: string | null;
  /** What the owner called the app's own tabs (SETTINGS_TAB, LOG_TAB, TENANTS_TAB). Left out, they have the usual names. */
  appTabNames?: Partial<Record<AppTab, string>>;
  /**
   * The title each tab has in the Sheet, shown where it is not the app's usual name for it. Asked once, right after the tab
   * list is in (NamedTabsGateway.knownTitles answers from that list without a call of its own); null for none.
   */
  realTitles?: () => Partial<Record<TabKey, string | null>> | null;
};

const WAITING = "Waiting for the checks above.";
const GENERAL_FAILURE = "Couldn't reach Google Sheets. Try again.";
/** How many tab titles "No tab named" lists. */
const MAX_LISTED_TABS = 8;

/** The ten checks, in the order they are shown, with the step and the title each has. */
const DEFINITIONS = [
  { id: "connection", step: 3, title: "Opening your Sheet" },
  { id: "schedule-tab", step: 4, title: "Schedule tab" },
  { id: "header-row", step: 4, title: "Header row" },
  { id: "months", step: 4, title: "Month rows" },
  { id: "row-below", step: 4, title: "Room for the next month" },
  { id: "total", step: 4, title: "Total column" },
  { id: "settings", step: 5, title: "Settings tab" },
  { id: "log", step: 5, title: "Payments Log tab" },
  { id: "tenants", step: 5, title: "Tenants tab" },
  { id: "portion-settings", step: 6, title: "Payments per cycle and hike" },
] as const satisfies readonly { id: string; step: SetupStep; title: string }[];

type CheckId = (typeof DEFINITIONS)[number]["id"];

function make(id: CheckId, status: CheckStatus, detail: string, fix?: string): Check {
  const { step, title } = DEFINITIONS.find((definition) => definition.id === id)!;
  return { id, step, title, status, detail, ...(fix === undefined ? {} : { fix }) };
}

/** Every check of the Sheet, waiting, with `detail` to say what for (the page uses it when the settings are wrong). */
export function waitingChecks(detail: string): Check[] {
  return DEFINITIONS.map(({ id }) => make(id, "skip", detail));
}

function blankFacts(): SheetFacts {
  return {
    listMs: 0,
    readMs: null,
    monthRows: null,
    firstMonth: null,
    lastMonth: null,
    portionsOn: null,
    portionsOff: null,
    seedPortions: null,
    logRows: null,
    lastSavedAt: null,
    tenantsRows: null,
    openTenancies: null,
    lastUpdatedAt: null,
  };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What an AppError says, which is already in words for the owner. Anything else is not ours to explain. */
function message(error: unknown): string | null {
  return error instanceof AppError ? error.message : null;
}

/** The connection failed: the reason in the gateway's own words, and every other check waits. */
function connectionFailed(error: unknown, facts: SheetFacts): SheetCheckResult {
  const reason = message(error);
  if (reason === null) {
    logEvent("error", "setup-check-failed", errorLogFields(error, "The Set up check could not read the Sheet"));
  }
  return { checks: [make("connection", "fail", reason ?? GENERAL_FAILURE), ...waitingChecks(WAITING).slice(1)], facts };
}

/** The result of a parse that may refuse with a sheet-structure message. */
type Parsed<T> = { value: T } | { problem: string };

function attempt<T>(parse: () => T): Parsed<T> {
  try {
    return { value: parse() };
  } catch (error) {
    return { problem: message(error) ?? "Couldn't read this part of your Sheet." };
  }
}

const isOk = <T>(parsed: Parsed<T>): parsed is { value: T } => "value" in parsed;

/** A time in a cell, when it is one written out in full (as the app writes them), as a time to compare. */
const timeOf = (cell: unknown): number | null =>
  typeof cell === "string" && indiaDayKey(cell) !== null ? Date.parse(cell) : null;

/** The latest of the times in `cells`, as it is written, or null when none is a time. */
function latestTime(cells: unknown[]): string | null {
  let best: { at: number; text: string } | null = null;
  for (const cell of cells) {
    const at = timeOf(cell);
    if (at !== null && (best === null || at > best.at)) best = { at, text: cell as string };
  }
  return best?.text ?? null;
}

/** "Tab 1", "Tab 2" and so on, quoted, with how many more there are when the list is long. */
function tabList(tabs: string[]): string {
  const shown = tabs.slice(0, MAX_LISTED_TABS).map((tab) => `"${tab}"`);
  const more = tabs.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

/** The grid of a Schedule that has only its header row and one month, so the columns can be checked whatever the months hold. */
function headerOnlyGrid(headers: unknown[], headerIndex: number, monthCol: number): unknown[][] {
  const month: unknown[] = [];
  month[monthCol] = "Jan-26";
  return [...Array.from({ length: headerIndex }, (): unknown[] => []), headers, month];
}

type ScheduleView = {
  headerIndex: number;
  headers: unknown[];
  /** The months, when they can be read. */
  parsed: Parsed<{ layout: ScheduleLayout; rows: ScheduleRow[] }> | null;
};

/** What a missing app tab with a name of the owner's own may mean, and what to do first. */
function renameFirst(key: AppTab, name: string): string {
  const fresh =
    key === "settings"
      ? "a new Settings tab with the default payments per cycle and hike"
      : `a new, empty ${DEFAULT_TAB_NAMES[key]} tab`;
  return ` ${renameFirstAdvice([`${TAB_VARIABLES[key]} ("${shorten(name)}")`], `, then use Check again: Prepare my Sheet would start ${fresh} and leave the old one alone.`)}`;
}

export async function checkSheet(
  gateway: SheetsGateway,
  options: SheetCheckOptions,
  clock: () => number = () => performance.now(),
): Promise<SheetCheckResult> {
  const { scheduleTab, totalHeader } = options;
  const brand = getBrand().name;
  const facts = blankFacts();

  // 1. The tab list.
  const listStart = clock();
  let tabs: string[];
  try {
    tabs = await gateway.listTabs();
  } catch (error) {
    facts.listMs = Math.round(clock() - listStart);
    return connectionFailed(error, facts);
  }
  facts.listMs = Math.round(clock() - listStart);
  const titles = options.realTitles?.() ?? null;

  // 2. ONE read of the tabs that are there.
  const wanted = [
    { tab: SETTINGS_TAB, a1: SETTINGS_RANGE },
    { tab: scheduleTab, a1: "A1:ZZ" },
    { tab: LOG_TAB, a1: "A1:I" },
    { tab: TENANTS_TAB, a1: TENANTS_RANGE },
  ].filter(({ tab }) => tabs.includes(tab));
  const grids = new Map<string, unknown[][]>();
  if (wanted.length > 0) {
    const readStart = clock();
    try {
      const answers = await gateway.getManyValues(wanted, "UNFORMATTED_VALUE");
      wanted.forEach(({ tab }, index) => grids.set(tab, answers[index] ?? []));
    } catch (error) {
      return connectionFailed(error, facts);
    }
    facts.readMs = Math.round(clock() - readStart);
  }

  const titleOf = (key: TabKey, fallback: string) => titles?.[key] ?? fallback;
  /** "Found as "x". " for an app tab whose real title is not the app's usual name for it. */
  const foundAs = (key: AppTab, detail: string) => {
    const real = titles?.[key];
    return typeof real === "string" && real !== DEFAULT_TAB_NAMES[key] ? `Found as "${shorten(real)}". ${detail}` : detail;
  };
  const customName = (key: AppTab): string | null => {
    const name = options.appTabNames?.[key];
    return name !== undefined && name !== DEFAULT_TAB_NAMES[key] ? name : null;
  };

  const checks: Check[] = [
    make("connection", "ok", `${brand} can open your Sheet (${facts.listMs} ms).`),
  ];

  // The Schedule tab, its header, its months.
  const scheduleGrid = grids.get(scheduleTab);
  let view: ScheduleView | null = null;
  if (scheduleGrid === undefined) {
    checks.push(
      make(
        "schedule-tab",
        "fail",
        `No tab named "${scheduleTab}". Your tabs: ${tabList(tabs)}.`,
        "Rename the tab that holds the month rows, or set SCHEDULE_TAB to its name.",
      ),
      make("header-row", "skip", WAITING),
      make("months", "skip", WAITING),
    );
  } else {
    checks.push(make("schedule-tab", "ok", `Found the tab "${shorten(titleOf("schedule", scheduleTab))}".`));
    const headerIndex = findHeaderRowIndex(scheduleGrid);
    if (headerIndex === -1) {
      checks.push(
        make(
          "header-row",
          "fail",
          'No row with "Month" in the first 25 rows.',
          "Put the headers (Month, then Tenant, Count and Amount for each portion) in one row near the top.",
        ),
        make("months", "skip", WAITING),
      );
    } else {
      checks.push(make("header-row", "ok", `Headers are in row ${headerIndex + 1}.`));
      const parsed = attempt(() => parseSchedule(scheduleGrid, [], null));
      view = { headerIndex, headers: scheduleGrid[headerIndex], parsed };
      if (isOk(parsed)) {
        const { layout, rows } = parsed.value;
        const first = rows[0].month;
        const last = rows[rows.length - 1].month;
        facts.monthRows = rows.length;
        facts.firstMonth = ymKey(first);
        facts.lastMonth = ymKey(last);
        const sample = String(scheduleGrid[layout.lastDataRow - 1][layout.monthCol]);
        const written = layout.codec.kind === "serial" ? "dates" : `text such as "${sample}"`;
        checks.push(
          make(
            "months",
            "ok",
            `${plural(rows.length, "month row", "month rows")}, ${formatMonthTitle(first)} to ${formatMonthTitle(last)}, written as ${written}.`,
          ),
        );
      } else {
        checks.push(make("months", "fail", parsed.problem));
      }
    }
  }
  const layout = view !== null && view.parsed !== null && isOk(view.parsed) ? view.parsed.value.layout : null;

  // 3. ONE read of the last month's row and the row under it.
  let tail: unknown[][] | null = null;
  if (layout !== null) {
    try {
      tail = await gateway.getValues(scheduleTab, `A${layout.lastDataRow}:ZZ${layout.lastDataRow + 1}`, "FORMULA");
    } catch (error) {
      return connectionFailed(error, facts);
    }
  }

  // The settings come before the total and the row below only in the code: the total check wants the portions' columns.
  const settingsGrid = grids.get(SETTINGS_TAB);
  const logGrid = grids.get(LOG_TAB);
  const tenantsGrid = grids.get(TENANTS_TAB);

  // Settings.
  let portions: PortionConfig[] | null = null;
  /** The columns the portions use, once they have been checked against the header row. */
  const portionColumns = new Set<number>();
  let settingsCheck: Check;
  const seedFrom = (): Parsed<number> | null =>
    view === null ? null : attempt(() => inferPortions(view!.headers).length);
  const totalFound = totalHeader !== null && view !== null && "index" in findHeader(view.headers, totalHeader);
  if (settingsGrid === undefined) {
    if (logGrid !== undefined || tenantsGrid !== undefined) {
      settingsCheck = make("settings", "fail", settingsMissing(options.appTabNames?.settings ?? SETTINGS_TAB));
    } else {
      const seed = seedFrom();
      if (seed === null) settingsCheck = make("settings", "skip", WAITING);
      else if (!isOk(seed)) {
        settingsCheck = make(
          "settings",
          "fail",
          seed.problem,
          "Make the Schedule header row use a Tenant, a Count and an Amount column for each portion (SETUP.md).",
        );
      } else {
        facts.seedPortions = seed.value;
        const name = customName("settings");
        settingsCheck = make(
          "settings",
          "todo",
          `Not created yet. Prepare my Sheet creates it with ${plural(seed.value, "portion", "portions")} found in your header.${name === null ? "" : renameFirst("settings", name)}`,
        );
      }
    }
  } else if (settingsIsEmpty(settingsGrid)) {
    const seed = seedFrom();
    if (seed === null) settingsCheck = make("settings", "skip", WAITING);
    else if (!isOk(seed)) {
      settingsCheck = make(
        "settings",
        "fail",
        foundAs("settings", seed.problem),
        "Make the Schedule header row use a Tenant, a Count and an Amount column for each portion (SETUP.md).",
      );
    } else {
      facts.seedPortions = seed.value;
      settingsCheck = make(
        "settings",
        "todo",
        foundAs("settings", `Nothing in it yet. Prepare my Sheet fills it with ${plural(seed.value, "portion", "portions")} found in your header.`),
      );
    }
  } else {
    const FIX = "Make the header names in the Settings tab match the Schedule header row.";
    const read = attempt(() => parseSettings(settingsGrid));
    if (!isOk(read)) {
      settingsCheck = make("settings", "fail", foundAs("settings", read.problem), FIX);
    } else {
      portions = read.value;
      facts.portionsOn = portions.length;
      facts.portionsOff = 0;
      if (view === null) {
        settingsCheck = make("settings", "skip", WAITING);
      } else {
        const monthCol = findHeader(view.headers, "Month");
        const columns =
          "index" in monthCol
            ? attempt(() =>
                parseSchedule(
                  headerOnlyGrid(view!.headers, view!.headerIndex, monthCol.index),
                  portions!,
                  totalFound ? totalHeader : null,
                ),
              )
            : null;
        if (columns === null) settingsCheck = make("settings", "skip", WAITING);
        else if (!isOk(columns)) settingsCheck = make("settings", "fail", foundAs("settings", columns.problem), FIX);
        else {
          for (const cols of columns.value.layout.portionCols.values()) {
            portionColumns.add(cols.tenant).add(cols.count).add(cols.amount);
          }
          settingsCheck = make(
            "settings",
            "ok",
            foundAs(
              "settings",
              portions.length === 1
                ? "1 portion, with its Tenant, Count and Amount columns."
                : `${portions.length} portions, each with its Tenant, Count and Amount columns.`,
            ),
          );
        }
      }
    }
  }

  // The row under the last month, and the total column.
  if (layout === null) {
    checks.push(make("row-below", "skip", WAITING));
  } else {
    const row = layout.lastDataRow + 1;
    const occupied = (tail?.[1] ?? []).some((cell) => cell !== undefined && cell !== "");
    checks.push(
      occupied
        ? make(
            "row-below",
            "warn",
            `Row ${row}, right under the last month, is not empty, so ${brand} can't add the next month there.`,
            `Move what is in row ${row} lower down, or clear it.`,
          )
        : make("row-below", "ok", `Row ${row}, under the last month, is free for the next month.`),
    );
  }
  checks.push(totalCheck(options, view, layout, tail, portionColumns, brand));
  checks.push(settingsCheck);

  // The Payments Log.
  if (logGrid === undefined) {
    const name = customName("log");
    checks.push(make("log", "todo", `Not created yet.${name === null ? "" : renameFirst("log", name)}`));
  } else {
    const header = logGrid[0] ?? [];
    if (header.every(isBlankCell)) {
      checks.push(make("log", "todo", foundAs("log", "Empty. Prepare my Sheet writes its headers.")));
    } else {
      const entries = logGrid.slice(1).filter((row) => !row.every(isBlankCell));
      facts.logRows = entries.length;
      facts.lastSavedAt = latestTime(entries.map((row) => row[0]));
      const { fill, taken } = logHeaderUpgrade(header);
      const where: Record<number, string> = {
        7: "who logged each payment",
        8: "what was done (Logged, Edited or Undone)",
      };
      if (taken.length > 0) {
        const detail = taken
          .map(
            (column) =>
              `Column ${colLetter(column)} is headed "${shorten(String(header[column]))}", but ${brand} still writes ${where[column]} there, and Activity reads it from that column.`,
          )
          .join(" ");
        checks.push(
          make(
            "log",
            "warn",
            foundAs("log", detail),
            taken.length === 1 ? "Move that column to the right of column I." : "Move those columns to the right of column I.",
          ),
        );
      } else {
        const entriesText = plural(entries.length, "entry", "entries");
        const added = fill.map((column) => LOG_HEADERS[column]);
        const newer =
          added.length === 0
            ? ""
            : added.length === 1
              ? `, and the newer header (${added[0]}) is added for you`
              : `, and the newer headers (${added.join(", ")}) are added for you`;
        checks.push(make("log", "ok", foundAs("log", `Headers are right${newer}. ${entriesText}.`)));
      }
    }
  }

  // The Tenants tab.
  if (tenantsGrid === undefined) {
    const name = customName("tenants");
    checks.push(make("tenants", "todo", `Not created yet.${name === null ? "" : renameFirst("tenants", name)}`));
  } else if ((tenantsGrid[0] ?? []).every(isBlankCell)) {
    checks.push(make("tenants", "todo", foundAs("tenants", "Empty. Prepare my Sheet writes its headers.")));
  } else {
    const read = attempt(() => parseTenancies(tenantsGrid));
    if (!isOk(read)) {
      checks.push(make("tenants", "fail", foundAs("tenants", `${read.problem} Logging rent still works.`)));
    } else {
      const tenancies = read.value;
      facts.tenantsRows = tenancies.length;
      facts.openTenancies = tenancies.filter((tenancy) => tenancy.moveOut === "").length;
      facts.lastUpdatedAt = latestTime(tenancies.map((tenancy) => tenancy.updatedAt));
      checks.push(make("tenants", "ok", foundAs("tenants", `Headers are right. ${plural(tenancies.length, "row", "rows")}.`)));
    }
  }

  // Step 6 follows the Settings tab.
  const reminder = "Check each portion's payments per cycle and hike before the first payment.";
  checks.push(
    settingsCheck.status === "ok"
      ? make("portion-settings", "ok", reminder)
      : settingsCheck.status === "todo"
        ? make("portion-settings", "todo", reminder)
        : make("portion-settings", "skip", WAITING),
  );

  return { checks, facts };
}

/**
 * The total column. With TOTAL_HEADER set it must be in the header row once; whether it adds itself up or holds typed
 * totals is read from the last month's row. Without it, a header that starts with "Total" and holds typed numbers is a
 * warning: nothing keeps those up to date.
 */
function totalCheck(
  options: SheetCheckOptions,
  view: ScheduleView | null,
  layout: ScheduleLayout | null,
  tail: unknown[][] | null,
  portionColumns: ReadonlySet<number>,
  brand: string,
): Check {
  const { totalHeader } = options;
  if (view === null) return make("total", "skip", WAITING);
  const headerRow = view.headerIndex + 1;
  const cellAt = (col: number): unknown => tail?.[0]?.[col];
  const isFormula = (cell: unknown) => typeof cell === "string" && cell.startsWith("=");

  if (totalHeader !== null) {
    const found = findHeader(view.headers, totalHeader);
    if ("problem" in found) {
      return found.problem === "missing"
        ? make(
            "total",
            "fail",
            `No column headed "${shorten(totalHeader)}" in the header row (row ${headerRow}).`,
            "Set TOTAL_HEADER to the header exactly as in the header row, or delete it.",
          )
        : make(
            "total",
            "fail",
            `The header "${shorten(totalHeader)}" appears more than once in the header row (row ${headerRow}).`,
            "Make it appear once, or set TOTAL_HEADER to a header that does.",
          );
    }
    if (layout === null) return make("total", "skip", WAITING);
    const says = isFormula(cellAt(found.index))
      ? `Column "${shorten(totalHeader)}" adds itself up with a formula.`
      : `Column "${shorten(totalHeader)}" holds typed totals; ${brand} keeps them up to date.`;
    // The app looks a header up by its exact text first and by a looser rule only when that finds none, so a twin that only
    // reads the same is not in the way today; renaming this header would quietly make the twin the one that is found.
    const twin = view.headers.findIndex((header, col) => col !== found.index && headerKey(header) === headerKey(totalHeader));
    if (twin === -1) return make("total", "ok", says);
    return make(
      "total",
      "warn",
      `${says} Another column has a header that looks the same ("${shorten(String(view.headers[twin]))}"): if you rename this one, ${brand} would read that column instead.`,
      `Rename the look-alike header, so that only one header reads as "${shorten(totalHeader)}".`,
    );
  }

  if (layout === null) return make("total", "skip", WAITING);
  // No TOTAL_HEADER: look for a column headed "Total..." that is not one of a portion's own.
  const candidates = view.headers.flatMap((header, col) =>
    headerKey(header).startsWith("total") && !portionColumns.has(col) ? [col] : [],
  );
  const typed = candidates.find((col) => typeof cellAt(col) === "number");
  if (typed !== undefined) {
    const header = shorten(String(view.headers[typed]));
    return make(
      "total",
      "warn",
      `Column "${header}" holds typed numbers, but TOTAL_HEADER is not set, so they will go out of date as you log payments.`,
      `Set TOTAL_HEADER to "${header}" so ${brand} keeps it up to date.`,
    );
  }
  const formula = candidates.find((col) => isFormula(cellAt(col)));
  if (formula !== undefined) {
    return make(
      "total",
      "ok",
      `No total column is set. Column "${shorten(String(view.headers[formula]))}" adds itself up with a formula.`,
    );
  }
  return make("total", "ok", "No total column is set, so none is kept up to date.");
}
