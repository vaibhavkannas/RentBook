import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configError, rateLimited } from "@/lib/errors";
import type { Check, CheckStatus } from "@/lib/setup-checks";
import { NamedTabsGateway } from "@/lib/sheets/named-tabs";
import { checkSheet, waitingChecks, type SheetFacts } from "@/lib/sheets/sheet-checks";
import { LOG_HEADERS, LOG_TAB, SETTINGS_HEADERS, SETTINGS_RANGE, SETTINGS_TAB } from "@/lib/sheets/settings-store";
import { TENANT_HEADERS, TENANTS_RANGE, TENANTS_TAB } from "@/lib/sheets/tenants-store";
import { captureLogs, loggedLines, type LogSpies } from "../support/logs";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, monthCell, scheduleRow, settingsGrid } from "../support/fixtures";

// The read-only check of the owner's Sheet behind the Set up page and Diagnostics: one answer for each part of the
// connection, with what was found and what to do, and a few counts and times. It reads three times and writes never.

type Grids = Record<string, unknown[][]>;

const SAVED_1 = "2026-08-05T04:30:00.000Z";
const SAVED_2 = "2026-09-07T06:15:00.000Z";
const UPDATED_1 = "2026-01-15T05:00:00.000Z";
const UPDATED_2 = "2026-09-20T08:00:00.000Z";

const logRow = (savedAt: unknown, month = "2026-09", tenant = "Asha", amount = 5450): unknown[] => [
  savedAt,
  month,
  "p1",
  tenant,
  amount,
  3,
  "2026-09-05",
  "owner@example.com",
  "Logged",
];

function tenantRow(overrides: Record<number, unknown> = {}): unknown[] {
  const row: unknown[] = [
    "t-1",
    "p1",
    "Asha",
    "98765 43210",
    "2026-01-15",
    "2027-01-14",
    20000,
    "2026-01-10",
    "Held",
    "",
    "",
    "Paid by cheque",
    "",
    "owner@example.com",
    UPDATED_1,
  ];
  for (const [at, value] of Object.entries(overrides)) row[Number(at)] = value;
  return row;
}

/** A Sheet as it is when everything is set up: the owner's Schedule and the app's three tabs, with a little history. */
function healthyGrids(): Grids {
  return {
    Schedule: baseSchedule(),
    [SETTINGS_TAB]: settingsGrid(),
    [LOG_TAB]: [[...LOG_HEADERS], logRow(SAVED_1, "2026-08"), logRow(SAVED_2)],
    [TENANTS_TAB]: [
      [...TENANT_HEADERS],
      tenantRow(),
      tenantRow({ 0: "t-2", 1: "p2", 2: "Bala", 12: "2026-06-30", 14: "2026-06-30T05:00:00.000Z" }),
      tenantRow({ 0: "t-3", 1: "p3", 2: "Chitra", 14: UPDATED_2 }),
    ],
  };
}

/** The healthy Sheet with these changes: a tab given as null is removed. */
function sheet(changes: Record<string, unknown[][] | null> = {}): FakeGateway {
  const grids: Grids = { ...healthyGrids() };
  for (const [tab, grid] of Object.entries(changes)) {
    if (grid === null) delete grids[tab];
    else grids[tab] = grid;
  }
  return new FakeGateway(grids);
}

/** A Sheet with the Schedule alone, as a new owner has it. */
const fresh = () => sheet({ [SETTINGS_TAB]: null, [LOG_TAB]: null, [TENANTS_TAB]: null });

const OPTIONS = { scheduleTab: "Schedule", totalHeader: "Total Rent" as string | null };

/** A clock that answers from a list: the times the checks read it at, in order. */
const clockOf = (...times: number[]) => () => times.shift() ?? 0;

const run = (fake: FakeGateway, options: Partial<typeof OPTIONS> = {}) =>
  checkSheet(fake, { ...OPTIONS, ...options }, clockOf(1000, 1012.4, 2000, 2041.6));

const byId = (checks: Check[], id: string): Check => {
  const found = checks.filter((check) => check.id === id);
  expect(found, `one check with the id ${id}`).toHaveLength(1);
  return found[0];
};

const statuses = (checks: Check[]) => Object.fromEntries(checks.map((check) => [check.id, check.status]));

const ALL_IDS = [
  "connection",
  "schedule-tab",
  "header-row",
  "months",
  "row-below",
  "total",
  "settings",
  "log",
  "tenants",
  "portion-settings",
];

const WAITING = "Waiting for the checks above.";

let logs: LogSpies;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("a healthy Sheet", () => {
  it("has one check for each part, in the order of the setup steps, and every one is OK", async () => {
    const { checks } = await run(sheet());
    expect(checks.map((check) => [check.id, check.step])).toEqual([
      ["connection", 3],
      ["schedule-tab", 4],
      ["header-row", 4],
      ["months", 4],
      ["row-below", 4],
      ["total", 4],
      ["settings", 5],
      ["log", 5],
      ["tenants", 5],
      ["portion-settings", 6],
    ]);
    for (const check of checks) {
      expect(check.status, check.id).toBe("ok");
      expect(check.fix, check.id).toBeUndefined();
      expect(check.title, check.id).not.toBe("");
    }
  });

  it("says what it found in each", async () => {
    const { checks } = await run(sheet());
    expect(Object.fromEntries(checks.map((check) => [check.id, check.detail]))).toEqual({
      connection: "RentBook can open your Sheet (12 ms).",
      "schedule-tab": 'Found the tab "Schedule".',
      "header-row": "Headers are in row 3.",
      months: '2 month rows, August 2026 to September 2026, written as text such as "Sep-26".',
      "row-below": "Row 6, under the last month, is free for the next month.",
      total: 'Column "Total Rent" adds itself up with a formula.',
      settings: "5 portions, each with its Tenant, Count and Amount columns.",
      log: "Headers are right. 2 entries.",
      tenants: "Headers are right. 3 rows.",
      "portion-settings": "Check each portion's payments per cycle and hike before the first payment.",
    });
  });

  it("gives the counts and the times, the times it read the clock at", async () => {
    const { facts } = await run(sheet());
    expect(facts).toEqual({
      listMs: 12,
      readMs: 42,
      monthRows: 2,
      firstMonth: "2026-08",
      lastMonth: "2026-09",
      portionsOn: 5,
      portionsOff: 0,
      seedPortions: null,
      logRows: 2,
      lastSavedAt: SAVED_2,
      tenantsRows: 3,
      openTenancies: 2,
      lastUpdatedAt: UPDATED_2,
    } satisfies SheetFacts);
  });

  it("makes exactly three calls: the tab list, one read of the four tabs, and one read of the last month's row and the row under it", async () => {
    const fake = sheet();
    const many = vi.spyOn(fake, "getManyValues");
    const one = vi.spyOn(fake, "getValues");
    await run(fake);
    expect(fake.calls).toEqual(["listTabs", "getManyValues", "getValues"]);
    expect(many.mock.calls).toEqual([
      [
        [
          { tab: SETTINGS_TAB, a1: SETTINGS_RANGE },
          { tab: "Schedule", a1: "A1:ZZ" },
          { tab: LOG_TAB, a1: "A1:I" },
          { tab: TENANTS_TAB, a1: TENANTS_RANGE },
        ],
        "UNFORMATTED_VALUE",
      ],
    ]);
    expect(one.mock.calls).toEqual([["Schedule", "A5:ZZ6", "FORMULA"]]);
  });

  it("never writes, creates a tab or changes a cell", async () => {
    for (const fake of [sheet(), fresh(), sheet({ [LOG_TAB]: [["Saved at"]], [TENANTS_TAB]: [["wrong"]] })]) {
      const before = structuredClone([...fake.tabs.entries()]);
      await run(fake);
      for (const write of ["updateValues", "addTab", "appendRow", "cloneRow"]) expect(fake.calls).not.toContain(write);
      expect([...fake.tabs.entries()]).toEqual(before);
    }
  });

  it("reads the clock four times, around the tab list and around the data read, and rounds to whole milliseconds", async () => {
    const times = [10, 10.4, 50, 50.6];
    let reads = 0;
    const { facts } = await checkSheet(sheet(), OPTIONS, () => times[reads++]);
    expect(reads).toBe(4);
    expect(facts.listMs).toBe(0);
    expect(facts.readMs).toBe(1);
  });

  it("uses the real clock when none is given", async () => {
    const { facts } = await checkSheet(sheet(), OPTIONS);
    expect(Number.isInteger(facts.listMs)).toBe(true);
    expect(facts.listMs).toBeGreaterThanOrEqual(0);
    expect(facts.readMs).toBeGreaterThanOrEqual(0);
  });

  it("works through the tab-name wrapper, with a Schedule tab and a Tenants tab that have other names", async () => {
    const inner = new FakeGateway({
      rent: baseSchedule(),
      settings: settingsGrid(),
      [LOG_TAB]: healthyGrids()[LOG_TAB],
      "RentBook Tenants": healthyGrids()[TENANTS_TAB],
      Tenants: [["The owner's own tab"]],
    });
    const wrapper = new NamedTabsGateway(inner, {
      schedule: "Rent",
      settings: "Settings",
      log: "Payments Log",
      tenants: "RentBook Tenants",
    });
    const { checks } = await checkSheet(wrapper, { scheduleTab: "Rent", totalHeader: "Total Rent" });
    expect(statuses(checks)).toEqual(Object.fromEntries(ALL_IDS.map((id) => [id, "ok"])));
    expect(inner.tabs.get("Tenants")).toEqual([["The owner's own tab"]]);
  });
});

describe("the connection", () => {
  it("fails with the gateway's own words when the tabs cannot be listed, and every later check waits", async () => {
    const message = "Share the Sheet with robot@example-project.iam.gserviceaccount.com, as an Editor.";
    const fake = sheet();
    vi.spyOn(fake, "listTabs").mockRejectedValue(configError(message));
    const { checks, facts } = await run(fake);
    expect(byId(checks, "connection")).toMatchObject({ status: "fail", detail: message, step: 3 });
    expect(checks.map((check) => check.id)).toEqual(ALL_IDS);
    for (const check of checks.slice(1)) expect(check, check.id).toMatchObject({ status: "skip", detail: WAITING });
    expect(fake.calls).toEqual([]);
    expect(facts).toEqual({
      listMs: 12,
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
    });
  });

  it("fails the same way when the read of the data is refused (Google busy), and carries on to no more calls", async () => {
    const fake = sheet();
    vi.spyOn(fake, "getManyValues").mockRejectedValue(rateLimited());
    const { checks, facts } = await run(fake);
    expect(byId(checks, "connection")).toMatchObject({ status: "fail", detail: rateLimited().message });
    expect(checks.slice(1).every((check) => check.status === "skip")).toBe(true);
    expect(fake.calls).toEqual(["listTabs"]);
    expect(facts.listMs).toBe(12);
    expect(facts.monthRows).toBeNull();
  });

  it("fails the same way when the last read is refused", async () => {
    const fake = sheet();
    vi.spyOn(fake, "getValues").mockRejectedValue(configError("Google rejected the service account key."));
    const { checks } = await run(fake);
    expect(byId(checks, "connection")).toMatchObject({ status: "fail", detail: "Google rejected the service account key." });
    expect(checks.slice(1).every((check) => check.status === "skip")).toBe(true);
  });

  it("says only something general for a failure that is not ours, and logs it without the error object", async () => {
    const fake = sheet();
    const failure = Object.assign(new Error("socket hang up CANARY"), { config: { headers: { Authorization: "Bearer CANARY" } } });
    vi.spyOn(fake, "listTabs").mockRejectedValue(failure);
    const { checks } = await run(fake);
    expect(byId(checks, "connection")).toMatchObject({ status: "fail", detail: "Couldn't reach Google Sheets. Try again." });
    expect(JSON.stringify(checks)).not.toContain("CANARY");
    const [line] = loggedLines(logs.error);
    expect(line).toMatchObject({ event: "setup-check-failed" });
    expect(JSON.stringify(line)).not.toMatch(/Bearer|Authorization/);
  });

  it("does not log a failure it can explain, which is shown on the page", async () => {
    const fake = sheet();
    vi.spyOn(fake, "listTabs").mockRejectedValue(configError("Google rejected the service account key."));
    await run(fake);
    expect(logs.error).not.toHaveBeenCalled();
    expect(logs.warn).not.toHaveBeenCalled();
  });
});

describe("waitingChecks", () => {
  it("are all ten checks of the Sheet, waiting, with the words given", () => {
    const waiting = waitingChecks("Fix the settings above first.");
    expect(waiting.map((check) => check.id)).toEqual(ALL_IDS);
    for (const check of waiting) expect(check).toMatchObject({ status: "skip", detail: "Fix the settings above first." });
    expect(waiting.map((check) => check.step)).toEqual([3, 4, 4, 4, 4, 4, 5, 5, 5, 6]);
  });
});

describe("the Schedule tab (step 4)", () => {
  it("is not found: it names the tab and lists the tabs there are, and the checks that read it wait", async () => {
    const fake = sheet({ Schedule: null, Rent: baseSchedule() });
    const { checks, facts } = await run(fake);
    expect(byId(checks, "schedule-tab")).toMatchObject({
      status: "fail",
      detail: 'No tab named "Schedule". Your tabs: "Settings", "Payments Log", "Tenants", "Rent".',
      fix: "Rename the tab that holds the month rows, or set SCHEDULE_TAB to its name.",
    });
    for (const id of ["header-row", "months", "row-below", "total"]) {
      expect(byId(checks, id), id).toMatchObject({ status: "skip", detail: WAITING });
    }
    // The tabs of the app are still read and checked.
    expect(byId(checks, "log").status).toBe("ok");
    expect(byId(checks, "tenants").status).toBe("ok");
    expect(facts.logRows).toBe(2);
    expect(fake.calls).toEqual(["listTabs", "getManyValues"]);
  });

  it("lists no more than eight tabs, and says how many more there are", async () => {
    const many = Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`Tab ${index + 1}`, [["x"]]]));
    const fake = new FakeGateway(many);
    const { checks } = await run(fake);
    const detail = byId(checks, "schedule-tab").detail;
    expect(detail).toContain('"Tab 8"');
    expect(detail).not.toContain('"Tab 9"');
    expect(detail).toContain("and 3 more");
  });

  it("has no row with Month in the first 25 rows", async () => {
    const grid = baseSchedule();
    grid[2] = grid[2].map((cell) => (cell === "Month" ? "When" : cell));
    const { checks } = await run(sheet({ Schedule: grid }));
    expect(byId(checks, "header-row")).toMatchObject({
      status: "fail",
      detail: 'No row with "Month" in the first 25 rows.',
      fix: "Put the headers (Month, then Tenant, Count and Amount for each portion) in one row near the top.",
    });
    for (const id of ["months", "row-below", "total"]) expect(byId(checks, id), id).toMatchObject({ status: "skip", detail: WAITING });
    expect(byId(checks, "settings").status).toBe("skip");
  });

  it("finds the header row wherever it is within the first 25 rows, and says which", async () => {
    const grid = [...Array.from({ length: 11 }, () => ["Notes"]), ...baseSchedule().slice(2)];
    const { checks } = await run(sheet({ Schedule: grid }));
    expect(byId(checks, "header-row").detail).toBe("Headers are in row 12.");
    expect(byId(checks, "months").status).toBe("ok");
  });
});

describe("the month rows (step 4)", () => {
  it("says dates when the months are date cells", async () => {
    const { checks } = await run(sheet({ Schedule: baseSchedule("serial") }));
    expect(byId(checks, "months").detail).toBe("2 month rows, August 2026 to September 2026, written as dates.");
  });

  it("says text such as the last month, in the style it is written in", async () => {
    const grid = baseSchedule();
    grid[4][0] = "September 2026";
    const { checks } = await run(sheet({ Schedule: grid }));
    expect(byId(checks, "months").detail).toBe('2 month rows, August 2026 to September 2026, written as text such as "September 2026".');
  });

  it("names the row of a cell in the table that is not a month, and keeps checking what it can", async () => {
    const grid = baseSchedule();
    grid.splice(3, 0, ["Autumn", "Asha", 1, 100]);
    const { checks, facts } = await run(sheet({ Schedule: grid }));
    const months = byId(checks, "months");
    expect(months.status).toBe("fail");
    expect(months.detail).toContain("Row 4 of the Schedule tab");
    expect(months.detail).toContain('"Autumn"');
    expect(facts.monthRows).toBeNull();
    expect(byId(checks, "header-row").status).toBe("ok");
    expect(byId(checks, "row-below")).toMatchObject({ status: "skip", detail: WAITING });
    expect(byId(checks, "total")).toMatchObject({ status: "skip", detail: WAITING });
    expect(byId(checks, "log").status).toBe("ok");
  });

  it("fails when there is no month row at all", async () => {
    const { checks } = await run(sheet({ Schedule: baseSchedule().slice(0, 3) }));
    expect(byId(checks, "months")).toMatchObject({
      status: "fail",
      detail: "The Schedule tab has no month rows to copy the format from.",
    });
  });
});

describe("the row under the last month (step 4)", () => {
  it("is free when only a row further down has something", async () => {
    const grid = baseSchedule();
    grid.push([]);
    grid.push(["a note two rows down"]);
    const { checks } = await run(sheet({ Schedule: grid }));
    expect(byId(checks, "row-below")).toMatchObject({
      status: "ok",
      detail: "Row 6, under the last month, is free for the next month.",
    });
  });

  it("warns when something sits right under the last month, and says which row to clear", async () => {
    const grid = baseSchedule();
    grid.push(["Grand total", 99999]);
    const { checks } = await run(sheet({ Schedule: grid }));
    expect(byId(checks, "row-below")).toEqual({
      id: "row-below",
      step: 4,
      title: expect.any(String),
      status: "warn",
      detail: "Row 6, right under the last month, is not empty, so RentBook can't add the next month there.",
      fix: "Move what is in row 6 lower down, or clear it.",
    });
  });

  it("counts a formula, or a cell holding only a space, as not empty, because a new month would overwrite it", async () => {
    for (const cell of ["=A1+1", " "]) {
      const grid = baseSchedule();
      grid.push([undefined, undefined, undefined, cell]);
      const { checks } = await run(sheet({ Schedule: grid }));
      expect(byId(checks, "row-below").status, cell).toBe("warn");
    }
  });

  it("reads the row under the last month, wherever the last month is", async () => {
    const grid = [...baseSchedule(), scheduleRow(monthCell("text", 2026, 10), [["Asha", 4, 5450], null, null, null, null], 6)];
    const fake = sheet({ Schedule: grid });
    const one = vi.spyOn(fake, "getValues");
    const { checks } = await run(fake);
    expect(one.mock.calls).toEqual([["Schedule", "A6:ZZ7", "FORMULA"]]);
    expect(byId(checks, "row-below").detail).toBe("Row 7, under the last month, is free for the next month.");
  });
});

describe("the total column (step 4)", () => {
  const typedTotals = () => {
    const grid = baseSchedule();
    grid[3] = scheduleRow(monthCell("text", 2026, 8), [["Asha", 2, 5450], ["Bala", 10, 12700], ["Chitra", 4, 9000], null, null], 4, 27150);
    grid[4] = scheduleRow(
      monthCell("text", 2026, 9),
      [["Asha", 3, 5450], ["Bala", 11, 12700], ["Chitra", 5, 9000], null, ["Esha", 1, 5100]],
      5,
      32250,
    );
    return grid;
  };

  it("adds itself up with a formula", async () => {
    const { checks } = await run(sheet());
    expect(byId(checks, "total")).toMatchObject({ status: "ok", detail: 'Column "Total Rent" adds itself up with a formula.' });
  });

  it("holds typed totals that the app keeps up to date", async () => {
    const { checks } = await run(sheet({ Schedule: typedTotals() }));
    expect(byId(checks, "total")).toMatchObject({
      status: "ok",
      detail: 'Column "Total Rent" holds typed totals; RentBook keeps them up to date.',
    });
  });

  it("is not found in the header row: set TOTAL_HEADER as it is typed there, or delete it", async () => {
    const { checks } = await run(sheet(), { totalHeader: "Per Month" });
    expect(byId(checks, "total")).toMatchObject({
      status: "fail",
      detail: 'No column headed "Per Month" in the header row (row 3).',
      fix: "Set TOTAL_HEADER to the header exactly as in the header row, or delete it.",
    });
  });

  it("is found twice in the header row", async () => {
    const grid = baseSchedule();
    grid[2] = [...grid[2], "Total Rent"];
    const { checks } = await run(sheet({ Schedule: grid }));
    expect(byId(checks, "total")).toMatchObject({
      status: "fail",
      detail: 'The header "Total Rent" appears more than once in the header row (row 3).',
      fix: "Make it appear once, or set TOTAL_HEADER to a header that does.",
    });
  });

  it("warns, and says which header, when another column's header only looks the same as the total's: renaming the first would re-point it", async () => {
    const grid = baseSchedule();
    grid[2] = [...grid[2], "Total  Rent"];
    const { checks } = await run(sheet({ Schedule: grid }));
    expect(byId(checks, "total")).toMatchObject({
      status: "warn",
      detail:
        'Column "Total Rent" adds itself up with a formula. Another column has a header that looks the same ("Total  Rent"): if you rename this one, RentBook would read that column instead.',
      fix: 'Rename the look-alike header, so that only one header reads as "Total Rent".',
    });
  });

  it("does not warn when the other header is plainly different", async () => {
    const grid = baseSchedule();
    grid[2] = [...grid[2], "Total Rent 2025", "Total"];
    expect(byId((await run(sheet({ Schedule: grid }))).checks, "total").status).toBe("ok");
  });

  it("finds the header in any case or spacing, as the app does", async () => {
    const { checks } = await run(sheet(), { totalHeader: "  total  rent " });
    expect(byId(checks, "total").status).toBe("ok");
  });

  it("has no total column when TOTAL_HEADER is not set and the header row has none", async () => {
    const grid = baseSchedule().map((row) => row.slice(0, 16));
    const { checks } = await run(sheet({ Schedule: grid }), { totalHeader: null });
    expect(byId(checks, "total")).toMatchObject({
      status: "ok",
      detail: "No total column is set, so none is kept up to date.",
    });
  });

  it("warns when TOTAL_HEADER is not set and a Total header holds typed numbers: nothing keeps them up to date", async () => {
    const { checks } = await run(sheet({ Schedule: typedTotals() }), { totalHeader: null });
    expect(byId(checks, "total")).toMatchObject({
      status: "warn",
      detail: 'Column "Total Rent" holds typed numbers, but TOTAL_HEADER is not set, so they will go out of date as you log payments.',
      fix: 'Set TOTAL_HEADER to "Total Rent" so RentBook keeps it up to date.',
    });
  });

  it("is fine without TOTAL_HEADER when the Total column is a formula, which keeps itself up to date", async () => {
    const { checks } = await run(sheet(), { totalHeader: null });
    expect(byId(checks, "total")).toMatchObject({
      status: "ok",
      detail: 'No total column is set. Column "Total Rent" adds itself up with a formula.',
    });
  });

  it("does not take a portion's own column for a total column", async () => {
    const grid = baseSchedule();
    grid[2][3] = "Total Amount";
    const settings = settingsGrid();
    settings[1][4] = "Total Amount";
    const { checks } = await run(sheet({ Schedule: grid, [SETTINGS_TAB]: settings }), { totalHeader: null });
    expect(byId(checks, "total")).toMatchObject({ status: "ok", detail: 'No total column is set. Column "Total Rent" adds itself up with a formula.' });
  });

  it("still finds a missing total when the months cannot be read, and waits when it is there", async () => {
    const broken = baseSchedule();
    broken.splice(3, 0, ["Autumn"]);
    expect(byId((await run(sheet({ Schedule: broken }), { totalHeader: "Per Month" })).checks, "total").status).toBe("fail");
    expect(byId((await run(sheet({ Schedule: broken }))).checks, "total")).toMatchObject({ status: "skip", detail: WAITING });
  });
});

describe("the Settings tab (step 5)", () => {
  it("counts the portions, each with its columns", async () => {
    const settings = settingsGrid().slice(0, 2);
    const { checks, facts } = await run(sheet({ [SETTINGS_TAB]: settings }));
    expect(byId(checks, "settings")).toMatchObject({ status: "ok", detail: "1 portion, with its Tenant, Count and Amount columns." });
    expect(facts.portionsOn).toBe(1);
    expect(facts.portionsOff).toBe(0);
  });

  it("is not created yet on a fresh Sheet, and says how many portions it would start with", async () => {
    const fake = fresh();
    const { checks, facts } = await run(fake);
    expect(byId(checks, "settings")).toMatchObject({
      status: "todo",
      detail: "Not created yet. Prepare my Sheet creates it with 5 portions found in your header.",
    });
    expect(facts.seedPortions).toBe(5);
    expect(facts.portionsOn).toBeNull();
    expect(fake.calls).toEqual(["listTabs", "getManyValues", "getValues"]);
  });

  it("is waiting for the checks above on a fresh Sheet whose header cannot be read, and fails when the header cannot be turned into portions", async () => {
    const noHeader = baseSchedule();
    noHeader[2][0] = "When";
    const waiting = await run(sheet({ Schedule: noHeader, [SETTINGS_TAB]: null, [LOG_TAB]: null, [TENANTS_TAB]: null }));
    expect(byId(waiting.checks, "settings")).toMatchObject({ status: "skip", detail: WAITING });
    expect(waiting.facts.seedPortions).toBeNull();

    const odd = baseSchedule();
    odd[2][1] = "Tenant Name";
    const failing = await run(sheet({ Schedule: odd, [SETTINGS_TAB]: null, [LOG_TAB]: null, [TENANTS_TAB]: null }));
    const settings = byId(failing.checks, "settings");
    expect(settings.status).toBe("fail");
    expect(settings.detail).toContain("Tenant Name");
    expect(settings.fix).toBeTruthy();
  });

  it.each([
    ["the Payments Log and the Tenants tab", {}],
    ["the Payments Log", { [TENANTS_TAB]: null }],
    ["the Tenants tab", { [LOG_TAB]: null }],
  ])("is refused when it is missing beside %s: it is never recreated", async (_name, others) => {
    const { checks } = await run(sheet({ [SETTINGS_TAB]: null, ...others }));
    expect(byId(checks, "settings")).toMatchObject({
      status: "fail",
      detail:
        "The Settings tab is missing. Restore it from File > Version history or rename it back. RentBook will not recreate it because that would reset your rent cycle lengths and hike percentages.",
    });
    expect(byId(checks, "portion-settings").status).toBe("skip");
  });

  it("is to do when the tab is there with nothing in it but, at most, its headers", async () => {
    for (const grid of [[], [[...SETTINGS_HEADERS]], [[]]]) {
      const { checks } = await run(sheet({ [SETTINGS_TAB]: grid }));
      expect(byId(checks, "settings"), JSON.stringify(grid)).toMatchObject({
        status: "todo",
        detail: "Nothing in it yet. Prepare my Sheet fills it with 5 portions found in your header.",
      });
    }
  });

  it("fails with the words of the problem, and what to do, when a row cannot be read", async () => {
    const settings = settingsGrid();
    settings[3][0] = "p1";
    const { checks } = await run(sheet({ [SETTINGS_TAB]: settings }));
    const found = byId(checks, "settings");
    expect(found.status).toBe("fail");
    expect(found.detail).toBe('Settings rows 2 and 4 both use the portion id "p1". Give each portion its own id.');
    expect(found.fix).toBe("Make the header names in the Settings tab match the Schedule header row.");
    expect(byId(checks, "portion-settings").status).toBe("skip");
  });

  it("fails when a portion's header is not in the Schedule header row, and says which", async () => {
    const settings = settingsGrid();
    settings[2][2] = "Tenant9";
    const { checks } = await run(sheet({ [SETTINGS_TAB]: settings }));
    const found = byId(checks, "settings");
    expect(found.status).toBe("fail");
    expect(found.detail).toBe(
      'Header "Tenant9" was not found in the Schedule tab. Check the spelling in the Schedule header row (row 3) and in the Settings tab.',
    );
    expect(found.fix).toBe("Make the header names in the Settings tab match the Schedule header row.");
  });

  it("fails when two portions share a column, or a portion uses the total column", async () => {
    const shared = settingsGrid();
    shared[2][2] = "Tenant";
    expect(byId((await run(sheet({ [SETTINGS_TAB]: shared }))).checks, "settings").detail).toContain('both use the column headed "Tenant"');

    const total = settingsGrid();
    total[2][4] = "Total Rent";
    const found = byId((await run(sheet({ [SETTINGS_TAB]: total }))).checks, "settings");
    expect(found.status).toBe("fail");
    expect(found.detail).toContain('both use the column headed "Total Rent"');
  });

  it("checks the columns even when a month cell cannot be read, so a typo in Settings is not hidden behind it", async () => {
    const grid = baseSchedule();
    grid.splice(3, 0, ["Autumn"]);
    const settings = settingsGrid();
    settings[2][2] = "Tenant9";
    const { checks } = await run(sheet({ Schedule: grid, [SETTINGS_TAB]: settings }));
    expect(byId(checks, "months").status).toBe("fail");
    expect(byId(checks, "settings").detail).toContain('Header "Tenant9"');
    // and says the row of the header in the Sheet, not row 1
    expect(byId(checks, "settings").detail).toContain("(row 3)");
  });

  it("is waiting when the Schedule's header cannot be read, since the columns cannot be checked", async () => {
    const grid = baseSchedule();
    grid[2][0] = "When";
    const { checks } = await run(sheet({ Schedule: grid }));
    expect(byId(checks, "settings")).toMatchObject({ status: "skip", detail: WAITING });
    expect(byId(checks, "portion-settings").status).toBe("skip");
  });

  it("is waiting when there is no Schedule tab", async () => {
    const { checks } = await run(sheet({ Schedule: null }));
    expect(byId(checks, "settings")).toMatchObject({ status: "skip", detail: WAITING });
  });
});

describe("the Payments Log (step 5)", () => {
  it("counts the entries, one of them in the singular", async () => {
    const { checks, facts } = await run(sheet({ [LOG_TAB]: [[...LOG_HEADERS], logRow(SAVED_1)] }));
    expect(byId(checks, "log").detail).toBe("Headers are right. 1 entry.");
    expect(facts.logRows).toBe(1);
    expect(facts.lastSavedAt).toBe(SAVED_1);
  });

  it("has no entries yet when only its headers are there", async () => {
    const { checks, facts } = await run(sheet({ [LOG_TAB]: [[...LOG_HEADERS]] }));
    expect(byId(checks, "log")).toMatchObject({ status: "ok", detail: "Headers are right. 0 entries." });
    expect(facts.logRows).toBe(0);
    expect(facts.lastSavedAt).toBeNull();
  });

  it("is not created yet when the tab is missing, and has no headers yet when it is empty", async () => {
    const missing = await run(sheet({ [LOG_TAB]: null }));
    expect(byId(missing.checks, "log")).toMatchObject({ status: "todo", detail: "Not created yet." });
    expect(missing.facts.logRows).toBeNull();
    const empty = await run(sheet({ [LOG_TAB]: [] }));
    expect(byId(empty.checks, "log")).toMatchObject({ status: "todo", detail: "Empty. Prepare my Sheet writes its headers." });
  });

  it("warns when column H is headed with something else: that is where the app writes who logged each payment", async () => {
    const header = [...LOG_HEADERS];
    header[7] = "Remarks";
    const { checks } = await run(sheet({ [LOG_TAB]: [header, logRow(SAVED_1)] }));
    expect(byId(checks, "log")).toMatchObject({
      status: "warn",
      detail:
        'Column H is headed "Remarks", but RentBook still writes who logged each payment there, and Activity reads it from that column.',
      fix: "Move that column to the right of column I.",
    });
  });

  it("warns about column I too, and about both at once", async () => {
    const both = [...LOG_HEADERS];
    both[7] = "Remarks";
    both[8] = "Status";
    const found = byId((await run(sheet({ [LOG_TAB]: [both] }))).checks, "log");
    expect(found.status).toBe("warn");
    expect(found.detail).toBe(
      'Column H is headed "Remarks", but RentBook still writes who logged each payment there, and Activity reads it from that column. Column I is headed "Status", but RentBook still writes what was done (Logged, Edited or Undone) there, and Activity reads it from that column.',
    );
    expect(found.fix).toBe("Move those columns to the right of column I.");
    const second = [...LOG_HEADERS];
    second[8] = "Status";
    expect(byId((await run(sheet({ [LOG_TAB]: [second] }))).checks, "log").detail).toBe(
      'Column I is headed "Status", but RentBook still writes what was done (Logged, Edited or Undone) there, and Activity reads it from that column.',
    );
  });

  it("is fine with the older headers of seven columns: the two newer ones are added by the app", async () => {
    const { checks } = await run(sheet({ [LOG_TAB]: [LOG_HEADERS.slice(0, 7), logRow(SAVED_1).slice(0, 7)] }));
    expect(byId(checks, "log")).toMatchObject({
      status: "ok",
      detail: "Headers are right, and the newer headers (Logged by, Action) are added for you. 1 entry.",
    });
  });

  it("names only the newer header that is missing, when one of the two is there", async () => {
    const { checks } = await run(sheet({ [LOG_TAB]: [LOG_HEADERS.slice(0, 8), logRow(SAVED_1)] }));
    expect(byId(checks, "log")).toMatchObject({
      status: "ok",
      detail: "Headers are right, and the newer header (Action) is added for you. 1 entry.",
    });
  });

  it("shows no more of a header than a short stretch of plain text", async () => {
    const header = [...LOG_HEADERS];
    header[7] = `Remarks\n${"x".repeat(200)}`;
    const found = byId((await run(sheet({ [LOG_TAB]: [header] }))).checks, "log");
    expect(found.detail).not.toContain("\n");
    expect(found.detail.length).toBeLessThan(200);
  });

  it("takes the latest time in the Saved at column, and ignores a cell that is not a time", async () => {
    const rows = [[...LOG_HEADERS], logRow(SAVED_2), logRow("not a time CANARY"), logRow(SAVED_1), logRow(12345)];
    const { facts } = await run(sheet({ [LOG_TAB]: rows }));
    expect(facts.lastSavedAt).toBe(SAVED_2);
    expect(facts.logRows).toBe(4);
  });
});

describe("the Tenants tab (step 5)", () => {
  it("counts the rows, the current tenancies and the latest update", async () => {
    const { checks, facts } = await run(sheet());
    expect(byId(checks, "tenants")).toMatchObject({ status: "ok", detail: "Headers are right. 3 rows." });
    expect(facts.tenantsRows).toBe(3);
    expect(facts.openTenancies).toBe(2);
    expect(facts.lastUpdatedAt).toBe(UPDATED_2);
  });

  it("counts a Move-out date of only spaces as a current tenancy", async () => {
    const { facts } = await run(sheet({ [TENANTS_TAB]: [[...TENANT_HEADERS], tenantRow({ 12: "  " })] }));
    expect(facts.openTenancies).toBe(1);
  });

  it("says 1 row in the singular, and 0 rows for a tab of headers", async () => {
    expect(byId((await run(sheet({ [TENANTS_TAB]: [[...TENANT_HEADERS], tenantRow()] }))).checks, "tenants").detail).toBe("Headers are right. 1 row.");
    const none = await run(sheet({ [TENANTS_TAB]: [[...TENANT_HEADERS]] }));
    expect(byId(none.checks, "tenants").detail).toBe("Headers are right. 0 rows.");
    expect(none.facts.lastUpdatedAt).toBeNull();
  });

  it("is not created yet when the tab is missing, and has no headers yet when it is empty", async () => {
    const missing = await run(sheet({ [TENANTS_TAB]: null }));
    expect(byId(missing.checks, "tenants")).toMatchObject({ status: "todo", detail: "Not created yet." });
    expect(missing.facts.tenantsRows).toBeNull();
    expect(byId((await run(sheet({ [TENANTS_TAB]: [] }))).checks, "tenants")).toMatchObject({
      status: "todo",
      detail: "Empty. Prepare my Sheet writes its headers.",
    });
  });

  it("fails with the header message, and says logging rent still works, when a header is wrong", async () => {
    const header = [...TENANT_HEADERS];
    header[3] = "Mobile";
    const { checks, facts } = await run(sheet({ [TENANTS_TAB]: [header, tenantRow()] }));
    const found = byId(checks, "tenants");
    expect(found.status).toBe("fail");
    expect(found.detail).toBe(
      'The Tenants tab must have "Phone" in column D (found "Mobile"). Columns A to O must keep the 15 Tenants headers in their original order; extra columns may go to the right. Logging rent still works.',
    );
    expect(facts.tenantsRows).toBeNull();
    expect(facts.openTenancies).toBeNull();
  });

  it("accepts the headers in any case or spacing, as the app does", async () => {
    const header = TENANT_HEADERS.map((name, index) => (index === 0 ? "  tenancy  ID" : name.toUpperCase()));
    expect(byId((await run(sheet({ [TENANTS_TAB]: [header, tenantRow()] }))).checks, "tenants").status).toBe("ok");
  });

  it("ignores a time in the Updated at column that is not one, and keeps the latest of the rest", async () => {
    const rows = [[...TENANT_HEADERS], tenantRow({ 14: "last Tuesday CANARY" }), tenantRow({ 0: "t-2", 14: UPDATED_1 })];
    const { facts } = await run(sheet({ [TENANTS_TAB]: rows }));
    expect(facts.lastUpdatedAt).toBe(UPDATED_1);
  });
});

describe("portion settings (step 6)", () => {
  it("is a reminder to check each portion's cycle and hike, once Settings is there", async () => {
    expect(byId((await run(sheet())).checks, "portion-settings")).toMatchObject({
      status: "ok",
      detail: "Check each portion's payments per cycle and hike before the first payment.",
    });
  });

  it("is to do while Settings does not exist", async () => {
    expect(byId((await run(fresh())).checks, "portion-settings")).toMatchObject({
      status: "todo",
      detail: "Check each portion's payments per cycle and hike before the first payment.",
    });
  });
});

describe("a fresh Sheet, with the Schedule alone", () => {
  it("has three things to do, and the rest OK, with the number of portions Settings would start with", async () => {
    const { checks, facts } = await run(fresh());
    expect(statuses(checks)).toEqual({
      connection: "ok",
      "schedule-tab": "ok",
      "header-row": "ok",
      months: "ok",
      "row-below": "ok",
      total: "ok",
      settings: "todo",
      log: "todo",
      tenants: "todo",
      "portion-settings": "todo",
    });
    expect(facts).toMatchObject({ seedPortions: 5, monthRows: 2, logRows: null, tenantsRows: null, portionsOn: null });
  });

  it("reads only the Schedule: the three tabs that are not there are not asked for", async () => {
    const fake = fresh();
    const many = vi.spyOn(fake, "getManyValues");
    await run(fake);
    expect(many.mock.calls[0][0]).toEqual([{ tab: "Schedule", a1: "A1:ZZ" }]);
  });

  it("makes no read of the data at all when none of the four tabs is there", async () => {
    const fake = new FakeGateway({ Notes: [["x"]] });
    const { checks, facts } = await run(fake);
    expect(fake.calls).toEqual(["listTabs"]);
    expect(byId(checks, "schedule-tab").status).toBe("fail");
    expect(byId(checks, "settings").status).toBe("skip");
    expect(byId(checks, "log").status).toBe("todo");
    expect(byId(checks, "tenants").status).toBe("todo");
    expect(facts.readMs).toBeNull();
  });
});

describe("the real titles of the tabs", () => {
  it("shows the Schedule tab's real title, which can differ from the name set by case or spacing", async () => {
    const { checks } = await checkSheet(sheet(), { ...OPTIONS, realTitles: () => ({ schedule: "schedule " }) });
    expect(byId(checks, "schedule-tab").detail).toBe('Found the tab "schedule".');
  });

  it("shows an app tab's real title where it is not the app's usual name for it, and nothing extra where it is", async () => {
    const { checks } = await checkSheet(sheet(), {
      ...OPTIONS,
      realTitles: () => ({ schedule: "Schedule", settings: "Settings", log: "payments log", tenants: "RentBook Tenants" }),
    });
    expect(byId(checks, "settings").detail).toBe("5 portions, each with its Tenant, Count and Amount columns.");
    expect(byId(checks, "log").detail).toBe('Found as "payments log". Headers are right. 2 entries.');
    expect(byId(checks, "tenants").detail).toBe('Found as "RentBook Tenants". Headers are right. 3 rows.');
  });

  it("shows it beside a problem too, and never an unprintable stretch of it", async () => {
    const header = [...TENANT_HEADERS];
    header[3] = "Mobile";
    const { checks } = await checkSheet(sheet({ [TENANTS_TAB]: [header] }), {
      ...OPTIONS,
      realTitles: () => ({ tenants: `RentBook\nTenants ${"x".repeat(100)}` }),
    });
    const detail = byId(checks, "tenants").detail;
    expect(detail.startsWith('Found as "RentBook Tenants xxx')).toBe(true);
    expect(detail).not.toContain("\n");
    expect(detail).toContain("Logging rent still works.");
  });

  it("asks for the titles once the tab list is in, and copes with an answer of null", async () => {
    const fake = sheet();
    let asked = 0;
    const { checks } = await checkSheet(fake, {
      ...OPTIONS,
      realTitles: () => {
        asked += 1;
        expect(fake.calls).toEqual(["listTabs"]);
        return null;
      },
    });
    expect(asked).toBe(1);
    expect(byId(checks, "schedule-tab").detail).toBe('Found the tab "Schedule".');
  });

  it("shows nothing for a tab that was not found", async () => {
    const { checks } = await checkSheet(fresh(), { ...OPTIONS, realTitles: () => ({ schedule: "Schedule", settings: null, log: null, tenants: null }) });
    expect(byId(checks, "settings").detail).toBe("Not created yet. Prepare my Sheet creates it with 5 portions found in your header.");
    expect(byId(checks, "log").detail).toBe("Not created yet.");
  });
});

describe("an app tab with a name of the owner's own that is not in the Sheet", () => {
  const names = { settings: "My Settings", log: "My Log", tenants: "RentBook Tenants" };

  it("says to rename the tab in the Sheet first, because Prepare my Sheet would start a new one", async () => {
    const { checks } = await checkSheet(fresh(), { ...OPTIONS, appTabNames: names });
    expect(byId(checks, "settings")).toMatchObject({ status: "todo" });
    expect(byId(checks, "settings").detail).toBe(
      'Not created yet. Prepare my Sheet creates it with 5 portions found in your header. SETTINGS_TAB ("My Settings") names a tab that is not in your Sheet yet. If you already have it under another name, rename it in your Sheet first, then use Check again: Prepare my Sheet would start a new Settings tab with the default payments per cycle and hike and leave the old one alone.',
    );
    expect(byId(checks, "log")).toMatchObject({ status: "todo" });
    expect(byId(checks, "log").detail).toBe(
      'Not created yet. LOG_TAB ("My Log") names a tab that is not in your Sheet yet. If you already have it under another name, rename it in your Sheet first, then use Check again: Prepare my Sheet would start a new, empty Payments Log tab and leave the old one alone.',
    );
    expect(byId(checks, "tenants").detail).toContain('TENANTS_TAB ("RentBook Tenants") names a tab that is not in your Sheet yet. If you already have it under another name, rename it in your Sheet first');
  });

  it("says nothing of the kind for a tab with its usual name, or when no names are given", async () => {
    for (const options of [OPTIONS, { ...OPTIONS, appTabNames: { settings: "Settings", log: "Payments Log", tenants: "Tenants" } }]) {
      const { checks } = await checkSheet(fresh(), options);
      for (const id of ["settings", "log", "tenants"]) expect(byId(checks, id).detail, id).not.toContain("rename it in your Sheet");
    }
  });

  it("says nothing of it once the tab is there", async () => {
    const { checks } = await checkSheet(sheet(), { ...OPTIONS, appTabNames: names });
    for (const id of ["settings", "log", "tenants"]) expect(byId(checks, id).detail, id).not.toContain("rename it in your Sheet");
  });

  it("names the owner's tab when the Settings tab is missing beside the others, which are never recreated", async () => {
    const { checks } = await checkSheet(sheet({ [SETTINGS_TAB]: null }), { ...OPTIONS, appTabNames: names });
    expect(byId(checks, "settings").detail).toContain('Settings tab, "My Settings", is missing.');
  });
});

describe("what a check may carry", () => {
  const CANARIES = [
    "CANARY-tenant-name",
    "98700 CANARY phone",
    "7654321",
    "CANARY-note",
    "CANARY-footer",
    "CANARY-owner@example.com",
    "CANARY-advance-status",
  ];
  const [tenant, phone, amount, note, footer, who] = CANARIES;

  /** A Sheet with a canary in every place a person's data can be, beside the places the checks read. */
  function loaded(): FakeGateway {
    const schedule = baseSchedule();
    schedule[3] = scheduleRow(monthCell("text", 2026, 8), [[tenant, 2, Number(amount)], [tenant, 10, 12700], null, null, null], 4);
    schedule.push([footer, footer, 1, 1]);
    const settings = settingsGrid();
    settings[1][1] = "CANARY-portion-name";
    return sheet({
      Schedule: schedule,
      [SETTINGS_TAB]: settings,
      [LOG_TAB]: [[...LOG_HEADERS], [SAVED_1, "2026-08", "p1", tenant, Number(amount), 2, "2026-08-05", who, "Logged"]],
      [TENANTS_TAB]: [[...TENANT_HEADERS], tenantRow({ 2: tenant, 3: phone, 6: Number(amount), 11: note, 13: who })],
    });
  }

  it("is counts, times, header texts and tab titles: no tenant, phone, amount, note, person or portion name", async () => {
    const result = await run(loaded());
    const text = JSON.stringify(result);
    for (const canary of [...CANARIES, "CANARY"]) expect(text, canary).not.toContain(canary);
    expect(byId(result.checks, "row-below").status).toBe("warn");
  });

  it("holds none of it when a part of the Sheet is wrong either", async () => {
    const fake = loaded();
    fake.tabs.get(TENANTS_TAB)![0][3] = "Mobile";
    fake.tabs.get(SETTINGS_TAB)![2][2] = "Tenant9";
    fake.tabs.get("Schedule")!.splice(3, 0, ["Autumn", tenant, 1, Number(amount)]);
    const text = JSON.stringify(await run(fake));
    for (const canary of [...CANARIES, "CANARY"]) expect(text, canary).not.toContain(canary);
  });

  it("holds none of it for a Settings row that cannot be read, or a portion id that is wrong", async () => {
    const fake = loaded();
    fake.tabs.get(SETTINGS_TAB)![2] = ["bad id!!", "CANARY-portion-name", "Tenant2", "Count2", "Amount2", 11, 5];
    const text = JSON.stringify(await run(fake));
    expect(text).not.toContain("CANARY-portion-name");
  });
});

describe("the checks as a whole", () => {
  it("never has a fix on a check that is OK, to do or waiting, and the statuses are from the usual five", async () => {
    const results = [await run(sheet()), await run(fresh()), await run(sheet({ Schedule: null }))];
    const allowed: CheckStatus[] = ["ok", "warn", "fail", "todo", "skip"];
    for (const { checks } of results) {
      for (const check of checks) {
        expect(allowed).toContain(check.status);
        if (check.status === "ok" || check.status === "todo" || check.status === "skip") expect(check.fix, check.id).toBeUndefined();
      }
    }
  });
});
