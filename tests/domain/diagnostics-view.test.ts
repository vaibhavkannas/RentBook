import { describe, expect, it } from "vitest";
import { diagnosticsRows, type DiagnosticsInput } from "@/lib/diagnostics-view";
import type { Check, CheckStatus } from "@/lib/setup-checks";
import type { SheetFacts } from "@/lib/sheets/sheet-checks";

// What Diagnostics says: how the app and the Sheet are doing, in plain rows, from the checks, the counts and times and the
// problems this server has logged. Pure, so the words can be tested with every state of the Sheet.

const check = (id: string, status: CheckStatus, step: Check["step"] = 4, detail = "Detail."): Check => ({ id, step, title: id, status, detail });

const OK_CHECKS: Check[] = [
  check("auth-secret", "ok", 1),
  check("service-account", "ok", 2),
  check("connection", "ok", 3, "RentBook can open your Sheet (12 ms)."),
  check("schedule-tab", "ok"),
  check("months", "ok"),
  check("settings", "ok", 5),
  check("log", "ok", 5),
  check("tenants", "ok", 5),
  check("portion-settings", "ok", 6),
];

const FACTS: SheetFacts = {
  listMs: 12,
  readMs: 42,
  monthRows: 14,
  firstMonth: "2025-10",
  lastMonth: "2026-11",
  portionsOn: 4,
  portionsOff: 1,
  seedPortions: null,
  logRows: 120,
  lastSavedAt: "2026-10-05T04:30:00.000Z",
  tenantsRows: 9,
  openTenancies: 4,
  lastUpdatedAt: "2026-10-04T05:00:00.000Z",
};

const PROBLEMS = { since: "2026-10-16T05:30:00.000Z", warn: {}, error: {} };

const input = (changes: Partial<DiagnosticsInput> = {}): DiagnosticsInput => ({
  version: "0.1.0",
  checks: OK_CHECKS,
  facts: FACTS,
  problems: PROBLEMS,
  appTabNames: { settings: "Settings", log: "Payments Log", tenants: "Tenants" },
  realTitles: null,
  setupHref: "/setup",
  ...changes,
});

const section = (id: string, changes: Partial<DiagnosticsInput> = {}) => {
  const found = diagnosticsRows(input(changes)).filter((entry) => entry.id === id);
  expect(found, id).toHaveLength(1);
  return found[0];
};
const texts = (id: string, changes: Partial<DiagnosticsInput> = {}) => section(id, changes).rows.map((row) => row.text);

describe("diagnosticsRows", () => {
  it("has four sections, App, Google Sheet, Tabs and Problems, in that order", () => {
    expect(diagnosticsRows(input()).map((entry) => [entry.id, entry.title])).toEqual([
      ["app", "App"],
      ["sheet", "Google Sheet"],
      ["tabs", "Tabs"],
      ["problems", "Problems"],
    ]);
  });
});

describe("the App section", () => {
  it("says the version, when this server started (India time) and how many settings checks are OK, with a link to Set up", () => {
    const app = section("app");
    expect(app.rows.map((row) => row.text)).toEqual([
      "Version 0.1.0",
      "This server started 16 Oct, 11:00 am",
      "Settings: 9 of 9 OK",
    ]);
    expect(app.rows[2].link).toEqual({ href: "/setup", label: "Open Set up" });
    expect(app.rows[0].link).toBeUndefined();
  });

  it("counts the checks that are not OK as the difference, whatever they are", () => {
    const checks = [...OK_CHECKS, check("a", "warn"), check("b", "fail"), check("c", "todo", 5), check("d", "skip", 4)];
    expect(texts("app", { checks })[2]).toBe("Settings: 9 of 13 OK");
  });

  it("keeps the link to Set up that the page gives it, which carries the month", () => {
    expect(section("app", { setupHref: "/setup?month=2026-10" }).rows[2].link?.href).toBe("/setup?month=2026-10");
  });

  it("says the start time as it is when it cannot be read", () => {
    expect(texts("app", { problems: { ...PROBLEMS, since: "not a time" } })[1]).toBe("This server started not a time");
  });
});

describe("the Google Sheet section", () => {
  it("is reachable, with how long the tab list and the data took", () => {
    const sheet = section("sheet");
    expect(sheet.rows).toEqual([
      { text: "Answered in 12 ms (tab list) and 42 ms (data).", pill: { tone: "success", label: "Reachable" } },
    ]);
  });

  it("gives only the time of the tab list when no data was read", () => {
    expect(texts("sheet", { facts: { ...FACTS, readMs: null } })).toEqual(["Answered in 12 ms (tab list)."]);
  });

  it("is not reachable, with the reason the connection check gave", () => {
    const checks = OK_CHECKS.map((entry) =>
      entry.id === "connection" ? { ...entry, status: "fail" as const, detail: "Share the Sheet with robot@example.com, as an Editor." } : entry,
    );
    expect(section("sheet", { checks }).rows).toEqual([
      { text: "Share the Sheet with robot@example.com, as an Editor.", pill: { tone: "danger", label: "Not reachable" } },
    ]);
  });

  it("says the Sheet was not tried when the settings are too wrong to open it, in words that fit this page", () => {
    const checks = OK_CHECKS.map((entry) =>
      entry.id === "connection" ? { ...entry, status: "skip" as const, detail: "Fix the settings above first." } : entry,
    );
    const rows = section("sheet", { checks, facts: null }).rows;
    expect(rows).toEqual([
      {
        text: "The settings need fixing before the Sheet can be tried.",
        pill: { tone: "danger", label: "Not reachable" },
        link: { href: "/setup", label: "Open Set up" },
      },
    ]);
  });
});

describe("the Tabs section", () => {
  it("says what each tab holds: month rows, portions, log entries and tenancies", () => {
    expect(texts("tabs")).toEqual([
      "Schedule: 14 month rows, October 2025 to November 2026",
      "Settings: 4 portions on, 1 switched off",
      "Payments Log: 120 entries, last saved 5 Oct, 10:00 am",
      "Tenants: 9 rows, 4 current",
    ]);
  });

  it("says one of each in the singular", () => {
    const facts = { ...FACTS, monthRows: 1, firstMonth: "2026-10", lastMonth: "2026-10", portionsOn: 1, portionsOff: 0, logRows: 1, tenantsRows: 1, openTenancies: 1 };
    expect(texts("tabs", { facts })).toEqual([
      "Schedule: 1 month row, October 2026 to October 2026",
      "Settings: 1 portion on, 0 switched off",
      "Payments Log: 1 entry, last saved 5 Oct, 10:00 am",
      "Tenants: 1 row, 1 current",
    ]);
  });

  it("leaves out the last saved time of a log with no entry, or none that is a time", () => {
    expect(texts("tabs", { facts: { ...FACTS, logRows: 0, lastSavedAt: null } })[2]).toBe("Payments Log: 0 entries");
    expect(texts("tabs", { facts: { ...FACTS, lastSavedAt: null } })[2]).toBe("Payments Log: 120 entries, no saved time recorded");
  });

  it("says Not created yet for an app tab that is missing", () => {
    const checks = OK_CHECKS.map((entry) => (["settings", "log", "tenants"].includes(entry.id) ? { ...entry, status: "todo" as const } : entry));
    const facts = { ...FACTS, portionsOn: null, portionsOff: null, logRows: null, lastSavedAt: null, tenantsRows: null, openTenancies: null };
    expect(texts("tabs", { checks, facts })).toEqual([
      "Schedule: 14 month rows, October 2025 to November 2026",
      "Settings: Not created yet",
      "Payments Log: Not created yet",
      "Tenants: Not created yet",
    ]);
  });

  it("says a tab cannot be read, and to look at Set up, when a check of it failed", () => {
    const checks = OK_CHECKS.map((entry) =>
      entry.id === "tenants" || entry.id === "months" ? { ...entry, status: "fail" as const } : entry,
    );
    const facts = { ...FACTS, monthRows: null, firstMonth: null, lastMonth: null, tenantsRows: null, openTenancies: null };
    const rows = texts("tabs", { checks, facts });
    expect(rows[0]).toBe("Schedule: the month rows can't be read (see Set up)");
    expect(rows[3]).toBe("Tenants: can't be read (see Set up)");
  });

  it("says the Schedule tab was not found", () => {
    const checks = OK_CHECKS.map((entry) => (entry.id === "schedule-tab" ? { ...entry, status: "fail" as const } : entry));
    expect(texts("tabs", { checks, facts: { ...FACTS, monthRows: null, firstMonth: null, lastMonth: null } })[0]).toBe("Schedule: tab not found");
  });

  it("says nothing was read when the Sheet could not be opened, rather than that a tab is missing", () => {
    const checks = OK_CHECKS.map((entry) => (entry.step >= 4 || entry.id === "connection" ? { ...entry, status: "skip" as const } : entry));
    expect(texts("tabs", { checks, facts: null })).toEqual([
      "Schedule: not read",
      "Settings: not read",
      "Payments Log: not read",
      "Tenants: not read",
    ]);
  });

  it("shows the real title of a tab where it is not the usual name, and says when a named tab is not there yet", () => {
    const realTitles = { schedule: "rent", settings: "Settings", log: "payments log", tenants: "RentBook Tenants" };
    expect(texts("tabs", { realTitles })).toEqual([
      'Schedule ("rent"): 14 month rows, October 2025 to November 2026',
      "Settings: 4 portions on, 1 switched off",
      'Payments Log ("payments log"): 120 entries, last saved 5 Oct, 10:00 am',
      'Tenants ("RentBook Tenants"): 9 rows, 4 current',
    ]);
    const checks = OK_CHECKS.map((entry) => (entry.id === "tenants" ? { ...entry, status: "todo" as const } : entry));
    const tabs = section("tabs", { checks, appTabNames: { settings: "Settings", log: "Payments Log", tenants: "RentBook Tenants" } });
    expect(tabs.rows[3].text).toBe("Tenants: Not created yet");
    expect(tabs.note).toBe(
      "TENANTS_TAB names a tab that is not in your Sheet yet. If you already have it under another name, rename it in your Sheet first (see Set up).",
    );
  });

  it("names every variable, in the plural, when several named tabs are missing", () => {
    const checks = OK_CHECKS.map((entry) => (["settings", "tenants"].includes(entry.id) ? { ...entry, status: "todo" as const } : entry));
    const tabs = section("tabs", { checks, appTabNames: { settings: "My Settings", log: "Payments Log", tenants: "RentBook Tenants" } });
    expect(tabs.note).toBe(
      "SETTINGS_TAB and TENANTS_TAB name tabs that are not in your Sheet yet. If you already have them under other names, rename them in your Sheet first (see Set up).",
    );
  });

  it("has no note about a tab name when every tab is where it should be, or is missing under its usual name", () => {
    expect(section("tabs").note).toBeUndefined();
    const checks = OK_CHECKS.map((entry) => (entry.id === "log" ? { ...entry, status: "todo" as const } : entry));
    expect(section("tabs", { checks }).note).toBeUndefined();
  });
});

describe("the Problems section", () => {
  const NOTE = "Each server instance counts on its own and starts from zero when it restarts.";

  it("says no problems were logged, since when, and that each server counts on its own", () => {
    const problems = section("problems");
    expect(problems.rows.map((row) => row.text)).toEqual(["No problems logged since 16 Oct, 11:00 am."]);
    expect(problems.note).toBe(NOTE);
  });

  it("counts the errors and the warnings, and names the codes, the most frequent first", () => {
    const counts = { since: PROBLEMS.since, warn: { "rate-limited": 3, unavailable: 1 }, error: { config: 2 } };
    expect(texts("problems", { problems: counts })).toEqual([
      "Since 16 Oct, 11:00 am on this server: 2 errors, 4 warnings (rate-limited 3, config 2, unavailable 1).",
    ]);
    expect(section("problems", { problems: counts }).note).toBe(NOTE);
  });

  it("says one error and one warning in the singular, and adds up a code that is both", () => {
    expect(texts("problems", { problems: { since: PROBLEMS.since, warn: { x: 1 }, error: { x: 1 } } })).toEqual([
      "Since 16 Oct, 11:00 am on this server: 1 error, 1 warning (x 2).",
    ]);
  });

  it("says zero of the kind there is none of", () => {
    expect(texts("problems", { problems: { since: PROBLEMS.since, warn: { "rate-limited": 2 }, error: {} } })).toEqual([
      "Since 16 Oct, 11:00 am on this server: 0 errors, 2 warnings (rate-limited 2).",
    ]);
  });

  it("lists at most six codes, and says how many more there are", () => {
    const error = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`code-${index + 1}`, 10 - index]));
    const [text] = texts("problems", { problems: { since: PROBLEMS.since, warn: {}, error } });
    expect(text).toContain("code-1 10, code-2 9, code-3 8, code-4 7, code-5 6, code-6 5 and 3 more");
    expect(text).not.toContain("code-7");
  });

  it("puts codes with the same count in alphabetical order, so the line does not change between visits", () => {
    const [text] = texts("problems", { problems: { since: PROBLEMS.since, warn: { b: 2, a: 2, c: 2 }, error: {} } });
    expect(text).toContain("(a 2, b 2, c 2)");
  });

  it("holds the codes and counts and nothing else", () => {
    const rows = diagnosticsRows(input({ problems: { since: PROBLEMS.since, warn: { "rate-limited": 3 }, error: { config: 1 } } }));
    expect(JSON.stringify(rows)).not.toMatch(/message|viewer|requestId/);
  });
});
